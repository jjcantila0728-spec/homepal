'use client';

import { useMemo, useState } from 'react';
import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { Avatar } from '@/lib/format';
import { isAdmin } from '@/lib/selectors';
import { dayNames } from '@/lib/constants';
import { ChoreRow, ShopRow, EmptyState } from '@/components/ui/Cards';
import { recommendedChores, seasonForMonth, SEASON_META } from '@/lib/recommendedChores';

// Season-aware weekly chore recommendations for a US single-family home.
// Suggestions already present in the chore list are hidden so the panel only
// shows fresh ideas. Each can be added with one tap, edited before adding, or
// ignored in favor of the user's own (via the Add button below).
function RecommendedChores() {
  const { state } = useHousehold();
  const { addRecommendedChore, openAddChore } = useActions();
  const [open, setOpen] = useState(true);

  const now = useMemo(() => new Date(), []);
  const season = seasonForMonth(now.getMonth());
  const seasonLabel = SEASON_META[season].label;

  const existing = useMemo(
    () => new Set(state.chores.map((c) => c.name.trim().toLowerCase())),
    [state.chores],
  );
  const recs = useMemo(
    () => recommendedChores(now).filter((r) => !existing.has(r.chore.name.toLowerCase())),
    [now, existing],
  );

  if (!recs.length) return null;

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <i className="fa-solid fa-wand-magic-sparkles text-[var(--accent)]" />
          Recommended for {seasonLabel}
          <span className="text-[10px] font-normal text-[var(--muted)]">· single-family home</span>
        </h3>
        <button
          className="text-[var(--muted)] hover:text-[var(--fg)] text-xs"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse recommendations' : 'Expand recommendations'}
        >
          <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
        </button>
      </div>
      {open && (
        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          {recs.map(({ season: s, chore }) => {
            const badge = s === 'all' ? null : SEASON_META[s];
            return (
              <div
                key={chore.name}
                className="flex items-center gap-3 p-2.5 rounded-xl border border-[var(--border)]"
                style={{ background: 'var(--bg2)' }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(123,140,168,.08)', color: 'var(--muted)', fontSize: 13 }}
                >
                  <i className={`fa-solid ${chore.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{chore.name}</div>
                  <div className="text-[10px] text-[var(--muted)] flex items-center gap-1.5">
                    {dayNames[chore.day]} · {chore.pts} pts
                    {badge && (
                      <span style={{ color: badge.color }}>
                        <i className={`fa-solid ${badge.icon} mr-0.5`} />
                        {badge.label}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => openAddChore(chore)}
                  aria-label={`Edit and add ${chore.name}`}
                >
                  <i className="fa-solid fa-pen" />
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => addRecommendedChore(chore)}
                  aria-label={`Add ${chore.name}`}
                >
                  <i className="fa-solid fa-plus" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chores() {
  const { state, ui } = useHousehold();
  const { openAddChore } = useActions();
  const myChores = state.chores.filter((c) => c.assignee === ui.userId);
  const allChores = isAdmin(state, ui.userId) ? state.chores : myChores;
  return (
    <>
      <RecommendedChores />
      <div className="card mb-5">
        <h3 className="font-semibold text-sm mb-3">
          <i className="fa-solid fa-trophy mr-1 text-[var(--amber)]" />
          Chore Points
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {state.members.map((m) => {
            const pts = state.chorePoints[m.id] || 0;
            return (
              <div
                key={m.id}
                className="text-center p-3 rounded-xl border border-[var(--border)]"
                style={{ background: 'var(--bg2)' }}
              >
                <div className="flex justify-center">
                  <Avatar member={m} size={32} fontSize={11} radius={9} />
                </div>
                <div className="font-semibold text-xs mt-1.5">{m.name}</div>
                <div className="text-lg font-bold" style={{ color: m.color }}>
                  {pts}
                </div>
                <div className="text-[9px] text-[var(--muted)]">points</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">This Week&apos;s Chores</h3>
          <button className="btn btn-sm btn-primary" onClick={() => openAddChore()}>
            <i className="fa-solid fa-plus" />
            Add
          </button>
        </div>
        {allChores.length ? (
          <div className="space-y-2">
            {allChores.map((c) => (
              <ChoreRow key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <EmptyState color="var(--accent)" title="No chores yet" sub="Add a chore to start earning points" />
        )}
      </div>
    </>
  );
}

function Shopping() {
  const { state } = useHousehold();
  const { openAddShop, clearChecked } = useActions();
  const checked = state.shopping.filter((s) => s.checked).length;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm">Shopping List</h3>
        <button className="btn btn-sm btn-primary" onClick={openAddShop}>
          <i className="fa-solid fa-plus" />
          Add
        </button>
      </div>
      {state.shopping.length ? (
        <div className="space-y-1">
          {state.shopping.map((s) => (
            <ShopRow key={s.id} s={s} />
          ))}
          {checked > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border)] text-xs text-[var(--muted)]">
              {checked} items checked &middot;{' '}
              <button className="text-[var(--red)] hover:underline" onClick={clearChecked}>
                Remove checked
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState color="var(--blue)" title="List is empty" sub="Add items the family needs to buy" />
      )}
    </div>
  );
}

export function Tasks() {
  const { state, ui, setUI } = useHousehold();
  const tab = ui.tasksTab;
  const pendingChores = state.chores.filter((c) => !c.done).length;
  const checkedShop = state.shopping.filter((s) => s.checked).length;
  return (
    <>
      <div className="flex gap-2 mb-5">
        <div
          className={`sec-tab ${tab === 'chores' ? 'active' : ''}`}
          onClick={() => setUI({ tasksTab: 'chores' })}
        >
          <i className="fa-solid fa-broom mr-1" />
          Chores ({pendingChores})
        </div>
        <div
          className={`sec-tab ${tab === 'shopping' ? 'active' : ''}`}
          onClick={() => setUI({ tasksTab: 'shopping' })}
        >
          <i className="fa-solid fa-cart-shopping mr-1" />
          Shopping ({state.shopping.length - checkedShop})
        </div>
      </div>
      {tab === 'chores' ? <Chores /> : <Shopping />}
    </>
  );
}
