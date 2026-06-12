// Storage validation, free-space, and retention planning. Uses fs.statfs (Node>=24).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { withinRoot, parseClipTime } from './cctv-paths.js';

// Verify dir exists and is writable; report free bytes. Never throws.
export async function validateStorage(dir) {
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return { ok: false, reason: 'Not a directory', freeBytes: 0 };
    await fsp.access(dir, fs.constants.W_OK);
    const sf = await fsp.statfs(dir);
    return { ok: true, freeBytes: sf.bsize * sf.bavail, totalBytes: sf.bsize * sf.blocks };
  } catch (err) {
    return { ok: false, reason: err.code || String(err.message || err), freeBytes: 0 };
  }
}

// Pure: given clips (oldest-deletable) + space info, return clips to delete
// (oldest first) until freeBytes would exceed floorBytes. clips: [{path,mtime,size}].
export function planRetention(clips, { freeBytes, floorBytes }) {
  if (freeBytes >= floorBytes) return [];
  const sorted = [...clips].sort((a, b) => a.mtime - b.mtime);
  const out = [];
  let free = freeBytes;
  for (const c of sorted) {
    if (free >= floorBytes) break;
    out.push(c);
    free += c.size;
  }
  return out;
}

// Walk storage root for clip files. Returns [{path, mtime, size, when}]. Root-guarded.
export async function listClips(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (!withinRoot(root, full)) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.mp4')) {
        const st = await fsp.stat(full).catch(() => null);
        if (st) out.push({ path: full, mtime: st.mtimeMs, size: st.size, when: parseClipTime(full) });
      }
    }
  }
  await walk(root);
  return out;
}

// Delete a clip ONLY if inside root. Returns true if deleted.
export async function safeDelete(root, file) {
  if (!withinRoot(root, file)) return false;
  await fsp.rm(file, { force: true });
  return true;
}
