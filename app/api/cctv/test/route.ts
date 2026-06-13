// POST /api/cctv/test { rtspUrl } — probe an RTSP stream before enabling it.
// In cloud mode there's no LAN/ffmpeg, so we return `local-agent-required`.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { isCloud, LOCAL_AGENT_REQUIRED } from '@/lib/cctv/cloud';
import { can } from '@/lib/entitlements';
import { validateRtspUrl } from '@/lib/cctv';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.plan, 'cctv'))
    return NextResponse.json({ error: 'Upgrade to Pro to use CCTV', upgrade: true }, { status: 403 });

  if (isCloud()) {
    return NextResponse.json({ ok: false, reason: LOCAL_AGENT_REQUIRED });
  }

  let body: { rtspUrl?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const result = await validateRtspUrl(String(body.rtspUrl || ''));
  return NextResponse.json(result);
}
