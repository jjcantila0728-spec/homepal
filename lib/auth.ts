import crypto from 'node:crypto';

// scrypt password hashing + HS256 JWT — ported from the legacy zero-dep server.

// Resolved lazily (not at import time) so a production build without env set
// doesn't throw while merely loading route modules — it only errors on real use.
let _secret: string | null = null;
function secret(): string {
  if (_secret) return _secret;
  if (process.env.JWT_SECRET) return (_secret = process.env.JWT_SECRET);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return (_secret = 'dev-insecure-secret-change-me');
}
const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

// ---- password hashing (scrypt) ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---- JWT (HS256) ----
const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64urlJson = (obj: unknown): string => b64url(JSON.stringify(obj));

function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(data).digest());
}

export interface TokenPayload {
  uid: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: { uid: string }): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlJson({ ...payload, iat: now, exp: now + TOKEN_TTL });
  const data = `${header}.${body}`;
  return `${data}.${sign(data)}`;
}

export function verifyToken(token: string | null | undefined): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expectedSig = sign(data);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

export { SESSION_COOKIE } from './session-cookie';
