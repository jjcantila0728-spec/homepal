'use client';

import type { ReactNode } from 'react';
import { Avatar, money, fd } from '@/lib/format';
import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { getMember, isAdmin, budgetSpent } from '@/lib/selectors';
import { catColors, statusIcons, devTypeColors, dayNames, debtMeta, ART } from '@/lib/constants';
import type {
  CalEvent,
  Transaction,
  Member,
  Light,
  Device,
  Chore,
  ShoppingItem,
  Budget,
  Savings,
  Recurring,
  Debt,
} from '@/lib/types';

// ---- helpers ----
export function Art({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function EmptyState({ color = 'var(--accent)', title, sub }: { color?: string; title: string; sub?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-art" dangerouslySetInnerHTML={{ __html: ART.empty(color) }} />
      <div className="text-sm font-semibold">{title}</div>
      {sub ? <div className="text-xs text-[var(--muted)] mt-1">{sub}</div> : null}
    </div>
  );
}

export function StatCard({
  cls,
  icon,
  iconColor,
  label,
  value,
  sub,
}: {
  cls: string;
  icon: string;
  iconColor: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className={`card stat-card ${cls}`} style={{ padding: 16 }}>
      <div className="flex items-center gap-2 mb-2">
        <i className={`fa-solid ${icon} text-sm`} style={{ color: iconColor }} aria-hidden="true" />
        <span className="text-xs text-[var(--muted)]">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub ? <div className="text-xs text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

export function EvtRow({ e }: { e: CalEvent }) {
  const { state } = useHousehold();
  const { viewEvent } = useActions();
  const m = getMember(state, e.memberId);
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-[var(--surface2)] transition cursor-pointer"
      onClick={() => viewEvent(e.id)}
    >
      <div className="w-1 h-9 rounded-full" style={{ background: catColors[e.cat] || '#6B7B8D' }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{e.title}</div>
        <div className="text-[11px] text-[var(--muted)]">
          {fd(e.date)} at {e.time}
        </div>
      </div>
      <Avatar member={m} size={26} fontSize={9} radius={7} />
    </div>
  );
}

export function TxRow({ t }: { t: Transaction }) {
  const { state, ui } = useHousehold();
  const { deleteTx } = useActions();
  const m = getMember(state, t.memberId);
  const ic = t.type === 'income' ? 'fa-arrow-down' : 'fa-arrow-up';
  const col = t.type === 'income' ? 'var(--accent)' : 'var(--red)';
  const bg = t.type === 'income' ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)';
  const sign = t.type === 'income' ? '+' : '-';
  const canDelete = isAdmin(state, ui.userId) || t.memberId === ui.userId;
  return (
    <div className="tx-row">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: bg }}>
        <i className={`fa-solid ${ic} text-xs`} style={{ color: col }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{t.cat}</div>
        <div className="text-[11px] text-[var(--muted)]">
          {(t.note || t.cat)} &middot; {fd(t.date)}
        </div>
      </div>
      <div className="text-sm font-bold" style={{ color: col }}>
        {sign}
        {money(t.amount)}
      </div>
      <Avatar member={m} size={26} fontSize={9} radius={7} />
      {canDelete && (
        <button
          className="text-[var(--muted)] hover:text-[var(--red)] transition text-xs"
          onClick={() => deleteTx(t.id)}
          aria-label="Delete transaction"
        >
          <i className="fa-solid fa-trash-can" />
        </button>
      )}
    </div>
  );
}

export function MemberCard({ m }: { m: Member }) {
  const { state, ui } = useHousehold();
  const { openEditMember } = useActions();
  const mE = state.events.filter((e) => e.memberId === m.id).length;
  const mI = state.transactions.filter((t) => t.memberId === m.id && t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const mX = state.transactions.filter((t) => t.memberId === m.id && t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const pts = state.chorePoints[m.id] || 0;
  const canEdit = isAdmin(state, ui.userId) || m.id === ui.userId;
  const editLabel = m.id === ui.userId ? 'Edit my profile' : 'Manage';
  return (
    <div className="card text-center">
      <div className="flex justify-center mb-2">
        <Avatar member={m} size={52} fontSize={17} radius={14} />
      </div>
      <h4 className="font-semibold text-lg">{m.name}</h4>
      <div className="flex items-center justify-center gap-2 mt-1 mb-3">
        <span className={`badge ${m.role === 'admin' ? 'badge-admin' : 'badge-member'}`}>{m.role}</span>
        <span className="text-xs text-[var(--muted)] capitalize">
          <i className={`fa-solid ${statusIcons[m.status] || 'fa-circle'} text-[10px]`} /> {m.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[var(--border)]">
        <div>
          <div className="text-base font-bold">{mE}</div>
          <div className="text-[9px] text-[var(--muted)]">Events</div>
        </div>
        <div>
          <div className="text-base font-bold text-[var(--accent)]">${mI.toLocaleString()}</div>
          <div className="text-[9px] text-[var(--muted)]">Income</div>
        </div>
        <div>
          <div className="text-base font-bold text-[var(--red)]">${mX.toLocaleString()}</div>
          <div className="text-[9px] text-[var(--muted)]">Expenses</div>
        </div>
      </div>
      <div className="text-xs text-[var(--muted)] mt-2">{pts} chore points</div>
      {canEdit && (
        <button className="btn btn-sm btn-secondary w-full mt-3" onClick={() => openEditMember(m.id)}>
          <i className="fa-solid fa-pen" /> {editLabel}
        </button>
      )}
    </div>
  );
}

export function LightCard({ l }: { l: Light }) {
  const { state } = useHousehold();
  const { toggleLight, setBrightness, openManageDevice } = useActions();
  const room = state.rooms.find((r) => r.id === l.room);
  const rn = room ? room.name : '';
  return (
    <div
      className={`p-3 rounded-xl border border-[var(--border)] ${l.on ? 'light-on' : ''}`}
      style={{ background: l.on ? 'rgba(245,158,11,.03)' : 'var(--bg2)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="dev-icon"
            title="Manage"
            style={{ cursor: 'pointer', background: l.on ? 'rgba(245,158,11,.12)' : 'rgba(123,140,168,.08)', width: 34, height: 34, borderRadius: 9, fontSize: 13 }}
            onClick={() => openManageDevice('light', l.id)}
            aria-label={`Manage ${l.name}`}
          >
            <i className="fa-solid fa-lightbulb" style={{ color: l.on ? 'var(--amber)' : 'var(--muted)' }} />
          </div>
          <div>
            <div className="font-medium text-xs">{l.name}</div>
            <div className="text-[10px] text-[var(--muted)]">{rn}</div>
          </div>
        </div>
        <div
          className={`toggle ${l.on ? 'on amber' : ''}`}
          style={{ width: 40, height: 22 }}
          onClick={() => toggleLight(l.id)}
          aria-label={`Toggle ${l.name}`}
          aria-pressed={l.on}
        />
      </div>
      {l.on && (
        <div className="flex items-center gap-2 mt-2">
          <i className="fa-solid fa-sun text-[10px] text-[var(--muted)]" />
          <input
            type="range"
            className="brightness-slider flex-1"
            min="5"
            max="100"
            value={l.brightness}
            onChange={(e) => setBrightness(l.id, +e.target.value)}
            aria-label={`${l.name} brightness`}
          />
          <span className="text-[10px] text-[var(--muted)] w-7 text-right">{l.brightness}%</span>
        </div>
      )}
    </div>
  );
}

export function LockRow({ d }: { d: Device }) {
  const { state } = useHousehold();
  const { toggleLock } = useActions();
  const room = state.rooms.find((r) => r.id === d.room);
  const rn = room ? room.name : '';
  const locked = d.status === 'locked';
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg2)]">
      <div className="flex items-center gap-2">
        <div
          className="dev-icon"
          style={{ background: locked ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)', width: 34, height: 34, borderRadius: 9, fontSize: 13 }}
        >
          <i className={`fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}`} style={{ color: locked ? 'var(--accent)' : 'var(--amber)' }} />
        </div>
        <div>
          <div className="font-medium text-xs">{d.name}</div>
          <div className="text-[10px] text-[var(--muted)]">{rn}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`badge ${locked ? 'badge-locked' : 'badge-unlocked'} text-[10px]`}>{d.status}</span>
        <div className={`toggle ${locked ? 'on' : ''}`} style={{ width: 40, height: 22 }} onClick={() => toggleLock(d.id)} aria-label={`Toggle ${d.name}`} />
      </div>
    </div>
  );
}

export function DeviceCard({ d }: { d: Device }) {
  const { state } = useHousehold();
  const { toggleDevice, openManageDevice } = useActions();
  const room = state.rooms.find((r) => r.id === d.room);
  const rn = room ? room.name : '';
  const isOn = d.status !== 'off' && d.status !== 'inactive';
  const tc = devTypeColors[d.type] || '#6B7280';
  return (
    <div className="p-3 rounded-xl border border-[var(--border)]" style={{ background: isOn ? tc + '06' : 'var(--bg2)' }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div
            className="dev-icon"
            title="Manage"
            style={{ cursor: 'pointer', background: isOn ? tc + '18' : 'rgba(123,140,168,.08)', color: isOn ? tc : 'var(--muted)', width: 34, height: 34, borderRadius: 9, fontSize: 13 }}
            onClick={() => openManageDevice('device', d.id)}
            aria-label={`Manage ${d.name}`}
          >
            <i className={`fa-solid ${d.icon}`} />
          </div>
          <div>
            <div className="font-medium text-xs">{d.name}</div>
            <div className="text-[10px] text-[var(--muted)]">
              {rn}
              {d.ip ? ' · ' + d.ip : ''}
            </div>
          </div>
        </div>
        <div className={`toggle ${isOn ? 'on' : ''}`} style={{ width: 40, height: 22 }} onClick={() => toggleDevice(d.id)} aria-label={`Toggle ${d.name}`} />
      </div>
      <span className={`badge ${isOn ? 'badge-on' : 'badge-off'} text-[10px]`}>{d.status}</span>
      {d.source === 'discovered' && (
        <span className="badge badge-active text-[10px] ml-1">
          <i className="fa-solid fa-wifi text-[8px]" /> linked
        </span>
      )}
    </div>
  );
}

export function SensorRow({ s }: { s: Device }) {
  const { state } = useHousehold();
  const { toggleSensor } = useActions();
  const room = state.rooms.find((r) => r.id === s.room);
  const active = s.status === 'active';
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg2)]">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: active ? 'rgba(6,182,212,.12)' : 'rgba(239,68,68,.12)' }}>
          <i className={`fa-solid ${s.icon} text-[11px]`} style={{ color: active ? 'var(--cyan)' : 'var(--red)' }} />
        </div>
        <div>
          <div className="text-xs font-medium">{s.name}</div>
          <div className="text-[9px] text-[var(--muted)]">{room ? room.name : ''}</div>
        </div>
      </div>
      <div className={`toggle ${active ? 'on' : ''}`} style={{ width: 38, height: 20 }} onClick={() => toggleSensor(s.id)} aria-label={`Toggle ${s.name}`} />
    </div>
  );
}

export function CamCard({ c }: { c: Device }) {
  if (c.status !== 'active') {
    return (
      <div className="cam-feed">
        <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--muted)] text-xs gap-1">
          <i className="fa-solid fa-video-slash text-lg" />
          <span>{c.name} — Off</span>
        </div>
        <div className="cam-label">
          <span>{c.name}</span>
        </div>
      </div>
    );
  }
  const tag = c.brand ? c.brand.toUpperCase() : 'SIMULATED';
  const sub = c.name + (c.camType ? ' · ' + c.camType : '');
  return (
    <div className="cam-feed">
      {c.stream ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.stream} alt={`${c.name} feed`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <canvas id={`cam-${c.id}`} width={320} height={200} style={{ display: 'none', position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </>
      ) : (
        <canvas id={`cam-${c.id}`} width={320} height={200} />
      )}
      <div className="cam-rec">REC</div>
      <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,.55)', letterSpacing: 1 }}>{tag}</div>
      <div className="cam-label">
        <span>{sub}</span>
        <span className="cam-time" />
      </div>
    </div>
  );
}

export function ChoreRow({ c }: { c: Chore }) {
  const { state } = useHousehold();
  const { toggleChore } = useActions();
  const m = getMember(state, c.assignee);
  return (
    <div className={`chore-row ${c.done ? 'done' : ''}`}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: c.done ? 'rgba(16,185,129,.12)' : 'rgba(123,140,168,.08)', color: c.done ? 'var(--accent)' : 'var(--muted)', fontSize: 13 }}
      >
        <i className={`fa-solid ${c.done ? 'fa-check' : c.icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="chore-name font-medium text-sm">{c.name}</div>
        <div className="text-[10px] text-[var(--muted)]">
          {dayNames[c.day]} &middot; {c.pts} pts
        </div>
      </div>
      <Avatar member={m} size={26} fontSize={9} radius={7} />
      <div className={`toggle ${c.done ? 'on' : ''}`} style={{ width: 40, height: 22 }} onClick={() => toggleChore(c.id)} aria-label={`Toggle ${c.name}`} />
    </div>
  );
}

export function ShopRow({ s }: { s: ShoppingItem }) {
  const { toggleShop, deleteShop } = useActions();
  return (
    <div className="shop-item">
      <div className={`shop-check ${s.checked ? 'on' : ''}`} onClick={() => toggleShop(s.id)} aria-label={`Toggle ${s.name}`}>
        {s.checked && <i className="fa-solid fa-check text-[10px] text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${s.checked ? 'line-through text-[var(--muted)]' : ''}`}>{s.name}</span>
        <span className="text-[10px] text-[var(--muted)] ml-2">{s.qty}</span>
      </div>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface2)] text-[var(--muted)]">{s.cat}</span>
      <button className="text-[var(--muted)] hover:text-[var(--red)] text-xs ml-1" onClick={() => deleteShop(s.id)} aria-label={`Remove ${s.name}`}>
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

export function BudgetCard({ b }: { b: Budget }) {
  const { state } = useHousehold();
  const spent = budgetSpent(state, b.cat);
  const pct = Math.min(100, Math.round((spent / b.limit) * 100));
  const col = pct >= 100 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--accent)';
  return (
    <div className="p-3 rounded-xl bg-[var(--bg2)]">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-medium">{b.cat}</span>
        <span style={{ color: col }}>{pct}%</span>
      </div>
      <div className="prog-bar">
        <div className="prog-fill" style={{ width: pct + '%', background: col }} />
      </div>
      <div className="text-[10px] text-[var(--muted)] mt-1">
        {money(spent)} / {money(b.limit)}
        {spent > b.limit && (
          <>
            {' '}
            &middot; <span style={{ color: 'var(--red)' }}>over</span>
          </>
        )}
      </div>
    </div>
  );
}

export function SavingsCard({ s }: { s: Savings }) {
  const { addToSavings } = useActions();
  const pct = Math.round((s.current / s.target) * 100);
  const circ = 2 * Math.PI * 38;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="text-center p-4 rounded-xl border border-[var(--border)]" style={{ background: 'var(--bg2)', position: 'relative' }}>
      <svg width="90" height="90" className="mx-auto mb-2" aria-hidden="true">
        <circle cx="45" cy="45" r="38" fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle
          className="progress-ring"
          cx="45"
          cy="45"
          r="38"
          fill="none"
          stroke={s.color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div style={{ position: 'absolute', top: 38, left: '50%', transform: 'translateX(-50%)' }}>
        <i className={`fa-solid ${s.icon}`} style={{ color: s.color, fontSize: 14 }} />
      </div>
      <div className="font-semibold text-sm mt-1">{s.name}</div>
      <div className="text-lg font-bold" style={{ color: s.color }}>
        ${s.current.toLocaleString()}
      </div>
      <div className="text-[11px] text-[var(--muted)]">
        of ${s.target.toLocaleString()} ({pct}%)
      </div>
      <button className="btn btn-sm btn-secondary w-full mt-2" onClick={() => addToSavings(s.id)}>
        <i className="fa-solid fa-plus" />
        Add
      </button>
    </div>
  );
}

export function RecurringCard({ r }: { r: Recurring }) {
  const { payRecurring, deleteRecurring } = useActions();
  const isBill = r.kind !== 'income';
  const col = isBill ? 'var(--red)' : 'var(--accent)';
  const icon = isBill ? 'fa-file-invoice-dollar' : 'fa-arrow-down';
  const dd = new Date(r.next + 'T00:00:00');
  const n = new Date();
  const days = Math.round((dd.getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86400000);
  const due = isNaN(days) ? '' : days < 0 ? 'Overdue' : days === 0 ? 'Due today' : days === 1 ? 'Tomorrow' : 'in ' + days + ' days';
  const dueCol = days <= 0 ? 'var(--red)' : days <= 3 ? 'var(--amber)' : 'var(--muted)';
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg2)]">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: col + '14', color: col }}>
        <i className={`fa-solid ${icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">
          {r.name}
          {r.autopay && <span className="badge badge-on text-[9px]"> auto</span>}
        </div>
        <div className="text-[11px] text-[var(--muted)] capitalize">
          {r.freq} &middot; {r.cat} &middot; <span style={{ color: dueCol }}>{due}</span>
        </div>
      </div>
      <div className="text-sm font-bold whitespace-nowrap" style={{ color: col }}>
        {isBill ? '-' : '+'}
        {money(r.amount)}
      </div>
      <button className="btn btn-sm btn-secondary" onClick={() => payRecurring(r.id)}>
        {isBill ? 'Pay' : 'Post'}
      </button>
      <button className="text-[var(--muted)] hover:text-[var(--red)] text-xs" onClick={() => deleteRecurring(r.id)} aria-label={`Remove ${r.name}`}>
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

export function DebtCard({ d }: { d: Debt }) {
  const { openPayDebt, deleteDebt } = useActions();
  const meta = debtMeta[d.kind] || debtMeta.personal;
  const isCard = d.kind === 'credit_card' || !!d.limit;
  const util = isCard && d.limit ? Math.min(100, Math.round((d.balance / d.limit) * 100)) : null;
  const dd = new Date(d.due + 'T00:00:00');
  const n = new Date();
  const days = Math.round((dd.getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86400000);
  const dueTxt = isNaN(days) ? '' : days < 0 ? 'Overdue' : days === 0 ? 'Due today' : 'Due in ' + days + 'd';
  const dueCol = days <= 0 ? 'var(--red)' : days <= 5 ? 'var(--amber)' : 'var(--muted)';
  return (
    <div className="p-4 rounded-xl border border-[var(--border)]" style={{ background: 'var(--bg2)' }}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: meta.color + '18', color: meta.color }}>
          <i className={`fa-solid ${meta.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{d.name}</div>
          <div className="text-[10px] text-[var(--muted)]">
            {meta.label} &middot; {d.apr}% APR
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold" style={{ color: meta.color }}>
            {money(d.balance)}
          </div>
          <div className="text-[10px] text-[var(--muted)]">balance</div>
        </div>
      </div>
      {util != null ? (
        <>
          <div className="prog-bar mb-1">
            <div className="prog-fill" style={{ width: util + '%', background: util > 70 ? 'var(--red)' : util > 30 ? 'var(--amber)' : 'var(--accent)' }} />
          </div>
          <div className="flex justify-between text-[10px] text-[var(--muted)] mb-3">
            <span>
              {util}% of {money(d.limit!)}
            </span>
            <span>{money(Math.max(0, d.limit! - d.balance))} available</span>
          </div>
        </>
      ) : (
        <div className="mb-3" />
      )}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-[var(--muted)]">
          Min {money(d.minPayment)}
          {dueTxt && (
            <>
              {' '}
              &middot; <span style={{ color: dueCol }}>{dueTxt}</span>
            </>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn btn-sm btn-primary" onClick={() => openPayDebt(d.id)}>
            Pay
          </button>
          <button className="text-[var(--muted)] hover:text-[var(--red)] text-xs" onClick={() => deleteDebt(d.id)} aria-label={`Remove ${d.name}`}>
            <i className="fa-solid fa-trash-can" />
          </button>
        </div>
      </div>
    </div>
  );
}
