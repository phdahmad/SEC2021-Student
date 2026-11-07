// Before publishing: opens EVERY student's bundle in dist/ with that student's real code,
// exactly as the page does, and checks what is inside against the data folder.
// Never prints a code, a name or a full ID (IDs are masked to their last three digits).
//
//   node tools/verify-dist.mjs [--data <dataDir>] [--out dist]
//
// Checks, for every student in roster.csv:
//   * the bundle opens with the student's own code, and holds that student only;
//   * every published item has the score, status and number of page images of results/<item>.json,
//     and each page image is the same bytes as the file in the data folder;
//   * a wrong code (one character changed) opens nothing;
//   * the next student's code opens nothing with this student's ID.
// Also: every bundle in dist/bundles belongs to a roster student (no stray bundles).
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, argValue, readCsv, fail } from './lib.mjs';
import { deriveMaster, locatorOf, decryptBundle, unpackPayload, normalizeId, normalizeToken, fromHex, ALPHABET } from '../src/crypto.js';

const DATA = dataDir();
const DIST = path.resolve(argValue('--out') ?? 'dist');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const mask = (id) => '…' + String(id).slice(-3);
const meta = readJson(path.join(DIST, 'meta.json'));
const salt = fromHex(meta.deploySalt);

async function open(id, code) {
  const master = await deriveMaster(normalizeId(id), normalizeToken(code), salt, meta.iterations);
  const loc = await locatorOf(master);
  const file = path.join(DIST, 'bundles', loc + '.bin');
  if (!fs.existsSync(file)) return { loc, payload: null };
  try { return { loc, payload: unpackPayload(await decryptBundle(master, loc, fs.readFileSync(file))) }; } catch { return { loc, payload: null }; }
}

const roster = readCsv(path.join(DATA, 'roster.csv'));
const tokens = Object.fromEntries(readCsv(path.join(DATA, 'tokens.csv')).map((r) => [normalizeId(r.id), r.token]));
const catalog = readJson(path.join(DATA, 'items.json'));
const results = Object.fromEntries(catalog.items.filter((i) => i.state === 'published')
  .map((i) => [i.id, readJson(path.join(DATA, i.results ?? `results/${i.id}.json`))]));
const recOf = (item, id) => { const s = results[item].students; return Array.isArray(s) ? s.find((x) => x.id === id) : s[id]; };

const problems = [], used = new Set();
console.log(`Checking ${roster.length} bundles (${meta.iterations} PBKDF2 iterations each, this takes a while)…`);
for (const [n, st] of roster.entries()) {
  const id = normalizeId(st.id), code = tokens[id];
  const say = (msg) => problems.push(`${mask(id)}: ${msg}`);
  if (!code) { say('no code in tokens.csv'); continue; }
  const { loc, payload } = await open(id, code);
  used.add(loc);
  if (!payload) { say('bundle does not open with the student’s own code'); continue; }
  const v = payload.data;
  if (v.student?.id !== id) say('bundle holds a different student');
  let images = 0;
  for (const it of v.items) {
    if (!results[it.id]) continue;
    const rec = recOf(it.id, id);
    if (!rec) { if (it.status !== 'not_submitted') say(`${it.id}: no result, but status ${it.status}`); continue; }
    if (it.status !== rec.status) say(`${it.id}: status ${it.status}, expected ${rec.status}`);
    if (rec.status === 'graded' && it.score !== rec.score) say(`${it.id}: score ${it.score}, expected ${rec.score}`);
    if ((it.pages ?? []).length !== (rec.pages ?? []).length) say(`${it.id}: ${it.pages.length} pages, expected ${rec.pages.length}`);
    (rec.pages ?? []).forEach((p, k) => {
      const blob = payload.blobs[it.pages[k]];
      if (!blob || !Buffer.from(blob.bytes).equals(fs.readFileSync(path.join(DATA, p)))) say(`${it.id}: page ${k + 1} differs from the data folder`);
      else images++;
    });
  }
  // a code with one character changed must open nothing
  const i = code.length - 1, wrong = code.slice(0, i) + ALPHABET[(ALPHABET.indexOf(code[i]) + 1) % ALPHABET.length];
  if ((await open(id, wrong)).payload) say('a wrong code opens the bundle');
  // the next student's code must not open anything with this ID
  const other = roster[(n + 1) % roster.length];
  if (other && normalizeId(other.id) !== id && (await open(id, tokens[normalizeId(other.id)])).payload) say('another student’s code opens a bundle with this ID');
  console.log(`  ${mask(id)}: opens, ${v.items.filter((x) => x.status === 'graded').length} marked items, ${images} page images match`);
}
const files = fs.readdirSync(path.join(DIST, 'bundles')).map((f) => f.replace(/\.bin$/, ''));
const stray = files.filter((f) => !used.has(f));
if (stray.length) problems.push(`${stray.length} bundle(s) in dist/bundles belong to no roster student`);
if (problems.length) { console.error('\nPROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`\nAll ${roster.length} bundles open with their own codes only, and match the approved results.`);
