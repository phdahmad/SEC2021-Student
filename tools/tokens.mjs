// Issues an access code to every student in roster.csv who does not have one.
// Existing codes are NEVER changed here (use reissue.mjs for one student).
// Writes tokens.csv (secret — stays in the data folder) and appends to tokens_log.csv.
//
// Usage: node tools/tokens.mjs [--data <dataDir>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateToken, formatToken, normalizeId } from '../src/crypto.js';
import { dataDir, readCsv, writeCsv, today } from './lib.mjs';

export const TOKEN_COLUMNS = ['id', 'name', 'section', 'token', 'issued'];
export const LOG_COLUMNS = ['date', 'id', 'action', 'note'];

export function readTokens(data) {
  const f = path.join(data, 'tokens.csv');
  return fs.existsSync(f) ? readCsv(f) : [];
}

export function appendLog(data, rows) {
  const f = path.join(data, 'tokens_log.csv');
  const old = fs.existsSync(f) ? readCsv(f) : [];
  writeCsv(f, [...old, ...rows], LOG_COLUMNS);
}

export function issueMissing(data) {
  const roster = readCsv(path.join(data, 'roster.csv'));
  const rows = readTokens(data);
  const have = new Set(rows.map((r) => normalizeId(r.id)));
  const used = new Set(rows.map((r) => r.token.replace(/-/g, '')));
  const log = [];
  for (const s of roster) {
    if (have.has(normalizeId(s.id))) continue;
    let t;
    do { t = generateToken(); } while (used.has(t));
    used.add(t);
    rows.push({ id: s.id, name: s.name, section: s.section, token: formatToken(t), issued: today() });
    log.push({ date: today(), id: s.id, action: 'issued', note: '' });
  }
  writeCsv(path.join(data, 'tokens.csv'), rows, TOKEN_COLUMNS);
  if (log.length) appendLog(data, log);
  return log.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = issueMissing(dataDir());
  console.log(n ? `Issued ${n} new access codes. tokens.csv updated (keep it private).` : 'Every student already has a code. Nothing changed.');
}
