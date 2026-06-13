'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useHousehold } from '@/store/household';
import { Avatar } from '@/lib/format';
import { currentUser } from '@/lib/selectors';
import { VIEWS, catColors } from '@/lib/constants';
import type { HouseholdState } from '@/lib/types';

const TITLES: Record<string, string> = {
  '/app': 'Dashboard',
  '/app/schedule': 'Schedule',
  '/app/finance': 'Finance',
  '/app/home': 'Smart Home',
  '/app/cctv': 'Cameras & Storage',
  '/app/tasks': 'Tasks',
  '/app/family': 'Family',
};

interface SearchResult {
  icon: string;
  label: string;
  sub: string;
  color: string;
  go: () => void;
}

function collectResults(state: HouseholdState, q: string, router: ReturnType<typeof useRouter>): SearchResult[] {
  const ql = q.toLowerCase();
  const items: SearchResult[] = [];
  state.events.forEach((e) => {
    if ((e.title || '').toLowerCase().includes(ql) || (e.desc || '').toLowerCase().includes(ql))
      items.push({ icon: 'fa-calendar', label: e.title, sub: e.date + ' ' + e.time, color: catColors[e.cat] || '#6B7B8D', go: () => router.push('/app/schedule') });
  });
  state.transactions.forEach((t) => {
    if ((t.cat || '').toLowerCase().includes(ql) || (t.note || '').toLowerCase().includes(ql))
      items.push({ icon: t.type === 'income' ? 'fa-arrow-down' : 'fa-arrow-up', label: t.cat + ': $' + t.amount, sub: t.note || '', color: t.type === 'income' ? 'var(--accent)' : 'var(--red)', go: () => router.push('/app/finance') });
  });
  state.devices.forEach((d) => {
    if (d.name.toLowerCase().includes(ql)) items.push({ icon: d.icon, label: d.name, sub: d.type, color: '#6B7B8D', go: () => router.push('/app/home') });
  });
  state.lights.forEach((l) => {
    if (l.name.toLowerCase().includes(ql)) items.push({ icon: 'fa-lightbulb', label: l.name, sub: state.rooms.find((r) => r.id === l.room)?.name || '', color: 'var(--amber)', go: () => router.push('/app/home') });
  });
  (state.automations || []).forEach((a) => {
    if ((a.name || '').toLowerCase().includes(ql)) items.push({ icon: a.icon || 'fa-wand-magic-sparkles', label: a.name, sub: 'Automation', color: 'var(--purple)', go: () => router.push('/app/home') });
  });
  state.members.forEach((m) => {
    if (m.name.toLowerCase().includes(ql)) items.push({ icon: 'fa-user', label: m.name, sub: m.role, color: m.color, go: () => router.push('/app/family') });
  });
  return items;
}

function Clock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <span className="text-xs text-[var(--muted)] hidden lg:inline mr-1" id="live-clock">
      {time}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, ui, setUI, logout } = useHousehold();
  const pathname = usePathname();
  const router = useRouter();
  const u = currentUser(state, ui.userId);
  const pendingChores = state.chores.filter((c) => !c.done).length;
  const unseen = state.alerts.filter((a) => !a.seen).length;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const userWrapRef = useRef<HTMLDivElement>(null);

  const title = TITLES[pathname] || 'Dashboard';
  const navResults = navQuery.trim() ? collectResults(state, navQuery, router) : [];

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (userWrapRef.current && !userWrapRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [userMenuOpen]);

  // Close transient panels on navigation.
  useEffect(() => {
    setSidebarOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  const openNotif = () => setNotifOpen((o) => !o);

  const notifColors: Record<string, string> = { info: 'var(--blue)', warning: 'var(--amber)', success: 'var(--accent)', danger: 'var(--red)' };
  const notifBgs: Record<string, string> = { info: 'rgba(59,130,246,.12)', warning: 'rgba(245,158,11,.12)', success: 'rgba(16,185,129,.12)', danger: 'rgba(239,68,68,.12)' };
  const notifIcons: Record<string, string> = {
    motion: 'fa-person-walking', door: 'fa-door-open', system: 'fa-shield-halved', light: 'fa-lightbulb', climate: 'fa-temperature-half',
    device: 'fa-plug', chore: 'fa-check-circle', budget: 'fa-wallet', automation: 'fa-wand-magic-sparkles', voice: 'fa-microphone',
  };

  return (
    <div className="flex h-screen relative z-10">
      <aside id="sidebar" className={sidebarOpen ? 'open' : ''}>
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <i className="fa-solid fa-house-chimney text-white text-sm" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk'" }}>
                HomePal
              </h1>
              <p className="text-[10px] text-[var(--muted)] -mt-0.5">Family Hub</p>
            </div>
            <button className="icon-btn md:hidden" onClick={() => setSidebarOpen(false)} title="Close sidebar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 py-3" id="nav-list">
          {VIEWS.map((v) => {
            const active = pathname === v.href;
            return (
              <Link key={v.id} href={v.href} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                <i className={`fa-solid ${v.icon}`} aria-hidden="true" />
                <span>{v.label}</span>
                {v.id === 'tasks' && pendingChores > 0 && (
                  <span className="nav-badge" style={{ display: 'flex' }}>
                    {pendingChores}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[var(--border)]" id="sidebar-user">
          <div className="flex items-center gap-3">
            <Avatar member={u} size={36} fontSize={13} radius={10} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate">{u.name}</div>
              <div className="text-[10px] text-[var(--muted)] capitalize">{u.role}</div>
            </div>
            <button className="text-[var(--muted)] hover:text-[var(--red)] transition text-sm" title="Sign out" aria-label="Sign out" onClick={() => logout()}>
              <i className="fa-solid fa-right-from-bracket" />
            </button>
          </div>
        </div>
      </aside>
      <div id="sidebar-backdrop" className={sidebarOpen ? 'open' : ''} onClick={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-h-screen main-wrap">
        <header className="h-14 border-b border-[var(--border)] bg-[var(--bg2)]/80 backdrop-blur-md flex items-center gap-2 sm:gap-3 px-3 sm:px-5 flex-shrink-0 relative z-40">
          <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <button className="icon-btn md:hidden" onClick={() => setSidebarOpen((o) => !o)} title="Toggle sidebar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <h2 className="text-base font-semibold truncate" id="page-title">
              {title}
            </h2>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <Clock />
            <div className={`navsearch ${searchOpen ? 'open' : ''}`} id="navsearch-wrap">
              <input
                id="navsearch"
                className="navsearch-input"
                type="text"
                placeholder="Search…"
                autoComplete="off"
                aria-label="Search"
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                onBlur={() => setTimeout(() => { if (!navQuery.trim()) setSearchOpen(false); }, 180)}
              />
              <button
                className="icon-btn navsearch-toggle"
                onClick={() => {
                  setSearchOpen((o) => {
                    if (o) setNavQuery('');
                    return !o;
                  });
                }}
                title="Search"
                aria-label="Search"
              >
                <i className="fa-solid fa-magnifying-glass" />
              </button>
              {searchOpen && navQuery.trim() && (
                <div id="navsearch-results" className="show">
                  {navResults.length ? (
                    navResults.slice(0, 10).map((it, i) => (
                      <div
                        key={i}
                        className="search-res flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--surface)] transition"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          it.go();
                          setNavQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: it.color + '20', color: it.color, fontSize: 13 }}>
                          <i className={`fa-solid ${it.icon}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{it.label}</div>
                          <div className="text-[11px] text-[var(--muted)]">{it.sub}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-center text-xs text-[var(--muted)]">No results</div>
                  )}
                </div>
              )}
            </div>
            <button className="icon-btn" id="voice-btn" title="Voice control (Alexa / Siri compatible)">
              <i className="fa-solid fa-microphone" />
            </button>
            <button className="icon-btn" onClick={openNotif} title="Notifications" style={{ position: 'relative' }}>
              <i className="fa-regular fa-bell text-base" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--red)] rounded-full" id="notif-dot" style={{ display: unseen > 0 ? 'block' : 'none' }} />
            </button>
            <div id="user-switcher" ref={userWrapRef}>
              <button
                id="user-menu-btn"
                className="user-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  setUserMenuOpen((o) => !o);
                }}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                title="Account menu"
              >
                <Avatar member={u} size={28} fontSize={8} radius={10} />
                <span className="uc-name">{u.name}</span>
                <i className="fa-solid fa-chevron-down uc-chev" />
              </button>
              <div id="user-menu" className={`user-menu ${userMenuOpen ? 'open' : ''}`} role="menu" aria-label="Account">
                <div className="um-head">
                  <Avatar member={u} size={40} fontSize={12} radius={14} />
                  <div className="min-w-0">
                    <div className="um-name">{u.name}</div>
                    <div className="um-role">{u.role}</div>
                  </div>
                </div>
                {state.members.length > 1 && (
                  <>
                    <div className="um-section-label">Switch member</div>
                    {state.members.map((m) => {
                      const on = m.id === ui.userId;
                      return (
                        <button
                          key={m.id}
                          className="um-item"
                          role="menuitemradio"
                          aria-checked={on}
                          onClick={() => {
                            setUI({ userId: m.id });
                            setUserMenuOpen(false);
                          }}
                        >
                          <Avatar member={m} size={24} fontSize={7} radius={9} />
                          <span className="flex-1 truncate">{m.name}</span>
                          {on && <i className="fa-solid fa-check um-check" />}
                        </button>
                      );
                    })}
                  </>
                )}
                <div className="um-divider" />
                <Link href="/app/family" className="um-item" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                  <i className="fa-solid fa-users um-ic" />
                  <span>Family</span>
                </Link>
                <button className="um-item um-danger" role="menuitem" onClick={() => logout()}>
                  <i className="fa-solid fa-right-from-bracket um-ic" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </div>
          <div id="notif-panel" className={notifOpen ? 'show' : ''}>
            {notifOpen && (
              <>
                <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                  <h4 className="font-semibold text-sm">Notifications</h4>
                  <button className="text-xs text-[var(--accent)] hover:underline" onClick={() => setNotifOpen(false)}>
                    Mark all read
                  </button>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
                  {state.alerts.slice(0, 12).map((a) => (
                    <div key={a.id} className="flex gap-3 p-3 hover:bg-[var(--surface)] transition cursor-pointer border-b border-[var(--border)]">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: notifBgs[a.sev], color: notifColors[a.sev], fontSize: 13 }}>
                        <i className={`fa-solid ${notifIcons[a.type] || 'fa-bell'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{a.msg}</div>
                        <div className="text-[10px] text-[var(--muted)]">{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5 view-enter stagger" id="content">
          {children}
        </main>
      </div>
      <nav id="mobile-bar" className="fixed bottom-0 left-0 right-0 bg-[var(--bg2)] border-t border-[var(--border)] z-50 flex justify-around py-1.5">
        {VIEWS.map((v) => {
          const active = pathname === v.href;
          return (
            <Link
              key={v.id}
              href={v.href}
              className={`mob-tab flex flex-col items-center gap-0.5 ${active ? 'text-[var(--accent)]' : 'text-[var(--muted)]'} text-[10px] p-1.5`}
              aria-current={active ? 'page' : undefined}
            >
              <i className={`fa-solid ${v.icon} text-base`} aria-hidden="true" />
              {v.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
