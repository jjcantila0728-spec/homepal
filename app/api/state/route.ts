import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState, saveState } from '@/lib/state';
import type { HouseholdState } from '@/lib/seed';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const state = await loadState(user.id);
  if (!state) return NextResponse.json({ error: 'No household' }, { status: 404 });
  return NextResponse.json({ state, plan: user.plan });
}

export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let state: HouseholdState;
  try {
    state = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
  }
  const ok = await saveState(user.id, state);
  if (!ok) return NextResponse.json({ error: 'No household' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
