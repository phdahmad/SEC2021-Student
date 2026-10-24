// Publishes dist/ to the gh-pages branch as ONE fresh commit with no history,
// so old (re-issued) bundles do not stay downloadable from earlier commits.
// Runs the guard first; refuses to publish if it fails.
//
// Needs Git for Windows (the `git` command) and push access to the repository.
// Usage: node tools/deploy.mjs [--data <dataDir>] [--out dist]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, dataDir, distDir, readCsv, fail } from './lib.mjs';
import { guard } from './guard.mjs';

const dist = distDir();
const roster = readCsv(path.join(dataDir(), 'roster.csv'));
const problems = guard(dist, roster);
if (problems.length) fail('Guard failed — nothing published:\n  - ' + problems.join('\n  - '));

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
let remote;
try { remote = git(['remote', 'get-url', 'origin'], REPO); } catch { fail('This repository has no "origin" remote. Publish it once with GitHub Desktop first.'); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec2021-pages-'));
try {
  fs.cpSync(dist, tmp, { recursive: true });
  git(['init', '-q', '-b', 'gh-pages'], tmp);
  git(['add', '-A'], tmp);
  git(['-c', 'user.name=SEC2021 Portal', '-c', 'user.email=portal@localhost', 'commit', '-q', '-m', 'Publish ' + new Date().toISOString()], tmp);
  git(['push', '-q', '--force', remote, 'gh-pages:gh-pages'], tmp);
  console.log('Published to gh-pages (single commit, no history).');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
