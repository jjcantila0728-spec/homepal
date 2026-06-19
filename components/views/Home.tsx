'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { TRIGGER_TEXT, actionText } from '@/lib/automations';
import { StatCard, LightCard, LockRow, DeviceCard, SensorRow, CamCard, EmptyState } from '@/components/ui/Cards';
import { apiConnectDeako, apiDeakoDevices, apiDeakoStatus } from '@/lib/integrations/deako/deakoClientApi';
import type { DeakoDevice, DeakoStatus } from '@/lib/integrations/deako/types';
import type { Light } from '@/lib/types';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const sevColors: Record<string, string> = {
  info: 'var(--blue)',
  warning: 'var(--amber)',
  success: 'var(--accent)',
  danger: 'var(--red)',
};

// Port of startCameras()/stopCameras(): animate noise onto each active camera's
// canvas via requestAnimationFrame, refresh .cam-time spans, and cancel on cleanup.
function useCameraNoise(activeCamIds: number[]) {
  const idsKey = activeCamIds.join(',');
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!activeCamIds.length) return;
    const ids = activeCamIds;
    function draw() {
      for (let i = 0; i < ids.length; i++) {
        const cv = document.getElementById('cam-' + ids[i]) as HTMLCanvasElement | null;
        if (!cv) continue;
        const ctx = cv.getContext('2d');
        if (!ctx) continue;
        cv.width = cv.offsetWidth * 0.8;
        cv.height = cv.offsetHeight * 0.8;
        const w = cv.width;
        const h = cv.height;
        const img = ctx.createImageData(w, h);
        for (let j = 0; j < img.data.length; j += 4) {
          const v = Math.random() * 30 + 15;
          img.data[j] = v * 0.3;
          img.data[j + 1] = v * 0.85;
          img.data[j + 2] = v * 0.3;
          img.data[j + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      document.querySelectorAll('.cam-time').forEach((el) => {
        el.textContent = new Date().toLocaleTimeString();
      });
      raf.current = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      if (raf.current) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
}

// Deako Lights: connect to a gateway device on the LAN and link each discovered
// Deako device to a HomePal light (so toggling the light drives real hardware).
function DeakoCard({
  lights,
  onLink,
  savedGatewayIp,
}: {
  lights: Light[];
  onLink: (lightId: number, uuid: string) => void;
  savedGatewayIp?: string;
}) {
  const [ip, setIp] = useState(savedGatewayIp ?? '');
  const [status, setStatus] = useState<DeakoStatus | null>(null);
  const [devices, setDevices] = useState<DeakoDevice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiDeakoStatus().then(setStatus).catch(() => {});
    apiDeakoDevices()
      .then((r) => {
        if (r.connected) setDevices(r.devices);
      })
      .catch(() => {});
  }, []);

  async function connect() {
    setBusy(true);
    const res = await apiConnectDeako(ip.trim());
    setBusy(false);
    if (res.connected) {
      setDevices(res.devices ?? []);
      apiDeakoStatus().then(setStatus).catch(() => {});
    } else {
      // eslint-disable-next-line no-alert
      alert(res.error || 'Could not connect to Deako.');
    }
  }

  const connected = status?.status === 'connected';
  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">
          <i className="fa-solid fa-lightbulb mr-1 text-[var(--accent)]" />
          Deako Lights
        </h3>
        <span className="text-[11px] text-[var(--muted)]">
          {connected
            ? `Connected · ${status?.deviceCount ?? devices.length} devices`
            : status?.status === 'error'
              ? 'Error'
              : 'Not connected'}
        </span>
      </div>
      <div className="flex gap-2 mb-2">
        <input
          className="input flex-1"
          placeholder="Deako device IP (e.g. 192.168.1.50)"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {!connected && (
        <div className="text-[11px] text-[var(--muted)] mb-1">
          Deako control requires HomePal running on your home network.
          {status?.lastError ? ` (${status.lastError})` : ''}
        </div>
      )}
      {devices.length > 0 && (
        <div className="space-y-2 mt-2">
          {devices.map((dv) => {
            const linked = lights.find((l) => l.deakoUuid === dv.uuid);
            return (
              <div key={dv.uuid} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">{dv.name}</span>
                <select
                  className="input !py-1 !text-xs"
                  value={linked?.id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) onLink(Number(v), dv.uuid);
                    else if (linked) onLink(linked.id, '');
                  }}
                >
                  <option value="">— Link to light —</option>
                  {lights.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Home() {
  const { state, ui, activateScene } = useHousehold();
  const {
    openConnectDevices,
    openAddRoom,
    openAddDevice,
    setRoom,
    allLights,
    linkDeako,
    adjTemp,
    toggleThermo,
    setThermoMode,
    toggleArm,
    openAddAutomation,
    toggleAutomation,
    deleteAutomation,
    runAutomationNow,
    seedDefaults,
  } = useActions();

  const S = state;
  const rm = ui.homeRoom;

  const fL = rm === 'all' ? S.lights : S.lights.filter((l) => l.room === rm);
  const fD = rm === 'all' ? S.devices : S.devices.filter((d) => d.room === rm);
  const locks = fD.filter((d) => d.type === 'lock');
  const sensors = fD.filter((d) => d.type === 'sensor');
  const others = fD.filter((d) => ['lock', 'camera', 'sensor'].indexOf(d.type) === -1);
  const t = S.thermostat;
  const pct = t.on ? Math.min(100, Math.max(0, ((t.target - 55) / 30) * 100)) : 0;
  const lightsOn = S.lights.filter((l) => l.on).length;
  const devOn = S.devices.filter((d) => ['lock', 'sensor'].indexOf(d.type) === -1 && d.status !== 'off' && d.status !== 'inactive').length;
  const allCams = S.devices.filter((d) => d.type === 'camera');
  const allRooms = [{ id: 'all', name: 'All Rooms', icon: 'fa-house-chimney' }, ...S.rooms];
  const modes = ['cool', 'heat', 'auto'];

  const autos = S.automations || [];
  const activeAutos = autos.filter((a) => a.enabled).length;

  // Camera noise animation, restarting on room change (active cams in current filter).
  const activeCamIds = allCams.filter((c) => c.status === 'active').map((c) => c.id);
  useCameraNoise(activeCamIds);

  // Energy bar chart — last 7 days weighted from week total, today override.
  const energyData = useMemo(() => {
    const now = new Date();
    const days: string[] = [];
    const usage: number[] = [];
    const wk = +S.energy.week || 0;
    const weights = [1.05, 0.95, 1.0, 1.0, 1.1, 1.2, 0.9];
    const wsum = weights.reduce((a, b) => a + b, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push(d.toLocaleString('en', { weekday: 'short' }));
      const idx = d.getDay();
      usage.push(wk ? Math.round(((wk / wsum) * weights[idx]) * 10) / 10 : 0);
    }
    usage[6] = +S.energy.today || usage[6];
    return {
      labels: days,
      datasets: [
        {
          label: 'kWh',
          data: usage,
          backgroundColor: 'rgba(245,158,11,.55)',
          borderRadius: 5,
          borderSkipped: false as const,
        },
      ],
    };
  }, [S.energy.week, S.energy.today]);

  const energyOptions = useMemo(
    () => ({
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7B8CA8', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#7B8CA8', font: { size: 10 } }, grid: { color: 'rgba(45,59,85,.2)' } },
      },
    }),
    [],
  );

  const breakdownData = useMemo(
    () => ({
      labels: S.energy.items.map((it) => it.cat),
      datasets: [
        {
          data: S.energy.items.map((it) => it.pct),
          backgroundColor: S.energy.items.map((it) => it.color),
          borderWidth: 0,
        },
      ],
    }),
    [S.energy.items],
  );

  const breakdownOptions = useMemo(
    () => ({
      responsive: true,
      cutout: '68%',
      plugins: { legend: { display: false } },
    }),
    [],
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h3 className="text-xl font-bold">Smart Home</h3>
          <p className="text-sm text-[var(--muted)]">
            {S.devices.length + S.lights.length} devices &middot; {S.rooms.length} rooms
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-sm btn-secondary">
            <i className="fa-solid fa-microphone-lines" />
            <span className="hidden sm:inline">Voice</span>
          </button>
          <button className="btn btn-sm btn-secondary" onClick={openConnectDevices}>
            <i className="fa-solid fa-wifi" />
            <span className="hidden sm:inline">Connect Devices</span>
          </button>
          <button className="btn btn-sm btn-secondary" onClick={openAddRoom}>
            <i className="fa-solid fa-door-open" />
            <span className="hidden sm:inline">Room</span>
          </button>
          <button className="btn btn-sm btn-primary" onClick={openAddDevice}>
            <i className="fa-solid fa-plus" />
            Add Device
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          cls="cyan"
          icon="fa-lightbulb"
          iconColor="var(--amber)"
          label="Lights"
          value={
            <>
              {lightsOn}
              <span className="text-xs font-normal text-[var(--muted)]">/{S.lights.length}</span>
            </>
          }
        />
        <StatCard
          cls="emerald"
          icon="fa-plug"
          iconColor="var(--accent)"
          label="Devices"
          value={
            <>
              {devOn}
              <span className="text-xs font-normal text-[var(--muted)]"> active</span>
            </>
          }
        />
        <StatCard
          cls="red"
          icon="fa-shield-halved"
          iconColor="var(--red)"
          label="Security"
          value={
            <span className={`badge ${S.securityArmed ? 'badge-armed' : 'badge-unlocked'} text-[10px]`}>
              {S.securityArmed ? 'Armed' : 'Off'}
            </span>
          }
        />
        <StatCard
          cls="amber"
          icon="fa-bolt"
          iconColor="var(--amber)"
          label="Energy"
          value={
            <>
              {S.energy.today}
              <span className="text-xs font-normal text-[var(--muted)]"> kWh</span>
            </>
          }
        />
      </div>

      {allCams.length > 0 && (
        <div className="card mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              <i className="fa-solid fa-video mr-1 text-[var(--blue)]" />
              Security Cameras <span className="text-[var(--muted)] font-normal">({allCams.length})</span>
            </h3>
            <button className="btn btn-sm btn-secondary" onClick={openAddDevice}>
              <i className="fa-solid fa-plus" />
              Add Camera
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allCams.map((c) => (
              <CamCard key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <h3 className="font-semibold mb-3">Quick Scenes</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {S.scenes.map((sc) => (
            <div key={sc.id} className="scene-card" onClick={() => activateScene(sc.id)}>
              <div className="scene-icon" style={{ background: sc.color + '18', color: sc.color }}>
                <i className={`fa-solid ${sc.icon}`} />
              </div>
              <div className="font-semibold text-sm">{sc.name}</div>
              <div className="text-[10px] text-[var(--muted)] mt-1">{sc.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {allRooms.map((r) => (
          <div key={r.id} className={`room-tab ${rm === r.id ? 'active' : ''}`} onClick={() => setRoom(r.id)}>
            <i className={`fa-solid ${r.icon} mr-1`} />
            {r.name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="card text-center">
          <h3 className="font-semibold mb-3 text-sm">
            <i className="fa-solid fa-temperature-half mr-1 text-[var(--amber)]" />
            Climate
          </h3>
          <div className="thermo-ring" style={{ '--pct': pct } as React.CSSProperties}>
            <div className="thermo-inner">
              <div className="thermo-temp">{t.on ? t.target : '--'}°</div>
              <div className="thermo-label">{t.on ? t.mode : 'off'}</div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-3 mb-3">
            <button
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--surface2)] hover:bg-[var(--border)] transition text-base font-bold"
              onClick={() => adjTemp(-1)}
              aria-label="Lower temperature"
            >
              -
            </button>
            <div className={`toggle ${t.on ? 'on amber' : ''}`} onClick={toggleThermo} aria-label="Toggle climate" />
            <button
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--surface2)] hover:bg-[var(--border)] transition text-base font-bold"
              onClick={() => adjTemp(1)}
              aria-label="Raise temperature"
            >
              +
            </button>
          </div>
          <div className="flex justify-center gap-1.5">
            {modes.map((md) => (
              <button
                key={md}
                className={`btn btn-sm ${t.mode === md && t.on ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setThermoMode(md)}
              >
                {md.charAt(0).toUpperCase() + md.slice(1)}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-2">Current: {t.temp}°F</div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-3">
            <i className="fa-solid fa-bolt mr-1 text-[var(--amber)]" />
            Energy
          </h3>
          <div style={{ height: 170 }}>
            <Bar data={energyData} options={{ ...energyOptions, maintainAspectRatio: false }} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <div>
              <div className="text-base font-bold">{S.energy.today}</div>
              <div className="text-[9px] text-[var(--muted)]">Today</div>
            </div>
            <div>
              <div className="text-base font-bold">{S.energy.week}</div>
              <div className="text-[9px] text-[var(--muted)]">Week</div>
            </div>
            <div>
              <div className="text-base font-bold">{S.energy.month}</div>
              <div className="text-[9px] text-[var(--muted)]">Month</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-3">
            <i className="fa-solid fa-chart-pie mr-1 text-[var(--cyan)]" />
            Breakdown
          </h3>
          <div style={{ height: 170 }}>
            {S.energy.items.length > 0 ? (
              <Doughnut data={breakdownData} options={{ ...breakdownOptions, maintainAspectRatio: false }} />
            ) : null}
          </div>
          <div className="space-y-1.5 mt-2">
            {S.energy.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded" style={{ background: it.color }} />
                <span className="flex-1">{it.cat}</span>
                <span className="font-semibold">{it.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`card mb-5 ${fL.some((l) => l.on) ? 'light-on' : ''}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">
            <i className="fa-solid fa-lightbulb mr-1 text-[var(--amber)]" />
            Lights
          </h3>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-ghost" onClick={() => allLights(true)}>
              All On
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => allLights(false)}>
              All Off
            </button>
          </div>
        </div>
        {fL.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {fL.map((l) => (
              <LightCard key={l.id} l={l} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--amber)" title="No lights here yet" sub="Add a light or connect WiFi devices" />
        )}
      </div>

      <DeakoCard lights={S.lights} onLink={linkDeako} savedGatewayIp={S.integrations?.deako?.gatewayIp} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              <i className="fa-solid fa-lock mr-1 text-[var(--accent)]" />
              Security
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--muted)]">Arm</span>
              <div
                className={`toggle ${S.securityArmed ? 'on' : ''}`}
                style={{ width: 40, height: 22 }}
                onClick={toggleArm}
                aria-label="Arm security"
              />
            </div>
          </div>
          <div className="space-y-2">
            {locks.map((d) => (
              <LockRow key={d.id} d={d} />
            ))}
          </div>
          {sensors.length > 0 && (
            <>
              <h4 className="font-semibold text-xs mt-3 mb-2">
                <i className="fa-solid fa-satellite-dish mr-1 text-[var(--cyan)]" />
                Sensors
              </h4>
              <div className="space-y-1.5">
                {sensors.map((s) => (
                  <SensorRow key={s.id} s={s} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-3">
            <i className="fa-solid fa-plug mr-1 text-[var(--accent)]" />
            Devices
          </h3>
          {others.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {others.map((d) => (
                <DeviceCard key={d.id} d={d} />
              ))}
            </div>
          ) : (
            <EmptyState color="var(--accent)" title="No devices here yet" sub="Tap Connect Devices to scan your WiFi" />
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-sm mb-3">
          <i className="fa-solid fa-bell mr-1 text-[var(--amber)]" />
          Activity
        </h3>
        {S.alerts.slice(0, 6).map((a) => (
          <div key={a.id} className="alert-line">
            <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: sevColors[a.sev] }} />
            <div className="flex-1">
              <div className="text-xs">{a.msg}</div>
              <div className="text-[10px] text-[var(--muted)]">{a.time}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ===== Automations (embedded) ===== */}
      <div className="border-t border-[var(--border)] mt-6 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <i className="fa-solid fa-wand-magic-sparkles text-[var(--purple)]" />
              Automations
            </h3>
            <p className="text-sm text-[var(--muted)] mt-0.5">
              {activeAutos} of {autos.length} active · the home runs itself
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-secondary" onClick={seedDefaults} title="Restore the built-in starter automations">
              <i className="fa-solid fa-wand-magic-sparkles" />
              <span className="hidden sm:inline">Defaults</span>
            </button>
            <button className="btn btn-sm btn-primary" onClick={openAddAutomation}>
              <i className="fa-solid fa-plus" />
              New Automation
            </button>
          </div>
        </div>

        <div className="card mb-5" style={{ background: 'linear-gradient(120deg,rgba(16,185,129,.10),rgba(6,182,212,.04))' }}>
          <div className="flex items-start gap-3">
            <i className="fa-solid fa-circle-info mt-0.5 text-[var(--accent)]" />
            <div className="text-xs text-[var(--muted)] leading-relaxed">
              Automations run on any household device that has HomePal open, and stay in sync for everyone. For 24/7 triggers,
              keep a tablet or a self-hosted instance running on your home network — that same instance is what discovers and
              controls your real WiFi devices.
            </div>
          </div>
        </div>

        {autos.length === 0 ? (
          <EmptyState color="var(--purple)" title="No automations yet" sub="Create one, or tap Defaults for a head start" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {autos.map((a) => (
              <div key={a.id} className={`auto-card ${a.enabled ? '' : 'off'}`}>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(139,92,246,.15)', color: 'var(--purple)' }}
                >
                  <i className={`fa-solid ${a.icon || 'fa-wand-magic-sparkles'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-sm truncate">{a.name}</div>
                    {a.lastRun && (
                      <span className="chip" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--accent)' }}>
                        ran {a.lastRun}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    <i className="fa-solid fa-bolt text-[9px] mr-1" />
                    {TRIGGER_TEXT(a.trigger)}
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    <i className="fa-solid fa-play text-[9px] mr-1" />
                    {actionText(S, a.actions)}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button className="btn btn-sm btn-ghost" onClick={() => runAutomationNow(a.id)}>
                      <i className="fa-solid fa-play" />
                      Run
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => deleteAutomation(a.id)} aria-label={`Delete ${a.name}`}>
                      <i className="fa-solid fa-trash-can" />
                    </button>
                  </div>
                </div>
                <div
                  className={`toggle ${a.enabled ? 'on' : ''}`}
                  style={{ width: 42, height: 24 }}
                  onClick={() => toggleAutomation(a.id)}
                  aria-label={`Enable ${a.name}`}
                  aria-pressed={a.enabled}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
