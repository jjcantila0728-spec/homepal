// One TCP socket to a Deako gateway device. Connect, pull the device list,
// send control commands, keepalive-ping, and reconnect on drop. Server-side
// only (node:net). Keeps an in-memory device roster updated from inbound frames.
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { buildControlRequest, buildDeviceListRequest, buildPingRequest, parseMessages } from './protocol.ts';
import type { DeakoDevice, DeakoState } from './types.ts';

const DEAKO_PORT = 23;
const LIST_SETTLE_MS = 800; // device-list frames arrive over a short window
const PING_INTERVAL_MS = 15_000;

export class DeakoClient {
  private sock: net.Socket | null = null;
  private carry = '';
  private devices = new Map<string, DeakoDevice>();
  private pingTimer: NodeJS.Timeout | null = null;
  private waiters: Array<() => void> = [];
  private host: string;
  private port: number;

  constructor(host: string, port: number = DEAKO_PORT) {
    this.host = host;
    this.port = port;
  }

  connect(timeoutMs = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      this.sock = sock;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        reject(err);
      };
      sock.setTimeout(timeoutMs);
      sock.once('timeout', () => fail(new Error('Deako connect timeout')));
      sock.once('error', fail);
      sock.once('connect', () => {
        settled = true;
        sock.setTimeout(0);
        sock.on('data', (b) => this.onData(b.toString('utf8')));
        this.startKeepalive();
        resolve();
      });
    });
  }

  private onData(chunk: string) {
    const { messages, rest } = parseMessages(chunk, this.carry);
    this.carry = rest;
    for (const m of messages) {
      const d = (m.data ?? {}) as Partial<DeakoDevice> & { state?: DeakoState };
      if (d.uuid && d.state) {
        const prev = this.devices.get(d.uuid);
        this.devices.set(d.uuid, {
          uuid: d.uuid,
          name: d.name ?? prev?.name ?? d.uuid,
          state: d.state,
        });
      }
      for (const w of this.waiters.splice(0)) w();
    }
  }

  private startKeepalive() {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      try { this.sock?.write(buildPingRequest(randomUUID())); } catch { /* ignore */ }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }
  private stopKeepalive() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  listDevices(): Promise<DeakoDevice[]> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('not connected'));
      this.devices.clear();
      this.sock.write(buildDeviceListRequest(randomUUID()));
      // Device-list replies stream as separate frames; settle after a short window.
      setTimeout(() => resolve([...this.devices.values()]), LIST_SETTLE_MS);
    });
  }

  setDevice(uuid: string, state: DeakoState): Promise<DeakoState> {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('not connected'));
      const timer = setTimeout(() => reject(new Error('Deako control timeout')), 4000);
      this.waiters.push(() => {
        const updated = this.devices.get(uuid)?.state ?? state;
        clearTimeout(timer);
        resolve(updated);
      });
      this.sock.write(buildControlRequest(randomUUID(), uuid, state));
    });
  }

  getDevices(): DeakoDevice[] {
    return [...this.devices.values()];
  }

  close() {
    this.stopKeepalive();
    try { this.sock?.destroy(); } catch { /* ignore */ }
    this.sock = null;
  }
}
