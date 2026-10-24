// Builds the teacher's index of all marking batches: one card per batch, linking
// to its review page.
//
//   node tools/review-hub.mjs [--data <dir>]
//
// Reads batches/*/ (assessment.json, <id>.draft.json, <id>.review.json, review.html),
// results/*.json and items.json. Writes review/index.html in the DATA folder,
// never in the repository, and it is never published.
// review-page.mjs and results-from-review.mjs call it at the end, so the index
// is fresh after every new review page and every approval.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataDir, readCsv } from './lib.mjs';
import { objDefault } from '../review/feedback-core.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (Math.round(n * 100) / 100).toString();
const date = (ymd) => (ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }) : null);
const day = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null);

// Score of one draft record, the same way the review page counts it.
function draftScore(A, d) {
  const V = A.versions?.[d.v]; if (!V) return null;
  const s = { ...d, ans: (d.mcq ?? '') + (d.tf ?? '') };
  const obj = (V.objective ?? []).reduce((t, o, i) => t + objDefault(o, i, s), 0);
  const sh = (d.short ?? []).map((q) => q.marks ?? []);
  return obj + sh.flat().reduce((t, x) => t + (+x || 0), 0);
}

export function collect(DATA) {
  const items = readJson(path.join(DATA, 'items.json'))?.items ?? [];
  const rosterSize = fs.existsSync(path.join(DATA, 'roster.csv')) ? readCsv(path.join(DATA, 'roster.csv')).length : null;
  const bdir = path.join(DATA, 'batches');
  const names = fs.existsSync(bdir) ? fs.readdirSync(bdir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  return names.map((name) => {
    const dir = path.join(bdir, name);
    const A = readJson(path.join(dir, 'assessment.json'));
    const id = A?.id ?? name;
    const item = items.find((i) => i.id === id);
    const raw = readJson(path.join(dir, `${name}.draft.json`));
    const draft = Array.isArray(raw) ? raw : [];
    const review = readJson(path.join(dir, `${name}.review.json`));
    const results = readJson(path.join(DATA, item?.results ?? `results/${id}.json`));
    const hasPage = fs.existsSync(path.join(dir, 'review.html'));
    const reviewed = review ? Object.values(review.students ?? {}).filter((s) => s.reviewed).length : 0;
    const scores = results?.students
      ? Object.values(results.students).filter((s) => typeof s.score === 'number').map((s) => s.score)
      : A ? draft.map((d) => draftScore(A, d)).filter((x) => x != null) : [];
    const published = item?.state === 'published' && results?.approved === true;
    const status = published ? 'published' : results?.approved ? 'approved' : review ? 'saved' : 'draft';
    return {
      name, id, hasPage,
      title: A?.title ?? item?.title ?? name, titleAr: A?.titleAr ?? null,
      practice: A ? !!A.practice : item ? !item.graded : false,
      max: A?.max ?? item?.max ?? null, weight: A?.weight ?? item?.weight ?? null,
      date: A?.date ?? item?.date ?? null,
      sheets: draft.length || (results?.students ? Object.values(results.students).filter((s) => s.status !== 'not_submitted').length : 0), rosterSize, reviewed, savedAt: review?.savedAt ?? null,
      approvedOn: results?.approvedOn ?? null, status,
      mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      order: item ? items.indexOf(item) : 999,
    };
  });
}

const STATUS = {
  draft: ['مسودة', 'لم تُحفظ مراجعة بعد'],
  saved: ['محفوظة', 'حُفظت مراجعة ولم تُعتمد'],
  approved: ['معتمدة', 'اعتُمدت ولم تُنشر'],
  published: ['منشورة', 'يراها الطلبة في صفحاتهم'],
};
const RANK = { saved: 0, draft: 1, approved: 2, published: 3 };

export function render(batches, builtAt = new Date()) {
  const list = [...batches].sort((a, b) => RANK[a.status] - RANK[b.status] || a.order - b.order || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, batches.filter((b) => b.status === k).length]));
  const card = (b) => {
    const pct = b.sheets ? Math.round((b.reviewed / b.sheets) * 100) : 0;
    const meta = [
      `الأوراق ${b.sheets}${b.rosterSize ? ` · الطلبة ${b.rosterSize}` : ''}`,
      b.max ? `الدرجة من ${b.max}${b.weight ? ` · @@PCT${b.weight}@@ من درجة المقرر` : ''}` : null,
      b.mean != null ? `المتوسط ${fmt(b.mean)}` : null,
    ].filter(Boolean);
    const when = b.status === 'published' || b.status === 'approved'
      ? (b.approvedOn ? `اعتُمدت في ${esc(date(b.approvedOn))}` : '')
      : b.savedAt ? `آخر حفظ: ${esc(day(b.savedAt))}` : 'لم تُحفظ بعد';
    const body = `
      <div class="row1">
        <span class="badge ${b.status}">${STATUS[b.status][0]}</span>
        <span class="kind">${b.practice ? 'للتدريب' : 'محسوب'}</span>
      </div>
      <h2 dir="auto">${esc(b.titleAr ?? b.title)}</h2>
      <p class="en" dir="ltr" lang="en">${esc(b.title)} · <span class="mono">${esc(b.id)}</span></p>
      <p class="meta">${meta.map(esc).join(' · ').replace(/@@PCT([\d.]+)@@/g, '<bdi dir="ltr">$1%</bdi>')}</p>
      ${b.hasPage && !(b.reviewed === 0 && (b.status === 'published' || b.status === 'approved')) ? `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${b.sheets}" aria-valuenow="${b.reviewed}" aria-label="نسبة المراجعة"><span style="width:${pct}%"></span></div>
      <p class="meta">رُوجع <b>${b.reviewed}</b> من ${b.sheets}${pct === 100 ? ' — اكتملت' : ''}</p>` : ''}
      ${b.reviewed === 0 && (b.status === 'published' || b.status === 'approved') ? '<p class="meta">اعتُمدت كما في المسودة، بلا تعديلات محفوظة</p>' : ''}
      <p class="when">${when} · ${STATUS[b.status][1]}</p>
      ${b.hasPage ? '<span class="go">افتح صفحة المراجعة ←</span>' : '<span class="go none">بلا صفحة مراجعة (روجعت قبل وجودها)</span>'}`;
    return b.hasPage
      ? `<li><a class="card" href="../batches/${encodeURIComponent(b.name)}/review.html">${body}</a></li>`
      : `<li><div class="card off">${body}</div></li>`;
  };
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>صفحات المراجعة · SEC2021</title>
<style>
:root {
  --bg: #F7F4EE; --surface: #FFFFFF; --surface-2: #EFEAE0; --ink: #172426; --muted: #4F5D60; --line: #DED7C9;
  --primary: #1B4D57; --accent: #D4A958; --accent-ink: #7A5512; --focus: #B8862F;
  --b-draft: #E1EEF0; --b-draft-ink: #1B4D57; --b-saved: #FBF0DF; --b-saved-ink: #7A5512;
  --b-approved: #E3EEF8; --b-approved-ink: #1D4466; --b-published: #E3F1E7; --b-published-ink: #1D5632;
  --shadow: 0 1px 2px rgba(23,36,38,.06), 0 4px 16px rgba(23,36,38,.06);
  --arabic: "Segoe UI", Tahoma, "Tajawal", "Noto Naskh Arabic", Arial, sans-serif; --latin: "Segoe UI", system-ui, Roboto, Arial, sans-serif;
  --mono: Consolas, ui-monospace, monospace; color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0F1719; --surface: #172326; --surface-2: #1F2E32; --ink: #EEF1EE; --muted: #AEBBBD; --line: #2F4146;
    --primary: #8FCBD6; --accent-ink: #E6C27A; --focus: #E6C27A;
    --b-draft: #1D3A40; --b-draft-ink: #B5E0E8; --b-saved: #3A2E1C; --b-saved-ink: #F0CF9F;
    --b-approved: #1C2C3D; --b-approved-ink: #A9CBEB; --b-published: #1C3527; --b-published-ink: #A3DBB6;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.25); color-scheme: dark;
  }
}
:root[data-theme="dark"] {
    --bg: #0F1719; --surface: #172326; --surface-2: #1F2E32; --ink: #EEF1EE; --muted: #AEBBBD; --line: #2F4146;
    --primary: #8FCBD6; --accent-ink: #E6C27A; --focus: #E6C27A;
    --b-draft: #1D3A40; --b-draft-ink: #B5E0E8; --b-saved: #3A2E1C; --b-saved-ink: #F0CF9F;
    --b-approved: #1C2C3D; --b-approved-ink: #A9CBEB; --b-published: #1C3527; --b-published-ink: #A3DBB6;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.25); color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 var(--arabic); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.top { background: #1B4D57; color: #fff; padding: 18px 16px; border-bottom: 3px solid var(--accent); }
.top .in, main { max-width: 1100px; margin: 0 auto; }
.top .in { display: flex; align-items: center; gap: 12px; }
.top .in > div { flex: 1; }
.theme-btn { min-width: 44px; min-height: 40px; border: 1px solid rgba(255,255,255,.3); background: transparent; color: #fff; border-radius: 10px; cursor: pointer; font-size: 1.1rem; }
.top h1 { margin: 0; font-size: 1.35rem; }
.top p { margin: 2px 0 0; opacity: .85; font-size: .9rem; }
main { padding: 20px 16px 40px; }
.sum { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
.sum li { background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: .88rem; color: var(--muted); }
.sum b { color: var(--ink); }
.grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
.card { display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 16px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: var(--shadow); color: inherit; text-decoration: none; transition: border-color .15s, transform .15s; }
a.card:hover { border-color: var(--accent); transform: translateY(-1px); }
.card.off { opacity: .75; }
.row1 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.badge { font-size: .8rem; font-weight: 700; padding: 2px 10px; border-radius: 999px; }
.badge.draft { background: var(--b-draft); color: var(--b-draft-ink); }
.badge.saved { background: var(--b-saved); color: var(--b-saved-ink); }
.badge.approved { background: var(--b-approved); color: var(--b-approved-ink); }
.badge.published { background: var(--b-published); color: var(--b-published-ink); }
.kind { font-size: .8rem; color: var(--muted); }
.card h2 { margin: 6px 0 0; font-size: 1.12rem; }
.en { direction: ltr; text-align: right; font-family: var(--latin); color: var(--muted); margin: 0; font-size: .88rem; unicode-bidi: isolate; }
.mono { font-family: var(--mono); }
.meta { margin: 2px 0 0; font-size: .9rem; color: var(--muted); }
.meta b { color: var(--ink); }
.bar { height: 6px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: 8px; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.when { margin: 6px 0 0; font-size: .84rem; color: var(--muted); }
.go { margin-top: auto; padding-top: 10px; font-weight: 700; color: var(--primary); }
.go.none { font-weight: 400; color: var(--muted); }
.note { margin-top: 20px; font-size: .85rem; color: var(--muted); }
.note code { white-space: nowrap; font-family: var(--mono); direction: ltr; unicode-bidi: isolate; background: var(--surface-2); padding: 1px 6px; border-radius: 6px; }
</style>
</head>
<body>
<header class="top"><div class="in">
  <div><h1>صفحات المراجعة · SEC2021</h1>
  <p>صفحة داخلية للمدرّس فقط · لا تُنشر</p></div>
  <button class="theme-btn" id="themeBtn" type="button" aria-label="الوضع الفاتح أو الداكن" title="الوضع الفاتح أو الداكن"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="display:block;margin:auto"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg></button>
</div></header>
<main>
  <ul class="sum" aria-label="ملخص">
    <li>الدفعات <b>${batches.length}</b></li>
    ${Object.entries(STATUS).map(([k, [label]]) => `<li>${label} <b>${counts[k]}</b></li>`).join('\n    ')}
  </ul>
  <ul class="grid">
    ${list.map(card).join('\n    ')}
  </ul>
  <p class="note">حُدّثت هذه الصفحة ${esc(day(builtAt.toISOString()))}. الأرقام لقطة من لحظة توليدها؛ تتحدث تلقائياً مع كل صفحة مراجعة جديدة وكل اعتماد، أو بالأمر <code>node tools/review-hub.mjs</code>. بعد الحفظ في صفحة اختبار، أعد تحميل هذه الصفحة بعد توليدها لترى العدد الجديد.</p>
</main>
<script>
(function () {
  var KEY = 'sec2021-review-theme', root = document.documentElement;
  function apply(t) { if (t) root.dataset.theme = t; else delete root.dataset.theme; }
  try { apply(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
  document.getElementById('themeBtn').addEventListener('click', function () {
    var cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    apply(next); try { localStorage.setItem(KEY, next); } catch (e) { /* storage blocked */ }
  });
})();
</script>
</body>
</html>
`;
}

export function writeHub(DATA, log = console.log) {
  const out = path.join(DATA, 'review', 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const batches = collect(DATA);
  fs.writeFileSync(out, render(batches));
  log(`Review index: ${out} (${batches.length} batches).`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) writeHub(dataDir());
