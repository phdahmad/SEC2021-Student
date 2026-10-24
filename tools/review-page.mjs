// Builds the teacher's internal review page for one marking batch.
//
//   node tools/review-page.mjs --batch Q1
//
// Reads from the data folder (never from the repo):
//   batches/<batch>/assessment.json   keys, topics, explanations, part labels
//   batches/<batch>/<batch>.draft.json the marking draft (one record per student)
//   batches/<batch>/<batch>.review.json the teacher's saved review, if any
//   roster.csv                         names and sections
// Writes batches/<batch>/review.html next to the scan images (web/*.webp).
// The page is for the teacher only: it is written into the data folder and is
// never copied to dist/ or published.
import fs from 'node:fs';
import path from 'node:path';
import { writeHub } from './review-hub.mjs';
import { REPO, dataDir, argValue, readCsv, fail } from './lib.mjs';

const batch = argValue('--batch') ?? fail('Give the batch name, e.g. --batch Q1');
const DATA = dataDir();
const dir = path.join(DATA, 'batches', batch);
const need = (f) => { const p = path.join(dir, f); if (!fs.existsSync(p)) fail(`Missing ${p}`); return p; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const assessment = readJson(need('assessment.json'));
const draft = readJson(need(`${batch}.draft.json`));
const reviewPath = path.join(dir, `${batch}.review.json`);
const saved = fs.existsSync(reviewPath) ? readJson(reviewPath) : null;

const names = new Map(readCsv(path.join(DATA, 'roster.csv')).map((r) => [r.id, { name: r.name, section: r.section }]));

// A draft record: { id, serial, v, mcq, tf, objMarks?, corrections?, short: [{ marks, note, parts|text, fb: { ar, en } }], flags }
const shortOf = (d) => d.short ?? [];

const students = draft.map((d) => {
  const who = names.get(d.id) ?? fail(`Student ${d.id} is in the draft but not in roster.csv`);
  const v = assessment.versions[d.v] ?? fail(`Unknown version ${d.v} for ${d.id}`);
  const objective = v.objective ?? [], shortQs = v.short ?? [];
  const ans = (d.mcq ?? '') + (d.tf ?? '');
  if (ans.length !== objective.length) fail(`${d.id}: ${ans.length} objective answers, expected ${objective.length}`);
  if (d.objMarks && d.objMarks.length !== objective.length) fail(`${d.id}: ${d.objMarks.length} objective marks, expected ${objective.length}`);
  (d.objMarks ?? []).forEach((m, i) => { const max = objective[i].max ?? 1; if (!(m >= 0 && m <= max)) fail(`${d.id}: item ${objective[i].label ?? objective[i].q} mark ${m} is outside 0–${max}`); });
  const short = shortOf(d);
  if (short.length !== shortQs.length) fail(`${d.id}: ${short.length} essay questions, expected ${shortQs.length}`);
  short.forEach((q, j) => { if ((q.marks ?? []).length !== shortQs[j].parts.length) fail(`${d.id}: question ${j + 1} has ${(q.marks ?? []).length} part marks, expected ${shortQs[j].parts.length}`); });
  if (!fs.existsSync(path.join(dir, 'web', `${d.id}_p1.webp`))) fail(`${d.id}: no scan images in web/`);
  return { id: d.id, name: who.name, section: who.section, serial: d.serial ?? null, v: d.v, ans,
    objMarks: d.objMarks ?? null, corrections: d.corrections ?? null, flags: d.flags ?? [], second: d.second ?? '',
    short: short.map((q) => ({ ...q, marks: q.marks ?? [] })), writing: d.writing ?? null };
});

const payload = { batch, generatedAt: new Date().toISOString(), assessment, students, saved, images: 'web/' };
// Keep "</script>" out of the inline JSON.
const json = JSON.stringify(payload).replace(/</g, '\\u003c');
const template = fs.readFileSync(path.join(REPO, 'review', 'review.template.html'), 'utf8');
if (!template.includes('/*__DATA__*/') || !template.includes('/*__FEEDBACK__*/')) fail('Template placeholder not found');
// The same feedback code as results-from-review.mjs, without the ES-module keywords.
const core = fs.readFileSync(path.join(REPO, 'review', 'feedback-core.js'), 'utf8').replace(/^export /gm, '');
const out = path.join(dir, 'review.html');
fs.writeFileSync(out, template.replace('/*__FEEDBACK__*/', () => core).replace('/*__DATA__*/', () => json));
console.log(`Review page: ${out}`);
console.log(`${students.length} students${saved ? `, saved review from ${saved.savedAt} included` : ''}.`);
console.log('Open it in Chrome or Edge. Saving writes ' + `${batch}.review.json` + ' into this folder.');
writeHub(DATA);
