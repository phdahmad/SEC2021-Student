// node --test tests/  — the Excel importer, with FAKE workbooks built by tests/xlsx-writer.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeXlsx } from './xlsx-writer.mjs';
import { readXlsx } from '../tools/xlsx.mjs';
import { readCsv } from '../tools/lib.mjs';
import { totalOf, objMax, buildFeedback } from '../review/feedback-core.js';
import { FAKE as ALL } from './fixture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
const S = ALL.slice(0, 3);
const KEY = 'ACDCABCDCBBDBADA', TF = 'FFTFTT';
const PARTS = ['3-1', '3-2', '3-3', '3-4', '4-أ', '4-ب', '4-ج'];
const MAX = [2, 2, 2, 2, 4, 3, 3];
const SCAN = [2, 3, 1]; // position of each student's sheet in the scan file — not the roster order

// answers per student: MCQ letters (Arabic letters allowed), Q2 marks, essay marks (درجتك or proposed)
const STUDENTS = [
  { mcq: [...KEY], q2: [1, 1, 1, 1, 1, 1], essay: MAX.slice(), own: [] },
  { mcq: [...KEY].map((c, i) => (i === 2 ? '-' : i === 5 ? 'X' : i === 0 ? 'أ' : c)), q2: [0.5, 1, 1, 0, 1, 1], essay: [2, 1.5, 2, 2, 4, 2, 3], own: [[1, 1]] },
  { mcq: [...KEY].map((c, i) => (i < 4 ? 'B' : c)), q2: [1, 0, 1, 1, 0.5, 1], essay: [1, 1, 2, 0, 3, 3, 2], own: [] },
];
const finalEssay = (k) => STUDENTS[k].essay.map((m, p) => { const o = STUDENTS[k].own.find(([pp]) => pp === p); return o ? o[1] : m; });

function makeWorkbooks(dir, { tamper = false } = {}) {
  const mid = [['جدول تجريبي'], ['م', 'اسم الطالب', 'الرقم الجامعي', ...PARTS, 'المجموع', 'ملاحظات']];
  S.forEach((s, k) => {
    const parts = finalEssay(k).slice();
    if (tamper && k === 2) parts[0] = 2; // the gradebook disagrees with the essay review
    mid.push([k + 1, s.name, s.id, ...parts, '', k === 1 ? 'تأخر عشر دقائق' : '']);
  });
  const items = [['م', 'اسم الطالب', ...Array.from({ length: 16 }, (_, i) => `س1-${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `س2-${i + 1}`)],
    ['', 'مفتاح الإجابة', ...KEY, ...TF]];
  S.forEach((s, k) => items.push([k + 1, s.name, ...STUDENTS[k].mcq, ...STUDENTS[k].q2]));
  const order = [['تسلسل الكشف', 'اسم الطالب', 'موضعه في ملف النصفي', 'موضعه في الكويز الأول']];
  S.forEach((s, k) => order.push([k + 1, s.name, SCAN[k], k + 1]));
  const quiz = [['م', 'اسم الطالب', 'الرقم الجامعي', ...Array.from({ length: 10 }, (_, i) => `ف${i + 1}`), 'ملاحظات'],
    ['', 'مفتاح الإجابة', '', ...'ABCDABCDAB']];
  S.forEach((s, k) => quiz.push([k + 1, s.name, s.id, ...[...'ABCDABCDAB'].map((c, i) => (i < k ? 'D' : c)), '']));
  writeXlsx(path.join(dir, 'gradebook.xlsx'), { 'النصفي': mid, 'فقرات النصفي': items, 'ترتيب الأوراق': order, 'الكويز الأول': quiz });

  const essay = [['الفرع', 'الورقة', 'النص كما قرأته', 'المقترحة', 'من', 'درجتك', 'سبب الخصم / ملاحظة']];
  S.forEach((s, k) => PARTS.forEach((p, j) => {
    const own = STUDENTS[k].own.find(([pp]) => pp === j);
    essay.push([p, SCAN[k], `نص تجريبي ${p}`, STUDENTS[k].essay[j], MAX[j], own ? own[1] : '', STUDENTS[k].essay[j] < MAX[j] ? 'سبب تجريبي' : '']);
  }));
  writeXlsx(path.join(dir, 'essays.xlsx'), {
    'مراجعة المقالي': essay,
    'القواعد الحدية': [['الرمز', 'أول ظهور', 'الحالة', 'القاعدة المثبّتة'], ['R1', 'ورقة 1', 'حالة تجريبية', 'قاعدة تجريبية']],
  });
}

function makeContent() {
  const feedback = {};
  STUDENTS.forEach((_, k) => finalEssay(k).forEach((m, j) => { if (m < MAX[j]) feedback[`${PARTS[j]}|${SCAN[k]}`] = `شرح تجريبي ${PARTS[j]}.`; }));
  return {
    title: 'Midterm exam', titleAr: 'الاختبار النصفي', weight: 20, pages: 5, mcqKey: KEY, tfKey: TF, q1Page: 1, q2Page: 2,
    q1: Array.from({ length: 16 }, (_, i) => ({ topicAr: `موضوع ${i + 1}`, whyAr: 'شرح.' })),
    q2: Array.from({ length: 6 }, (_, i) => ({ topicAr: `عبارة ${i + 1}`, whyAr: 'شرح.' })),
    short: [
      { q: 3, labelAr: 'السؤال الثالث', topicAr: 'موضوع تجريبي', page: 3, rubricAr: 'معيار', fullAr: 'إجابتك كاملة.',
        parts: ['3-1', '3-2', '3-3', '3-4'].map((label) => ({ label, max: 2, topicAr: 'فرع' })) },
      { q: 4, labelAr: 'السؤال الرابع', topicAr: 'موضوع تجريبي', page: 4, rubricAr: 'معيار', fullAr: 'إجابتك كاملة.',
        parts: [['4-أ', 4], ['4-ب', 3], ['4-ج', 3]].map(([label, max]) => ({ label, max, topicAr: 'فرع' })) },
    ],
    feedback, flags: { [`3-1|${SCAN[2]}`]: 'راجع هذا الفرع' },
  };
}

function setup(opts) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sec2021-import-'));
  makeWorkbooks(data, opts);
  fs.writeFileSync(path.join(data, 'gradebook.json'), JSON.stringify({ gradebook: 'gradebook.xlsx', essays: { MID: 'essays.xlsx' }, rosterSheet: 'النصفي', section: '48' }));
  for (const b of ['MID', 'Q1']) fs.mkdirSync(path.join(data, 'batches', b, 'web'), { recursive: true });
  fs.writeFileSync(path.join(data, 'batches', 'MID', 'content.json'), JSON.stringify(makeContent()));
  fs.writeFileSync(path.join(data, 'batches', 'Q1', 'content.json'), JSON.stringify({
    title: 'Quiz 1', titleAr: 'الاختبار القصير الأول', weight: 5, pages: 2, items: Array.from({ length: 10 }, (_, i) => ({ topicAr: `فقرة ${i + 1}` })),
  }));
  return data;
}

test('xlsx reader reads the test workbooks back', () => {
  const data = setup();
  const wb = readXlsx(path.join(data, 'gradebook.xlsx'));
  assert.deepEqual(wb.sheetNames, ['النصفي', 'فقرات النصفي', 'ترتيب الأوراق', 'الكويز الأول']);
  assert.equal(wb.value('النصفي', 'B3'), S[0].name);
  assert.equal(wb.value('فقرات النصفي', 'C2'), 'A');
  assert.equal(wb.value('ترتيب الأوراق', 'C2'), SCAN[0]);
});

test('import: roster, then midterm totals match the workbook, matched by ID not scan order', () => {
  const data = setup();
  let r = run(['tools/import-xlsx.mjs', '--roster', '--data', data]);
  assert.equal(r.status, 0, r.stderr);
  const roster = readCsv(path.join(data, 'roster.csv'));
  assert.deepEqual(roster.map((x) => x.id), S.map((x) => x.id));
  assert.equal(run(['tools/import-xlsx.mjs', '--roster', '--data', data]).status, 1, 'roster.csv is never overwritten');

  r = run(['tools/import-xlsx.mjs', '--batch', 'MID', '--data', data]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /All totals match/);
  for (const s of S) assert.ok(!r.stdout.includes(s.id) && !r.stdout.includes(s.name), 'output shows masked IDs only');

  const dir = path.join(data, 'batches', 'MID');
  const A = JSON.parse(fs.readFileSync(path.join(dir, 'assessment.json'), 'utf8'));
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'MID.draft.json'), 'utf8'));
  assert.equal(A.versions.A.objective.length, 22);
  assert.equal(A.versions.A.objective.filter((o) => o.half).length, [...TF].filter((c) => c === 'F').length);
  assert.equal(A.rules.length, 1);
  assert.deepEqual(draft.map((d) => d.scan), SCAN);

  const expected = STUDENTS.map((st, k) => [...st.mcq].map((a, i) => ((a === 'أ' ? 'A' : a) === KEY[i] ? 1 : 0)).reduce((x, y) => x + y, 0)
    + st.q2.reduce((x, y) => x + y, 0) + finalEssay(k).reduce((x, y) => x + y, 0));
  draft.forEach((d, k) => {
    const obj = A.versions.A.objective.map((o, i) => (d.objMarks ? d.objMarks[i] : objMax(o)));
    assert.equal(totalOf({ obj, sq: d.short.map((q) => q.marks) }), expected[k], `student ${k + 1}`);
  });
  const d2 = draft[1];
  assert.equal(d2.mcq[0], 'A', 'Arabic letters are read as Latin');
  assert.equal(d2.mcq[2], '-'); assert.equal(d2.mcq[5], 'X');
  assert.equal(d2.tf[0], 'F', 'half mark on a false statement keeps the right judgement');
  assert.equal(d2.tf[3], 'T', 'zero on a false statement means the student said true');
  assert.equal(d2.short[0].marks[1], 1, 'the teacher’s own mark wins over the proposed one');
  assert.match(d2.short[0].fb.ar, /^في 3-2 \(1 من 2\): /);
  assert.equal(draft[0].short[0].fb.ar, 'إجابتك كاملة.');
  assert.ok(d2.flags.some((f) => f.includes('تأخر')), 'the gradebook note becomes a teacher flag');
  assert.ok(draft[2].flags.some((f) => f.startsWith('3-1')), 'content.json flags are attached');
  assert.equal(A.letters, 'ar');
  const d3 = draft[2], obj3 = A.versions.A.objective.map((o, i) => d3.objMarks[i]);
  const fb3 = buildFeedback(A, { ...d3, ans: d3.mcq + d3.tf }, { obj: obj3, sq: d3.short.map((q) => q.marks), far: [], fen: [] });
  assert.ok(fb3.points.some((p) => p.text.startsWith('اخترت ب، والإجابة الصحيحة أ.')), 'answers are shown with the Arabic letters printed on the paper');

  // the review page accepts the imported draft
  for (const d of draft) fs.writeFileSync(path.join(dir, 'web', `${d.id}_p1.webp`), 'x');
  r = run(['tools/review-page.mjs', '--batch', 'MID', '--data', data]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(data, 'review', 'index.html')));
});

test('import: a gradebook that disagrees with the essay review is reported and exits 2', () => {
  const data = setup({ tamper: true });
  assert.equal(run(['tools/import-xlsx.mjs', '--roster', '--data', data]).status, 0);
  const r = run(['tools/import-xlsx.mjs', '--batch', 'MID', '--data', data]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const rep = readCsv(path.join(data, 'batches', 'MID', 'import-report.csv'));
  assert.deepEqual(rep.map((x) => x.match), ['نعم', 'نعم', 'لا']);
  assert.equal(rep[2].partsDiffer, '3-1');
});

test('import: a 10-item quiz from the gradebook', () => {
  const data = setup();
  run(['tools/import-xlsx.mjs', '--roster', '--data', data]);
  const r = run(['tools/import-xlsx.mjs', '--batch', 'Q1', '--data', data]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const draft = JSON.parse(fs.readFileSync(path.join(data, 'batches', 'Q1', 'Q1.draft.json'), 'utf8'));
  const rep = readCsv(path.join(data, 'batches', 'Q1', 'import-report.csv'));
  assert.deepEqual(rep.map((x) => Number(x.excel)), [10, 9, 8]);
  assert.deepEqual(draft.map((d) => d.mcq.length), [10, 10, 10]);
});

test('import: missing feedback for a deducted part stops the import', () => {
  const data = setup();
  run(['tools/import-xlsx.mjs', '--roster', '--data', data]);
  const cp = path.join(data, 'batches', 'MID', 'content.json');
  const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
  delete c.feedback[Object.keys(c.feedback)[0]];
  fs.writeFileSync(cp, JSON.stringify(c));
  const r = run(['tools/import-xlsx.mjs', '--batch', 'MID', '--data', data]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no student feedback/);
  assert.ok(!fs.existsSync(path.join(data, 'batches', 'MID', 'MID.draft.json')), 'nothing written on failure');
});

// Fake scan: sheets of 2 pages with a blank page after each, then a signature page.
// Needs python3 + Pillow + poppler (pdfimages); skipped where they are missing.
const hasPy = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0
  && spawnSync('pdfimages', ['-v'], { encoding: 'utf8' }).status === 0;
test('scan pages: one image per page, mapped by scan position, blanks checked', { skip: !hasPy && 'python3/Pillow/pdfimages not available' }, () => {
  const data = setup();
  run(['tools/import-xlsx.mjs', '--roster', '--data', data]);
  assert.equal(run(['tools/import-xlsx.mjs', '--batch', 'Q1', '--data', data]).status, 0);
  const src = path.join(data, 'batches', 'Q1', 'source');
  fs.mkdirSync(src, { recursive: true });
  // page k carries the text "S<sheet>P<page>" as a block of ink; blank pages are white
  const make = (blankBetween, out) => spawnSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
pages=[]
for sheet in range(1,4):
    for n in range(1,3):
        im=Image.new('L',(1240,1754),255); d=ImageDraw.Draw(im)
        d.rectangle((100,100+sheet*200,600+n*100,400+sheet*200),fill=0); pages.append(im)
    pages.append(Image.new('L',(1240,1754),255 if ${blankBetween} else 0))
sig=Image.new('L',(1240,1754),255); ImageDraw.Draw(sig).rectangle((100,100,1100,600),fill=0); pages.append(sig)
pages[0].save(sys.argv[1],save_all=True,append_images=pages[1:])
`, out], { encoding: 'utf8' });
  const pdf = path.join(src, 'Q1_scan.pdf');
  assert.equal(make('True', pdf).status, 0);
  const py = (args) => spawnSync('python3', ['tools/scan-pages.py', ...args], { cwd: REPO, encoding: 'utf8' });
  let r = py(['--batch', 'Q1', '--data', data, '--per-sheet', '2', '--stride', '3']);
  assert.equal(r.status, 1, 'the page count is checked'); assert.match(r.stderr, /expected 3 sheets/);
  r = py(['--batch', 'Q1', '--data', data, '--per-sheet', '2', '--stride', '3', '--extra', '1']);
  assert.equal(r.status, 0, r.stderr);
  for (const s of S) assert.ok(!r.stdout.includes(s.id), 'output shows masked IDs only');
  const web = path.join(data, 'batches', 'Q1', 'web');
  const draft = JSON.parse(fs.readFileSync(path.join(data, 'batches', 'Q1', 'Q1.draft.json'), 'utf8'));
  for (const d of draft) for (const n of [1, 2]) assert.ok(fs.existsSync(path.join(web, `${d.id}_p${n}.webp`)));
  // the sheet at scan position 1 is student 1 (fixture: quiz position = serial); its first page has the sheet-1 mark
  const size = (f) => spawnSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("L");print(im.width, sum(im.histogram()[:128]))', f], { encoding: 'utf8' }).stdout.trim();
  const [w] = size(path.join(web, `${draft[0].id}_p1.webp`)).split(' ');
  assert.equal(w, '1400');
  // a dark page where a blank one should be stops everything
  fs.rmSync(web, { recursive: true });
  assert.equal(make('False', pdf).status, 0);
  r = py(['--batch', 'Q1', '--data', data, '--per-sheet', '2', '--stride', '3', '--extra', '1']);
  assert.equal(r.status, 1); assert.match(r.stderr, /not blank/);
  assert.ok(!fs.existsSync(web) || fs.readdirSync(web).length === 0, 'nothing written');
});
