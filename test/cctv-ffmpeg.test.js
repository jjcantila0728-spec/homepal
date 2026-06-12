import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegInfo, validateRtspUrl } from '../server/cctv.js';

test('ffmpegInfo reports availability shape', async () => {
  const info = await ffmpegInfo();
  assert.equal(typeof info.ffmpeg, 'boolean');
  assert.equal(typeof info.ffprobe, 'boolean');
});

test('validateRtspUrl rejects non-rtsp scheme without spawning', async () => {
  const r = await validateRtspUrl('http://192.168.1.5/x');
  assert.equal(r.ok, false);
  assert.match(r.reason, /rtsp/i);
});
