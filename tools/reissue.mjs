// Re-issues the access code of ONE student and re-encrypts only that student's
// bundle in dist/. Every other bundle stays byte-for-byte unchanged.
// The old bundle file is deleted, so the old code stops working once you publish.
//
// Usage: node tools/reissue.mjs --id 445001734 [--data <dataDir>] [--out dist]
import fs from 'node:fs';
import path from 'node:path';
import {
  generateToken, formatToken, normalizeId, fromHex,
  deriveMaster, locatorOf, encryptBundle, packPayload,
} from '../src/crypto.js';
import { dataDir, distDir, assertSeparate, readJson, writeJson, writeCsv, fail, argValue, today } from './lib.mjs';
import { readTokens, appendLog, TOKEN_COLUMNS } from './tokens.mjs';
import { loadData, studentView } from './build.mjs';
import { guard } from './guard.mjs';

const data = dataDir();
const dist = distDir();
assertSeparate(data, dist);
const id = normalizeId(argValue('--id'));
if (!id) fail('Give the student ID: node tools/reissue.mjs --id <ID>');

const statePath = path.join(data, 'deploy-state.json');
if (!fs.existsSync(statePath) || !fs.existsSync(path.join(dist, 'meta.json'))) fail('No current build found. Run a full build first.');
const state = readJson(statePath);
const meta = readJson(path.join(dist, 'meta.json'));
if (meta.deploySalt !== state.deploySalt) fail('dist/ does not match deploy-state.json. Run a full build instead.');

// 1. New code (keeps all other students' codes).
const rows = readTokens(data);
const row = rows.find((r) => normalizeId(r.id) === id);
if (!row) fail(`${id} is not in tokens.csv`);
const used = new Set(rows.map((r) => r.token.replace(/-/g, '')));
let t;
do { t = generateToken(); } while (used.has(t));

// 2. Re-encrypt only this student's bundle with the SAME deploy salt and padding.
const loaded = loadData(data);
const student = loaded.roster.find((s) => s.id === id);
if (!student) fail(`${id} is not in roster.csv`);
const { view, blobs } = studentView(data, loaded, student, state.built);
const plain = packPayload(view, blobs);
if (plain.length >= state.padTo) fail('This student now has more data than the padded size. Run a full build instead.');
const master = await deriveMaster(id, t, fromHex(state.deploySalt), state.iterations);
const loc = await locatorOf(master);
const bundle = await encryptBundle(master, loc, packPayload(view, blobs, state.padTo));

const oldLoc = state.locators[id];
fs.writeFileSync(path.join(dist, 'bundles', loc + '.bin'), bundle);
if (oldLoc && oldLoc !== loc) fs.rmSync(path.join(dist, 'bundles', oldLoc + '.bin'), { force: true });

const problems = guard(dist, loaded.roster, { minIterations: state.iterations });
if (problems.length) fail('Guard failed:\n  - ' + problems.join('\n  - '));

// 3. Save only after everything succeeded.
row.token = formatToken(t);
row.issued = today();
writeCsv(path.join(data, 'tokens.csv'), rows, TOKEN_COLUMNS);
appendLog(data, [{ date: today(), id, action: 'reissued', note: 'old code revoked' }]);
state.locators[id] = loc;
writeJson(statePath, state);
console.log(`New code for ${id}: ${formatToken(t)}\nOnly this student's bundle changed. Publish to make the old code stop working.`);
