import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cctvStatusPayload, sanitizeCamerasForClient } from '../lib/cctv/index.ts';

test('sanitizeCamerasForClient masks rtsp + drops ciphertext', () => {
  const cams = [{ id: 'c1', name: 'Front', rtspUrl: 'ENC', _plain: 'rtsp://u:p@10.0.0.5/s', sensitivity: 0.04, enabled: true }];
  const out = sanitizeCamerasForClient(cams, () => 'rtsp://u:p@10.0.0.5/s');
  assert.equal(out[0].rtspMasked, 'rtsp://***@10.0.0.5/s');
  assert.equal(out[0].rtspUrl, undefined);
  assert.equal(out[0]._plain, undefined);
});

test('cctvStatusPayload shape', () => {
  const p = cctvStatusPayload({ ffmpeg: true, ffprobe: true }, { ok: true, freeBytes: 5 * 1024 ** 3 }, { enabled: true, cameras: [] });
  assert.equal(p.ffmpeg, true);
  assert.equal(p.storage.ok, true);
  assert.equal(typeof p.storage.freeGB, 'number');
});
