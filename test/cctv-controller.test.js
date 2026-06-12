import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraController } from '../server/cctv.js';

test('controller stitches segments on motion and reports a clip', async () => {
  const written = [];
  const ctrl = new CameraController({
    camera: { id: 'c1', name: 'Front', preRoll: 2, postRoll: 2 },
    // injected concat: record which segment files were stitched + output path
    concat: async (files, outPath) => { written.push({ files: [...files], outPath }); },
    storageRoot: '/nas',
    now: () => new Date('2026-06-12T09:00:30'),
  });

  // simulate 2s segments arriving at 24,26,28,30,32,34
  for (const t of [24, 26, 28, 30, 32, 34]) ctrl.onSegment({ file: `seg_${t}.ts`, start: t, end: t + 2 });
  // motion at t=30
  ctrl.onMotion(30);
  // close the event (no motion for postRoll): advance past 30+postRoll
  await ctrl.onSegment({ file: 'seg_36.ts', start: 36, end: 38 });
  await ctrl.flush();

  assert.equal(written.length, 1);
  // window [28,32]: seg_28 covers [28,30], seg_30 covers [30,32]. seg_32 starts
  // exactly at the window end and contributes nothing, so it is excluded.
  assert.deepEqual(written[0].files, ['seg_28.ts', 'seg_30.ts']);
  assert.match(written[0].outPath, /Front[/\\]2026-06-12[/\\]clip_090030\.mp4$/);
});

test('controller writes nothing without motion', async () => {
  const written = [];
  const ctrl = new CameraController({
    camera: { id: 'c1', name: 'Front', preRoll: 2, postRoll: 2 },
    concat: async (f, o) => written.push({ f, o }),
    storageRoot: '/nas',
    now: () => new Date(),
  });
  for (const t of [0, 2, 4, 6]) await ctrl.onSegment({ file: `s${t}`, start: t, end: t + 2 });
  await ctrl.flush();
  assert.equal(written.length, 0);
});
