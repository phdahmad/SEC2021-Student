// SEC2021 — the feedback a student sees for one marked sheet.
// ONE implementation, used in two places so they can never disagree:
//   * review.html (inlined by tools/review-page.mjs) shows it as a live preview;
//   * tools/results-from-review.mjs writes it into results/<item>.json.
// Plain JavaScript, no DOM. The feedback is Arabic; English is optional (textEn).
//
// A  = assessment.json of the batch
// s  = one student of the draft: { v, ans, short: [...] }
// r  = the marks being reviewed: { obj: [..], sq: [[..]], sn, far, fen, summaryExtra, wLevel, wTip }

export const fmtMark = (n) => (Math.round(n * 100) / 100).toString();
export const sumMarks = (a) => a.reduce((x, y) => x + (+y || 0), 0);
export const objMax = (o) => (typeof o.max === 'number' ? o.max : 1);
export const objLabel = (o) => String(o.label ?? o.q);

// Default mark of one objective item, from the draft: the imported mark if the
// draft has one, otherwise full marks when the answer matches the key.
export function objDefault(o, i, s) {
  if (Array.isArray(s.objMarks) && typeof s.objMarks[i] === 'number') return s.objMarks[i];
  return (s.ans ?? '')[i] === o.key ? objMax(o) : 0;
}

export function totalOf(r) {
  return Math.round((sumMarks(r.obj) + r.sq.reduce((t, q) => t + sumMarks(q), 0)) * 100) / 100;
}

const AR_WORD = { T: 'صح', F: 'خطأ' };
const shown = (x) => AR_WORD[x] ?? x;

export function buildFeedback(A, s, r) {
  const V = A.versions[s.v];
  const OBJ = V.objective ?? [], SHORT = V.short ?? [];
  const total = totalOf(r);
  const objOk = OBJ.every((o, i) => +r.obj[i] === objMax(o));

  let summary = `حصلت على ${fmtMark(total)} من ${A.max}.`;
  if (OBJ.length) summary += objOk ? ' إجاباتك في الأسئلة الموضوعية كلها صحيحة.' : ' الفقرات التي فاتتك مشروحة أدناه.';
  if (r.summaryExtra && r.summaryExtra.trim()) summary += ' ' + r.summaryExtra.trim();

  const points = [];
  OBJ.forEach((o, i) => {
    const got = +r.obj[i], max = objMax(o);
    if (got === max) return;
    const a = (s.ans ?? '')[i];
    let text;
    if (a === o.key && o.half) text = `حكمك صحيح (${shown(a)})، لكن التصحيح ناقص أو غير صحيح، فأخذت ${fmtMark(got)} من ${fmtMark(max)}.`;
    else if (got > 0) text = `أخذت ${fmtMark(got)} من ${fmtMark(max)} في هذه الفقرة.`;
    else if (a === o.key) text = `أخذت ${fmtMark(got)} من ${fmtMark(max)} في هذه الفقرة.`;
    else if (a === '-' || a === undefined) text = 'تركت هذه الفقرة دون إجابة.';
    else if (a === 'X') text = 'اخترت إجابتين، فلا تُحتسب الفقرة.';
    else text = `اخترت ${shown(a)}، والإجابة الصحيحة ${shown(o.key)}.`;
    if (o.whyAr) text += ' ' + o.whyAr;
    const pt = { ref: `الفقرة ${objLabel(o)} · ${o.topicAr ?? o.topic ?? ''}`.replace(/ · $/, ''), text };
    if (o.whyEn) pt.textEn = o.whyEn;
    points.push(pt);
  });
  SHORT.forEach((q, j) => {
    const max = sumMarks(q.parts.map((p) => p.max));
    const marks = q.parts.length ? ` · ${fmtMark(sumMarks(r.sq[j]))} من ${fmtMark(max)}` : '';
    const ar = (r.far?.[j] ?? '').trim(), en = (r.fen?.[j] ?? '').trim();
    if (!ar && !en) return;
    const pt = { ref: `${q.labelAr ?? 'السؤال ' + q.q} · ${q.topicAr ?? q.topic ?? ''}${marks}`, text: ar || en };
    if (ar && en) pt.textEn = en;
    points.push(pt);
  });

  const feedback = { lang: 'ar', summary, points };
  if (A.writingTip === true && r.wTip) feedback.writing = { level: r.wLevel, tipAr: r.wTip };
  return feedback;
}
