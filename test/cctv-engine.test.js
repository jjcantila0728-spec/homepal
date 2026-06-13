import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runRetention } from '../lib/cctv/index.ts';

test('runRetention deletes oldest clips below floor, keeps newest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-'));
  const mk = (rel, bytes, mtimeMs) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(bytes));
    fs.utimesSync(f, new Date(mtimeMs), new Date(mtimeMs));
    return f;
  };
  const old = mk('Front/2026-06-10/clip_000000.mp4', 1000, Date.now() - 99999);
  const mid = mk('Front/2026-06-11/clip_000000.mp4', 1000, Date.now() - 50000);
  const recent = mk('Front/2026-06-12/clip_000000.mp4', 1000, Date.now());

  // Pretend the volume reports 0 free; floor needs 1500 -> must free 1500 -> delete old+mid.
  const deleted = await runRetention(root, { freeBytes: 0, floorBytes: 1500 });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(mid), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(deleted.length, 2);
});
