import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneTimes, selectSegments } from '../lib/cctv/detect.ts';

test('parseSceneTimes extracts pts_time from metadata.print lines', () => {
  const stderr = [
    'frame:12   pts:120000  pts_time:5.0',
    'lavfi.scene_score=0.080000',
    'frame:40   pts:400000  pts_time:16.6',
    'lavfi.scene_score=0.120000',
    'noise line',
  ].join('\n');
  assert.deepEqual(parseSceneTimes(stderr), [5.0, 16.6]);
});

test('selectSegments returns segments overlapping [motion-pre, lastMotion+post]', () => {
  // 2s segments starting at 0,2,4,...,20
  const segs = Array.from({ length: 11 }, (_, i) => ({ file: `seg_${i}.ts`, start: i * 2, end: i * 2 + 2 }));
  // motion at t=10 and t=12, preRoll 4, postRoll 4 -> window [6,16]
  const picked = selectSegments(segs, [10, 12], { preRoll: 4, postRoll: 4 });
  assert.deepEqual(picked.map((s) => s.file), ['seg_3.ts', 'seg_4.ts', 'seg_5.ts', 'seg_6.ts', 'seg_7.ts']);
  // seg_3 covers [6,8] ... seg_7 covers [14,16]
});

test('selectSegments with no motion returns empty', () => {
  const segs = [{ file: 'a', start: 0, end: 2 }];
  assert.deepEqual(selectSegments(segs, [], { preRoll: 4, postRoll: 4 }), []);
});
