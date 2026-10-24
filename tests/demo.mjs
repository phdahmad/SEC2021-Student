// Builds a complete FAKE demo (nine fake students) for the browser check and the
// screenshots: data folder, review pages, the hub, and a real-strength build.
//
//   node tests/demo.mjs <empty folder>
//
// Afterwards: <folder>/data (like StudentPortal), <folder>/dist (publishable build).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeData } from './fixture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('Usage: node tests/demo.mjs <empty folder>'); process.exit(1); }
fs.mkdirSync(root, { recursive: true });
if (fs.readdirSync(root).length) { console.error(`${root} is not empty`); process.exit(1); }

const { data, dist } = makeData({ count: 9, root });
const run = (...args) => {
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  process.stdout.write(r.stdout);
};
// The midterm goes through the real flow: review page → saved review → results.
fs.rmSync(path.join(data, 'results', 'MID.json'));
run('tools/review-page.mjs', '--batch', 'MID', '--data', data);
run('tools/review-page.mjs', '--batch', 'Q1', '--data', data);
const draft = JSON.parse(fs.readFileSync(path.join(data, 'batches/MID/MID.draft.json'), 'utf8'));
const reviewed = Object.fromEntries(draft.slice(0, 5).map((d) => [d.id, { reviewed: true }]));
reviewed[draft[0].id] = { ...reviewed[draft[0].id], sq: [[4, 4], [4, 2, 1]] };
fs.writeFileSync(path.join(data, 'batches/MID/MID.review.json'), JSON.stringify({ batch: 'MID', savedAt: new Date().toISOString(), students: reviewed }, null, 2));
run('tools/results-from-review.mjs', '--batch', 'MID', '--data', data, '--approve', 'Approved for the fake demo');
run('tools/review-page.mjs', '--batch', 'MID', '--data', data);
run('tools/build.mjs', '--data', data, '--out', dist);
console.log(`\nDemo ready:\n  data: ${data}\n  dist: ${dist}`);
