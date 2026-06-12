// CCTV recording engine. Built-ins + ffmpeg/ffprobe child processes only.
//
// Per enabled camera we run two cheap ffmpeg processes:
//   - segmenter: `-c copy` 2s MPEG-TS segments into a staging ring buffer (no transcode)
//   - detector:  downscaled scene-change detection that emits motion timestamps
// A CameraController stitches the segments overlapping a motion event into one
// MP4 on the NAS. A periodic sweep prunes oldest clips when free space is low.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSceneTimes, selectSegments } from './cctv-detect.js';
import { clipRelPath } from './cctv-paths.js';
import { validateStorage, listClips, planRetention, safeDelete } from './cctv-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const RING_KEEP_SEC = 30; // trailing staging window to keep when idle
const GB = 1024 ** 3;

// ---- ffmpeg detection + rtsp validation (Task 6) ----

function probeBinary(bin) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(bin, ['-version'], { stdio: 'ignore' }); }
    catch { return resolve(false); }
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

export async function ffmpegInfo() {
  const [ffmpeg, ffprobe] = await Promise.all([probeBinary(FFMPEG), probeBinary(FFPROBE)]);
  return { ffmpeg, ffprobe };
}

// Validate an RTSP URL: scheme check (no spawn), then a 1s ffmpeg decode to
// confirm the stream is reachable and decodable.
export async function validateRtspUrl(url, timeoutMs = 8000) {
  if (!/^rtsp:\/\//i.test(String(url))) return { ok: false, reason: 'URL must start with rtsp://' };
  return new Promise((resolve) => {
    const args = ['-rtsp_transport', 'tcp', '-i', String(url), '-t', '1', '-f', 'null', '-'];
    let p, done = false;
    const finish = (v) => { if (!done) { done = true; try { p && p.kill('SIGKILL'); } catch {} resolve(v); } };
    try { p = spawn(FFMPEG, args); }
    catch (e) { return resolve({ ok: false, reason: String(e.message || e) }); }
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 8192) err = err.slice(-8192); });
    p.on('error', (e) => finish({ ok: false, reason: String(e.message || e) }));
    p.on('close', (code) => finish(code === 0 ? { ok: true } : { ok: false, reason: err.split('\n').filter(Boolean).pop() || 'ffmpeg failed' }));
    setTimeout(() => finish({ ok: false, reason: 'timed out probing stream' }), timeoutMs);
  });
}

// ---- camera controller: motion-event stitching (Task 7) ----

// Fed segment + motion events; emits a stitched clip via injected `concat(files,
// outPath)`. No ffmpeg/timers here so it unit-tests in isolation.
export class CameraController {
  constructor({ camera, concat, storageRoot, now }) {
    this.camera = camera;
    this.concat = concat;
    this.storageRoot = storageRoot;
    this.now = now || (() => new Date());
    this.segments = [];      // ring buffer [{file,start,end}]
    this.motions = [];       // pts times in current/last event
    this.eventOpen = false;
    this.eventStartedAt = null;
    this.lastMotion = -Infinity;
    this.lastClip = null;
  }

  onMotion(t) {
    this.motions.push(t);
    this.lastMotion = Math.max(this.lastMotion, t);
    if (!this.eventOpen) { this.eventOpen = true; this.eventStartedAt = this.now(); }
  }

  async onSegment(seg) {
    this.segments.push(seg);
    // Close the event once we've buffered past lastMotion + postRoll.
    const post = this.camera.postRoll ?? 8;
    if (this.eventOpen && seg.start > this.lastMotion + post) {
      await this._closeEvent();
    }
    this._trim();
  }

  _trim() {
    if (this.eventOpen) return; // keep everything while recording
    const cutoff = (this.segments.at(-1)?.end ?? 0) - RING_KEEP_SEC;
    this.segments = this.segments.filter((s) => s.end >= cutoff);
  }

  async _closeEvent() {
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
    await this.concat(picked.map((s) => s.file), outPath);
    this.lastClip = { rel, at: startedAt.toISOString() };
    return outPath;
  }

  // Force-close any open event (shutdown / test).
  async flush() {
    if (this.eventOpen) await this._closeEvent();
  }
}

// ---- ffmpeg adapters (Task 8) ----

// Concatenate MPEG-TS segments into one MP4 via ffmpeg concat demuxer.
export async function concatSegments(files, outPath) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const listFile = outPath + '.txt';
  await fsp.writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('concat failed code ' + code))));
  });
  await fsp.rm(listFile, { force: true });
}

// Spawn the segmenter: 2s -c copy MPEG-TS segments into stagingDir.
export function startSegmenter(url, stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });
  const pattern = path.join(stagingDir, 'seg_%05d.ts');
  const p = spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-i', url,
    '-an', '-c', 'copy', '-f', 'segment',
    '-segment_time', '2', '-reset_timestamps', '1',
    pattern,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  p.on('error', () => {}); // missing binary / spawn failure shouldn't crash the server
  return p;
}

// Spawn the detector: downscaled scene-change; emits motion times via onMotion.
export function startDetector(url, sensitivity, onMotion) {
  const p = spawn(FFMPEG, [
    '-rtsp_transport', 'tcp', '-i', url,
    '-an', '-vf', `scale=320:-1,select='gt(scene,${Number(sensitivity) || 0.04})',metadata=print`,
    '-f', 'null', '-',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  p.on('error', () => {}); // missing binary / spawn failure shouldn't crash the server
  let buf = '';
  p.stderr.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const t of parseSceneTimes(lines.join('\n'))) onMotion(t);
  });
  return p;
}

// ---- engine orchestration + retention (Task 9) ----

// Run one retention pass. `space` ({freeBytes, floorBytes}) is provided by the
// caller (the sweep reads it via validateStorage; tests inject it).
export async function runRetention(root, space) {
  if (!space) throw new Error('space required');
  const { freeBytes, floorBytes } = space;
  const clips = await listClips(root);
  const toDelete = planRetention(clips.map((c) => ({ path: c.path, mtime: c.mtime, size: c.size })), { freeBytes, floorBytes });
  const deleted = [];
  for (const c of toDelete) if (await safeDelete(root, c.path)) deleted.push(c.path);
  return deleted;
}

const STAGING_ROOT = path.join(__dirname, '..', 'data', 'cctv-staging');
const recorders = new Map(); // cameraId -> { seg, det, ctrl, stagingDir, watcher }
let retentionTimer = null;
let engineCfg = { enabled: false, storagePath: '', freeSpaceFloorGB: 20, cameras: [] };

export function getEngineStatus() {
  return {
    enabled: engineCfg.enabled,
    storagePath: engineCfg.storagePath,
    freeSpaceFloorGB: engineCfg.freeSpaceFloorGB,
    cameras: [...recorders.values()].map((r) => ({
      id: r.ctrl.camera.id, name: r.ctrl.camera.name,
      recording: r.ctrl.eventOpen, lastClip: r.ctrl.lastClip || null,
    })),
  };
}

// (Re)configure the engine from a decrypted config object. Stops removed
// recorders, starts enabled ones, and (re)arms the retention sweep.
// `decrypt` turns a camera's stored rtspUrl into the usable plaintext URL.
export async function applyConfig(cfg, { decrypt } = {}) {
  engineCfg = { ...engineCfg, ...cfg };
  const cameras = cfg.cameras || [];

  // Stop recorders that are gone or disabled.
  for (const [id, r] of recorders) {
    if (!cfg.enabled || !cameras.find((c) => c.id === id && c.enabled)) {
      try { r.seg.kill('SIGKILL'); r.det.kill('SIGKILL'); r.watcher?.close(); } catch {}
      recorders.delete(id);
    }
  }

  // Start newly-enabled recorders.
  if (cfg.enabled) {
    for (const cam of cameras) {
      if (!cam.enabled || recorders.has(cam.id)) continue;
      let url;
      try { url = decrypt ? decrypt(cam.rtspUrl) : cam.rtspUrl; } catch { continue; }
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
        const idx = Number(/seg_(\d+)\.ts/.exec(fname)?.[1] ?? -1);
        if (idx < 0) return;
        const start = idx * 2;
        try { await ctrl.onSegment({ file: path.join(stagingDir, fname), start, end: start + 2 }); } catch {}
      });
      const det = startDetector(url, cam.sensitivity, (t) => ctrl.onMotion(t));
      recorders.set(cam.id, { seg, det, ctrl, stagingDir, watcher });
    }
  }

  // (Re)start retention timer.
  if (retentionTimer) clearInterval(retentionTimer);
  if (cfg.enabled && cfg.storagePath) {
    retentionTimer = setInterval(async () => {
      const v = await validateStorage(cfg.storagePath);
      if (v.ok) {
        await runRetention(cfg.storagePath, { freeBytes: v.freeBytes, floorBytes: (cfg.freeSpaceFloorGB || 20) * GB }).catch(() => {});
      }
    }, 5 * 60 * 1000);
    retentionTimer.unref?.();
  }
}

export function stopEngine() {
  for (const [, r] of recorders) {
    try { r.seg.kill('SIGKILL'); r.det.kill('SIGKILL'); r.watcher?.close(); } catch {}
  }
  recorders.clear();
  if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null; }
}
