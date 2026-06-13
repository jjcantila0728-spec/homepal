// GET /api/cctv/status — ffmpeg availability, storage writability/free space,
// and cameras (RTSP masked). In cloud mode we short-circuit with a
// `local-agent-required` payload so the UI shows the self-hosting banner.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState } from '@/lib/state';
import { decryptSecret } from '@/lib/crypto';
import { isCloud, LOCAL_AGENT_REQUIRED } from '@/lib/cctv/cloud';
import { can } from '@/lib/entitlements';
import {
  ffmpegInfo,
  cctvStatusPayload,
  sanitizeCamerasForClient,
  type Camera,
} from '@/lib/cctv';
import { validateStorage } from '@/lib/cctv/storage';

export const runtime = 'nodejs';

interface CctvCfg {
  enabled?: boolean;
  storagePath?: string;
  freeSpaceFloorGB?: number;
  cameras?: Camera[];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // CCTV is a Pro feature — free plans get an upgrade prompt instead of config.
  if (!can(user.plan, 'cctv')) {
    return NextResponse.json({ ok: false, upgrade: true, reason: 'upgrade-required' });
  }

  const state = await loadState(user.id);
  const cfg: CctvCfg =
    (state?.cctv as CctvCfg | undefined) || { storagePath: '', freeSpaceFloorGB: 20, cameras: [] };
  const cameras = sanitizeCamerasForClient(cfg.cameras, decryptSecret);

  // Cloud: a hosted instance can't reach LAN cameras/NAS. Still return cameras
  // so the configuration UI stays usable; recording just won't run.
  if (isCloud()) {
    return NextResponse.json({
      ok: false,
      cloud: true,
      ffmpeg: false,
      ffprobe: false,
      reason: LOCAL_AGENT_REQUIRED,
      storage: { ok: false, reason: LOCAL_AGENT_REQUIRED, freeGB: 0 },
      enabled: !!cfg.enabled,
      cameras,
      storagePath: cfg.storagePath || '',
      freeSpaceFloorGB: cfg.freeSpaceFloorGB || 20,
    });
  }

  // Self-host: probe ffmpeg + storage for real.
  const ff = await ffmpegInfo();
  const storage = cfg.storagePath
    ? await validateStorage(cfg.storagePath)
    : { ok: false, reason: 'not configured', freeBytes: 0 };

  const payload = cctvStatusPayload(ff, storage, { enabled: cfg.enabled, cameras });
  return NextResponse.json({
    ok: true,
    cloud: false,
    ...payload,
    storagePath: cfg.storagePath || '',
    freeSpaceFloorGB: cfg.freeSpaceFloorGB || 20,
  });
}
