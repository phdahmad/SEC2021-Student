// Turns a reviewed marking batch into the results file the student page is built from.
//
//   node tools/results-from-review.mjs --batch MID --approve "Approved by Dr. Ahmad Alhindi on 2026-10-24"
//
// Reads batches/<batch>/assessment.json, <batch>.draft.json and, if present,
// <batch>.review.json (the teacher's edits from review.html win over the draft).
// Writes results/<item>.json. Without --approve the file is written with
// "approved": false, and build.mjs refuses to publish it.
// Prints the differences between the draft and the saved review, per student,
// so they can be shown to the teacher before approval.
// The feedback is built by review/feedback-core.js — the same code as the preview
// on the review page.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeHub } from './review-hub.mjs';
import { dataDir, argValue, readCsv, fail } from './lib.mjs';
import { buildFeedback, objDefault, objMax, objLabel, totalOf, sumMarks, fmtMark } from '../review/feedback-core.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// The marks one student ends up with: draft defaults, then the saved review on top.
export function marksOf(A, d, savedRec) {
  const V = A.versions[d.v] ?? fail(`Unknown version ${d.v} for ${d.id}`);
  const obj = V.objective ?? [];
  const sh = d.short ?? [];
  const base = {
    obj: obj.map((o, i) => objDefault(o, i, d)),
    sq: sh.map((q) => [...(q.marks ?? [])]), sn: sh.map((q) => q.note ?? ''),
    far: sh.map((q) => q.fb?.ar ?? ''), fen: sh.map((q) => q.fb?.en ?? ''),
    wLevel: d.writing?.level ?? '', wTip: d.writing?.tip_ar ?? '', summaryExtra: '',
  };
  return { base, final: { ...base, ...(savedRec ?? {}) } };
}

// Human-readable list of what the teacher changed for one student.
export function diffOf(A, d, base, fin) {
  const V = A.versions[d.v], out = [];
  (V.objective ?? []).forEach((o, i) => { if (+base.obj[i] !== +fin.obj[i]) out.push(`الفقرة ${objLabel(o)}: ${fmtMark(base.obj[i])} ← ${fmtMark(fin.obj[i])}`); });
  (V.short ?? []).forEach((q, j) => {
    q.parts.forEach((p, k) => { if (+base.sq[j][k] !== +fin.sq[j][k]) out.push(`${q.labelAr ?? 'السؤال ' + q.q} ${p.label}: ${fmtMark(base.sq[j][k])} ← ${fmtMark(fin.sq[j][k])}`); });
    if ((base.far[j] ?? '') !== (fin.far[j] ?? '')) out.push(`${q.labelAr ?? 'السؤال ' + q.q}: عُدّل التوضيح العربي`);
    if ((base.fen[j] ?? '') !== (fin.fen[j] ?? '')) out.push(`${q.labelAr ?? 'السؤال ' + q.q}: عُدّلت الترجمة الإنجليزية`);
  });
  if ((fin.summaryExtra ?? '').trim()) out.push('أُضيفت جملة إلى الملخص');
  return out;
}

export function resultsFromReview(DATA, batch, approval) {
  const dir = path.join(DATA, 'batches', batch);
  const need = (f) => { const p = path.join(dir, f); if (!fs.existsSync(p)) fail(`Missing ${p}`); return p; };
  const A = readJson(need('assessment.json'));
  const draft = readJson(need(`${batch}.draft.json`));
  const reviewPath = path.join(dir, `${batch}.review.json`);
  const saved = fs.existsSync(reviewPath) ? readJson(reviewPath) : null;
  if (saved && saved.batch !== A.id) fail(`${reviewPath} belongs to batch ${saved.batch}, not ${A.id}`);
  const roster = new Set(readCsv(path.join(DATA, 'roster.csv')).map((r) => r.id));

  const students = {}, diffs = [];
  for (const d of draft) {
    if (!roster.has(d.id)) fail(`${d.id} is not in roster.csv`);
    const V = A.versions[d.v];
    const { base, final: r } = marksOf(A, d, saved?.students?.[d.id]);
    (V.objective ?? []).forEach((o, i) => { if (!(+r.obj[i] >= 0 && +r.obj[i] <= objMax(o))) fail(`${d.id}: item ${objLabel(o)} mark ${r.obj[i]} is outside 0–${objMax(o)}`); });
    (V.short ?? []).forEach((q, j) => {
      if (r.sq[j].length !== q.parts.length) fail(`${d.id}: question ${q.labelAr ?? q.q} has ${r.sq[j].length} marks, expected ${q.parts.length}`);
      q.parts.forEach((p, k) => { if (r.sq[j][k] < 0 || r.sq[j][k] > p.max) fail(`${d.id}: ${p.label} mark ${r.sq[j][k]} is outside 0–${p.max}`); });
    });
    const score = totalOf(r);
    if (score > A.max) fail(`${d.id}: score ${score} is above the maximum ${A.max}`);
    const feedback = buildFeedback(A, { ...d, ans: (d.mcq ?? '') + (d.tf ?? '') }, r);
    const pages = Array.from({ length: A.pages ?? 3 }, (_, i) => `batches/${batch}/web/${d.id}_p${i + 1}.webp`);
    for (const p of pages) if (!fs.existsSync(path.join(DATA, p))) fail(`${d.id}: missing ${p}`);
    students[d.id] = { status: 'graded', score, feedback, pages };
    const changes = diffOf(A, d, base, r);
    if (changes.length) diffs.push({ id: d.id, serial: d.serial ?? null, before: totalOf(base), after: score, changes });
  }
  // Absent students (in the roster, no sheet) are recorded as not submitted.
  for (const id of A.absent ?? []) if (!students[id]) students[id] = { status: 'not_submitted' };

  const out = {
    item: A.id,
    approved: !!approval,
    ...(approval ? { approvedOn: new Date().toISOString().slice(0, 10), approvalNote: approval } : {}),
    source: saved ? `${batch}.draft.json + ${batch}.review.json (saved ${saved.savedAt})` : `${batch}.draft.json (no edits saved on the review page)`,
    students,
  };
  fs.mkdirSync(path.join(DATA, 'results'), { recursive: true });
  const file = path.join(DATA, 'results', `${A.id}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return { file, out, diffs, A, saved };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const batch = argValue('--batch') ?? fail('Give the batch name, e.g. --batch MID');
  const approval = argValue('--approve');
  const DATA = dataDir();
  const { file, out, diffs, A, saved } = resultsFromReview(DATA, batch, approval);
  const scores = Object.values(out.students).filter((s) => typeof s.score === 'number').map((s) => s.score);
  console.log(`${file}: ${scores.length} students, mean ${fmtMark(sumMarks(scores) / scores.length)} / ${A.max}, ${approval ? 'APPROVED' : 'not approved'}${saved ? ', with saved review' : ''}.`);
  // Sheet number and a masked ID (no names) so the list can be pasted into a conversation.
  if (diffs.length) {
    console.log(`\nDifferences between the draft and the review (${diffs.length} students):`);
    for (const x of diffs) console.log(`  ${x.serial != null ? '#' + x.serial + ' ' : ''}…${x.id.slice(-3)}: ${fmtMark(x.before)} → ${fmtMark(x.after)}\n    - ${x.changes.join('\n    - ')}`);
  } else console.log('\nNo differences between the draft and the review.');
  writeHub(DATA);
}
