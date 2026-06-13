// Pure functions: parse ffmpeg metadata.print output for scene-change times,
// and select staging segments that belong to a motion event window. No I/O.
// Ported from server/cctv-detect.js.

export interface Segment {
  file: string;
  start: number;
  end: number;
}

// metadata=print emits "pts_time:<sec>" lines followed by "lavfi.scene_score=..".
// Because the detector uses select='gt(scene,THRESH)', every emitted frame IS a
// motion frame, so we just collect the pts_time values.
export function parseSceneTimes(stderr: string): number[] {
  const out: number[] = [];
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(stderr)))) out.push(Number(m[1]));
  return out;
}

// segments: [{file, start, end}] (seconds, monotonic). motionTimes: number[].
// opts: { preRoll, postRoll } seconds. Returns segments overlapping the union
// window [min(motion)-preRoll, max(motion)+postRoll].
export function selectSegments(
  segments: Segment[],
  motionTimes: number[],
  { preRoll = 5, postRoll = 8 }: { preRoll?: number; postRoll?: number } = {},
): Segment[] {
  if (!motionTimes.length) return [];
  const lo = Math.min(...motionTimes) - preRoll;
  const hi = Math.max(...motionTimes) + postRoll;
  return segments.filter((s) => s.end > lo && s.start < hi);
}
