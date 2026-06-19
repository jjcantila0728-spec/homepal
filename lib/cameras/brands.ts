// lib/cameras/brands.ts
// Pure adapters that turn friendly per-brand camera fields into the rtsp:// URL
// the recording engine consumes. No I/O — fully unit-testable. The caller
// (config/test routes) encrypts the returned URL at rest via lib/crypto.

export type CameraBrand = 'tapo' | 'onvif' | 'generic';

export interface BrandFields {
  brand: CameraBrand;
  host?: string;
  username?: string;
  password?: string;
  streamQuality?: 'hd' | 'sd';
  rtspUrl?: string;
  rtspPath?: string;
}

export interface BuiltStream {
  rtspUrl: string;
  warnings: string[];
}

const EXPERIMENTAL =
  'ADT and other proprietary cameras may not expose RTSP/ONVIF; this is best-effort.';

function creds(username?: string, password?: string): string {
  if (!username) return '';
  const u = encodeURIComponent(username);
  const p = password ? ':' + encodeURIComponent(password) : '';
  return `${u}${p}@`;
}

export function buildRtspUrl(f: BrandFields): BuiltStream {
  if (f.brand === 'tapo') {
    if (!f.host) throw new Error('Tapo camera needs a host/IP');
    if (!f.username || !f.password) throw new Error('Tapo camera needs the camera-account username and password');
    const stream = f.streamQuality === 'sd' ? 'stream2' : 'stream1';
    return { rtspUrl: `rtsp://${creds(f.username, f.password)}${f.host}:554/${stream}`, warnings: [] };
  }

  // generic / onvif (covers ADT best-effort)
  if (f.rtspUrl) {
    const url = f.rtspUrl.trim();
    if (!/^rtsp:\/\//i.test(url)) throw new Error('Stream URL must start with rtsp://');
    return { rtspUrl: url, warnings: [EXPERIMENTAL] };
  }
  if (!f.host) throw new Error('Camera needs a host/IP or a full rtsp:// URL');
  const path = (f.rtspPath || '').replace(/^\/+/, '');
  return { rtspUrl: `rtsp://${creds(f.username, f.password)}${f.host}:554/${path}`, warnings: [EXPERIMENTAL] };
}
