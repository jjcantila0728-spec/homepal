// Domain types for the Deako local-API integration. No I/O here.

export interface DeakoState {
  power: boolean;
  dim: number; // 0–100; for non-dimmable switches treat <100 as on
}

export interface DeakoDevice {
  uuid: string;
  name: string;
  state: DeakoState;
}

export type DeakoConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DeakoStatus {
  status: DeakoConnectionStatus;
  gatewayIp: string | null;
  deviceCount: number;
  lastError: string | null;
}
