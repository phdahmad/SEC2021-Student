// node --test tests/   — security and correctness tests (fake data only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ALPHABET, TOKEN_LEN, generateToken, normalizeToken, normalizeId, fromHex,
  deriveMaster, locatorOf, decryptBundle, unpackPayload,
} from '../src/crypto.js';
import { build } from '../tools/build.mjs';
import { guard } from '../tools/guard.mjs';
import { readCsv } from '../tools/lib.mjs';
import { makeData, FAKE as ALL } from './fixture.mjs';
const FAKE = ALL.slice(0, 3); // the default fake data folder has three students

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IT = 1000; // fast iterations for unit tests only; the page refuses anything below 600,000
const quiet = () => {};

// What the page does, step for step.
async function login(dist, id, code) {
  const meta = JSON.parse(fs.readFileSync(path.join(dist, 'meta.json'), 'utf8'));
  const nid = normalizeId(id), tok = normalizeToken(code);
  if (!nid || !tok) return null;
  const master = await deriveMaster(nid, tok, fromHex(meta.deploySalt), meta.iterations);
  const loc = await locatorOf(master);
  const file = path.join(dist, 'bundles', loc + '.bin');
  if (!fs.existsSync(file)) return null;
  try { return unpackPayload(await decryptBundle(master, loc, fs.readFileSync(file))); } catch { return null; }
}
const tokensOf = (data) => Object.fromEntries(readCsv(path.join(data, 'tokens.csv')).map((r) => [r.id, r.token]));
const run = (args) => spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });

test('access codes: 12 characters, no ambiguous characters, unbiased alphabet', () => {
  for (const bad of ['0', 'O', '1', 'I', 'L']) assert.ok(!ALPHABET.includes(bad));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = generateToken();
    assert.equal(t.length, TOKEN_LEN);
    assert.match(t, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/);
    seen.add(t);
  }
  assert.equal(seen.size, 2000);
  assert.equal(normalizeToken('k7qm-4xrt 9hzp'), 'K7QM4XRT9HZP');
  assert.equal(normalizeToken('K7QM-4XRT-9HZ0'), null);       // 0 is not allowed
  assert.equal(normalizeId('٤٤٥٠٠١٧٣٤'), '445001734');          // Arabic-keyboard digits
});

test('each student sees only their own data', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const tokens = tokensOf(data);
  assert.equal(fs.readdirSync(path.join(dist, 'bundles')).length, FAKE.length);
  for (const s of FAKE) {
    const r = await login(dist, s.id, tokens[s.id]);
    assert.ok(r, `${s.id} could not log in`);
    assert.equal(r.data.student.id, s.id);
    assert.equal(r.data.student.name, s.name);
    const text = JSON.stringify(r.data);
    for (const o of FAKE.filter((x) => x.id !== s.id)) {
      assert.ok(!text.includes(o.id), `${s.id} bundle contains another student's ID`);
      assert.ok(!text.includes(o.name), `${s.id} bundle contains another student's name`);
    }
  }
  const a = await login(dist, FAKE[0].id, tokens[FAKE[0].id]);
  assert.ok(JSON.stringify(a.data).includes('SECRET-FEEDBACK-A'));
  assert.ok(!JSON.stringify(a.data).includes('SECRET-FEEDBACK-B'));
  assert.equal(a.blobs.length, 5);                                   // own five midterm pages only
  const q1 = a.data.items.find((i) => i.id === 'Q1');
  assert.equal(q1.scaled, 3.5);                                      // 7/10 × 5%
  const mid = a.data.items.find((i) => i.id === 'MID');
  assert.equal(mid.scaled, 16.5);                                    // 33/40 × 20%
  assert.equal(mid.titleAr, 'الاختبار النصفي');
  assert.equal(a.data.student.section, '48');
  const pq = a.data.items.find((i) => i.id === 'PQ');
  assert.equal(pq.graded, false);                                    // practice: shown, never counted
  assert.equal(pq.scaled, null);
  const quizzes = a.data.categories.find((c) => c.key === 'quizzes');
  assert.deepEqual([quizzes.earned, quizzes.outOf], [3.5, 5]);
  const c = await login(dist, FAKE[2].id, tokens[FAKE[2].id]);
  assert.equal(c.data.items.find((i) => i.id === 'MID').status, 'not_submitted');
  assert.equal(c.blobs.length, 0);
});

test('wrong code, wrong ID, or another student\'s code is refused', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const t = tokensOf(data);
  const [a, b] = FAKE;
  assert.equal(await login(dist, a.id, 'AAAA-BBBB-CCCC'), null);     // wrong code
  assert.equal(await login(dist, '900000999', t[a.id]), null);       // wrong ID, right code
  assert.equal(await login(dist, a.id, t[b.id]), null);              // someone else's code
  assert.equal(await login(dist, b.id, t[a.id]), null);
  const flipped = t[a.id].slice(0, -1) + (t[a.id].endsWith('Z') ? 'Y' : 'Z');
  assert.equal(await login(dist, a.id, flipped), null);              // one character off
});

test('a tampered bundle does not decrypt', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const t = tokensOf(data);
  const meta = JSON.parse(fs.readFileSync(path.join(dist, 'meta.json'), 'utf8'));
  const master = await deriveMaster(FAKE[0].id, normalizeToken(t[FAKE[0].id]), fromHex(meta.deploySalt), IT);
  const loc = await locatorOf(master);
  const buf = fs.readFileSync(path.join(dist, 'bundles', loc + '.bin'));
  buf[500] ^= 1;
  await assert.rejects(decryptBundle(master, loc, buf));
});

test('all bundles have the same size, and the output holds no plaintext', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const sizes = new Set(fs.readdirSync(path.join(dist, 'bundles')).map((f) => fs.statSync(path.join(dist, 'bundles', f)).size));
  assert.equal(sizes.size, 1);
  assert.deepEqual(guard(dist, FAKE, { minIterations: IT }), []);
  for (const f of fs.readdirSync(dist, { recursive: true })) {
    const p = path.join(dist, f);
    if (fs.statSync(p).isDirectory()) continue;
    const s = fs.readFileSync(p).toString('latin1');
    assert.ok(!s.includes('SECRET-FEEDBACK'), `${f} contains plaintext feedback`);
    assert.ok(!s.includes('RIFF'), `${f} contains an unencrypted image`);
  }
});

test('guard rejects any unencrypted file in the publish folder', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const check = (label, mutate, undo) => {
    mutate();
    const p = guard(dist, FAKE, { minIterations: IT });
    assert.ok(p.length > 0, `guard missed: ${label}`);
    undo();
    assert.deepEqual(guard(dist, FAKE, { minIterations: IT }), [], `guard not clean after undo: ${label}`);
  };
  const f = (rel) => path.join(dist, rel);
  check('a JSON data file', () => fs.writeFileSync(f('grades.json'), '{}'), () => fs.rmSync(f('grades.json')));
  check('a scanned image', () => fs.copyFileSync(path.join(data, 'batches/MID/web', FAKE[0].id + '_p1.webp'), f('bundles/page.webp')), () => fs.rmSync(f('bundles/page.webp')));
  check('a CSV', () => fs.writeFileSync(f('tokens.csv'), 'id,token'), () => fs.rmSync(f('tokens.csv')));
  check('a plaintext .bin with a bundle name', () => fs.writeFileSync(f('bundles/' + 'a'.repeat(64) + '.bin'), 'A41B' + 'x'.repeat(5000)), () => fs.rmSync(f('bundles/' + 'a'.repeat(64) + '.bin')));
  const html = fs.readFileSync(f('index.html'));
  check('a student ID inside the page', () => fs.appendFileSync(f('index.html'), FAKE[1].id), () => fs.writeFileSync(f('index.html'), html));
  check('a student name inside the page', () => fs.appendFileSync(f('index.html'), FAKE[1].name), () => fs.writeFileSync(f('index.html'), html));
  const meta = fs.readFileSync(f('meta.json'));
  check('weak iterations in meta.json', () => fs.writeFileSync(f('meta.json'), JSON.stringify({ ...JSON.parse(meta), iterations: 10 })), () => fs.writeFileSync(f('meta.json'), meta));
  assert.ok(guard(dist, FAKE).length > 0, 'production guard must refuse a test build with low iterations');
});

test('build refuses unapproved results and refuses a data folder inside the repository', () => {
  const { data, dist } = makeData({ approved: false });
  let r = run(['tools/build.mjs', '--data', data, '--out', dist, '--iterations', String(IT)]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not approved/);
  assert.ok(!fs.existsSync(path.join(dist, 'bundles')));
  r = run(['tools/build.mjs', '--data', path.join(REPO, 'tests'), '--out', dist, '--iterations', String(IT)]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /inside the repository/);
});

test('every build uses a new salt, new bundle names and new ciphertext', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const m1 = JSON.parse(fs.readFileSync(path.join(dist, 'meta.json'))); const n1 = fs.readdirSync(path.join(dist, 'bundles')).sort();
  await build({ data, dist, iterations: IT, log: quiet });
  const m2 = JSON.parse(fs.readFileSync(path.join(dist, 'meta.json'))); const n2 = fs.readdirSync(path.join(dist, 'bundles')).sort();
  assert.notEqual(m1.deploySalt, m2.deploySalt);
  assert.equal(n1.filter((x) => n2.includes(x)).length, 0);
  const t = tokensOf(data);
  for (const s of FAKE) assert.ok(await login(dist, s.id, t[s.id]), 'codes keep working across builds');
});

test('re-issuing one code re-encrypts only that student', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const before = tokensOf(data);
  const snap = Object.fromEntries(fs.readdirSync(path.join(dist, 'bundles')).map((f) => [f, fs.readFileSync(path.join(dist, 'bundles', f))]));
  const r = run(['tools/reissue.mjs', '--id', FAKE[0].id, '--data', data, '--out', dist]);
  assert.equal(r.status, 0, r.stderr);
  const after = tokensOf(data);
  assert.notEqual(after[FAKE[0].id], before[FAKE[0].id]);
  assert.equal(await login(dist, FAKE[0].id, before[FAKE[0].id]), null, 'old code must stop working');
  assert.ok(await login(dist, FAKE[0].id, after[FAKE[0].id]), 'new code must work');
  for (const s of FAKE.slice(1)) {
    assert.equal(after[s.id], before[s.id]);
    assert.ok(await login(dist, s.id, after[s.id]));
  }
  const now = fs.readdirSync(path.join(dist, 'bundles'));
  const unchanged = now.filter((f) => snap[f] && snap[f].equals(fs.readFileSync(path.join(dist, 'bundles', f))));
  assert.equal(unchanged.length, FAKE.length - 1, 'other bundles must be byte-for-byte unchanged');
  assert.equal(now.length, FAKE.length, 'old bundle must be deleted');
  const log = readCsv(path.join(data, 'tokens_log.csv'));
  assert.ok(log.some((l) => l.id === FAKE[0].id && l.action === 'reissued'));
});

// ---------------- review pages, results and the hub (SEC2021) ----------------
import { buildFeedback, totalOf } from '../review/feedback-core.js';
import { MID_ASSESSMENT, Q1_ASSESSMENT } from './fixture.mjs';

test('feedback core: partial true/false marks, Arabic summary, optional English', () => {
  const ans = 'ACDCABCDCBBDBADA' + 'FFTFTT';
  const r = { obj: [...Array(16).fill(1), 1, 0.5, 1, 1, 1, 1], sq: [[3, 4], [4, 2, 1]], far: ['', 'توضيح عربي'], fen: ['', 'English line'], sn: ['', ''], summaryExtra: '' };
  assert.equal(totalOf(r), 35.5);
  const fb = buildFeedback(MID_ASSESSMENT, { v: 'A', ans }, r);
  assert.equal(fb.lang, 'ar');
  assert.match(fb.summary, /^حصلت على 35\.5 من 40\./);
  const half = fb.points.find((p) => p.ref.startsWith('الفقرة 2-2'));
  assert.match(half.text, /حكمك صحيح \(خطأ\)، لكن التصحيح ناقص.*0\.5 من 1/);
  const q4 = fb.points.find((p) => p.ref.startsWith('السؤال الرابع'));
  assert.equal(q4.text, 'توضيح عربي'); assert.equal(q4.textEn, 'English line');
  assert.match(q4.ref, /7 من 10$/);
  const q = buildFeedback(Q1_ASSESSMENT, { v: 'A', ans: 'ACACDBDAB-' }, { obj: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], sq: [], far: [], fen: [], sn: [] });
  assert.match(q.points[0].text, /تركت هذه الفقرة/);
});

test('review page: builds for a midterm and a 10-item quiz, never in the repository', () => {
  const { data } = makeData({ count: 4 });
  for (const b of ['MID', 'Q1']) {
    const r = run(['tools/review-page.mjs', '--batch', b, '--data', data]);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(data, 'batches', b, 'review.html'), 'utf8');
    assert.ok(html.includes('function buildFeedback'), 'shared feedback code is inlined');
    assert.ok(!html.includes('/*__DATA__*/') && !html.includes('/*__FEEDBACK__*/'));
  }
  assert.ok(fs.existsSync(path.join(data, 'review', 'index.html')), 'hub is refreshed after a review page');
  assert.ok(!fs.existsSync(path.join(REPO, 'review', 'index.html')), 'hub is never written into the repository');
});

test('results from review: saved edits win, diffs are listed, absentees are recorded, approval is required', () => {
  const { data } = makeData({ count: 4 });
  fs.rmSync(path.join(data, 'results', 'MID.json'));
  const draft = JSON.parse(fs.readFileSync(path.join(data, 'batches/MID/MID.draft.json'), 'utf8'));
  const s0 = draft[0];
  fs.writeFileSync(path.join(data, 'batches/MID/MID.review.json'), JSON.stringify({
    batch: 'MID', savedAt: '2026-10-24T10:00:00Z',
    students: { [s0.id]: { obj: [...s0.objMarks.slice(0, 21), 0], sq: [[4, 4], [4, 3, 3]], far: ['', 'نص عُدّل'], fen: ['', ''], sn: ['', ''], summaryExtra: '', reviewed: true } },
  }));
  assert.equal(run(['tools/review-page.mjs', '--batch', 'MID', '--data', data]).status, 0);
  let r = run(['tools/results-from-review.mjs', '--batch', 'MID', '--data', data]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not approved/);
  assert.match(r.stdout, /Differences between the draft and the review \(1 students\)/);
  assert.ok(!r.stdout.includes(s0.id), 'full IDs are masked in the printout');
  const res = JSON.parse(fs.readFileSync(path.join(data, 'results/MID.json'), 'utf8'));
  assert.equal(res.approved, false);
  const expected = s0.objMarks.slice(0, 21).reduce((a, b) => a + b, 0) + 8 + 10;
  assert.equal(res.students[s0.id].score, expected);
  assert.equal(res.students[ALL[3].id].status, 'not_submitted');
  const hub = fs.readFileSync(path.join(data, 'review', 'index.html'), 'utf8');
  assert.match(hub, /محفوظة/);
  assert.match(hub, /رُوجع <b>1<\/b> من 3/);
  r = run(['tools/results-from-review.mjs', '--batch', 'MID', '--data', data, '--approve', 'Approved for the test']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'results/MID.json'), 'utf8')).approved, true);
  assert.match(fs.readFileSync(path.join(data, 'review', 'index.html'), 'utf8'), /منشورة/);
});

test('guard also catches two neighbouring name parts', async () => {
  const { data, dist } = makeData();
  await build({ data, dist, iterations: IT, log: quiet });
  const parts = FAKE[1].name.split(' ');
  fs.appendFileSync(path.join(dist, 'index.html'), parts[1] + ' ' + parts[2]);
  assert.ok(guard(dist, FAKE, { minIterations: IT }).length > 0);
});
