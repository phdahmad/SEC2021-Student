// SEC2021 Student Portal — shared cryptography.
// The SAME file runs in the browser (page) and in Node 20+ (build tools),
// so the page and the build can never disagree about the scheme.
//
// Scheme (v1):
//   master  = PBKDF2-SHA256(password = access code,
//                           salt = deploySalt || "|" || studentId,
//                           600,000 iterations) -> 32 bytes
//   locator = hex(SHA-256("SEC2021-locator-v1" || master))   -> bundle file name
//   key     = HKDF-SHA256(master, salt = bundleSalt,
//                         info = "SEC2021-bundle-key-v1")     -> AES-GCM-256
//   bundle  = "A41B" | version(1) | bundleSalt(16) | iv(12) | AES-GCM(ciphertext+tag)
//             AAD = header bytes || locator
// deploySalt is new on every full build; bundleSalt and iv are new for every bundle.

export const ITERATIONS = 600000;
export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
export const TOKEN_LEN = 12;
export const MAGIC = new Uint8Array([0x41, 0x34, 0x31, 0x42]); // "A41B"
export const VERSION = 1;
export const HEADER_LEN = 4 + 1 + 16 + 12;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

// Student IDs: digits only. Eastern Arabic digits (from an Arabic phone keyboard)
// are converted to Western digits. Returns null if not a plausible ID.
export function normalizeId(raw) {
  const s = String(raw ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, '');
  return /^\d{6,12}$/.test(s) ? s : null;
}

// Access codes: case-insensitive, dashes and spaces ignored.
export function normalizeToken(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.length !== TOKEN_LEN) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

export function formatToken(t) {
  return t.match(/.{1,4}/g).join('-');
}

// Unbiased random code (rejection sampling).
export function generateToken() {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < TOKEN_LEN) {
    for (const b of randomBytes(32)) {
      if (b < limit && out.length < TOKEN_LEN) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

export async function deriveMaster(id, token, deploySalt, iterations = ITERATIONS) {
  const pw = await subtle.importKey('raw', enc.encode(token), 'PBKDF2', false, ['deriveBits']);
  const salt = concat(deploySalt, enc.encode('|' + id));
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, pw, 256);
  return new Uint8Array(bits);
}

export async function locatorOf(master) {
  const h = await subtle.digest('SHA-256', concat(enc.encode('SEC2021-locator-v1'), master));
  return toHex(new Uint8Array(h));
}

async function bundleKey(master, bundleSalt, usage) {
  const ikm = await subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bundleSalt, info: enc.encode('SEC2021-bundle-key-v1') },
    ikm, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function encryptBundle(master, locator, plaintext) {
  const bundleSalt = randomBytes(16);
  const iv = randomBytes(12);
  const header = concat(MAGIC, new Uint8Array([VERSION]), bundleSalt, iv);
  const key = await bundleKey(master, bundleSalt, 'encrypt');
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: concat(header, enc.encode(locator)) }, key, plaintext);
  return concat(header, new Uint8Array(ct));
}

// Throws on any failure (wrong key, tampering, wrong format).
export async function decryptBundle(master, locator, bytes) {
  bytes = new Uint8Array(bytes);
  if (bytes.length <= HEADER_LEN) throw new Error('bad bundle');
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('bad bundle');
  if (bytes[4] !== VERSION) throw new Error('bad bundle');
  const header = bytes.subarray(0, HEADER_LEN);
  const bundleSalt = bytes.subarray(5, 21);
  const iv = bytes.subarray(21, 33);
  const key = await bundleKey(master, bundleSalt, 'decrypt');
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: concat(header, enc.encode(locator)) }, key, bytes.subarray(HEADER_LEN));
  return new Uint8Array(pt);
}

// Payload container: u32 jsonLength | JSON | binary blobs | zero padding.
// JSON lists blobs as {o: offset, n: length, t: mime}; offsets are relative to blob area.
export function packPayload(data, blobs, padTo = 0) {
  const meta = { ...data, blobs: [] };
  let off = 0;
  for (const b of blobs) { meta.blobs.push({ o: off, n: b.bytes.length, t: b.type }); off += b.bytes.length; }
  const json = enc.encode(JSON.stringify(meta));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length);
  let out = concat(len, json, ...blobs.map((b) => b.bytes));
  if (padTo > out.length) out = concat(out, new Uint8Array(padTo - out.length));
  return out;
}

export function unpackPayload(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(dec.decode(bytes.subarray(4, 4 + n)));
  const base = 4 + n;
  const blobs = meta.blobs.map((b) => ({ type: b.t, bytes: bytes.subarray(base + b.o, base + b.o + b.n) }));
  return { data: meta, blobs };
}

export function payloadLength(data, blobs) {
  return packPayload(data, blobs).length;
}
