// GET /api/cctv/clips?camera=&date= — list recorded clips from storage, newest
// first. Cloud mode has no local storage, so we return a `local-agent-required`
// shape with an empty list.
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadState } from '@/lib/state';
import { isCloud, LOCAL_AGENT_REQUIRED } from '@/lib/cctv/cloud';
import { listClips } from '@/lib/cctv/storage';
import { safeName } from '@/lib/cctv/paths';

export const runtime = 'nodejs';

interface StoredCctv {
  storagePath?: string;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (isCloud()) {
    return NextResponse.json({ ok: false, clips: [], reason: LOCAL_AGENT_REQUIRED });
  }

  const state = await loadState(user.id);
  const cfg = state?.cctv as StoredCctv | undefined;
  const root = cfg?.storagePath || '';
  if (!root) return NextResponse.json([]);

  const url = new URL(req.url);
  const cam = url.searchParams.get('camera');
  const date = url.searchParams.get('date');
  const slug = cam ? safeName(cam) : null;

  const clips = (await listClips(root))
    .filter((c) => {
      const p = c.path.replace(/\\/g, '/');
      if (slug && !p.includes(`/${slug}/`)) return false;
      if (date && !p.includes(`/${date}/`)) return false;
      return true;
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((c) => ({
      path: c.path,
      when: c.when ? c.when.toISOString() : null,
      sizeMB: +(c.size / (1024 * 1024)).toFixed(1),
    }));

  return NextResponse.json(clips);
}
