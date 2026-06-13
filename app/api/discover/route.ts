// /api/discover — LAN smart-device discovery (zero-dep SSDP/UPnP).
//   GET            → scan the local network for devices.
//   POST { check } → probe a single host for TCP reachability.
// Cloud mode can't reach a user's home LAN, so both return
// `local-agent-required` shapes (and the Connect-Devices UI degrades cleanly).
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { isCloud, LOCAL_AGENT_REQUIRED } from '@/lib/cctv/cloud';
import { can } from '@/lib/entitlements';
import { discoverDevices, checkReachable, isPrivateHost } from '@/lib/discovery';

export const runtime = 'nodejs';

const UPGRADE_REASON = 'Device discovery is a Pro feature — upgrade to scan your network.';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!can(user.plan, 'discovery')) {
    return NextResponse.json({ ok: false, upgrade: true, reason: UPGRADE_REASON, devices: [] });
  }

  if (isCloud()) {
    return NextResponse.json({ ok: false, reason: LOCAL_AGENT_REQUIRED, devices: [] });
  }

  const result = await discoverDevices({ timeoutMs: 4000 });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!can(user.plan, 'discovery')) {
    return NextResponse.json({ ok: false, upgrade: true, reason: UPGRADE_REASON, devices: [] });
  }

  let body: { check?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.check) {
    if (isCloud()) {
      return NextResponse.json({ reachable: false, reason: LOCAL_AGENT_REQUIRED });
    }
    const [host, portStr] = String(body.check).split(':');
    // Restrict probes to private/LAN ranges — refusing public/link-local hosts
    // prevents the server being used as an SSRF port-scanner (cloud metadata).
    if (!isPrivateHost(host)) {
      return NextResponse.json({ reachable: false, host, error: 'Only private (LAN) addresses can be probed' });
    }
    const reachable = await checkReachable(host, Number(portStr) || 80);
    return NextResponse.json({ reachable, host });
  }

  if (isCloud()) {
    return NextResponse.json({ ok: false, reason: LOCAL_AGENT_REQUIRED, devices: [] });
  }
  const result = await discoverDevices({ timeoutMs: 4000 });
  return NextResponse.json(result);
}
