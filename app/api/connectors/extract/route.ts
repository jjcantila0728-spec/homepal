import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { extractShifts, extractTransactions, type ExtractInput } from '@/lib/ai/extract';
import type { ConnectorKind } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_BODY = 8_000_000; // ~8MB, covers a base64 screenshot

// POST /api/connectors/extract
// Body: { kind: 'calendar'|'bank', text?, fileBase64?, mime?, url? }
// Returns { ok:true, items } with validated, proposed rows (never writes state),
// or { ok:false, reason } the UI can surface.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== 'calendar' && kind !== 'bank') {
    return NextResponse.json({ ok: false, reason: 'bad-request' }, { status: 400 });
  }

  const input = toInput(body);
  if (!input) return NextResponse.json({ ok: false, reason: 'no-content' }, { status: 400 });

  const result =
    kind === 'calendar' ? await extractShifts(input) : await extractTransactions(input);

  if (!result.ok) {
    const status = result.reason === 'ai-unavailable' ? 503 : result.reason === 'blocked-url' ? 400 : 502;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, kind: kind as ConnectorKind, items: result.items });
}

// Resolve the request body into a single extraction input. A base64 file is sent
// to the model as an image data URL (screenshots are the common case).
function toInput(body: Record<string, unknown>): ExtractInput | null {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : '';
  const mime = typeof body.mime === 'string' ? body.mime : '';

  if (fileBase64 && mime.startsWith('image/')) {
    const dataUrl = fileBase64.startsWith('data:') ? fileBase64 : `data:${mime};base64,${fileBase64}`;
    return { kind: 'image', dataUrl };
  }
  if (text) return { kind: 'text', text };
  if (url) return { kind: 'url', url };
  return null;
}
