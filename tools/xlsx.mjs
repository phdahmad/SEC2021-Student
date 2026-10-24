// Minimal .xlsx reader (no dependencies): sheet names, cell values and formulas.
// Enough for reading marking workbooks; it does not evaluate formulas.
//
//   const wb = readXlsx(file);  wb.sheetNames  wb.cell('Sheet', 'B5')  wb.rows('Sheet')
import fs from 'node:fs';
import zlib from 'node:zlib';

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize);
    files.set(name, () => (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8'));
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unxml(m[1] ?? '')).join('');

export function colIndex(ref) { // 'AD12' -> 30 (1-based)
  const letters = /^[A-Z]+/.exec(ref)[0];
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}

export function readXlsx(file) {
  const files = unzip(fs.readFileSync(file));
  const get = (n) => { const f = files.get(n); if (!f) throw new Error(`${file}: missing ${n}`); return f(); };
  const shared = files.has('xl/sharedStrings.xml') ? [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rels = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])[1], target = /Target="([^"]+)"/.exec(m[0])[1];
    return [id, target.replace(/^\/?(xl\/)?/, 'xl/')];
  }));
  const sheets = [...get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unxml(/name="([^"]*)"/.exec(m[0])[1]), path: rels[/r:id="([^"]+)"/.exec(m[0])[1]],
  }));
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const s = sheets.find((x) => x.name === name);
    if (!s) throw new Error(`${file}: no sheet named «${name}»`);
    const cells = new Map();
    for (const m of get(s.path).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1], body = m[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)[1], type = /t="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1], f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
      let value = null;
      if (type === 's') value = shared[+v];
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = v != null ? unxml(v) : null;
      else if (type === 'b') value = v === '1';
      else if (v != null) value = Number(v);
      cells.set(ref, { value, formula: f != null ? unxml(f) : null });
    }
    cache.set(name, cells);
    return cells;
  }
  return {
    sheetNames: sheets.map((s) => s.name),
    cell: (sheet, ref) => load(sheet).get(ref) ?? { value: null, formula: null },
    value: (sheet, ref) => (load(sheet).get(ref) ?? {}).value ?? null,
    // rows(sheet) -> [{ row: 5, cells: { A: v, B: v, ... } }]
    rows(sheet) {
      const byRow = new Map();
      for (const [ref, c] of load(sheet)) {
        const r = +/\d+$/.exec(ref)[0], col = /^[A-Z]+/.exec(ref)[0];
        if (!byRow.has(r)) byRow.set(r, {});
        byRow.get(r)[col] = c.value;
      }
      return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => ({ row, cells }));
    },
  };
}
