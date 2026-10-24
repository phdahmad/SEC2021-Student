// SEC2021 · My Work — student page. Everything happens in this browser:
// the code + ID unlock one encrypted bundle; nothing is sent anywhere.
import {
  ITERATIONS, normalizeId, normalizeToken, fromHex,
  deriveMaster, locatorOf, decryptBundle, unpackPayload,
} from './crypto.js?v=2';
import { createViewer } from './viewer.js?v=2';
import { t, getLang, applyLang } from './i18n.js?v=2';

const IDLE_MS = 15 * 60 * 1000;
const THEME_KEY = 'sec2021_portal_theme';
const KIND_ORDER = ['quiz', 'midterm', 'assignment', 'project', 'practical', 'lab', 'final', 'activity'];

const $ = (id) => document.getElementById(id);
const views = { login: $('loginView'), home: $('homeView'), item: $('itemView') };
const viewer = createViewer({ pageOf: (i, n) => t('pageOf', i, n), scannedOf: (i, n) => t('scannedOf', i, n) });
let current = { view: 'login', id: null };
let session = null;   // { data, blobs, urls: Map }
let idleTimer = null;

// ---------- small DOM helper (text only — never innerHTML with data) ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const svg = (d, cls = 'chev') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
  return s;
};
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${t('months')[Number(m[2]) - 1]} ${m[1]}` : null;
};
// English course content inside an Arabic page keeps its own direction.
const en = (tag, attrs, ...kids) => h(tag, { ...attrs, dir: 'ltr', lang: 'en' }, ...kids);
// Arabic text that quotes English: isolate each Latin run so the word order stays right.
function mixed(text) {
  return String(text).split(/("[^"\u0600-\u06FF]*"|“[^”\u0600-\u06FF]*”|'[A-Za-z][^'\u0600-\u06FF]*'|[A-Za-z][^\u0600-\u06FF"“”«»،؛]*[A-Za-z0-9)'’]|\d+(?:[-–/]\d+)+|\d+(?:\.\d+)?%)/)
    .map((part, i) => (i % 2 ? h('bdi', { dir: 'ltr', lang: 'en' }, part) : part));
}
const arText = (text) => text && h('span', { class: 'pt-ar', dir: 'rtl', lang: 'ar' }, mixed(text));
const enText = (text) => text && en('span', { class: 'pt-en' }, text);
// Item titles exist in both languages; show the one that matches the page.
const titleOf = (it, tag, attrs = {}) => (getLang() === 'ar' && it.titleAr
  ? h(tag, { ...attrs, dir: 'rtl', lang: 'ar' }, mixed(it.titleAr))
  : en(tag, attrs, it.title));

// ---------- language ----------
applyLang();
$('langBtn').addEventListener('click', () => {
  applyLang(getLang() === 'ar' ? 'en' : 'ar');
  if (session && current.view === 'home') renderHome();
  if (session && current.view === 'item') renderItem(current.id);
});

// ---------- theme ----------
function storedTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
applyTheme(storedTheme());
$('themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
});

// ---------- views ----------
function show(name) {
  current.view = name;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  $('signOutBtn').hidden = name === 'login';
  document.body.classList.toggle('signed-in', name !== 'login');
  window.scrollTo(0, 0);
  $('main').focus({ preventScroll: true });
}

// ---------- sign in ----------
const form = $('loginForm'), btn = $('loginBtn'), err = $('loginError'), notice = $('loginNotice');

$('code').addEventListener('input', (e) => {
  // friendly grouping: XXXX-XXXX-XXXX while typing
  const raw = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
  const grouped = raw.match(/.{1,4}/g)?.join('-') ?? '';
  if (grouped !== e.target.value) e.target.value = grouped;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; notice.hidden = true;
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = t('opening');
  try {
    session = await unlock($('sid').value, $('code').value);
    form.reset();
    renderHome();
    history.replaceState({ view: 'home' }, '');
    show('home');
    armIdle();
  } catch (ex) {
    if (ex && ex.message === 'offline') {
      notice.textContent = t('offline');
      notice.hidden = false;
    } else {
      err.hidden = false;
    }
    $('code').select();
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-label').textContent = t('openBtn');
  }
});

async function unlock(rawId, rawCode) {
  let meta;
  try {
    const r = await fetch('meta.json', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    meta = await r.json();
  } catch { throw new Error('offline'); }
  if (!(meta.iterations >= ITERATIONS)) throw new Error('weak build');

  const id = normalizeId(rawId), code = normalizeToken(rawCode);
  // Same work whether or not the input is well-formed, so timing reveals nothing.
  const master = await deriveMaster(id ?? '0', code ?? 'INVALIDINPUT', fromHex(meta.deploySalt), meta.iterations);
  if (!id || !code) throw new Error('denied');
  const loc = await locatorOf(master);
  let res;
  try { res = await fetch(`bundles/${loc}.bin`, { cache: 'no-store' }); } catch { throw new Error('offline'); }
  if (!res.ok) throw new Error('denied');
  let plain;
  try { plain = await decryptBundle(master, loc, new Uint8Array(await res.arrayBuffer())); } catch { throw new Error('denied'); }
  master.fill(0);
  const { data, blobs } = unpackPayload(plain);
  if (data.student?.id !== id) throw new Error('denied');
  return { data, blobs, urls: new Map() };
}

function blobUrl(i) {
  if (!session.urls.has(i)) {
    const b = session.blobs[i];
    session.urls.set(i, URL.createObjectURL(new Blob([b.bytes], { type: b.type })));
  }
  return session.urls.get(i);
}

function signOut(reason) {
  if (viewer.isOpen()) viewer.hide();
  if (session) for (const u of session.urls.values()) URL.revokeObjectURL(u);
  session = null;
  clearTimeout(idleTimer);
  views.home.replaceChildren(); views.item.replaceChildren();
  form.reset(); err.hidden = true;
  notice.hidden = !reason; notice.textContent = reason ?? '';
  history.replaceState(null, '');
  show('login');
}
$('signOutBtn').addEventListener('click', () => signOut());

function armIdle() {
  clearTimeout(idleTimer);
  if (session) idleTimer = setTimeout(() => signOut(t('idle')), IDLE_MS);
}
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, armIdle, { passive: true });

addEventListener('popstate', (e) => {
  if (!session) return;
  if (viewer.isOpen()) viewer.hide();
  if (e.state?.view === 'item') renderItem(e.state.id, false);
  else { show('home'); }
});

// ---------- home ----------
function chip(status) { return h('span', { class: `chip ${status}` }, t('status')[status] ?? status); }

function renderHome() {
  const { student, categories, items, course } = session.data;
  const section = student.section ? t('section', student.section) : null;

  const hello = h('div', { class: 'hello' },
    h('p', { class: 'eyebrow' }, h('bdi', { dir: 'ltr' }, course?.code ?? 'SEC2021'), ' · ', t('term')),
    h('h1', { id: 'homeTitle' }, h('bdi', { class: 'name', dir: 'rtl', lang: 'ar' }, student.name)),
    h('p', { class: 'hello-meta' },
      h('span', {}, t('id'), ' ', h('bdi', { class: 'mono', dir: 'ltr' }, student.id)),
      section && h('span', {}, section)));

  const rows = categories.map((c) => h('li', { class: 'marks-row' },
    h('span', { class: 'cat' }, t('categories')[c.key] ?? c.label, h('span', { class: 'weight' }, mixed(t('ofCourse', c.weight)))),
    c.recorded
      ? h('span', { class: 'val' }, h('bdi', { dir: 'ltr' }, `${fmt(c.earned)} / ${fmt(c.outOf)}`))
      : h('span', { class: 'val none' }, t('notMarked'))));
  const marks = h('section', { class: 'card marks', 'aria-labelledby': 'marksTitle' },
    h('h2', { id: 'marksTitle' }, t('marksTitle')),
    h('p', { class: 'marks-sub' }, t('marksSub')),
    h('ul', { class: 'marks-grid' }, rows),
    h('p', { class: 'marks-note' }, t('marksNote')));

  const groups = KIND_ORDER.map((kind) => {
    const label = t('kinds')[kind][0];
    const list = items.filter((i) => i.kind === kind);
    if (!list.length) return null;
    return h('section', { class: 'group' },
      h('h2', {}, label, h('span', { class: 'count' }, String(list.length))),
      h('ul', { class: 'items' }, list.map(itemCard)));
  });

  views.home.replaceChildren(hello, marks, ...groups.filter(Boolean));
}

function itemCard(it) {
  const open = it.state === 'published';
  const sub = [it.module ? t('module', it.module) : null, fmtDate(it.date)].filter(Boolean).join(' · ');
  const side = h('span', { class: 'item-side' },
    chip(it.status),
    it.status === 'graded' && h('span', { class: 'item-score' }, h('bdi', { dir: 'ltr' }, `${fmt(it.score)} / ${fmt(it.max)}`)));
  return h('li', {}, h('button', {
    type: 'button', class: 'item-btn', disabled: !open,
    onclick: () => { history.pushState({ view: 'item', id: it.id }, ''); renderItem(it.id); },
  },
  titleOf(it, 'span', { class: 'item-title' }),
  sub && h('span', { class: 'item-sub' }, sub),
  side));
}

// ---------- feedback: one card per part of the sheet ----------
// The summary becomes the first card (its title comes from summaryRef, or from a
// leading "Part A:" in the text). Points whose title starts with "Item" are the
// details of that first part, so they are shown inside its card.
function feedbackList(fb) {
  if (fb.lang === 'ar') return feedbackListAr(fb);
  const points = fb.points ?? [];
  const isDetail = (p) => /^Item\b/.test(p.ref ?? '');
  const cards = [];
  if (fb.summary) {
    let ref = fb.summaryRef ?? null, text = fb.summary;
    const m = !ref && /^(Part [A-Z])\s*:\s*([\s\S]*)$/.exec(text);
    if (m) { ref = m[1]; text = m[2].charAt(0).toUpperCase() + m[2].slice(1); }
    const details = points.filter(isDetail);
    cards.push(h('li', {},
      ref && h('span', { class: 'ref' }, ref),
      h('span', { class: 'pt-text' }, text),
      arText(fb.summaryAr),
      details.length > 0 && h('ul', { class: 'subpoints' }, details.map((p) =>
        h('li', {}, h('span', { class: 'subref' }, p.ref), h('span', {}, p.text), arText(p.textAr))))));
  }
  for (const p of points) {
    if (fb.summary && isDetail(p)) continue;
    cards.push(h('li', {}, p.ref && h('span', { class: 'ref' }, p.ref), h('span', { class: 'pt-text' }, p.text), arText(p.textAr)));
  }
  return en('ul', { class: 'points' }, cards);
}

// SEC2021: the feedback is Arabic. Each point may carry the same point in
// English (textEn) under it. Points whose title starts with «الفقرة» or "Item"
// are details of the first card (for example the questions a student missed).
function feedbackListAr(fb) {
  const points = fb.points ?? [];
  const isDetail = (p) => /^(الفقرة\s|Item\b)/.test(p.ref ?? '');
  const ar = (tag, attrs, text) => h(tag, { ...attrs, dir: 'rtl', lang: 'ar' }, mixed(text));
  const cards = [];
  if (fb.summary) {
    const details = points.filter(isDetail);
    cards.push(h('li', {},
      fb.summaryRef && ar('span', { class: 'ref' }, fb.summaryRef),
      ar('span', { class: 'pt-text' }, fb.summary),
      enText(fb.summaryEn),
      details.length > 0 && h('ul', { class: 'subpoints' }, details.map((p) =>
        h('li', {}, ar('span', { class: 'subref' }, p.ref), ar('span', {}, p.text), enText(p.textEn))))));
  }
  for (const p of points) {
    if (fb.summary && isDetail(p)) continue;
    cards.push(h('li', {}, p.ref && ar('span', { class: 'ref' }, p.ref), ar('span', { class: 'pt-text' }, p.text), enText(p.textEn)));
  }
  return h('ul', { class: 'points', dir: 'rtl', lang: 'ar' }, cards);
}

// ---------- one item ----------
function renderItem(id) {
  const it = session.data.items.find((x) => x.id === id);
  if (!it) return;
  current.id = id;
  const kindLabel = t('kinds')[it.kind]?.[1] ?? '';
  const meta = [kindLabel, it.module ? t('module', it.module) : null, fmtDate(it.date)].filter(Boolean).join(' · ');

  const parts = [
    h('button', { type: 'button', class: 'back', onclick: () => history.back() },
      svg('M15 5l-7 7 7 7'), t('back')),
    h('div', { class: 'item-head' },
      titleOf(it, 'h1'),
      h('div', { class: 'row' }, chip(it.status), h('span', {}, meta))),
  ];

  if (it.status === 'graded') {
    parts.push(h('div', { class: 'score-box' },
      h('bdi', { class: 'big', dir: 'ltr' }, `${fmt(it.score)} / ${fmt(it.max)}`),
      it.scaled != null && h('span', {}, mixed(t('scaled', fmt(it.scaled), fmt(it.weight))))));
  }

  const intro = {
    completed: it.graded ? null : t('introCompleted'),
    graded: it.graded ? null : t('introPractice'),
    not_submitted: t('introMissing'),
    excused: t('introExcused'),
  }[it.status];

  const fb = it.feedback;
  if (intro || fb) {
    const panel = h('section', { class: 'card panel', 'aria-labelledby': 'fbTitle' }, h('h2', { id: 'fbTitle' }, fb ? t('feedback') : t('statusTitle')));
    if (intro) panel.append(h('p', { class: 'muted' }, intro));
    const second = fb && (fb.lang === 'ar'
      ? [fb.summaryEn, ...(fb.points ?? []).map((p) => p.textEn)]
      : [fb.summaryAr, ...(fb.points ?? []).map((p) => p.textAr)]).some(Boolean);
    const langNote = second ? t('feedbackLangBoth') : t('feedbackLang');
    if (fb && langNote) panel.append(h('p', { class: 'fb-lang' }, langNote));
    if (fb) panel.append(feedbackList(fb));
    if (fb) panel.append(h('p', { class: 'review-note' }, t('reviewed')));
    parts.push(panel);
  }

  if (it.pages?.length) {
    const urls = it.pages.map(blobUrl);
    parts.push(h('section', { class: 'card panel', 'aria-labelledby': 'pgTitle' },
      h('h2', { id: 'pgTitle' }, t('sheet')),
      h('p', { class: 'muted' }, t('sheetHint')),
      h('div', { class: 'pages' }, urls.map((u, i) =>
        h('button', { type: 'button', class: 'page-thumb', onclick: () => viewer.show(urls, i), 'aria-label': t('openPage', i + 1) },
          h('img', { src: u, alt: '', loading: 'lazy' }), h('span', {}, t('page', i + 1)))))));
  }

  views.item.replaceChildren(...parts);
  show('item');
}
