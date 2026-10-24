// Shared helpers for the build tools (Node 20+, no dependencies).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(REPO, 'src');
export const DIST_DEFAULT = path.join(REPO, 'dist');

// Where the plaintext data lives (outside the repo). Order:
// --data <dir>  >  env SEC2021_DATA  >  local.config.json { "dataDir": ... }
export function dataDir(argv = process.argv) {
  const i = argv.indexOf('--data');
  if (i > -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  if (process.env.SEC2021_DATA) return path.resolve(process.env.SEC2021_DATA);
  const cfg = path.join(REPO, 'local.config.json');
  if (fs.existsSync(cfg)) {
    const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (c.dataDir && fs.existsSync(c.dataDir)) return path.resolve(c.dataDir);
    if (c.dataDirLinux && fs.existsSync(c.dataDirLinux)) return path.resolve(c.dataDirLinux);
  }
  fail('Data folder not found. Create local.config.json with {"dataDir": "F:\\\\SEC2021\\\\Gradebook\\\\StudentPortal"}.');
}

export function argValue(name, argv = process.argv) {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}

export function distDir(argv = process.argv) {
  return path.resolve(argValue('--out', argv) ?? DIST_DEFAULT);
}

// Safety: the data folder and the output folder must never overlap,
// and the data folder must never be inside the repo.
export function assertSeparate(data, dist) {
  const inside = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (inside(data, REPO)) fail(`Data folder ${data} is inside the repository. Refusing.`);
  if (inside(dist, data) || inside(data, dist)) fail('Data folder and output folder overlap. Refusing.');
}

export function fail(msg) {
  console.error('\nERROR: ' + msg + '\n');
  process.exit(1);
}

// ---- CSV (RFC 4180, UTF-8, optional BOM) ----
export function readCsv(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, j) => [h.trim(), (r[j] ?? '').trim()])));
}

export function writeCsv(file, rows, columns) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))];
  // BOM so Excel opens Arabic names correctly.
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
