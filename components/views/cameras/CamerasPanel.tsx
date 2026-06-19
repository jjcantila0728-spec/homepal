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
  brand?: 'tapo' | 'onvif' | 'generic';
  host?: string;
  username?: string;
  password?: string;
  streamQuality?: 'hd' | 'sd';
}

// The modal exposes a friendly brand union; 'adt' maps to the generic/onvif
// adapter on the wire (many ADT cameras don't expose RTSP/ONVIF — best-effort).
type UiBrand = 'tapo' | 'adt' | 'generic';
function brandWire(b: UiBrand): 'tapo' | 'onvif' | 'generic' {
  return b === 'tapo' ? 'tapo' : 'generic';
}

const LOCAL_AGENT_REQUIRED = 'local-agent-required';

function gb(n: number | undefined | null): string | number {
  return n === undefined || n === null ? '—' : n;
}

export function CamerasPanel() {
  const { toast, showModal, hideModal } = useHousehold();
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

  // Submit handler for the Add Camera modal: sends brand fields (not a hand-built
  // URL) to /test then /config, so the server derives + encrypts the rtsp URL.
  const submitAddCamera = useCallback(
    async (form: {
      name: string;
      brand: UiBrand;
      host: string;
      username: string;
      password: string;
      streamQuality: 'hd' | 'sd';
      rtspUrl: string;
    }): Promise<void> => {
      const wire = brandWire(form.brand);
      const fields: Partial<CameraPayload> & { brand: 'tapo' | 'onvif' | 'generic' } =
        wire === 'tapo'
          ? { brand: wire, host: form.host, username: form.username, password: form.password, streamQuality: form.streamQuality }
          : form.rtspUrl.trim()
            ? { brand: wire, rtspUrl: form.rtspUrl.trim() }
            : { brand: wire, host: form.host, username: form.username, password: form.password };
      toast('Testing stream…', 'info');
      const t = await fetch('/api/cctv/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
        .then((r) => r.json())
        .catch(() => ({ ok: false }));
      if (!t.ok) {
        const why = t.reason === LOCAL_AGENT_REQUIRED ? 'self-hosting required' : t.reason || 'unreachable';
        toast('Stream test failed: ' + why + ' — saving anyway', 'error');
      }
      const cams = camerasPayload();
      cams.push({ name: form.name || 'Camera', sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true, ...fields } as CameraPayload);
      await saveConfig({ cameras: cams })
        .then(() => {
          toast('Camera added', 'success');
          hideModal();
        })
        .catch((e: Error) => toast(e.message || 'Could not add camera', 'error'));
    },
    [camerasPayload, saveConfig, toast, hideModal],
  );

  const cctvAddCamera = () => showModal(<AddCameraModal onClose={hideModal} onSubmit={submitAddCamera} />);

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
                  <div className="text-xs flex items-center gap-2 flex-shrink-0">
                    {c.recording && <span style={{ color: 'var(--accent)' }}>● rec</span>}
                    <div
                      className={`toggle ${c.enabled ? 'on' : ''}`}
                      style={{ width: 40, height: 22 }}
                      onClick={() => cctvToggleCamera(c.id, !c.enabled)}
                      aria-label={`Recording for ${c.name}`}
                      aria-pressed={!!c.enabled}
                    />
                  </div>
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

// Brand-aware Add Camera form, rendered into the app's global ModalHost via
// showModal. Mirrors the app's modal markup (header + close, .input fields,
// btn btn-primary). Submits friendly brand fields — the server derives the URL.
function AddCameraModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (form: {
    name: string;
    brand: UiBrand;
    host: string;
    username: string;
    password: string;
    streamQuality: 'hd' | 'sd';
    rtspUrl: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState<UiBrand>('tapo');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [streamQuality, setStreamQuality] = useState<'hd' | 'sd'>('hd');
  const [rtspUrl, setRtspUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    await onSubmit({ name, brand, host, username, password, streamQuality, rtspUrl });
    setBusy(false);
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">Add Camera</h3>
        <button className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={onClose} aria-label="Close">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Front Door" />
        </div>
        <div>
          <label>Brand</label>
          <select className="input" value={brand} onChange={(e) => setBrand(e.target.value as UiBrand)}>
            <option value="tapo">Tapo</option>
            <option value="adt">ADT (experimental)</option>
            <option value="generic">Generic ONVIF</option>
          </select>
        </div>

        {brand === 'tapo' ? (
          <>
            <div>
              <label>Camera IP / host</label>
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Camera username</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label>Camera password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div>
              <label>Quality</label>
              <select className="input" value={streamQuality} onChange={(e) => setStreamQuality(e.target.value as 'hd' | 'sd')}>
                <option value="hd">HD (stream1)</option>
                <option value="sd">SD (stream2)</option>
              </select>
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              Use the camera account you created in the Tapo app, not your Tapo login.
            </div>
          </>
        ) : (
          <>
            <div>
              <label>Stream URL (rtsp://)</label>
              <input
                className="input"
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                placeholder="rtsp://user:pass@192.168.1.50:554/stream"
              />
            </div>
            <div className="text-[11px] text-[var(--muted)]">— or — provide host + credentials below</div>
            <div>
              <label>Camera IP / host</label>
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Username</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label>Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div
              className="text-[11px] p-2 rounded-lg"
              style={{ border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.08)', color: 'var(--amber)' }}
            >
              Experimental — many ADT cameras don’t expose RTSP/ONVIF.
            </div>
          </>
        )}

        <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
          {busy ? 'Adding…' : 'Add Camera'}
        </button>
      </div>
    </div>
  );
}
