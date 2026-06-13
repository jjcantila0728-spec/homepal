// Cloud-awareness for the CCTV feature. A cloud instance cannot reach cameras
// or NAS storage on a user's home LAN, so the recording engine is gated behind
// isCloud(). When cloud, the APIs return a `local-agent-required` state and the
// UI shows a "requires self-hosting" banner.
//
// Node built-ins only — safe in route handlers (runtime='nodejs'). Detection is
// lazy/memoized so importing this module never spawns a process or throws.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const LOCAL_AGENT_REQUIRED = 'local-agent-required';

let ffmpegCache: boolean | null = null;

// True iff ffmpeg is invocable. Checks FFMPEG_PATH (if it points at a real file)
// first, then resolves `ffmpeg` on PATH via `which`/`where`. Memoized; never
// throws. Synchronous on purpose so callers can use it inside other guards.
export function ffmpegAvailable(): boolean {
  if (ffmpegCache !== null) return ffmpegCache;
  ffmpegCache = detectFfmpeg();
  return ffmpegCache;
}

function detectFfmpeg(): boolean {
  const explicit = process.env.FFMPEG_PATH;
  if (explicit) {
    // An explicit path is trusted if it exists; else fall through to PATH lookup.
    try {
      if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) return true;
    } catch {
      /* ignore and try PATH */
    }
  }
  // `which ffmpeg` (POSIX) / `where ffmpeg` (Windows). spawnSync never throws on
  // a missing binary — it sets .error / non-zero status instead.
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(finder, ['ffmpeg'], { stdio: 'ignore' });
    if (!r.error && r.status === 0) return true;
  } catch {
    /* ignore */
  }
  // Last resort: probe `ffmpeg -version` directly (covers shells where which is
  // absent but ffmpeg is on PATH).
  const bin = explicit || 'ffmpeg';
  try {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    if (!r.error && r.status === 0) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Cloud mode when explicitly flagged OR when ffmpeg isn't available (a cloud
// host won't have ffmpeg + LAN access for recording). Lazy: only reads env and
// probes ffmpeg when called, so `next build` never trips on import.
export function isCloud(): boolean {
  if (process.env.HOMEPAL_CLOUD === '1') return true;
  return !ffmpegAvailable();
}

// Where staging segments live for self-hosted recording. Kept here so both the
// engine and (future) tests share one definition. Outside the storage root so a
// retention sweep can't touch it.
export function stagingRoot(): string {
  return path.join(process.cwd(), 'data', 'cctv-staging');
}
