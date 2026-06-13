// GET /api/cctv/clip?path= — stream a single recorded clip, Range-aware and
// path-guarded to the household's storage root. Cloud mode has no local clips,
// so we return 404 with a local-agent message.
import { getSessionUser } from '@/lib/session';
import { loadState } from '@/lib/state';
import { isCloud, LOCAL_AGENT_REQUIRED } from '@/lib/cctv/cloud';
import { can } from '@/lib/entitlements';
import { withinRoot } from '@/lib/cctv/paths';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export const runtime = 'nodejs';

interface StoredCctv {
  storagePath?: string;
}

function notFound(reason: string): Response {
  return new Response(JSON.stringify({ error: 'Clip not found', reason }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!can(user.plan, 'cctv')) return notFound('upgrade-required');

  if (isCloud()) return notFound(LOCAL_AGENT_REQUIRED);

  const state = await loadState(user.id);
  const cfg = state?.cctv as StoredCctv | undefined;
  const root = cfg?.storagePath || '';

  const url = new URL(req.url);
  const file = path.resolve(url.searchParams.get('path') || '');

  if (!root || !withinRoot(root, file) || !fs.existsSync(file)) return notFound('not found');

  const stat = fs.statSync(file);
  const range = req.headers.get('range');

  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : stat.size - 1;
    const nodeStream = fs.createReadStream(file, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as WebReadableStream<Uint8Array>;
    return new Response(webStream as unknown as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': 'video/mp4',
      },
    });
  }

  const nodeStream = fs.createReadStream(file);
  const webStream = Readable.toWeb(nodeStream) as unknown as WebReadableStream<Uint8Array>;
  return new Response(webStream as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Length': String(stat.size),
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    },
  });
}
