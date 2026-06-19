// Pure builders/parser for the Deako local-API wire protocol (newline-framed
// JSON over TCP). No sockets here — fully unit-testable. Mirrors pydeako's
// request/response message shapes; verify field names against pydeako source.

export interface DeakoMessage {
  type: string;
  transactionId?: string;
  dst?: string;
  src?: string;
  data?: unknown;
  [k: string]: unknown;
}

const SRC = 'homepal';

function envelope(transactionId: string, type: string, data?: unknown): string {
  const msg: DeakoMessage = { transactionId, type, dst: 'deako', src: SRC };
  if (data !== undefined) msg.data = data;
  return JSON.stringify(msg) + '\n';
}

export function buildDeviceListRequest(transactionId: string): string {
  return envelope(transactionId, 'DEVICE_LIST');
}

export function buildPingRequest(transactionId: string): string {
  return envelope(transactionId, 'PING');
}

export function buildControlRequest(
  transactionId: string,
  target: string,
  state: { power: boolean; dim: number },
): string {
  return envelope(transactionId, 'CONTROL', { target, state });
}

// Accumulate a socket chunk onto any buffered partial line, return whole
// messages plus the leftover tail to carry into the next call.
export function parseMessages(
  chunk: string,
  carry: string,
): { messages: DeakoMessage[]; rest: string } {
  const buf = carry + chunk;
  const parts = buf.split('\n');
  const rest = parts.pop() ?? ''; // last element is the (possibly empty) partial tail
  const messages: DeakoMessage[] = [];
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as DeakoMessage);
    } catch {
      /* ignore malformed frame */
    }
  }
  return { messages, rest };
}
