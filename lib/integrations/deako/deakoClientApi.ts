// Browser-side helpers for the Deako API. Never import server modules here.
import type { DeakoDevice, DeakoStatus } from './types.ts';

export async function apiConnectDeako(
  gatewayIp: string,
): Promise<{ connected: boolean; devices?: DeakoDevice[]; error?: string }> {
  const r = await fetch('/api/integrations/deako/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayIp }),
  });
  return r.json();
}

export async function apiDeakoDevices(): Promise<{ connected: boolean; devices: DeakoDevice[] }> {
  const r = await fetch('/api/integrations/deako/devices');
  return r.json();
}

export async function apiDeakoControl(
  uuid: string,
  power: boolean,
  dim?: number,
): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/integrations/deako/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, power, dim }),
  });
  return r.json();
}

export async function apiDeakoStatus(): Promise<DeakoStatus> {
  const r = await fetch('/api/integrations/deako/status');
  return r.json();
}
