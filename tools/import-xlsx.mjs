// Imports a batch that was already marked in Excel into the portal's format.
//
//   node tools/import-xlsx.mjs --roster                 writes roster.csv from the gradebook (if missing)
//   node tools/import-xlsx.mjs --batch MID              midterm: gradebook + essay review workbook
//   node tools/import-xlsx.mjs --batch Q1   (or Q2)     quizzes: gradebook
//
// Reads (all inside or next to the data folder, never from the repository):
//   gradebook.json                     where the workbooks are (paths relative to the data folder)
//   batches/<id>/content.json          the exam text that is not in Excel: titles, topics, explanations,
//                                      rubrics, the true/false key, page numbers, and the Arabic
//                                      feedback for each deducted essay part
// Writes:
//   batches/<id>/assessment.json       (keys taken from Excel, checked against content.json)
//   batches/<id>/<id>.draft.json       one record per student, matched by university ID
//   batches/<id>/import-report.csv     Excel total vs draft total per student (with names; stays local)
// Students are matched by the university ID in the gradebook and the sheet order table,
// never by the order of papers in the scan file.
// Prints the comparison with sheet numbers and masked IDs only, then refreshes the hub.
import fs from 'node:fs';
import path from 'node:path';
import { readXlsx } from './xlsx.mjs';
import { writeHub } from './review-hub.mjs';
import { dataDir, argValue, readCsv, writeCsv, writeJson, fail } from './lib.mjs';
import { objMax, totalOf } from '../review/feedback-core.js';

const DATA = dataDir();
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cfgPath = path.join(DATA, 'gradebook.json');
if (!fs.existsSync(cfgPath)) fail(`Missing ${cfgPath} — it says where the Excel workbooks are.`);
const cfg = readJson(cfgPath);
const wbPath = (rel) => { const p = path.resolve(DATA, rel); if (!fs.existsSync(p)) fail(`Workbook not found: ${p}`); return p; };
const r2 = (x) => Math.round(x * 100) / 100;
const mask = (id) => '…' + String(id).slice(-3);
const AR_LETTER = { 'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D' };
const letter = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s === '-' || s === '—') return '-';
  if (/^[A-D]$/i.test(s)) return s.toUpperCase();
  if (AR_LETTER[s]) return AR_LETTER[s];
  if (/^[xX]$|^خياران$/.test(s)) return 'X';
  fail(`Unreadable answer «${s}»`);
};
const head = (s) => String(s ?? '').split('\n')[0].trim();

// Header row = the row whose column A says «م» (or the given first header); returns { row, col(name) }.
function table(wb, sheet, first = 'م') {
  const rows = wb.rows(sheet);
  const h = rows.find((r) => head(r.cells.A) === first);
  if (!h) fail(`«${sheet}»: header row starting with «${first}» not found`);
  const cols = Object.fromEntries(Object.entries(h.cells).map(([c, v]) => [head(v), c]));
  const col = (name) => cols[name] ?? fail(`«${sheet}»: no column «${name}»`);
  return { rows: rows.filter((r) => r.row > h.row), col, has: (n) => n in cols };
}

function gradebookStudents(wb) {
  const t = table(wb, cfg.rosterSheet ?? 'النصفي');
  return t.rows.filter((r) => typeof r.cells.A === 'number').map((r) => ({
    serial: r.cells.A, name: String(r.cells[t.col('اسم الطالب')]).trim(), id: String(r.cells[t.col('الرقم الجامعي')]).trim(),
  }));
}

// ---------------- roster ----------------
if (process.argv.includes('--roster')) {
  const out = path.join(DATA, 'roster.csv');
  if (fs.existsSync(out)) fail(`${out} exists already. Nothing written.`);
  const wb = readXlsx(wbPath(cfg.gradebook));
  const list = gradebookStudents(wb);
  // the same IDs must appear on the quiz sheets
  for (const sheet of ['الكويز الأول', 'الكويز الثاني'].filter((s) => wb.sheetNames.includes(s))) {
    const t = table(wb, sheet);
    const ids = new Set(t.rows.filter((r) => typeof r.cells.A === 'number').map((r) => String(r.cells[t.col('الرقم الجامعي')]).trim()));
    for (const s of list) if (!ids.has(s.id)) fail(`${mask(s.id)} (sheet ${s.serial}) is missing from «${sheet}»`);
  }
  writeCsv(out, list.map((s) => ({ ...s, section: cfg.section ?? '' })), ['id', 'name', 'section', 'serial']);
  console.log(`roster.csv: ${list.length} students.`);
  process.exit(0);
}

// ---------------- batches ----------------
const batch = argValue('--batch') ?? fail('Give --batch MID, Q1 or Q2 (or --roster)');
const dir = path.join(DATA, 'batches', batch);
const contentPath = path.join(dir, 'content.json');
if (!fs.existsSync(contentPath)) fail(`Missing ${contentPath}`);
const C = readJson(contentPath);
const roster = readCsv(path.join(DATA, 'roster.csv'));
const bySerial = new Map(roster.map((s) => [Number(s.serial), s]));
const byId = new Map(roster.map((s) => [s.id, s]));
const gb = readXlsx(wbPath(cfg.gradebook));
const sameName = (a, b) => String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();

// scan position (order of sheets in the scan file) -> serial number in the signature sheet
function scanOrder(columnName) {
  const t = table(gb, 'ترتيب الأوراق', 'تسلسل الكشف');
  const map = new Map();
  for (const r of t.rows.filter((x) => typeof x.cells.A === 'number')) {
    const s = bySerial.get(r.cells.A) ?? fail(`«ترتيب الأوراق»: serial ${r.cells.A} is not in roster.csv`);
    if (!sameName(s.name, r.cells[t.col('اسم الطالب')])) fail(`«ترتيب الأوراق»: name for serial ${r.cells.A} differs from roster.csv`);
    const pos = r.cells[t.col(columnName)];
    if (typeof pos === 'number') map.set(pos, s);
  }
  return map;
}

function rulesFrom(wb, sheet = 'القواعد الحدية') {
  if (!wb.sheetNames.includes(sheet)) return [];
  const t = table(wb, sheet, 'الرمز');
  return t.rows.filter((r) => r.cells.A).map((r) => `${r.cells.A} · ${r.cells[t.col('أول ظهور')]}: ${r.cells[t.col('الحالة')]} ← ${r.cells[t.col('القاعدة المثبّتة')]}`);
}

let draft = [], excelTotal = new Map(), assessment;

if (batch === 'MID') {
  const sheetA = table(gb, 'النصفي');
  const items = table(gb, 'فقرات النصفي');
  const keyRow = items.rows.find((r) => head(r.cells.B) === 'مفتاح الإجابة') ?? fail('«فقرات النصفي»: key row not found');
  const q1cols = Array.from({ length: 16 }, (_, i) => items.col(`س1-${i + 1}`));
  const q2cols = Array.from({ length: 6 }, (_, i) => items.col(`س2-${i + 1}`));
  const key1 = q1cols.map((c) => letter(keyRow.cells[c])).join('');
  const key2 = C.tfKey ?? fail('content.json: tfKey missing');
  if (C.mcqKey && C.mcqKey !== key1) fail(`MCQ key in Excel (${key1}) differs from content.json (${C.mcqKey})`);
  const partNames = C.short.flatMap((q) => q.parts.map((p) => p.label));
  const scan = scanOrder(C.scanColumn ?? 'موضعه في ملف النصفي');

  // essay review workbook: one row per part and sheet
  const ew = readXlsx(wbPath(cfg.essays?.MID ?? fail('gradebook.json: essays.MID missing')));
  const et = table(ew, 'مراجعة المقالي', 'الفرع');
  const essay = new Map();
  for (const r of et.rows.filter((x) => x.cells.A)) {
    const part = String(r.cells.A).trim(), sheet = r.cells[et.col('الورقة')];
    const own = r.cells[et.col('درجتك')];
    const proposed = r.cells[et.col('المقترحة')], max = r.cells[et.col('من')];
    const mark = typeof own === 'number' ? own : proposed;
    if (!(mark >= 0 && mark <= max)) fail(`essay ${part} sheet ${sheet}: mark ${mark} outside 0–${max}`);
    essay.set(`${part}|${sheet}`, { mark, max, text: r.cells[et.col('النص كما قرأته')] ?? '', reason: r.cells[et.col('سبب الخصم / ملاحظة')] ?? '', own: typeof own === 'number' });
  }

  for (const r of sheetA.rows.filter((x) => typeof x.cells.A === 'number')) {
    const id = String(r.cells[sheetA.col('الرقم الجامعي')]).trim();
    const s = byId.get(id) ?? fail(`«النصفي»: ${mask(id)} is not in roster.csv`);
    if (!sameName(s.name, r.cells[sheetA.col('اسم الطالب')])) fail(`«النصفي»: name for ${mask(id)} differs from roster.csv`);
    const ir = items.rows.find((x) => x.cells.A === Number(s.serial)) ?? fail(`«فقرات النصفي»: no row for serial ${s.serial}`);
    if (!sameName(s.name, ir.cells.B)) fail(`«فقرات النصفي»: row ${s.serial} is a different student`);
    const mcq = q1cols.map((c) => letter(ir.cells[c])).join('');
    const q2 = q2cols.map((c) => Number(ir.cells[c] ?? 0));
    // Judgement from the mark: full or half on a FALSE statement = right judgement; 0 = wrong judgement.
    const tf = q2.map((m, i) => (m > 0 ? key2[i] : key2[i] === 'T' ? 'F' : 'T')).join('');
    const objMarks = [...mcq].map((a, i) => (a === key1[i] ? 1 : 0)).concat(q2);
    const pos = [...scan.entries()].find(([, v]) => v.id === id)?.[0] ?? fail(`${mask(id)}: no position in «ترتيب الأوراق»`);
    const flags = [];
    const short = C.short.map((q) => {
      const rows = q.parts.map((p) => essay.get(`${p.label}|${pos}`) ?? fail(`essay ${p.label} for sheet ${pos} missing`));
      rows.forEach((e, k) => { if (e.max !== q.parts[k].max) fail(`essay ${q.parts[k].label}: max ${e.max} in Excel, ${q.parts[k].max} in content.json`); });
      const lines = q.parts.map((p, k) => {
        const e = rows[k];
        if (e.mark === e.max) return null;
        const t = C.feedback?.[`${p.label}|${pos}`];
        if (!t) fail(`content.json: no student feedback for ${p.label} on sheet ${pos} (${e.mark}/${e.max})`);
        return `في ${p.label} (${e.mark} من ${e.max}): ${t}`;
      }).filter(Boolean);
      for (const p of q.parts) { const f = C.flags?.[`${p.label}|${pos}`]; if (f) flags.push(`${p.label}: ${f}`); }
      return {
        marks: rows.map((e) => e.mark),
        note: q.parts.map((p, k) => (rows[k].reason ? `${p.label}: ${rows[k].reason}` : null)).filter(Boolean).join('\n'),
        parts: q.parts.map((p, k) => ({ label: `${p.label} · ${p.topicAr}`, text: String(rows[k].text ?? '') })),
        fb: { ar: lines.length ? lines.join(' ') : (q.fullAr ?? 'إجابتك عن هذا السؤال كاملة.') },
      };
    });
    const note = r.cells[sheetA.col('ملاحظات')];
    if (note) flags.push(`ملاحظة الرصد: ${note}`);
    draft.push({ id, serial: Number(s.serial), scan: pos, v: 'A', mcq, tf, objMarks, short, flags });

    // the total the gradebook computes: S (matches) + AD (Q2) + parts on «النصفي»
    const sheetParts = partNames.map((n) => Number(r.cells[sheetA.col(n)] ?? 0));
    const excelSum = objMarks.slice(0, 16).reduce((a, b) => a + b, 0) + q2.reduce((a, b) => a + b, 0) + sheetParts.reduce((a, b) => a + b, 0);
    const essayParts = short.flatMap((q) => q.marks);
    excelTotal.set(id, { total: r2(excelSum), partsDiffer: partNames.filter((n, k) => sheetParts[k] !== essayParts[k]) });
  }

  assessment = {
    id: 'MID', title: C.title, titleAr: C.titleAr, max: 40, letters: C.letters ?? 'ar', weight: C.weight, date: C.date ?? null,
    pages: C.pages, startPage: 1, objectiveTitleAr: C.objectiveTitleAr,
    rules: rulesFrom(ew).length ? rulesFrom(ew) : rulesFrom(gb),
    versions: { A: {
      objective: [
        ...C.q1.map((o, i) => ({ q: i + 1, label: `1-${i + 1}`, key: key1[i], max: 1, topicAr: o.topicAr, whyAr: o.whyAr ?? '', page: o.page ?? C.q1Page })),
        ...C.q2.map((o, i) => ({ q: 17 + i, label: `2-${i + 1}`, key: key2[i], max: 1, half: key2[i] === 'F', topicAr: o.topicAr, whyAr: o.whyAr ?? '', page: o.page ?? C.q2Page })),
      ],
      short: C.short.map((q) => ({ q: q.q, labelAr: q.labelAr, topicAr: q.topicAr, page: q.page, rubricAr: q.rubricAr,
        parts: q.parts.map((p) => ({ label: p.label, max: p.max, step: 0.5 })) })),
    } },
  };
} else if (batch === 'Q1' || batch === 'Q2') {
  const sheet = C.sheet ?? (batch === 'Q1' ? 'الكويز الأول' : 'الكويز الثاني');
  const t = table(gb, sheet);
  const cols = Array.from({ length: 10 }, (_, i) => t.col(`ف${i + 1}`));
  const keyRow = t.rows.find((r) => head(r.cells.B) === 'مفتاح الإجابة') ?? fail(`«${sheet}»: key row not found`);
  const key = cols.map((c) => letter(keyRow.cells[c])).join('');
  if (C.key && C.key !== key) fail(`${batch}: key in Excel (${key}) differs from content.json (${C.key})`);
  const scan = scanOrder(C.scanColumn ?? (batch === 'Q1' ? 'موضعه في الكويز الأول' : 'موضعه في الكويز الثاني'));
  for (const r of t.rows.filter((x) => typeof x.cells.A === 'number')) {
    const id = String(r.cells[t.col('الرقم الجامعي')]).trim();
    const s = byId.get(id) ?? fail(`«${sheet}»: ${mask(id)} is not in roster.csv`);
    if (!sameName(s.name, r.cells[t.col('اسم الطالب')])) fail(`«${sheet}»: name for ${mask(id)} differs from roster.csv`);
    const mcq = cols.map((c) => letter(r.cells[c])).join('');
    const pos = [...scan.entries()].find(([, v]) => v.id === id)?.[0] ?? null;
    const note = r.cells[t.col('ملاحظات')];
    draft.push({ id, serial: Number(s.serial), scan: pos, v: 'A', mcq, short: [], flags: note ? [`ملاحظة الرصد: ${note}`] : [] });
    excelTotal.set(id, { total: [...mcq].filter((a, i) => a === key[i]).length, partsDiffer: [] });
  }
  assessment = {
    id: batch, title: C.title, titleAr: C.titleAr, max: 10, letters: C.letters ?? 'ar', weight: C.weight, date: C.date ?? null, pages: C.pages ?? 2, startPage: 1,
    rules: rulesFrom(gb).filter((x) => C.rulesFilter ? x.includes(C.rulesFilter) : false),
    versions: { A: { objective: C.items.map((o, i) => ({ q: i + 1, key: key[i], topicAr: o.topicAr, whyAr: o.whyAr ?? '', page: o.page ?? 1 })), short: [] } },
  };
} else fail(`Unknown batch ${batch}`);

// absent: in the roster, no row in the workbook
assessment.absent = roster.filter((s) => !draft.some((d) => d.id === s.id)).map((s) => s.id);
draft.sort((a, b) => a.serial - b.serial);
writeJson(path.join(dir, 'assessment.json'), assessment);
writeJson(path.join(dir, `${batch}.draft.json`), draft);

// ---------------- comparison ----------------
const V = assessment.versions.A;
const rows = draft.map((d) => {
  const r = { obj: (V.objective ?? []).map((o, i) => (d.objMarks ? d.objMarks[i] : ((d.mcq ?? '') + (d.tf ?? ''))[i] === o.key ? objMax(o) : 0)), sq: d.short.map((q) => q.marks) };
  const mine = totalOf(r), ex = excelTotal.get(d.id);
  return { serial: d.serial, scan: d.scan, id: d.id, name: byId.get(d.id).name, excel: ex.total, draft: mine, match: ex.total === mine && !ex.partsDiffer.length ? 'نعم' : 'لا', partsDiffer: ex.partsDiffer.join(' ') };
});
writeCsv(path.join(dir, 'import-report.csv'), rows, ['serial', 'scan', 'id', 'name', 'excel', 'draft', 'match', 'partsDiffer']);
console.log(`${batch}: ${draft.length} sheets imported, ${assessment.absent.length} absent.`);
console.log('serial  sheet-in-scan  id     Excel  draft  match');
for (const x of rows) console.log(`${String(x.serial).padStart(4)}  ${String(x.scan ?? '-').padStart(6)}        ${mask(x.id)}  ${String(x.excel).padStart(5)}  ${String(x.draft).padStart(5)}  ${x.match === 'نعم' ? 'yes' : 'NO ' + x.partsDiffer}`);
const bad = rows.filter((x) => x.match !== 'نعم');
console.log(bad.length ? `\n${bad.length} student(s) differ — see import-report.csv.` : '\nAll totals match the workbook.');
writeHub(DATA);
if (bad.length) process.exit(2);
