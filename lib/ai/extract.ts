// Server-only OpenAI extraction. Turns user-provided content (pasted text, an
// uploaded image, or a fetched public URL) into validated connector rows. The
// OpenAI API key never leaves the server. All output is run through the pure,
// defensive validators in connector-data.ts before it is trusted.

// NOTE: server-only module — imported solely by app/api/connectors/extract (nodejs
// runtime). Never import this from a client component; the client uses the pure
// helpers in connector-data.ts and calls the /api/connectors/extract route.
import { isPrivateIPv4 } from '@/lib/discovery';
import {
  parseShiftRows,
  parseTxnRows,
  type ShiftRow,
  type TxnRow,
} from '@/lib/ai/connector-data';
import type { ConnectorKind } from '@/lib/types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
// Default to a current GPT-4-class vision model; override with OPENAI_MODEL.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export type ExtractInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; dataUrl: string } // data:image/...;base64,...
  | { kind: 'url'; url: string };

export type ExtractResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: 'ai-unavailable' | 'blocked-url' | 'fetch-failed' | 'no-content' | 'ai-error' };

const SYSTEM: Record<ConnectorKind, string> = {
  calendar:
    'You extract work-schedule shifts from the user-provided content (which may be a roster, ' +
    'calendar export, payslip, or a screenshot). Return ONLY JSON of the form ' +
    '{"shifts":[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"...","category":"work"}]}. ' +
    'Use 24-hour times. Omit a field if unknown. If nothing schedule-like is present, return {"shifts":[]}.',
  bank:
    'You extract financial transactions from the user-provided content (a bank/credit statement, ' +
    'export, or screenshot). Return ONLY JSON of the form ' +
    '{"transactions":[{"date":"YYYY-MM-DD","amount":12.34,"type":"income|expense","category":"Groceries","description":"..."}]}. ' +
    'amount is a positive number; type is "expense" for money out and "income" for money in. ' +
    'Categorize using everyday buckets (Groceries, Transport, Utilities, Rent, Salary, etc.). ' +
    'If nothing transaction-like is present, return {"transactions":[]}.',
};

const MAX_URL_BYTES = 1_000_000;

// Permit only plausible public http(s) URLs; refuse localhost and private/link-local
// IP literals so a pasted URL can't probe internal or cloud-metadata endpoints.
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  // Block private/link-local IPv4 literals; bare IPv6/loopback too.
  if (host === '::1' || host === '0.0.0.0') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) return false;
  return true;
}

async function fetchUrlText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_URL_BYTES) return null;
    return new TextDecoder().decode(buf).slice(0, 200_000);
  } catch {
    return null;
  }
}

// Build the user message content (text and/or image parts) for the model.
async function buildContent(input: ExtractInput): Promise<
  { ok: true; content: unknown } | { ok: false; reason: 'blocked-url' | 'fetch-failed' | 'no-content' }
> {
  if (input.kind === 'text') {
    const t = input.text.trim();
    if (!t) return { ok: false, reason: 'no-content' };
    return { ok: true, content: t.slice(0, 200_000) };
  }
  if (input.kind === 'image') {
    if (!input.dataUrl.startsWith('data:image/')) return { ok: false, reason: 'no-content' };
    return {
      ok: true,
      content: [
        { type: 'text', text: 'Extract the requested data from this image.' },
        { type: 'image_url', image_url: { url: input.dataUrl } },
      ],
    };
  }
  // url
  if (!isSafePublicUrl(input.url)) return { ok: false, reason: 'blocked-url' };
  const text = await fetchUrlText(input.url);
  if (!text) return { ok: false, reason: 'fetch-failed' };
  return { ok: true, content: `Content fetched from ${input.url}:\n\n${text}` };
}

async function callOpenAI(kind: ConnectorKind, content: unknown): Promise<unknown | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM[kind] },
          { role: 'user', content },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function extractShifts(input: ExtractInput): Promise<ExtractResult<ShiftRow>> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, reason: 'ai-unavailable' };
  const built = await buildContent(input);
  if (!built.ok) return { ok: false, reason: built.reason };
  const json = await callOpenAI('calendar', built.content);
  if (json == null) return { ok: false, reason: 'ai-error' };
  return { ok: true, items: parseShiftRows(json) };
}

export async function extractTransactions(input: ExtractInput): Promise<ExtractResult<TxnRow>> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, reason: 'ai-unavailable' };
  const built = await buildContent(input);
  if (!built.ok) return { ok: false, reason: built.reason };
  const json = await callOpenAI('bank', built.content);
  if (json == null) return { ok: false, reason: 'ai-error' };
  return { ok: true, items: parseTxnRows(json) };
}
