// Pure path helpers for CCTV clip layout + traversal safety. No I/O.
// Ported from server/cctv-paths.js.
import path from 'node:path';

const pad = (n: number): string => String(n).padStart(2, '0');

// Filesystem-safe slug for a camera folder (no separators, no dots-only).
export function safeName(name: string): string {
  const s = String(name || 'camera')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.+/g, '_');
  return s.replace(/^_+|_+$/g, '') || 'camera';
}

export function dateFolder(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clipRelPath(cameraName: string, d: Date): string {
  const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return path.join(safeName(cameraName), dateFolder(d), `clip_${hms}.mp4`);
}

// Parse "<...>/YYYY-MM-DD/clip_HHMMSS.mp4" -> Date (local). Returns null if unparseable.
export function parseClipTime(p: string): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})[/\\]clip_(\d{2})(\d{2})(\d{2})\.mp4$/.exec(
    String(p).replace(/\\/g, '/'),
  );
  if (!m) return null;
  const [, y, mo, da, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, da, h, mi, s);
}

// True iff `target` resolves to `root` or a path inside it.
export function withinRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}
