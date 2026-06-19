import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { listDeakoDevices, deakoStatus } from '@/lib/integrations/deako';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const st = deakoStatus();
  if (st.status !== 'connected') return NextResponse.json({ connected: false, devices: [] });
  const devices = await listDeakoDevices();
  return NextResponse.json({ connected: true, devices });
}
