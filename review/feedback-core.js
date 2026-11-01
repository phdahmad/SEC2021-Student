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

// ---------- grants: marks given in full to every student ----------
// A.grants = [{ id, titleAr, headingAr?, noteAr, groups: [{ labelAr, items: ['1-13', '2-5', '3-3', '4-ب', …] }] }]
// Items are objective labels or essay part labels. The marks the teacher reviews (r)
// stay the marks the student earned; the grant is applied on top, and the student is
// shown both: per group (question) and in total, before and after.
// A label names one objective item or one essay part; "Q4:ب" names part ب of question 4
// when part labels repeat across questions. A label that matches twice is refused.
function locate(A, s, label) {
  const V = A.versions[s.v ?? 'A'];
  const m = /^Q(\d+):(.+)$/.exec(label);
  const found = [];
  if (!m) (V.objective ?? []).forEach((o, i) => { if (objLabel(o) === label) found.push({ kind: 'obj', i, max: objMax(o) }); });
  (V.short ?? []).forEach((q, j) => {
    if (m && String(q.q) !== m[1]) return;
    q.parts.forEach((p, k) => { if (p.label === (m ? m[2] : label)) found.push({ kind: 'sq', j, k, max: p.max }); });
  });
  if (found.length !== 1) throw new Error(`grant: «${label}» matches ${found.length} items or parts (expected exactly one)`);
  return found[0];
}
const markAt = (r, at) => +(at.kind === 'obj' ? r.obj[at.i] : r.sq[at.j][at.k]) || 0;

// The marks that count: r with every granted item at full marks.
export function creditOf(A, s, r) {
  if (!A.grants?.length) return r;
  const c = { ...r, obj: [...r.obj], sq: r.sq.map((q) => [...q]) };
  for (const g of A.grants) for (const grp of g.groups) for (const label of grp.items) {
    const at = locate(A, s, label);
    if (at.kind === 'obj') c.obj[at.i] = at.max; else c.sq[at.j][at.k] = at.max;
  }
  return c;
}
export const scoreOf = (A, s, r) => totalOf(creditOf(A, s, r));

// What the student is shown for each grant: per group before/after/max, then the total.
export function adjustmentsOf(A, s, r) {
  if (!A.grants?.length) return [];
  const before = totalOf(r), after = scoreOf(A, s, r);
  const scale = (t) => (A.weight ? Math.round(t / A.max * A.weight * 100) / 100 : null);
  return A.grants.map((g) => {
    const rows = g.groups.map((grp) => {
      const at = grp.items.map((l) => locate(A, s, l));
      const max = sumMarks(at.map((x) => x.max)), got = sumMarks(at.map((x) => markAt(r, x)));
      return { labelAr: grp.labelAr, before: Math.round(got * 100) / 100, after: max, max };
    });
    return { id: g.id, titleAr: g.headingAr ?? g.titleAr, noteAr: g.noteAr ?? '', rows,
      before, after, max: A.max, weight: A.weight ?? null, scaledBefore: scale(before), scaledAfter: scale(after) };
  });
}
const grantLabels = (A) => new Set((A.grants ?? []).flatMap((g) => g.groups.flatMap((grp) => grp.items)));

// How an answer is written for the student: صح/خطأ for true/false, and the Arabic
// letters printed on the paper (أ ب ج د) when the assessment says letters: 'ar'.
const AR_WORD = { T: 'صح', F: 'خطأ' };
const AR_LETTER = { A: 'أ', B: 'ب', C: 'ج', D: 'د' };
export function shownAnswer(x, A) {
  if (x === '-' || x === undefined || x === null || x === '') return '—';
  if (AR_WORD[x]) return AR_WORD[x];
  if (A?.letters === 'ar' && AR_LETTER[x]) return AR_LETTER[x];
  return x;
}

export function buildFeedback(A, s, r) {
  const V = A.versions[s.v];
  const OBJ = V.objective ?? [], SHORT = V.short ?? [];
  const earned = totalOf(r), total = scoreOf(A, s, r);
  const granted = grantLabels(A), grantNames = (A.grants ?? []).map((g) => g.titleAr).join(' و');
  const objOk = OBJ.every((o, i) => +r.obj[i] === objMax(o));

  let summary = `حصلت على ${fmtMark(total)} من ${A.max}.`;
  if (granted.size) summary = total !== earned
    ? `حصلت على ${fmtMark(total)} من ${A.max} بعد احتساب ${grantNames} كاملة، وكانت درجتك قبلها ${fmtMark(earned)}.`
    : `حصلت على ${fmtMark(total)} من ${A.max}، و${grantNames} كاملة عندك من الأصل.`;
  if (OBJ.length) summary += objOk ? ' إجاباتك في الأسئلة الموضوعية كلها صحيحة.' : ' الفقرات التي فاتتك مشروحة أدناه.';
  if (r.summaryExtra && r.summaryExtra.trim()) summary += ' ' + r.summaryExtra.trim();

  const points = [];
  OBJ.forEach((o, i) => {
    const got = +r.obj[i], max = objMax(o);
    if (got === max) return;
    const a = (s.ans ?? '')[i];
    let text;
    if (a === o.key && o.half) text = `حكمك صحيح (${shownAnswer(a, A)})، لكن التصحيح ناقص أو غير صحيح، فأخذت ${fmtMark(got)} من ${fmtMark(max)}.`;
    else if (got > 0) text = `أخذت ${fmtMark(got)} من ${fmtMark(max)} في هذه الفقرة.`;
    else if (a === o.key) text = `أخذت ${fmtMark(got)} من ${fmtMark(max)} في هذه الفقرة.`;
    else if (a === '-' || a === undefined) text = 'تركت هذه الفقرة دون إجابة.';
    else if (a === 'X') text = 'اخترت إجابتين، فلا تُحتسب الفقرة.';
    else text = `اخترت ${shownAnswer(a, A)}، والإجابة الصحيحة ${shownAnswer(o.key, A)}.`;
    if (o.whyAr) text += ' ' + o.whyAr;
    if (granted.has(objLabel(o))) text += ` واحتُسبت لك هذه الفقرة كاملة ضمن ${grantNames}.`;
    const pt = { ref: `الفقرة ${objLabel(o)} · ${o.topicAr ?? o.topic ?? ''}`.replace(/ · $/, ''), text };
    if (o.whyEn) pt.textEn = o.whyEn;
    points.push(pt);
  });
  SHORT.forEach((q, j) => {
    const max = sumMarks(q.parts.map((p) => p.max));
    const marks = q.parts.length ? ` · ${fmtMark(sumMarks(r.sq[j]))} من ${fmtMark(max)}` : '';
    const ar = (r.far?.[j] ?? '').trim(), en = (r.fen?.[j] ?? '').trim();
    if (!ar && !en) return;
    const lost = q.parts.filter((p, k) => (granted.has(p.label) || granted.has(`Q${q.q}:${p.label}`)) && +r.sq[j][k] < p.max).map((p) => p.label);
    const which = lost.length === 1 ? `الفرع ${lost[0]} كاملاً` : lost.length === 2 ? `الفرعان ${lost.join(' و')} كاملَين` : `الفروع ${lost.join(' و')} كاملة`;
    const note = lost.length ? ` واحتُسب لك ${which} ضمن ${grantNames}.` : '';
    const pt = { ref: `${q.labelAr ?? 'السؤال ' + q.q} · ${q.topicAr ?? q.topic ?? ''}${marks}`, text: (ar || en) + (ar ? note : '') };
    if (ar && en) pt.textEn = en;
    points.push(pt);
  });

  const feedback = { lang: 'ar', summary, points };
  const adj = adjustmentsOf(A, s, r);
  if (adj.length) feedback.adjustments = adj;
  if (A.writingTip === true && r.wTip) feedback.writing = { level: r.wLevel, tipAr: r.wTip };
  return feedback;
}
