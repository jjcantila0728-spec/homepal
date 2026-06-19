import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { controlDeako, deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { uuid?: string; power?: boolean; dim?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const uuid = String(body.uuid || '').trim();
  if (!uuid) return NextResponse.json({ error: 'uuid required' }, { status: 400 });
  if (deakoStatus().status !== 'connected') {
    return NextResponse.json({ error: 'Deako not connected', connected: false }, { status: 409 });
  }
  const power = body.power ?? true;
  const dim = Math.min(100, Math.max(0, Number(body.dim ?? (power ? 100 : 0))));
  try {
    const state = await controlDeako(uuid, { power, dim });
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[deako/control]', err);
    return NextResponse.json({ error: 'Control failed' }, { status: 502 });
  }
}
