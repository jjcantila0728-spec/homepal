# HomePal CCTV → UGREEN NAS Recording — Design

**Date:** 2026-06-12
**Status:** Approved (design); pending implementation plan

## Goal

Add a real motion-triggered CCTV recording pipeline to HomePal that captures
camera RTSP streams and writes video clips to a UGREEN NAS, with automatic
retention. Stays true to HomePal's zero-npm-dependency style: only Node
built-ins plus the external `ffmpeg`/`ffprobe` binaries.

## Locked Decisions

| Area | Decision |
|------|----------|
| Scope | Real recording pipeline (not dashboard representation) |
| Capture engine | Locally installed `ffmpeg`; HomePal detects it and warns if missing |
| Storage access | Mounted path — user mounts UGREEN SMB/NFS share; HomePal writes files to it |
| Record mode | Motion-triggered |
| Motion source | `ffmpeg` scene-change detection (works with any camera), per-camera sensitivity |
| Retention | Free-space floor — delete oldest clips when NAS free space drops below a configured GB floor |
| Camera config | Full RTSP URL per camera; validated with `ffprobe`; stored encrypted at rest |

## Architecture

### Capture pipeline (per enabled camera — two ffmpeg processes)

1. **Segmenter** (`-c copy`, no transcode → near-zero CPU)
   - `ffmpeg -rtsp_transport tcp -i <url> -c copy -f segment -segment_time 2 -reset_timestamps 1 staging/<cam>/seg_%05d.ts`
   - Writes 2-second MPEG-TS segments into a local staging **ring buffer**.
   - Only the trailing window (~15s) is retained unless an event claims segments.

2. **Detector** (downscaled decode)
   - `ffmpeg -rtsp_transport tcp -i <url> -an -vf "scale=320:-1,select='gt(scene,<sens>)',metadata=print" -f null -`
   - Parses stderr `lavfi.scene_score` / `pts_time` lines to emit motion timestamps.

3. **Controller** (per camera)
   - On a motion timestamp `T`, opens/extends an **event** spanning
     `[T − preRoll … lastMotion + postRoll]`.
   - Pre-roll is satisfied by segments already in the ring buffer.
   - When the event closes (no motion for `postRoll`), concatenates the
     overlapping `.ts` segments into a single MP4 and writes it to the NAS:
     `<storagePath>/<camera>/<YYYY-MM-DD>/clip_<HHMMSS>.mp4`.
   - Non-event segments are pruned continuously to bound staging size.

Rationale: a `-c copy` segmenter is essentially free; only the small downscaled
detector decodes frames. This yields true motion clips *with pre-roll* on any
camera at minimal CPU.

### Storage (mounted path)

- User mounts the UGREEN share (e.g. `Z:\cctv` on Windows, `/mnt/ugreen/cctv`
  on Linux). HomePal only ever writes to the configured path.
- Path is verified to exist and be writable at startup and before each clip write.
- Free space read via `fs.statfs` (available on Node ≥ 24).

### Retention (free-space floor)

- A periodic sweep (every few minutes) reads free space on the mount.
- When below `freeSpaceFloorGB`, delete oldest clips (by path date / mtime)
  until free space is back above floor + margin.
- Hard-guarded: deletion is confined to the configured CCTV storage root.

## New / changed files

### Backend
- `server/cctv.js` — recording engine: recorder registry, segmenter/detector/
  controller, retention sweep, `ffmpeg`/`ffprobe` detection.
- `server/crypto.js` — AES-256-GCM helper. Key derived from `HOMEPAL_SECRET`
  env var, or a key generated once and stored in the `data/` dir. Used to
  encrypt RTSP URLs (which carry credentials) at rest.
- `server/db.js` — add `cctv` to the `putState` config whitelist
  ([db.js:182](../../server/db.js)). Config shape:
  ```json
  {
    "cctv": {
      "enabled": true,
      "storagePath": "Z:\\cctv",
      "freeSpaceFloorGB": 20,
      "cameras": [
        {
          "id": "cam1", "name": "Front Door",
          "rtspUrl": "<aes-gcm ciphertext>",
          "sensitivity": 0.04, "preRoll": 5, "postRoll": 8,
          "enabled": true, "status": "idle", "lastClip": "..."
        }
      ]
    }
  }
  ```

### API (added to `server/index.js`, all auth-protected via `verifyToken`)
- `GET  /api/cctv/status` — ffmpeg availability, storage writable + free space,
  per-camera state (idle/recording/error, last clip, today's clip count).
- `POST /api/cctv/config` — set storage path, floor; add/update/remove cameras.
- `POST /api/cctv/test` — `ffprobe` a given RTSP URL before enabling it.
- `GET  /api/cctv/clips?camera=&date=` — list recorded clips (metadata).
- `GET  /api/cctv/clip/...` — stream a clip with HTTP Range support;
  path-traversal-guarded to the storage root.

### Frontend (`src/` — a "Cameras & Storage" view)
- UGREEN storage config: mount path, free-space floor, live free-space bar.
- ffmpeg-missing warning banner.
- Per-camera cards: masked RTSP URL field, sensitivity slider, pre/post-roll,
  enable toggle, status, "Test" button.
- Clip browser: list by camera/date, play via HTML5 `<video>` against the
  range endpoint.
- Discovered `camera`-type devices (from SSDP discovery) can be attached to an
  RTSP config in one click.

## Security

- RTSP credentials encrypted at rest (AES-256-GCM); masked in all API responses
  (never return the raw URL to the client).
- `ffmpeg`/`ffprobe` invoked via `spawn` arg arrays — no shell, no command injection.
- RTSP URL scheme validated (`rtsp://`) before use.
- Clip-serving endpoint and retention sweep both confined to the storage root
  (resolved-path prefix check) to prevent traversal / accidental deletion.

## Testing

- **Unit**
  - Motion-event parsing from ffmpeg stderr lines.
  - Event → segment-selection logic (which `.ts` segments belong to an event).
  - Retention selection (oldest-first until above floor) and storage-root guard.
  - Crypto round-trip (encrypt/decrypt RTSP URL) and masking helper.
  - Clip filename/timestamp parsing; `fs.statfs` free-space computation.
  - Path-traversal guard for the clip-serving endpoint.
- **Integration**
  - Controller driven with synthetic motion events + fabricated `.ts` segments
    in a temp staging dir writing to a temp "NAS" dir (no real camera needed).
  - ffmpeg/ffprobe interaction tested via a stub binary on PATH.
- **Manual / E2E**
  - Real camera + mounted UGREEN share: verify clip is written on motion,
    plays back in the browser, and retention prunes when the floor is hit.

## Build order

1. ffmpeg/ffprobe detection + storage path validation + `crypto.js` + config plumbing.
2. Capture pipeline (segmenter + detector + controller) for one camera.
3. Retention sweep.
4. API endpoints.
5. Frontend view.

Each stage is independently testable.

## Notes

- HomePal is not a git repository in this workspace, so this spec is not
  committed. Run `git init` first if version-controlled history is wanted.
