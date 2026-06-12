// AES-256-GCM encryption for secrets stored at rest (RTSP URLs carry creds).
// Key comes from HOMEPAL_SECRET env, else a 32-byte key generated once and
// persisted to data/.cctv-key (0600). Built-ins only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, '..', 'data', '.cctv-key');

function loadKey() {
  const env = process.env.HOMEPAL_SECRET;
  if (env) return crypto.createHash('sha256').update(env).digest(); // 32 bytes
  try {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  } catch {}
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

const KEY = loadKey();

// Returns base64 of iv(12) | tag(16) | ciphertext.
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(enc) {
  const buf = Buffer.from(String(enc), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Replace "user:pass@" with "***@" for safe display. No creds -> unchanged.
export function maskRtsp(url) {
  return String(url).replace(/(rtsp:\/\/)[^@/]+@/i, '$1***@');
}
