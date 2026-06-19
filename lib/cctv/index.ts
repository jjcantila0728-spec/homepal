// CCTV recording engine + response shaping. Ported from server/cctv.js and
// server/cctv-api.js for SELF-HOST use. Node built-ins + ffmpeg/ffprobe child
// processes only — safe inside route handlers (runtime='nodejs').
//
// In cloud mode the routes short-circuit before touching the engine; nothing
// here spawns a process at import time, so `next build` is unaffected.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseSceneTimes, selectSegments, type Segment } from './detect.ts';
import { clipRelPath } from './paths.ts';
import { validateStorage, listClips, planRetention, safeDelete } from './storage.ts';
import { stagingRoot } from './cloud.ts';
import { maskRtsp, decryptSecret } from '../crypto.ts';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const RING_KEEP_SEC = 30; // trailing staging window to keep when idle
const GB = 1024 ** 3;

// ---- types ----

export interface Camera {
  id: string;
  name: string;
  rtspUrl: string; // ciphertext at rest
  sensitivity: number;
  preRoll: number;
  postRoll: number;
  enabled: boolean;
  brand?: 'tapo' | 'onvif' | 'generic'; // non-secret display/edit metadata
  host?: string;
  streamQuality?: 'hd' | 'sd';
}

export interface EngineConfig {
  enabled: boolean;
  storagePath: string;
  freeSpaceFloorGB: number;
  cameras: Camera[];
}

interface LastClip {
  rel: string;
  at: string;
}

// ---- ffmpeg detection + rtsp validation ----

function probeBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let p: ChildProcess;
    try {
      p = spawn(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      return resolve(false);
    }
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

export async function ffmpegInfo(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  const [ffmpeg, ffprobe] = await Promise.all([probeBinary(FFMPEG), probeBinary(FFPROBE)]);
  return { ffmpeg, ffprobe };
}

export interface RtspProbeResult {
  ok: boolean;
  reason?: string;
}

// Validate an RTSP URL: scheme check (no spawn), then a 1s ffmpeg decode to
// confirm the stream is reachable and decodable.
export async function validateRtspUrl(url: string, timeoutMs = 8000): Promise<RtspProbeResult> {
  if (!/^rtsp:\/\//i.test(String(url))) return { ok: false, reason: 'URL must start with rtsp://' };
  return new Promise((resolve) => {
    const args = ['-rtsp_transport', 'tcp', '-i', String(url), '-t', '1', '-f', 'null', '-'];
    let p: ChildProcess | undefined;
    let done = false;
    const finish = (v: RtspProbeResult) => {
      if (!done) {
        done = true;
        try {
          p?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve(v);
      }
    };
    try {
      p = spawn(FFMPEG, args);
    } catch (e) {
      return resolve({ ok: false, reason: String((e as Error).message || e) });
    }
    let err = '';
    p.stderr?.on('data', (d: Buffer) => {
      err += d;
      if (err.length > 8192) err = err.slice(-8192);
    });
    p.on('error', (e) => finish({ ok: false, reason: String(e.message || e) }));
    p.on('close', (code) =>
      finish(
        code === 0
          ? { ok: true }
          : { ok: false, reason: err.split('\n').filter(Boolean).pop() || 'ffmpeg failed' },
      ),
    );
    setTimeout(() => finish({ ok: false, reason: 'timed out probing stream' }), timeoutMs);
  });
}

// ---- camera controller: motion-event stitching ----

type ConcatFn = (files: string[], outPath: string) => Promise<void>;

// Fed segment + motion events; emits a stitched clip via injected `concat`.
// No ffmpeg/timers here so it unit-tests in isolation.
export class CameraController {
  camera: Camera;
  concat: ConcatFn;
  storageRoot: string;
  now: () => Date;
  segments: Segment[] = [];
  motions: number[] = [];
  eventOpen = false;
  eventStartedAt: Date | null = null;
  lastMotion = -Infinity;
  lastClip: LastClip | null = null;

  constructor({
    camera,
    concat,
    storageRoot,
    now,
  }: {
    camera: Camera;
    concat: ConcatFn;
    storageRoot: string;
    now?: () => Date;
  }) {
    this.camera = camera;
    this.concat = concat;
    this.storageRoot = storageRoot;
    this.now = now || (() => new Date());
  }

  onMotion(t: number): void {
    this.motions.push(t);
    this.lastMotion = Math.max(this.lastMotion, t);
    if (!this.eventOpen) {
      this.eventOpen = true;
      this.eventStartedAt = this.now();
    }
  }

  async onSegment(seg: Segment): Promise<void> {
    this.segments.push(seg);
    const post = this.camera.postRoll ?? 8;
    if (this.eventOpen && seg.start > this.lastMotion + post) {
      await this._closeEvent();
    }
    this._trim();
  }

  _trim(): void {
    if (this.eventOpen) return; // keep everything while recording
    const cutoff = (this.segments.at(-1)?.end ?? 0) - RING_KEEP_SEC;
    this.segments = this.segments.filter((s) => s.end >= cutoff);
  }

  async _closeEvent(): Promise<string | null> {
    const picked = selectSegments(this.segments, this.motions, {
      preRoll: this.camera.preRoll ?? 5,
      postRoll: this.camera.postRoll ?? 8,
    });
    const startedAt = this.eventStartedAt || this.now();
    this.eventOpen = false;
    this.motions = [];
    this.lastMotion = -Infinity;
    if (!picked.length) return null;
    const rel = clipRelPath(this.camera.name, startedAt);
    const outPath = path.join(this.storageRoot, rel);
    await this.concat(
      picked.map((s) => s.file),
      outPath,
    );
    this.lastClip = { rel, at: startedAt.toISOString() };
    return outPath;
  }

  // Force-close any open event (shutdown / test).
  async flush(): Promise<void> {
    if (this.eventOpen) await this._closeEvent();
  }
}

// ---- ffmpeg adapters ----

// Concatenate MPEG-TS segments into one MP4 via ffmpeg concat demuxer.
export async function concatSegments(files: string[], outPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const listFile = outPath + '.txt';
  await fsp.writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      FFMPEG,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath],
      { stdio: 'ignore' },
    );
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('concat failed code ' + code))));
  });
  await fsp.rm(listFile, { force: true });
}

// Spawn the segmenter: 2s -c copy MPEG-TS segments into stagingDir.
export function startSegmenter(url: string, stagingDir: string): ChildProcess {
  fs.mkdirSync(stagingDir, { recursive: true });
  const pattern = path.join(stagingDir, 'seg_%05d.ts');
  const p = spawn(
    FFMPEG,
    ['-rtsp_transport', 'tcp', '-i', url, '-an', '-c', 'copy', '-f', 'segment', '-segment_time', '2', '-reset_timestamps', '1', pattern],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  p.on('error', () => {}); // missing binary / spawn failure shouldn't crash the server
  return p;
}

// Spawn the detector: downscaled scene-change; emits motion times via onMotion.
export function startDetector(
  url: string,
  sensitivity: number,
  onMotion: (t: number) => void,
): ChildProcess {
  const p = spawn(
    FFMPEG,
    [
      '-rtsp_transport',
      'tcp',
      '-i',
      url,
      '-an',
      '-vf',
      `scale=320:-1,select='gt(scene,${Number(sensitivity) || 0.04})',metadata=print`,
      '-f',
      'null',
      '-',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  p.on('error', () => {}); // missing binary / spawn failure shouldn't crash the server
  let buf = '';
  p.stderr?.on('data', (d: Buffer) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const t of parseSceneTimes(lines.join('\n'))) onMotion(t);
  });
  return p;
}

// ---- engine orchestration + retention ----

// Run one retention pass. `space` ({freeBytes, floorBytes}) is provided by the
// caller (the sweep reads it via validateStorage; tests inject it).
export async function runRetention(
  root: string,
  space: { freeBytes: number; floorBytes: number },
): Promise<string[]> {
  if (!space) throw new Error('space required');
  const { freeBytes, floorBytes } = space;
  const clips = await listClips(root);
  const toDelete = planRetention(
    clips.map((c) => ({ path: c.path, mtime: c.mtime, size: c.size })),
    { freeBytes, floorBytes },
  );
  const deleted: string[] = [];
  for (const c of toDelete) if (await safeDelete(root, c.path)) deleted.push(c.path);
  return deleted;
}

interface Recorder {
  seg: ChildProcess;
  det: ChildProcess;
  ctrl: CameraController;
  stagingDir: string;
  watcher: fs.FSWatcher | null;
}

const recorders = new Map<string, Recorder>(); // cameraId -> recorder
let retentionTimer: ReturnType<typeof setInterval> | null = null;
let engineCfg: EngineConfig = { enabled: false, storagePath: '', freeSpaceFloorGB: 20, cameras: [] };

export function getEngineStatus() {
  return {
    enabled: engineCfg.enabled,
    storagePath: engineCfg.storagePath,
    freeSpaceFloorGB: engineCfg.freeSpaceFloorGB,
    cameras: [...recorders.values()].map((r) => ({
      id: r.ctrl.camera.id,
      name: r.ctrl.camera.name,
      recording: r.ctrl.eventOpen,
      lastClip: r.ctrl.lastClip || null,
    })),
  };
}

// (Re)configure the engine from a config object whose camera rtspUrls are
// ciphertext. Stops removed recorders, starts enabled ones, and (re)arms the
// retention sweep. `decrypt` turns a camera's stored rtspUrl into plaintext.
export async function applyConfig(
  cfg: EngineConfig,
  { decrypt = decryptSecret }: { decrypt?: (enc: string) => string } = {},
): Promise<void> {
  engineCfg = { ...engineCfg, ...cfg };
  const cameras = cfg.cameras || [];

  // Stop recorders that are gone or disabled.
  for (const [id, r] of recorders) {
    if (!cfg.enabled || !cameras.find((c) => c.id === id && c.enabled)) {
      try {
        r.seg.kill('SIGKILL');
        r.det.kill('SIGKILL');
        r.watcher?.close();
      } catch {
        /* ignore */
      }
      recorders.delete(id);
    }
  }

  // Start newly-enabled recorders.
  if (cfg.enabled) {
    const STAGING_ROOT = stagingRoot();
    for (const cam of cameras) {
      if (!cam.enabled || recorders.has(cam.id)) continue;
      let url: string;
      try {
        url = decrypt ? decrypt(cam.rtspUrl) : cam.rtspUrl;
      } catch {
        continue;
      }
      const stagingDir = path.join(STAGING_ROOT, cam.id);
      const ctrl = new CameraController({
        camera: cam,
        concat: concatSegments,
        storageRoot: cfg.storagePath,
        now: () => new Date(),
      });
      const seg = startSegmenter(url, stagingDir);
      // Map each new seg_NNNNN.ts to its start time (2s per segment by index).
      const watcher = fs.watch(stagingDir, async (_evt, fname) => {
        if (!fname || !String(fname).endsWith('.ts')) return;
        const idx = Number(/seg_(\d+)\.ts/.exec(String(fname))?.[1] ?? -1);
        if (idx < 0) return;
        const start = idx * 2;
        try {
          await ctrl.onSegment({ file: path.join(stagingDir, String(fname)), start, end: start + 2 });
        } catch {
          /* ignore */
        }
      });
      const det = startDetector(url, cam.sensitivity, (t) => ctrl.onMotion(t));
      recorders.set(cam.id, { seg, det, ctrl, stagingDir, watcher });
    }
  }

  // (Re)start retention timer.
  if (retentionTimer) clearInterval(retentionTimer);
  if (cfg.enabled && cfg.storagePath) {
    retentionTimer = setInterval(
      async () => {
        const v = await validateStorage(cfg.storagePath);
        if (v.ok) {
          await runRetention(cfg.storagePath, {
            freeBytes: v.freeBytes,
            floorBytes: (cfg.freeSpaceFloorGB || 20) * GB,
          }).catch(() => {});
        }
      },
      5 * 60 * 1000,
    );
    retentionTimer.unref?.();
  }
}

export function stopEngine(): void {
  for (const [, r] of recorders) {
    try {
      r.seg.kill('SIGKILL');
      r.det.kill('SIGKILL');
      r.watcher?.close();
    } catch {
      /* ignore */
    }
  }
  recorders.clear();
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

// ---- response shaping (ported from server/cctv-api.js) ----

export interface SanitizedCamera {
  id: string;
  name: string;
  sensitivity: number;
  preRoll: number;
  postRoll: number;
  enabled: boolean;
  rtspMasked: string;
  brand?: 'tapo' | 'onvif' | 'generic';
  host?: string;
  streamQuality?: 'hd' | 'sd';
}

// Strip ciphertext + any plaintext; expose only a masked URL for display.
export function sanitizeCamerasForClient(
  cameras: Camera[] | undefined,
  decrypt: (enc: string) => string,
): SanitizedCamera[] {
  return (cameras || []).map((c) => {
    let masked = '';
    try {
      masked = maskRtsp(decrypt(c.rtspUrl));
    } catch {
      masked = '';
    }
    // Allowlist safe fields only — never spread the source camera, so neither
    // the ciphertext (rtspUrl) nor any cached plaintext can ever reach a client.
    return {
      id: c.id,
      name: c.name,
      sensitivity: c.sensitivity,
      preRoll: c.preRoll,
      postRoll: c.postRoll,
      enabled: c.enabled,
      rtspMasked: masked,
      brand: c.brand,
      host: c.host,
      streamQuality: c.streamQuality,
    };
  });
}

export function cctvStatusPayload(
  ff: { ffmpeg?: boolean; ffprobe?: boolean },
  storage: { ok?: boolean; reason?: string; freeBytes: number },
  engine: { enabled?: boolean; cameras?: SanitizedCamera[] },
) {
  return {
    ffmpeg: !!ff.ffmpeg,
    ffprobe: !!ff.ffprobe,
    storage: {
      ok: !!storage.ok,
      reason: storage.reason || '',
      freeGB: +(storage.freeBytes / GB).toFixed(1),
    },
    enabled: !!engine.enabled,
    cameras: engine.cameras || [],
  };
}
