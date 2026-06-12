import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { concatSegments, ffmpegInfo } from '../server/cctv.js';

// concatSegments uses ffmpeg concat demuxer; skip if ffmpeg missing.
test('concatSegments writes an output file from .ts inputs', async (t) => {
  const info = await ffmpegInfo();
  if (!info.ffmpeg) return t.skip('ffmpeg not installed');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  // Generate two tiny 1s test .ts segments with ffmpeg lavfi.
  const { spawnSync } = await import('node:child_process');
  const seg = (name) => {
    const f = path.join(dir, name);
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10', '-t', '1', '-c:v', 'libx264', '-f', 'mpegts', f], { stdio: 'ignore' });
    return f;
  };
  const a = seg('a.ts'); const b = seg('b.ts');
  const out = path.join(dir, 'out', 'clip.mp4');
  await concatSegments([a, b], out);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.statSync(out).size > 0);
});
