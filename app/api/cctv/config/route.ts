// POST /api/cctv/config — save storage settings + cameras. New plaintext
// rtsp:// URLs are encrypted at rest; omitted URLs keep the camera's existing
// ciphertext. Saving works in cloud mode too (so users can pre-configure);
// only the live recording engine (applyConfig) is gated on self-hosting.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState, saveState } from '@/lib/state';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { isCloud } from '@/lib/cctv/cloud';
import { can } from '@/lib/entitlements';
import { applyConfig, sanitizeCamerasForClient, type Camera, type EngineConfig } from '@/lib/cctv';
import { buildRtspUrl } from '@/lib/cameras/brands';
import { isPrivateHost } from '@/lib/discovery';
import type { HouseholdState } from '@/lib/seed';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

interface RawCamera {
  id?: string;
  name?: string;
  rtspUrl?: string;
  sensitivity?: number;
  preRoll?: number;
  postRoll?: number;
  enabled?: boolean;
  brand?: 'tapo' | 'onvif' | 'generic';
  host?: string;
  username?: string;
  password?: string;
  streamQuality?: 'hd' | 'sd';
}

interface ConfigBody {
  enabled?: boolean;
  storagePath?: string;
  freeSpaceFloorGB?: number;
  cameras?: RawCamera[];
}

interface StoredCctv {
  enabled?: boolean;
  storagePath?: string;
  freeSpaceFloorGB?: number;
  cameras?: Camera[];
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!can(user.plan, 'cctv'))
    return NextResponse.json({ error: 'Upgrade to Pro to use CCTV', upgrade: true }, { status: 403 });

  const state = await loadState(user.id);
  if (!state) return NextResponse.json({ error: 'Household not found' }, { status: 404 });

  let body: ConfigBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const prev: StoredCctv = (state.cctv as StoredCctv | undefined) || { cameras: [] };
  const prevById = new Map<string, Camera>((prev.cameras || []).map((c) => [c.id, c]));

  const cameras: Camera[] = [];
  for (const raw of Array.isArray(body.cameras) ? body.cameras : []) {
    const id = String(raw.id || randomUUID());
    const existing = prevById.get(id);
    let rtspUrl: string;
    const hasLiteral = typeof raw.rtspUrl === 'string' && raw.rtspUrl.trim();
    if (hasLiteral) {
      if (!/^rtsp:\/\//i.test(raw.rtspUrl!.trim())) {
        return NextResponse.json({ error: `Camera "${raw.name || id}" stream URL must start with rtsp://` }, { status: 400 });
      }
      rtspUrl = encryptSecret(raw.rtspUrl!.trim());
    } else if (raw.brand && (raw.host || raw.brand !== 'tapo')) {
      if (raw.host && !isPrivateHost(raw.host)) {
        return NextResponse.json({ error: `Camera "${raw.name || id}" host must be a private LAN address` }, { status: 400 });
      }
      try {
        const built = buildRtspUrl({
          brand: raw.brand, host: raw.host, username: raw.username,
          password: raw.password, streamQuality: raw.streamQuality, rtspPath: undefined,
        });
        rtspUrl = encryptSecret(built.rtspUrl);
      } catch (e) {
        return NextResponse.json({ error: `Camera "${raw.name || id}": ${(e as Error).message}` }, { status: 400 });
      }
    } else if (existing) {
      rtspUrl = existing.rtspUrl; // keep stored ciphertext
    } else {
      return NextResponse.json({ error: `Camera "${raw.name || id}" needs a stream (brand fields or rtsp:// URL)` }, { status: 400 });
    }
    cameras.push({
      id,
      name: String(raw.name || 'Camera').slice(0, 60),
      rtspUrl,
      sensitivity: Math.min(0.5, Math.max(0.005, Number(raw.sensitivity) || 0.04)),
      preRoll: Math.min(30, Math.max(0, Number(raw.preRoll) ?? 5)),
      postRoll: Math.min(60, Math.max(0, Number(raw.postRoll) ?? 8)),
      enabled: !!raw.enabled,
      brand: raw.brand ?? (existing?.brand),
      host: raw.host ?? existing?.host,
      streamQuality: raw.streamQuality ?? existing?.streamQuality,
    });
  }

  const cctv: EngineConfig = {
    enabled: body.enabled !== undefined ? !!body.enabled : (prev.enabled ?? true),
    storagePath: String(body.storagePath ?? prev.storagePath ?? '').trim(),
    freeSpaceFloorGB: Math.max(1, Number(body.freeSpaceFloorGB) || prev.freeSpaceFloorGB || 20),
    cameras,
  };

  const next = { ...state, cctv } as HouseholdState;
  const ok = await saveState(user.id, next);
  if (!ok) return NextResponse.json({ error: 'Household not found' }, { status: 404 });

  // Apply to the live engine only when self-hosting (best-effort; never blocks
  // the response). In cloud mode the config is persisted but recording is off.
  if (!isCloud()) {
    applyConfig(cctv, { decrypt: decryptSecret }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    cloud: isCloud(),
    cameras: sanitizeCamerasForClient(cameras, decryptSecret),
  });
}
