import { NextResponse } from 'next/server';
import { tx } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { setSession } from '@/lib/session';
import { buildSeedState } from '@/lib/seed';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string; householdName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
  }

  try {
    const userId = await tx(async (client) => {
      const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existing.rowCount) {
        throw new Error('EMAIL_TAKEN');
      }
      const userRes = await client.query<{ id: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, hashPassword(password)],
      );
      const uid = userRes.rows[0].id;
      const state = buildSeedState(name, body.householdName);
      await client.query('INSERT INTO households (owner_user_id, state) VALUES ($1, $2)', [uid, state]);
      return uid;
    });

    await setSession(userId);
    return NextResponse.json({ ok: true, user: { id: userId, email, plan: 'free' } });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
      return NextResponse.json({ error: 'That email is already registered.' }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error('register failed:', err);
    return NextResponse.json({ error: 'Could not create your account.' }, { status: 500 });
  }
}
