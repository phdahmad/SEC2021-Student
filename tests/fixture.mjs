// Builds a throw-away data folder with FAKE students (never real data in tests).
// The folder has the same layout as F:\SEC2021\Gradebook\StudentPortal:
//   roster.csv, tokens.csv, items.json, results/, batches/<id>/{assessment.json,
//   <id>.draft.json, web/<id>_p<n>.webp}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv, writeJson } from '../tools/lib.mjs';
import { issueMissing } from '../tools/tokens.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'];

export const FAKE = ORD.map((o, i) => ({ id: String(900000101 + i * 101), name: `طالب تجريبي ${o}`, section: '48' }));
FAKE[2].id = '90000303'; // an 8-digit ID, to keep testing ID normalisation

export const CATALOG = {
  course: { code: 'SEC2021', title: 'Introduction to Computing and Computer Programming', titleAr: 'مقدمة في الحوسبة والبرمجة', term: 'Test term' },
  categories: [
    { key: 'quizzes', label: 'Quizzes', weight: 10 },
    { key: 'midterm', label: 'Midterm exam', weight: 20 },
    { key: 'assignments', label: 'Assignments', weight: 10 },
    { key: 'project', label: 'Presentation / project', weight: 10 },
    { key: 'practical', label: 'Practical exam', weight: 10 },
    { key: 'final', label: 'Final exam', weight: 40 },
  ],
  items: [
    { id: 'Q1', kind: 'quiz', category: 'quizzes', title: 'Quiz 1', titleAr: 'الكويز الأول', module: 2, date: '2026-09-27', graded: true, max: 10, weight: 5, state: 'published' },
    { id: 'Q2', kind: 'quiz', category: 'quizzes', title: 'Quiz 2', titleAr: 'الكويز الثاني', module: 3, date: '2026-10-04', graded: true, max: 10, weight: 5, state: 'marking' },
    { id: 'MID', kind: 'midterm', category: 'midterm', title: 'Midterm exam', titleAr: 'الاختبار النصفي', date: '2026-10-18', graded: true, max: 40, weight: 20, state: 'published' },
    { id: 'PQ', kind: 'activity', title: 'Practice quiz', titleAr: 'نموذج تدريبي للكويز', module: 2, date: '2026-09-20', graded: false, max: 10, state: 'published' },
    { id: 'A1', kind: 'assignment', category: 'assignments', title: 'Assignment', titleAr: 'الواجب', graded: true, max: 10, weight: 10, state: 'upcoming' },
    { id: 'PR', kind: 'project', category: 'project', title: 'Presentation / project', titleAr: 'العرض والمشروع', graded: true, max: 10, weight: 10, state: 'upcoming' },
    { id: 'PX', kind: 'practical', category: 'practical', title: 'Practical exam', titleAr: 'الاختبار العملي', graded: true, max: 10, weight: 10, state: 'upcoming' },
    { id: 'FIN', kind: 'final', category: 'final', title: 'Final exam', titleAr: 'الاختبار النهائي', graded: true, max: 40, weight: 40, state: 'upcoming' },
  ],
};

// A fake midterm with the SEC2021 shape: 16 MCQ + 6 true/false with correction + two written questions.
export const MID_ASSESSMENT = {
  id: 'MID', title: 'Midterm exam', titleAr: 'الاختبار النصفي', max: 40, weight: 20, pages: 5, startPage: 1, date: '2026-10-18',
  objectiveTitleAr: 'السؤالان الأول والثاني (اختيار من متعدد · صح وخطأ مع التصحيح)',
  rules: ['قاعدة تجريبية: «يُقبل ذكر SSD دون HDD في الفرع (أ)».', 'قاعدة تجريبية ثانية للعرض فقط.'],
  versions: {
    A: {
      objective: [
        ...'ACDCABCDCBBDBADA'.split('').map((key, i) => ({ q: i + 1, label: `1-${i + 1}`, key, topicAr: `موضوع تجريبي ${i + 1}`, whyAr: 'شرح تجريبي للإجابة الصحيحة.', page: i < 8 ? 1 : 2 })),
        ...'FFTFTT'.split('').map((key, i) => ({ q: 17 + i, label: `2-${i + 1}`, key, max: 1, half: key === 'F', topicAr: `عبارة تجريبية ${i + 1}`, whyAr: key === 'F' ? 'التصحيح التجريبي للعبارة.' : 'العبارة صحيحة.', page: 2 })),
      ],
      short: [
        { q: 3, labelAr: 'السؤال الثالث', topicAr: 'سؤال تجريبي عن نظام التشغيل', page: 3, parts: [{ label: 'أ', max: 4 }, { label: 'ب', max: 4 }] },
        { q: 4, labelAr: 'السؤال الرابع', topicAr: 'سؤال تجريبي عن اختيار جهاز', page: 4, parts: [{ label: 'أ', max: 4 }, { label: 'ب', max: 3 }, { label: 'ج', max: 3 }] },
      ],
    },
  },
};

export const Q1_ASSESSMENT = {
  id: 'Q1', title: 'Quiz 1', titleAr: 'الكويز الأول', max: 10, weight: 5, pages: 2, startPage: 1,
  versions: { A: { objective: 'ACACDBDABD'.split('').map((key, i) => ({ q: i + 1, key, topicAr: `موضوع تجريبي ${i + 1}`, whyAr: 'شرح تجريبي.', page: 1 })), short: [] } },
};

function images(data, batch, ids, pages) {
  const dir = path.join(data, 'batches', batch, 'web');
  fs.mkdirSync(dir, { recursive: true });
  const src = ['sample_p1', 'sample_p2', 'sample_b1'];
  for (const id of ids) for (let p = 1; p <= pages; p++) fs.copyFileSync(path.join(FIX, src[(p - 1) % 3] + '.webp'), path.join(dir, `${id}_p${p}.webp`));
}

function midDraft(students) {
  return students.map((s, i) => {
    const mcq = 'ACDCABCDCBBDBADA'.split('').map((k, j) => ((i + j) % 5 === 0 ? 'B' : k)).join('');
    const tf = i % 3 === 0 ? 'FFTTTT' : 'FFTFTT';
    const objMarks = [...mcq].map((a, j) => (a === 'ACDCABCDCBBDBADA'[j] ? 1 : 0))
      .concat([...tf].map((a, j) => (a !== 'FFTFTT'[j] ? 0 : 'FFTFTT'[j] === 'F' && j === 1 && i % 2 ? 0.5 : 1)));
    return {
      id: s.id, serial: i + 1, v: 'A', mcq, tf, objMarks,
      corrections: [...Array(16).fill(''), 'الكيلوبايت أصغر من الميجابايت', i % 2 ? '' : 'RAM يزول محتواها عند الإطفاء', '', '', '', ''],
      short: [
        { marks: [3, 4 - (i % 3)], note: 'سبب تجريبي للخصم', parts: [{ label: 'أ', text: 'إجابة تجريبية تذكر Windows وLinux.' }, { label: 'ب', text: i % 4 ? 'يدير نظام التشغيل الذاكرة RAM والملفات.' : '' }],
          fb: { ar: 'توضيح تجريبي: ذكرت مثالين صحيحين، والفرع (ب) يحتاج ربطاً بالموقف.' } },
        { marks: [4, 2, 1 + (i % 2)], note: '', parts: [{ label: 'أ', text: 'Core i5, 8GB RAM, SSD 512GB' }, { label: 'ب', text: 'لأن SSD أسرع من HDD' }, { label: 'ج', text: 'أرسله بصيغة docx' }],
          fb: { ar: 'توضيح تجريبي: المواصفات محددة بقيمها، والفرع (ج) يطلب صيغة الملف لا وسيلة الإرسال.', en: 'Sample: name the file format (PDF), not how you send it.' } },
      ],
      flags: i === 1 ? ['الفقرة 1-5: علامتان على ورقة الطالب، إحداهما مشطوبة جزئياً.'] : [],
    };
  });
}

function q1Draft(students) {
  return students.map((s, i) => ({ id: s.id, serial: i + 1, v: 'A', mcq: 'ACACDBDABD'.split('').map((k, j) => ((i + j) % 4 === 0 ? (j % 2 ? '-' : 'C') : k)).join(''), short: [], flags: [] }));
}

// count: how many fake students (3 for unit tests, 9 for the demo).
// approved: whether results files are approved.
export function makeData({ approved = true, count = 3, root } = {}) {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), 'sec2021-test-'));
  const data = path.join(root, 'data');
  const students = FAKE.slice(0, count);
  fs.mkdirSync(path.join(data, 'results'), { recursive: true });
  writeCsv(path.join(data, 'roster.csv'), students, ['id', 'name', 'section']);
  writeJson(path.join(data, 'items.json'), CATALOG);

  // Midterm: everybody but the last student sat it (the last one is absent).
  const sat = students.slice(0, -1);
  const mid = path.join(data, 'batches', 'MID');
  fs.mkdirSync(mid, { recursive: true });
  writeJson(path.join(mid, 'assessment.json'), { ...MID_ASSESSMENT, absent: [students.at(-1).id] });
  writeJson(path.join(mid, 'MID.draft.json'), midDraft(sat));
  images(data, 'MID', sat.map((s) => s.id), 5);

  const q1 = path.join(data, 'batches', 'Q1');
  fs.mkdirSync(q1, { recursive: true });
  writeJson(path.join(q1, 'assessment.json'), Q1_ASSESSMENT);
  writeJson(path.join(q1, 'Q1.draft.json'), q1Draft(students));
  images(data, 'Q1', students.map((s) => s.id), 2);

  // Results written by hand (as results-from-review.mjs would) so the build tests do not depend on it.
  writeJson(path.join(data, 'results', 'MID.json'), {
    item: 'MID', approved,
    students: {
      [students[0].id]: {
        status: 'graded', score: 33,
        feedback: {
          lang: 'ar', summary: 'حصلت على 33 من 40. الفقرات التي فاتتك مشروحة أدناه. SECRET-FEEDBACK-A',
          points: [
            { ref: 'الفقرة 1-5 · وحدات التخزين', text: 'اخترت B، والإجابة الصحيحة A. الذاكرة RAM يزول محتواها عند انقطاع التيار.' },
            { ref: 'السؤال الرابع · اختيار جهاز · 7 من 10', text: 'المواصفات محددة، والفرع (ج) يطلب صيغة الملف مثل PDF أو docx.', textEn: 'Name the file format (PDF), not how you send it.' },
          ],
        },
        pages: [1, 2, 3, 4, 5].map((n) => `batches/MID/web/${students[0].id}_p${n}.webp`),
      },
      [students[1].id]: {
        status: 'graded', score: 28.5, feedback: { lang: 'ar', summary: 'SECRET-FEEDBACK-B', points: [] },
        pages: [`batches/MID/web/${students[1].id}_p1.webp`],
      },
      [students.at(-1).id]: { status: 'not_submitted' },
    },
  });
  writeJson(path.join(data, 'results', 'Q1.json'), {
    item: 'Q1', approved,
    students: { [students[0].id]: { status: 'graded', score: 7, feedback: { lang: 'ar', summary: 'حصلت على 7 من 10.', points: [] } } },
  });
  writeJson(path.join(data, 'results', 'PQ.json'), {
    item: 'PQ', approved,
    students: { [students[0].id]: { status: 'graded', score: 6, feedback: { lang: 'ar', summary: 'نموذج تدريبي: حصلت على 6 من 10.', points: [] } } },
  });
  issueMissing(data);
  return { root, data, dist: path.join(root, 'dist'), students };
}
