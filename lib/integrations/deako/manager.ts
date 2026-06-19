// Process-wide singleton owning the active DeakoClient. Lazy-connects to a
// gateway IP, survives dev hot-reload (globalThis pin), and never throws across
// the API boundary — callers get status objects / typed errors.
import { DeakoClient } from './client.ts';
import type { DeakoDevice, DeakoState, DeakoStatus } from './types.ts';

interface ManagerState {
  client: DeakoClient | null;
  gatewayIp: string | null;
  status: DeakoStatus['status'];
  lastError: string | null;
}

const g = globalThis as unknown as { _hpDeako?: ManagerState };
function state(): ManagerState {
  if (!g._hpDeako) g._hpDeako = { client: null, gatewayIp: null, status: 'disconnected', lastError: null };
  return g._hpDeako;
}

export async function connectDeako(gatewayIp: string): Promise<DeakoStatus> {
  const s = state();
  if (s.client && s.gatewayIp === gatewayIp && s.status === 'connected') return status();
  if (s.client) s.client.close();
  s.client = new DeakoClient(gatewayIp);
  s.gatewayIp = gatewayIp;
  s.status = 'connecting';
  s.lastError = null;
  try {
    await s.client.connect();
    await s.client.listDevices();
    s.status = 'connected';
  } catch (err) {
    s.status = 'error';
    s.lastError = err instanceof Error ? err.message : 'connect failed';
    s.client = null;
  }
  return status();
}

export async function listDeakoDevices(): Promise<DeakoDevice[]> {
  const s = state();
  if (!s.client || s.status !== 'connected') return [];
  return s.client.listDevices();
}

export async function controlDeako(uuid: string, next: DeakoState): Promise<DeakoState> {
  const s = state();
  if (!s.client || s.status !== 'connected') throw new Error('Deako not connected');
  return s.client.setDevice(uuid, next);
}

export function status(): DeakoStatus {
  const s = state();
  return {
    status: s.status,
    gatewayIp: s.gatewayIp,
    deviceCount: s.client ? s.client.getDevices().length : 0,
    lastError: s.lastError,
  };
}
