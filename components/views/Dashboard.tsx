'use client';

import { useEffect } from 'react';
import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { Avatar, ds, money } from '@/lib/format';
import { currentUser } from '@/lib/selectors';
import { statusIcons, ART } from '@/lib/constants';
import { StatCard, EvtRow, BudgetCard, EmptyState } from '@/components/ui/Cards';

// Animate every .counter span from 0 to its data-target (mirrors initCounters()).
function useCounters(deps: unknown[]) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.counter');
    const timers: ReturnType<typeof setInterval>[] = [];
    els.forEach((el) => {
      const t = +(el.dataset.target || '0');
      const p = el.dataset.prefix || '';
      let c = 0;
      const step = Math.max(1, Math.ceil(t / 35));
      const timer = setInterval(() => {
        c += step;
        if (c >= t) {
          c = t;
          clearInterval(timer);
        }
        el.textContent = p + c.toLocaleString();
      }, 25);
      timers.push(timer);
    });
    return () => timers.forEach(clearInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function Dashboard() {
  const { state, ui, setUI, activateScene, update } = useHousehold();
  const { openAddEvent, payRecurring } = useActions();
  const u = currentUser(state, ui.userId);

  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  const todayEvts = state.events.filter((e) => e.date === ds());
  const totalInc = state.transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExp = state.transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const bal = totalInc - totalExp;
  const lightsOn = state.lights.filter((l) => l.on).length;
  const pendingChores = state.chores.filter((c) => !c.done).length;
  const w = state.weather;
  const country = state.location?.country;

  // Realtime weather: geolocate the browser, fetch live conditions, and refresh
  // every 10 minutes. Falls back to the family location's country when the user
  // denies geolocation. Failures leave the existing weather untouched.
  useEffect(() => {
    let cancelled = false;

    const apply = (qs: string) => {
      fetch(`/api/weather?${qs}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && !cancelled && data.temp != null) update((d) => { d.weather = data; });
        })
        .catch(() => {});
    };

    const load = () => {
      const fallback = () => apply(country ? `country=${encodeURIComponent(country)}` : '');
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => apply(`lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`),
          () => fallback(),
          { timeout: 8000, maximumAge: 600_000 },
        );
      } else {
        fallback();
      }
    };

    load();
    const id = setInterval(load, 600_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const upEvts = state.events
    .filter((e) => e.date >= ds())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 5);

  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueSoon = (state.recurring || [])
    .map((r) => ({ r, d: Math.round((new Date(r.next + 'T00:00:00').getTime() - todayMid.getTime()) / 86400000) }))
    .filter((x) => x.r.kind !== 'income' && x.d <= 7)
    .sort((a, b) => a.d - b.d);

  useCounters([todayEvts.length, bal, pendingChores]);

  return (
    <>
      <div className="hero">
        <div className="hero-grid">
          <div className="hero-copy flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-[var(--accent)] uppercase mb-1">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <h2 className="text-2xl font-bold">
                {greeting},<br className="sm:hidden" /> <span className="grad-text">{u.name}</span>
              </h2>
            </div>
            {w && w.temp != null && w.temp !== '--' && (
              <div className="card flex items-center gap-4" style={{ padding: '14px 18px', minWidth: 260 }}>
                <div className="text-3xl" style={{ color: 'var(--amber)' }}>
                  <i className={`fa-solid ${w.icon}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{w.temp}°</span>
                    {w.city && <span className="text-xs text-[var(--muted)]">{w.city}</span>}
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      <span className="pulse-dot" style={{ width: 6, height: 6 }} />
                      Live
                    </span>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {w.cond} &middot; H:{w.hi}° L:{w.lo}°
                  </div>
                </div>
                <div className="flex gap-3">
                  {w.forecast.map((f, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[10px] text-[var(--muted)]">{f.day}</div>
                      <i className={`fa-solid ${f.icon} text-xs my-0.5`} style={{ color: 'var(--amber)' }} />
                      <div className="text-[10px]">{f.hi}°</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="hero-art" dangerouslySetInnerHTML={{ __html: ART.home() }} />
        </div>
      </div>

      <div className="flex gap-3 mb-5 overflow-x-auto pb-1">
        {state.scenes.map((sc) => (
          <button key={sc.id} className="btn btn-ghost flex-shrink-0" onClick={() => activateScene(sc.id)}>
            <i className={`fa-solid ${sc.icon}`} style={{ color: sc.color }} />
            {sc.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          cls="emerald"
          icon="fa-calendar-check"
          iconColor="var(--accent)"
          label="Today's Events"
          value={<span className="counter" data-target={todayEvts.length}>0</span>}
        />
        <StatCard
          cls="amber"
          icon="fa-wallet"
          iconColor="var(--amber)"
          label="Balance"
          value={
            <span className="grad-text counter" data-target={bal} data-prefix="$">
              $0
            </span>
          }
        />
        <StatCard
          cls="cyan"
          icon="fa-lightbulb"
          iconColor="var(--cyan)"
          label="Home"
          value={
            <>
              {lightsOn} lights &middot;{' '}
              <span className={`badge ${state.securityArmed ? 'badge-armed' : 'badge-unlocked'} text-[10px]`}>{state.securityArmed ? 'Armed' : 'Off'}</span>
            </>
          }
        />
        <StatCard
          cls="purple"
          icon="fa-list-check"
          iconColor="var(--purple)"
          label="Pending"
          value={<span className="counter" data-target={pendingChores}>0</span>}
          sub="chores left"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Upcoming Events</h3>
            <button className="btn btn-sm btn-primary" onClick={openAddEvent}>
              <i className="fa-solid fa-plus" />
              Add
            </button>
          </div>
          <div className="space-y-1.5">
            {upEvts.length ? (
              upEvts.map((e) => <EvtRow key={e.id} e={e} />)
            ) : (
              <EmptyState color="var(--accent)" title="No upcoming events" sub="Tap Add to plan something together" />
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="card">
            <h3 className="font-semibold mb-3">Family</h3>
            {state.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar member={m} size={30} fontSize={10} radius={8} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-[10px] text-[var(--muted)] capitalize">
                    <i className={`fa-solid ${statusIcons[m.status] || 'fa-circle'} text-[8px]`} /> {m.status}
                  </div>
                </div>
                <span className={`badge ${m.role === 'admin' ? 'badge-admin' : 'badge-member'} text-[10px]`}>{m.role}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Chore Points</h3>
              <button className="text-xs text-[var(--accent)] hover:underline" onClick={() => setUI({ tasksTab: 'chores' })}>
                View All
              </button>
            </div>
            {state.members.map((pm) => {
              const pts = state.chorePoints[pm.id] || 0;
              return (
                <div key={pm.id} className="flex items-center gap-2 mb-2">
                  <Avatar member={pm} size={22} fontSize={8} radius={6} />
                  <div className="flex-1">
                    <div className="prog-bar">
                      <div className="prog-fill" style={{ width: Math.min(100, pts) + '%', background: pm.color }} />
                    </div>
                  </div>
                  <span className="text-xs font-bold" style={{ color: pm.color }}>
                    {pts}
                  </span>
                </div>
              );
            })}
          </div>

          {dueSoon.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">
                  <i className="fa-solid fa-file-invoice-dollar mr-1 text-[var(--amber)]" />
                  Bills Due Soon
                </h3>
                <span className="text-xs text-[var(--muted)]">All</span>
              </div>
              {dueSoon.slice(0, 4).map(({ r: bd, d: bdd }) => {
                const lbl = bdd < 0 ? 'Overdue' : bdd === 0 ? 'Today' : bdd === 1 ? 'Tomorrow' : bdd + 'd';
                const lc = bdd <= 0 ? 'var(--red)' : bdd <= 3 ? 'var(--amber)' : 'var(--muted)';
                return (
                  <div key={bd.id} className="flex items-center gap-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{bd.name}</div>
                      <div className="text-[10px]" style={{ color: lc }}>
                        {lbl}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-[var(--red)]">{money(bd.amount)}</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => payRecurring(bd.id)}>
                      Pay
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card mt-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Budget Overview</h3>
          <span className="text-xs text-[var(--muted)]">Details</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {state.budgets.map((b) => (
            <BudgetCard key={b.cat} b={b} />
          ))}
        </div>
      </div>
    </>
  );
}
