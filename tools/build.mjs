// Full build: encrypts one bundle per student into dist/ (new deploy salt,
// new bundle salts and IVs every time), copies the page, then runs the guard.
// If the guard fails, dist/ is deleted and nothing can be published.
//
// Usage: node tools/build.mjs [--data <dataDir>] [--out <dist>] [--iterations N (tests only)]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ITERATIONS, randomBytes, toHex, normalizeId, normalizeToken,
  deriveMaster, locatorOf, encryptBundle, packPayload,
} from '../src/crypto.js';
import { SRC, REPO, dataDir, distDir, assertSeparate, readCsv, readJson, writeJson, fail, argValue } from './lib.mjs';
import { guard, ALLOWED_PAGE_FILES } from './guard.mjs';

const PAD_STEP = 64 * 1024;
const KINDS = ['activity', 'quiz', 'assignment', 'lab', 'midterm', 'project', 'practical', 'final'];
const STATUSES = ['completed', 'graded', 'excused', 'not_submitted'];

export function loadData(data) {
  const need = (f) => { const p = path.join(data, f); if (!fs.existsSync(p)) fail(`Missing ${p}`); return p; };
  const roster = readCsv(need('roster.csv')).map((r) => ({ id: normalizeId(r.id), name: r.name, section: r.section }));
  for (const r of roster) if (!r.id) fail('roster.csv has an invalid student ID');
  if (new Set(roster.map((r) => r.id)).size !== roster.length) fail('roster.csv has duplicate IDs');

  const tokenRows = readCsv(need('tokens.csv'));
  const tokens = new Map();
  for (const t of tokenRows) {
    const id = normalizeId(t.id), tok = normalizeToken(t.token);
    if (!id || !tok) fail(`tokens.csv: bad row for ${t.id}`);
    tokens.set(id, tok);
  }
  const missing = roster.filter((r) => !tokens.has(r.id));
  if (missing.length) fail(`${missing.length} students have no access code. Run: node tools/tokens.mjs`);

  const catalog = readJson(need('items.json'));
  const results = new Map();
  for (const item of catalog.items) {
    if (!KINDS.includes(item.kind)) fail(`items.json: unknown kind "${item.kind}" for ${item.id}`);
    if (item.state !== 'published') continue;
    const file = path.join(data, item.results ?? `results/${item.id}.json`);
    if (!fs.existsSync(file)) fail(`${item.id} is published but ${file} is missing`);
    const r = readJson(file);
    if (r.approved !== true) fail(`${item.id}: results are not approved yet (set "approved": true after review). Nothing was built.`);
    for (const [id, rec] of Object.entries(r.students)) {
      if (!roster.some((s) => s.id === id)) fail(`${item.id}: result for ${id}, who is not in roster.csv`);
      if (!STATUSES.includes(rec.status)) fail(`${item.id}/${id}: unknown status "${rec.status}"`);
      if (rec.status === 'graded' && typeof rec.score !== 'number') fail(`${item.id}/${id}: graded without a score`);
      for (const p of rec.pages ?? []) if (!fs.existsSync(path.join(data, p))) fail(`${item.id}/${id}: page image missing: ${p}`);
    }
    results.set(item.id, r.students);
  }
  return { roster, tokens, catalog, results };
}

const round2 = (x) => Math.round(x * 100) / 100;

// Everything ONE student may see — and nothing about anyone else.
export function studentView(data, { roster, catalog, results }, student, built) {
  const blobs = [];
  const items = catalog.items.map((item) => {
    const base = {
      id: item.id, kind: item.kind, category: item.category ?? null, title: item.title, titleAr: item.titleAr ?? null,
      module: item.module ?? null, date: item.date ?? null, graded: !!item.graded,
      max: item.max ?? null, weight: item.weight ?? null, state: item.state,
    };
    if (item.state !== 'published') return { ...base, status: item.state === 'marking' ? 'marking' : 'upcoming' };
    const rec = results.get(item.id)[student.id];
    if (!rec) return { ...base, status: 'not_submitted' };
    const pages = (rec.pages ?? []).map((p) => {
      blobs.push({ type: 'image/webp', bytes: new Uint8Array(fs.readFileSync(path.join(data, p))) });
      return blobs.length - 1;
    });
    const scaled = rec.status === 'graded' && item.max && item.weight ? round2((rec.score / item.max) * item.weight) : null;
    return {
      ...base, status: rec.status, score: rec.status === 'graded' ? rec.score : null, scaled,
      feedback: rec.feedback ?? null, pages,
    };
  });
  const categories = (catalog.categories ?? []).map((c) => {
    const counted = items.filter((i) => i.category === c.key && i.status === 'graded' && i.scaled !== null);
    const excused = items.filter((i) => i.category === c.key && i.status === 'excused');
    const missed = items.filter((i) => i.category === c.key && i.status === 'not_submitted' && i.graded && i.weight);
    return {
      key: c.key, label: c.label, weight: c.weight,
      earned: round2(counted.reduce((s, i) => s + i.scaled, 0)),
      outOf: round2([...counted, ...missed].reduce((s, i) => s + i.weight, 0)),
      recorded: counted.length + missed.length + excused.length,
    };
  });
  const view = {
    schema: 1, built, course: catalog.course,
    student: { id: student.id, name: student.name, section: student.section },
    categories, items,
  };
  return { view, blobs };
}

function copyPage(dist) {
  fs.mkdirSync(path.join(dist, 'bundles'), { recursive: true });
  for (const rel of ALLOWED_PAGE_FILES) {
    const from = path.join(SRC, rel);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(dist, rel));
  }
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
}

function looksLikeBuild(dir) {
  const walk = (d, b = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), b) : [path.relative(b, path.join(d, e.name)).split(path.sep).join('/')]);
  const files = walk(dir);
  return files.length === 0 || files.every((f) => ALLOWED_PAGE_FILES.has(f) || /^bundles\/[0-9a-f]{64}\.bin$/.test(f));
}

export function cleanDist(dist) {
  const rel = path.relative(REPO, dist);
  const insideRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (fs.existsSync(dist)) {
    // Outside the repo we only ever delete a folder that looks like a previous build.
    if (!insideRepo && !looksLikeBuild(dist)) fail(`Refusing to empty ${dist}: it is outside the repository and is not a previous build.`);
    fs.rmSync(dist, { recursive: true, force: true });
  }
}

export async function build({ data, dist, iterations = ITERATIONS, log = console.log }) {
  assertSeparate(data, dist);
  const loaded = loadData(data);
  const built = new Date().toISOString();
  const deploySalt = randomBytes(16);

  const prepared = loaded.roster.map((s) => ({ s, ...studentView(data, loaded, s, built) }));
  const longest = Math.max(...prepared.map((p) => packPayload(p.view, p.blobs).length));
  const padTo = Math.ceil((longest + 1) / PAD_STEP) * PAD_STEP;

  cleanDist(dist);
  copyPage(dist);
  const locators = {};
  let n = 0;
  for (const p of prepared) {
    const token = loaded.tokens.get(p.s.id);
    const master = await deriveMaster(p.s.id, token, deploySalt, iterations);
    const loc = await locatorOf(master);
    const bundle = await encryptBundle(master, loc, packPayload(p.view, p.blobs, padTo));
    fs.writeFileSync(path.join(dist, 'bundles', loc + '.bin'), bundle);
    locators[p.s.id] = loc;
    if (++n % 10 === 0) log(`  encrypted ${n}/${prepared.length}`);
  }
  const bundleSize = padTo + 33 + 16;
  writeJson(path.join(dist, 'meta.json'), { schema: 1, deploySalt: toHex(deploySalt), iterations, built, bundleSize });

  const problems = guard(dist, loaded.roster, { minIterations: Math.min(iterations, ITERATIONS) });
  if (problems.length) {
    fs.rmSync(dist, { recursive: true, force: true });
    fail('Guard failed — output deleted:\n  - ' + problems.join('\n  - '));
  }
  writeJson(path.join(data, 'deploy-state.json'), {
    built, deploySalt: toHex(deploySalt), iterations, padTo, bundleSize, locators,
  });
  log(`Built ${prepared.length} bundles of ${(bundleSize / 1024).toFixed(0)} KB each into ${dist}. Guard passed.`);
  return { locators, deploySalt, padTo };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const it = argValue('--iterations');
  await build({ data: dataDir(), dist: distDir(), iterations: it ? Number(it) : ITERATIONS });
}
