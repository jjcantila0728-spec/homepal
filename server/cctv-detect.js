// Pure functions: parse ffmpeg metadata.print output for scene-change times,
// and select staging segments that belong to a motion event window. No I/O.

// metadata=print emits "pts_time:<sec>" lines followed by "lavfi.scene_score=..".
// Because the detector uses select='gt(scene,THRESH)', every emitted frame IS a
// motion frame, so we just collect the pts_time values.
export function parseSceneTimes(stderr) {
  const out = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m;
  while ((m = re.exec(String(stderr)))) out.push(Number(m[1]));
  return out;
}

// segments: [{file, start, end}] (seconds, monotonic). motionTimes: number[].
// opts: { preRoll, postRoll } seconds. Returns segments overlapping the union
// window [min(motion)-preRoll, max(motion)+postRoll].
export function selectSegments(segments, motionTimes, { preRoll = 5, postRoll = 8 } = {}) {
  if (!motionTimes.length) return [];
  const lo = Math.min(...motionTimes) - preRoll;
  const hi = Math.max(...motionTimes) + postRoll;
  return segments.filter((s) => s.end > lo && s.start < hi);
}
