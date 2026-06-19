'use client';

// Cameras panel — rendered inside Smart Home (formerly the standalone
// "Cameras & Storage" view). Preserves the legacy markup/classNames: UGREEN NAS
// storage config, ffmpeg status banner, per-camera cards with masked RTSP,
// add/test camera, and a clip browser.
//
// Cloud-aware: when /api/cctv/status reports `local-agent-required`, we render a
// "requires self-hosting" banner while still allowing camera/storage config to
// be saved (the config POST persists even in cloud).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHousehold } from '@/store/household';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';

interface SanitizedCamera {
  id: string;
  name: string;
  sensitivity?: number;
  preRoll?: number;
  postRoll?: number;
  enabled?: boolean;
  recording?: boolean;
  rtspMasked?: string;
}

interface CctvStatus {
  ok?: boolean;
  cloud?: boolean;
  upgrade?: boolean;
  reason?: string;
  ffmpeg?: boolean;
  ffprobe?: boolean;
  storage?: { ok?: boolean; reason?: string; freeGB?: number };
  enabled?: boolean;
  cameras?: SanitizedCamera[];
  storagePath?: string;
  freeSpaceFloorGB?: number;
}

interface ClipRow {
  path: string;
  when: string | null;
  sizeMB: number;
}

interface CameraPayload {
  id?: string;
  name: string;
  rtspUrl?: string;
  sensitivity?: number;
  preRoll?: number;
  postRoll?: number;
  enabled?: boolean;
}

const LOCAL_AGENT_REQUIRED = 'local-agent-required';

function gb(n: number | undefined | null): string | number {
  return n === undefined || n === null ? '—' : n;
}

export function CamerasPanel() {
  const { toast } = useHousehold();
  const [status, setStatus] = useState<CctvStatus | null>(null);
  const [error, setError] = useState<string>('');
  const statusRef = useRef<CctvStatus | null>(null);
  statusRef.current = status;

  // Controlled inputs for the storage form (mirror #cctv-path / #cctv-floor).
  const [pathInput, setPathInput] = useState('');
  const [floorInput, setFloorInput] = useState<string>('');

  // Clip browser state (mirrors #cctv-clips / #cctv-player).
  const [clipsFor, setClipsFor] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipRow[] | null>(null);
  const [clipsError, setClipsError] = useState('');
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const isCloud = !!status && (status.cloud === true || status.reason === LOCAL_AGENT_REQUIRED);

  const loadStatus = useCallback(() => {
    fetch('/api/cctv/status')
      .then((r) => r.json())
      .then((s: CctvStatus) => {
        setStatus(s);
        setError('');
        setPathInput(s.storagePath || '');
        setFloorInput(s.freeSpaceFloorGB != null ? String(s.freeSpaceFloorGB) : '');
      })
      .catch((e: Error) => setError(e.message || 'error'));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Build cameras payload from the last status (no rtspUrl => server keeps each
  // camera's stored ciphertext), applying an optional per-camera patch.
  const camerasPayload = useCallback(
    (patchId?: string, patch?: Partial<CameraPayload>): CameraPayload[] => {
      const cams = statusRef.current?.cameras || [];
      return cams.map((c) => {
        const out: CameraPayload = {
          id: c.id,
          name: c.name,
          sensitivity: c.sensitivity,
          preRoll: c.preRoll,
          postRoll: c.postRoll,
          enabled: c.enabled,
        };
        if (patchId && c.id === patchId && patch) Object.assign(out, patch);
        return out;
      });
    },
    [],
  );

  const saveConfig = useCallback(
    async (extra?: { cameras?: CameraPayload[] }): Promise<void> => {
      const s = statusRef.current;
      const body = {
        storagePath: pathInput,
        freeSpaceFloorGB: Number(floorInput) || (s?.freeSpaceFloorGB ?? 20),
        enabled: s ? !!s.enabled : true,
        cameras: (extra && extra.cameras) || camerasPayload(),
      };
      const r = await fetch('/api/cctv/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Save failed');
      }
      loadStatus();
    },
    [pathInput, floorInput, camerasPayload, loadStatus],
  );

  const cctvSaveStorage = () => {
    saveConfig()
      .then(() => toast('Storage settings saved', 'success'))
      .catch((e: Error) => toast(e.message || 'Save failed', 'error'));
  };

  const cctvToggleCamera = (id: string, on: boolean) => {
    saveConfig({ cameras: camerasPayload(id, { enabled: !!on }) })
      .then(() => toast(on ? 'Recording enabled' : 'Recording paused', 'info'))
      .catch((e: Error) => toast(e.message || 'Save failed', 'error'));
  };

  const cctvSetSensitivity = (id: string, val: string) => {
    saveConfig({ cameras: camerasPayload(id, { sensitivity: Number(val) }) }).catch((e: Error) =>
      toast(e.message || 'Save failed', 'error'),
    );
  };

  const cctvAddCamera = () => {
    const name = window.prompt('Camera name (e.g. Front Door):');
    if (!name) return;
    const rtsp = window.prompt('RTSP URL (e.g. rtsp://user:pass@192.168.1.50:554/stream1):');
    if (!rtsp) return;
    toast('Testing stream…', 'info');
    fetch('/api/cctv/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rtspUrl: rtsp }),
    })
      .then((r) => r.json())
      .then((res: { ok?: boolean; reason?: string }) => {
        if (!res.ok) {
          const why = res.reason === LOCAL_AGENT_REQUIRED ? 'self-hosting required' : res.reason || 'unreachable';
          toast('Stream test failed: ' + why + ' — saving anyway', 'error');
        }
        const cams = camerasPayload();
        cams.push({ name, rtspUrl: rtsp, sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true });
        return saveConfig({ cameras: cams });
      })
      .then(() => toast('Camera added', 'success'))
      .catch((e: Error) => toast(e.message || 'Could not add camera', 'error'));
  };

  const cctvShowClips = (cameraName: string) => {
    setClipsFor(cameraName);
    setClips(null);
    setClipsError('');
    setPlayUrl(null);
    fetch('/api/cctv/clips?camera=' + encodeURIComponent(cameraName))
      .then((r) => r.json())
      .then((data: ClipRow[] | { clips?: ClipRow[] }) => {
        const list = Array.isArray(data) ? data : data.clips || [];
        setClips(list);
      })
      .catch((e: Error) => setClipsError(e.message || 'error'));
  };

  const cctvPlayClip = (path: string) => {
    setPlayLoading(true);
    setPlayUrl(null);
    const url = '/api/cctv/clip?path=' + encodeURIComponent(path);
    fetch(url)
      .then((r) => r.blob())
      .then((b) => {
        setPlayUrl(URL.createObjectURL(b));
        setPlayLoading(false);
      })
      .catch(() => {
        setPlayLoading(false);
        setClipsError('Could not load clip.');
      });
  };

  if (error) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card p-6 text-sm text-[var(--red)]">Couldn’t load camera status: {error}</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card p-6 text-center text-[var(--muted)] text-sm">Loading cameras…</div>
      </div>
    );
  }

  // Free plan: gate the whole view behind an upgrade prompt.
  if (status.upgrade) {
    return <UpgradePrompt feature="cctv" />;
  }

  const st = status.storage || {};
  const cams = status.cameras || [];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div id="cctv-root" className="space-y-5">
        {/* Cloud / self-hosting banner */}
        {isCloud && (
          <div
            className="card p-4"
            style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)' }}
          >
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-cloud" style={{ color: 'var(--amber)' }} />
              <div className="text-xs">
                <div className="font-semibold mb-0.5">Camera recording requires self-hosting</div>
                A cloud instance can’t reach cameras on your home network. You can still configure cameras and
                storage here — run HomePal on your home LAN (with ffmpeg installed) to start motion recording.
              </div>
            </div>
          </div>
        )}

        {/* ffmpeg banner (self-host only; cloud shows the banner above instead) */}
        {!isCloud && !status.ffmpeg && (
          <div
            className="card p-4"
            style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)' }}
          >
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--amber)' }} />
              <div className="text-xs">
                <div className="font-semibold mb-0.5">ffmpeg not found on the HomePal host</div>
                Recording needs ffmpeg installed on the machine running HomePal. Install it, then reload.
              </div>
            </div>
          </div>
        )}

        {/* Storage */}
        <div className="card p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <i className="fa-solid fa-hard-drive" style={{ color: 'var(--accent)' }} />
            UGREEN Storage
          </h3>
          <label className="block text-xs text-[var(--muted)] mb-1">Mount path</label>
          <input
            className="input mb-3"
            id="cctv-path"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="Z:\cctv or /mnt/ugreen/cctv"
          />
          <label className="block text-xs text-[var(--muted)] mb-1">Keep free (GB)</label>
          <input
            className="input mb-3"
            id="cctv-floor"
            type="number"
            min="1"
            value={floorInput}
            onChange={(e) => setFloorInput(e.target.value)}
          />
          <div className={'text-xs mb-3 ' + (st.ok ? 'text-[var(--muted)]' : 'text-[var(--red)]')}>
            {st.ok ? 'Free now: ' + gb(st.freeGB) + ' GB' : '⚠ ' + (st.reason || 'unreachable')}
          </div>
          <button className="btn btn-primary" onClick={cctvSaveStorage}>
            <i className="fa-solid fa-floppy-disk" />
            Save storage
          </button>
        </div>

        {/* Cameras */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold flex items-center gap-2">
              <i className="fa-solid fa-video" style={{ color: 'var(--accent)' }} />
              Cameras
            </h3>
            <button className="btn btn-sm" onClick={cctvAddCamera}>
              <i className="fa-solid fa-plus" />
              Add camera
            </button>
          </div>
          {!cams.length ? (
            <div className="text-sm text-[var(--muted)]">
              No cameras yet. Add one with its RTSP URL to start motion recording.
            </div>
          ) : (
            cams.map((c) => (
              <div key={c.id} className="rounded-xl p-3 mb-2" style={{ background: 'rgba(255,255,255,.04)' }}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{c.name}</div>
                    <div className="text-[11px] text-[var(--muted)] truncate">{c.rtspMasked || 'no stream set'}</div>
                  </div>
                  <label className="text-xs flex items-center gap-1 flex-shrink-0">
                    {c.recording && <span style={{ color: 'var(--accent)' }}>● rec</span>}
                    <input
                      type="checkbox"
                      checked={!!c.enabled}
                      onChange={(e) => cctvToggleCamera(c.id, e.target.checked)}
                    />{' '}
                    on
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[11px] text-[var(--muted)]">
                  Sensitivity{' '}
                  <input
                    type="range"
                    min="0.01"
                    max="0.2"
                    step="0.01"
                    defaultValue={c.sensitivity || 0.04}
                    onChange={(e) => cctvSetSensitivity(c.id, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-sm" onClick={() => cctvShowClips(c.name)}>
                    Clips
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Clip browser */}
        <div id="cctv-clips" className="space-y-2">
          {clipsFor !== null && (
            <>
              {clipsError ? (
                <div className="card p-4 text-sm text-[var(--red)]">{clipsError}</div>
              ) : clips === null ? (
                <div className="card p-4 text-sm text-[var(--muted)]">Loading clips…</div>
              ) : (
                <div className="card p-5">
                  <h3 className="font-bold mb-3">Clips — {clipsFor}</h3>
                  {!clips.length ? (
                    <div className="text-sm text-[var(--muted)]">No recordings yet.</div>
                  ) : (
                    <>
                      {clips.map((cl, i) => {
                        const when = cl.when ? new Date(cl.when).toLocaleString() : 'clip';
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between py-1.5 border-t border-[rgba(255,255,255,.06)]"
                          >
                            <span className="text-sm">
                              {when} <span className="text-[var(--muted)] text-xs">({cl.sizeMB} MB)</span>
                            </span>
                            <button className="btn btn-sm" onClick={() => cctvPlayClip(cl.path)}>
                              Play
                            </button>
                          </div>
                        );
                      })}
                      <div id="cctv-player" className="mt-3">
                        {playLoading && <div className="text-xs text-[var(--muted)]">Loading…</div>}
                        {playUrl && (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video controls autoPlay src={playUrl} style={{ width: '100%', borderRadius: 12 }} />
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
