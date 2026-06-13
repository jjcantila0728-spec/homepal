import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { setSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const user = await queryOne<{ id: string; email: string; password_hash: string; plan: string }>(
    'SELECT id, email, password_hash, plan FROM users WHERE email = $1',
    [email],
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  await setSession(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, plan: user.plan } });
}
