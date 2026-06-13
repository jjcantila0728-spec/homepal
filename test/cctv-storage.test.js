import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateStorage, planRetention } from '../lib/cctv/storage.ts';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-'));
}

test('validateStorage ok for a writable dir', async () => {
  const dir = tmpDir();
  const r = await validateStorage(dir);
  assert.equal(r.ok, true);
  assert.equal(typeof r.freeBytes, 'number');
});

test('validateStorage fails for a missing dir', async () => {
  const r = await validateStorage(path.join(tmpDir(), 'nope'));
  assert.equal(r.ok, false);
});

test('planRetention picks oldest clips until above floor', () => {
  const clips = [
    { path: 'a/2026-06-10/clip_000000.mp4', mtime: 10, size: 100 },
    { path: 'a/2026-06-11/clip_000000.mp4', mtime: 20, size: 100 },
    { path: 'a/2026-06-12/clip_000000.mp4', mtime: 30, size: 100 },
  ];
  // freeBytes 50, floor 200 -> need to free 150 -> delete two oldest (200 freed)
  const del = planRetention(clips, { freeBytes: 50, floorBytes: 200 });
  assert.deepEqual(del.map((c) => c.path), [clips[0].path, clips[1].path]);
});

test('planRetention deletes nothing when above floor', () => {
  const del = planRetention([{ path: 'x', mtime: 1, size: 100 }], { freeBytes: 500, floorBytes: 200 });
  assert.deepEqual(del, []);
});
