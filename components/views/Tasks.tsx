'use client';

import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { Avatar } from '@/lib/format';
import { isAdmin } from '@/lib/selectors';
import { ChoreRow, ShopRow, EmptyState } from '@/components/ui/Cards';

function Chores() {
  const { state, ui } = useHousehold();
  const { openAddChore } = useActions();
  const myChores = state.chores.filter((c) => c.assignee === ui.userId);
  const allChores = isAdmin(state, ui.userId) ? state.chores : myChores;
  return (
    <>
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
          <button className="btn btn-sm btn-primary" onClick={openAddChore}>
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
