// Pure response-shaping helpers for the CCTV API (kept separate so they unit-test
// without spinning the HTTP server). The route handlers in index.js call these.
import { maskRtsp } from './crypto.js';

const GB = 1024 ** 3;

// Strip ciphertext + any plaintext; expose only a masked URL for display.
export function sanitizeCamerasForClient(cameras, decrypt) {
  return (cameras || []).map((c) => {
    let masked = '';
    try { masked = maskRtsp(decrypt(c.rtspUrl)); } catch { masked = ''; }
    const { rtspUrl, _plain, ...rest } = c;
    return { ...rest, rtspMasked: masked };
  });
}

export function cctvStatusPayload(ff, storage, engine) {
  return {
    ffmpeg: !!ff.ffmpeg,
    ffprobe: !!ff.ffprobe,
    storage: { ok: !!storage.ok, reason: storage.reason || '', freeGB: +(storage.freeBytes / GB).toFixed(1) },
    enabled: !!engine.enabled,
    cameras: engine.cameras || [],
  };
}
