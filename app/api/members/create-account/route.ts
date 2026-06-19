// POST /api/members/create-account — an admin gives an existing member profile
// its own login (email + temporary password). The member signs in and is forced
// to change the password. Claims the existing profile, preserving its data.
import { NextResponse } from 'next/server';
import { tx, isDbConnectivityError } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { getSessionUser } from '@/lib/session';
import { isAdmin } from '@/lib/authz';
import { loadState } from '@/lib/state';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(admin) || !admin.household_id) {
    return NextResponse.json({ error: 'Only a household admin can create member accounts.' }, { status: 403 });
  }

  let body: { memberId?: number; email?: string; tempPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const tempPassword = String(body.tempPassword || '');
  const memberId = Number(body.memberId);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (tempPassword.length < 8) {
    return NextResponse.json({ error: 'Temporary password must be at least 8 characters.' }, { status: 400 });
  }

  const state = await loadState(admin.id);
  if (!state) return NextResponse.json({ error: 'Household not found' }, { status: 404 });
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return NextResponse.json({ error: 'Member profile not found.' }, { status: 404 });

  try {
    await tx(async (client) => {
      const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (taken.rowCount) throw new Error('EMAIL_TAKEN');
      const claimed = await client.query(
        'SELECT 1 FROM users WHERE household_id = $1 AND member_id = $2',
        [admin.household_id, memberId],
      );
      if (claimed.rowCount) throw new Error('PROFILE_CLAIMED');
      await client.query(
        `INSERT INTO users (email, password_hash, household_id, member_id, role, must_change_password)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [email, hashPassword(tempPassword), admin.household_id, memberId, member.role === 'admin' ? 'admin' : 'member'],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
      return NextResponse.json({ error: 'That email is already registered.' }, { status: 409 });
    }
    if (err instanceof Error && err.message === 'PROFILE_CLAIMED') {
      return NextResponse.json({ error: 'That member already has an account.' }, { status: 409 });
    }
    if (isDbConnectivityError(err)) {
      return NextResponse.json({ error: 'Service temporarily unavailable — please try again.' }, { status: 503 });
    }
    // eslint-disable-next-line no-console
    console.error('create-account failed:', err);
    return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 });
  }
}
