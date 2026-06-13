// AES-256-GCM encryption for secrets stored at rest (RTSP URLs carry creds).
// Ported from server/crypto.js. Node built-ins only — safe in route handlers
// (runtime='nodejs').
//
// Key resolution is LAZY (never throws at import):
//   - HOMEPAL_SECRET env  -> sha256(secret) (32 bytes), stable across restarts.
//   - else                -> a 32-byte key generated once in-memory. This is
//                            EPHEMERAL: ciphertext encrypted with it will not be
//                            decryptable after a restart. We surface this so the
//                            host operator knows to set HOMEPAL_SECRET.
import crypto from 'node:crypto';

let KEY: Buffer | null = null;
let ephemeral = false;

function getKey(): Buffer {
  if (KEY) return KEY;
  const env = process.env.HOMEPAL_SECRET;
  if (env) {
    KEY = crypto.createHash('sha256').update(env).digest(); // 32 bytes
    ephemeral = false;
  } else {
    KEY = crypto.randomBytes(32);
    ephemeral = true;
  }
  return KEY;
}

// True iff the active key was generated in-memory (no HOMEPAL_SECRET set).
// Lazily initializes the key as a side effect, mirroring encrypt/decrypt.
export function isEphemeralKey(): boolean {
  getKey();
  return ephemeral;
}

// Returns base64 of iv(12) | tag(16) | ciphertext.
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const key = getKey();
  const buf = Buffer.from(String(enc), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Replace "user:pass@" with "***@" for safe display. No creds -> unchanged.
export function maskRtsp(url: string): string {
  return String(url).replace(/(rtsp:\/\/)[^@/]+@/i, '$1***@');
}
