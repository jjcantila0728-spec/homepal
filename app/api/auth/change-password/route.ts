// POST /api/auth/change-password — the signed-in user sets a new password.
// Clears must_change_password (used to force a reset after an admin creates the
// account with a temporary password).
import { NextResponse } from 'next/server';
import { queryOne, query, isDbConnectivityError } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
  }

  try {
    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [user.id],
    );
    if (!row || !verifyPassword(String(body.currentPassword || ''), row.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    }
    await query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [
      hashPassword(newPassword),
      user.id,
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isDbConnectivityError(err)) {
      return NextResponse.json({ error: 'Service temporarily unavailable — please try again.' }, { status: 503 });
    }
    // eslint-disable-next-line no-console
    console.error('change-password failed:', err);
    return NextResponse.json({ error: 'Could not change your password.' }, { status: 500 });
  }
}
