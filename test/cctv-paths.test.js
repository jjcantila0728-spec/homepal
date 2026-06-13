import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { clipRelPath, parseClipTime, withinRoot } from '../lib/cctv/paths.ts';

test('clipRelPath builds <camera>/<date>/clip_<HHMMSS>.mp4', () => {
  const d = new Date('2026-06-12T09:05:03');
  assert.equal(clipRelPath('Front Door', d), path.join('Front_Door', '2026-06-12', 'clip_090503.mp4'));
});

test('clipRelPath sanitizes unsafe camera names', () => {
  const d = new Date('2026-06-12T00:00:00');
  const rel = clipRelPath('../evil/..', d);
  assert.ok(!rel.includes('..'), rel);
});

test('parseClipTime reads timestamp back', () => {
  const t = parseClipTime('2026-06-12/clip_090503.mp4');
  assert.equal(t.getFullYear(), 2026);
  assert.equal(t.getHours(), 9);
  assert.equal(t.getSeconds(), 3);
});

test('withinRoot rejects traversal, accepts children', () => {
  const root = path.resolve('/srv/cctv');
  assert.equal(withinRoot(root, path.join(root, 'a/b.mp4')), true);
  assert.equal(withinRoot(root, path.resolve(root, '../etc/passwd')), false);
});
