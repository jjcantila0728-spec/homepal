import { cookies } from 'next/headers';
import { SESSION_COOKIE, signToken, verifyToken } from './auth';
import { queryOne } from './db';

export interface SessionUser {
  id: string;
  email: string;
  plan: string;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  current_period_end: Date | null;
}

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken({ uid: userId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

// Resolve the authenticated user from the session cookie, or null.
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  return queryOne<SessionUser>(
    `SELECT id, email, plan, subscription_status, stripe_customer_id, current_period_end
     FROM users WHERE id = $1`,
    [payload.uid],
  );
}
