'use client';

import { useHousehold } from '@/store/household';
import { useActions } from '@/hooks/useActions';
import { isAdmin } from '@/lib/selectors';
import { MemberCard } from '@/components/ui/Cards';
import type { Alert } from '@/lib/types';

const sevColors: Record<Alert['sev'], string> = {
  info: 'var(--blue)',
  warning: 'var(--amber)',
  success: 'var(--accent)',
  danger: 'var(--red)',
};

export function Family() {
  const { state, ui } = useHousehold();
  const { openAddMember, openEditFamilyName } = useActions();
  const admin = isAdmin(state, ui.userId);
  const famName = state.householdName || 'Your Family';
  const adminCount = state.members.filter((m) => m.role === 'admin').length;

  return (
    <>
      <div
        className="card mb-5"
        style={{ background: 'linear-gradient(120deg,rgba(16,185,129,.10),rgba(6,182,212,.04))' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-people-roof text-white text-lg" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold truncate">{famName}</h3>
                {admin && (
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    onClick={openEditFamilyName}
                    title="Edit family name"
                    aria-label="Edit family name"
                  >
                    <i className="fa-solid fa-pen text-xs" />
                  </button>
                )}
              </div>
              <p className="text-sm text-[var(--muted)]">
                {state.members.length} member{state.members.length === 1 ? '' : 's'} &middot; {adminCount} admin
              </p>
            </div>
          </div>
          {admin && (
            <button className="btn btn-primary btn-sm flex-shrink-0" onClick={openAddMember}>
              <i className="fa-solid fa-user-plus" />
              Add Member
            </button>
          )}
        </div>
        {!admin && (
          <p className="text-[11px] text-[var(--muted)] mt-3 pt-3 border-t border-[var(--border)]">
            <i className="fa-solid fa-circle-info mr-1" />
            You can edit your own profile. Ask a household admin to add or remove members.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {state.members.map((m) => (
          <MemberCard key={m.id} m={m} />
        ))}
      </div>

      <div className="card">
        <h3 className="font-semibold text-lg mb-4">Activity Log</h3>
        {state.alerts.slice(0, 8).map((a) => (
          <div key={a.id} className="alert-line">
            <div
              className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
              style={{ background: sevColors[a.sev] }}
            />
            <div className="flex-1">
              <div className="text-sm">{a.msg}</div>
              <div className="text-xs text-[var(--muted)]">{a.time}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
