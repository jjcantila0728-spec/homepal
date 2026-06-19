import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState, saveState } from '@/lib/state';
import { isDbConnectivityError } from '@/lib/db';
import { isPrivateHost } from '@/lib/discovery';
import { connectDeako, listDeakoDevices } from '@/lib/integrations/deako';
import type { HouseholdState } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { gatewayIp?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const gatewayIp = String(body.gatewayIp || '').trim();
    if (!gatewayIp || !isPrivateHost(gatewayIp)) {
      return NextResponse.json({ error: 'Enter a valid private LAN IP for a Deako device.' }, { status: 400 });
    }

    const state = await loadState(user.id);
    if (!state) return NextResponse.json({ error: 'Household not found' }, { status: 404 });

    const st = await connectDeako(gatewayIp);
    if (st.status !== 'connected') {
      return NextResponse.json({ connected: false, error: st.lastError || 'Could not reach Deako on your network.' }, { status: 502 });
    }
    const devices = await listDeakoDevices();
    const next = {
      ...state,
      integrations: {
        ...(state.integrations || {}),
        deako: {
          enabled: true,
          gatewayIp,
          lastConnectedAt: new Date().toISOString(),
          devices: devices.map((d) => ({ uuid: d.uuid, name: d.name })),
        },
      },
    } as HouseholdState;
    await saveState(user.id, next);
    return NextResponse.json({ connected: true, devices });
  } catch (err) {
    if (isDbConnectivityError(err)) return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 });
    // eslint-disable-next-line no-console
    console.error('[deako/connect]', err);
    return NextResponse.json({ error: 'Deako connect failed.' }, { status: 500 });
  }
}
