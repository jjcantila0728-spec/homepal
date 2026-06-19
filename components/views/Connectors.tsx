'use client';

import { useState } from 'react';
import { useHousehold } from '@/store/household';
import { currentUser } from '@/lib/selectors';
import { connectorProviders, type ConnectorProvider } from '@/lib/constants';
import { Avatar } from '@/lib/format';
import type { Connection, ConnectorKind } from '@/lib/types';

const KIND_META: Record<ConnectorKind, { title: string; sub: string; icon: string; color: string; syncedLabel: string }> = {
  calendar: {
    title: 'Work Schedule',
    sub: 'Link your work calendars so shifts and meetings flow straight into the household Schedule.',
    icon: 'fa-calendar-days',
    color: 'var(--blue)',
    syncedLabel: 'events',
  },
  bank: {
    title: 'Bank Accounts',
    sub: 'Securely connect your accounts so balances and transactions keep Finance up to date.',
    icon: 'fa-building-columns',
    color: 'var(--accent)',
    syncedLabel: 'transactions',
  },
};

function providerOf(id: string): ConnectorProvider | undefined {
  return connectorProviders.find((p) => p.id === id);
}

// Believable "items pulled" count so the mock sync feels alive.
function pseudoCount(seed: number, kind: ConnectorKind): number {
  const base = kind === 'calendar' ? 6 : 14;
  return base + ((seed * 7) % (kind === 'calendar' ? 12 : 31));
}

export function Connectors() {
  const { state, ui, update, toast, showModal, hideModal } = useHousehold();
  const me = currentUser(state, ui.userId);
  const mine = (state.connectors || []).filter((c) => c.memberId === ui.userId);
  const connectedIds = new Set(mine.map((c) => c.providerId));

  function connect(provider: ConnectorProvider, account: string) {
    const acct = account.trim() || provider.accountHint;
    update((d) => {
      if (!d.connectors) d.connectors = [];
      const id = ++d.nid;
      d.connectors.push({
        id,
        memberId: ui.userId,
        providerId: provider.id,
        kind: provider.kind,
        account: acct,
        status: 'connected',
        autoSync: true,
        lastSync: 'Just now',
        synced: pseudoCount(id, provider.kind),
      });
      d.alerts.unshift({
        id: ++d.nid,
        type: provider.kind === 'calendar' ? 'system' : 'budget',
        msg: `${me.name} connected ${provider.name}`,
        time: 'Just now',
        sev: 'success',
        seen: false,
      });
    });
    hideModal();
    toast(`${provider.name} connected`, 'success');
  }

  function disconnect(c: Connection) {
    const p = providerOf(c.providerId);
    update((d) => {
      d.connectors = (d.connectors || []).filter((x) => x.id !== c.id);
    });
    toast(`${p?.name || 'Account'} disconnected`, 'warning');
  }

  function syncNow(c: Connection) {
    const p = providerOf(c.providerId);
    update((d) => {
      const conn = (d.connectors || []).find((x) => x.id === c.id);
      if (!conn) return;
      conn.lastSync = 'Just now';
      conn.status = 'connected';
      conn.synced = pseudoCount(conn.id + (conn.synced % 5) + 1, conn.kind);
    });
    toast(`${p?.name || 'Account'} synced`, 'success');
  }

  function toggleAuto(c: Connection) {
    update((d) => {
      const conn = (d.connectors || []).find((x) => x.id === c.id);
      if (conn) conn.autoSync = !conn.autoSync;
    });
  }

  function openConnect(provider: ConnectorProvider) {
    showModal(<ConnectModal provider={provider} onConnect={connect} onClose={hideModal} />);
  }

  return (
    <>
      <div
        className="card mb-5"
        style={{ background: 'linear-gradient(120deg,rgba(59,130,246,.10),rgba(16,185,129,.05))' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-plug-circle-bolt text-white text-lg" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl font-bold truncate">Connectors</h3>
              <p className="text-sm text-[var(--muted)]">
                Link your accounts to keep Schedule &amp; Finance updated automatically.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 bg-[var(--surface)] rounded-xl px-3 py-2 border border-[var(--border)]">
            <Avatar member={me} size={28} fontSize={9} radius={9} />
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{me.name}</div>
              <div className="text-[10px] text-[var(--muted)]">{mine.length} connected</div>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-[var(--muted)] mt-3 pt-3 border-t border-[var(--border)]">
          <i className="fa-solid fa-shield-halved mr-1" />
          You manage only your own connections. Switch member from the avatar menu to manage someone else&apos;s.
        </p>
      </div>

      <Section
        kind="calendar"
        connections={mine.filter((c) => c.kind === 'calendar')}
        connectedIds={connectedIds}
        onConnect={openConnect}
        onDisconnect={disconnect}
        onSync={syncNow}
        onToggleAuto={toggleAuto}
      />
      <Section
        kind="bank"
        connections={mine.filter((c) => c.kind === 'bank')}
        connectedIds={connectedIds}
        onConnect={openConnect}
        onDisconnect={disconnect}
        onSync={syncNow}
        onToggleAuto={toggleAuto}
      />
    </>
  );
}

function Section({
  kind,
  connections,
  connectedIds,
  onConnect,
  onDisconnect,
  onSync,
  onToggleAuto,
}: {
  kind: ConnectorKind;
  connections: Connection[];
  connectedIds: Set<string>;
  onConnect: (p: ConnectorProvider) => void;
  onDisconnect: (c: Connection) => void;
  onSync: (c: Connection) => void;
  onToggleAuto: (c: Connection) => void;
}) {
  const meta = KIND_META[kind];
  const available = connectorProviders.filter((p) => p.kind === kind && !connectedIds.has(p.id));

  return (
    <div className="card mb-5">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: meta.color + '20', color: meta.color }}
        >
          <i className={`fa-solid ${meta.icon}`} />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-lg leading-tight">{meta.title}</h3>
          <p className="text-xs text-[var(--muted)]">{meta.sub}</p>
        </div>
      </div>

      {connections.length > 0 && (
        <div className="space-y-2 mb-4">
          {connections.map((c) => (
            <ConnectionRow
              key={c.id}
              c={c}
              syncedLabel={meta.syncedLabel}
              onDisconnect={onDisconnect}
              onSync={onSync}
              onToggleAuto={onToggleAuto}
            />
          ))}
        </div>
      )}

      {available.length > 0 && (
        <>
          {connections.length > 0 && (
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-2 mt-1">Add another</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {available.map((p) => (
              <button
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] transition text-left"
                onClick={() => onConnect(p)}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: p.color + '22', color: p.color }}
                >
                  <i className={p.icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-[var(--muted)] truncate">{p.blurb}</div>
                </div>
                <i className="fa-solid fa-plus text-[var(--muted)] text-xs flex-shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}

      {connections.length === 0 && available.length === 0 && (
        <p className="text-sm text-[var(--muted)] text-center py-4">Everything available is connected.</p>
      )}
    </div>
  );
}

function ConnectionRow({
  c,
  syncedLabel,
  onDisconnect,
  onSync,
  onToggleAuto,
}: {
  c: Connection;
  syncedLabel: string;
  onDisconnect: (c: Connection) => void;
  onSync: (c: Connection) => void;
  onToggleAuto: (c: Connection) => void;
}) {
  const p = providerOf(c.providerId);
  const color = p?.color || 'var(--accent)';
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: color + '22', color }}
      >
        <i className={p?.icon || 'fa-solid fa-link'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{p?.name || 'Connected account'}</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,.15)', color: 'var(--accent)' }}>
            <i className="fa-solid fa-circle-check" /> Connected
          </span>
        </div>
        <div className="text-[11px] text-[var(--muted)] truncate">
          {c.account} &middot; {c.synced} {syncedLabel} &middot; synced {c.lastSync}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <label
          className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer mr-1 select-none"
          title="Keep this account syncing automatically"
        >
          <input type="checkbox" checked={c.autoSync} onChange={() => onToggleAuto(c)} style={{ width: 'auto' }} />
          <span className="hidden sm:inline">Auto</span>
        </label>
        <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => onSync(c)} title="Sync now" aria-label="Sync now">
          <i className="fa-solid fa-rotate text-xs" />
        </button>
        <button
          className="icon-btn"
          style={{ width: 32, height: 32 }}
          onClick={() => onDisconnect(c)}
          title="Disconnect"
          aria-label="Disconnect"
        >
          <i className="fa-solid fa-link-slash text-xs" />
        </button>
      </div>
    </div>
  );
}

function ConnectModal({
  provider,
  onConnect,
  onClose,
}: {
  provider: ConnectorProvider;
  onConnect: (p: ConnectorProvider, account: string) => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const calendar = provider.kind === 'calendar';

  function authorize() {
    if (busy) return;
    setBusy(true);
    // Simulate the OAuth / bank-link round-trip.
    setTimeout(() => onConnect(provider, account), 700);
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">Connect {provider.name}</h3>
        <button className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={onClose} aria-label="Close">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)]">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: provider.color + '22', color: provider.color, fontSize: 18 }}
        >
          <i className={provider.icon} />
        </div>
        <p className="text-xs text-[var(--muted)]">{provider.blurb}</p>
      </div>
      <div className="space-y-3">
        <div>
          <label>{calendar ? 'Account email' : 'Account'}</label>
          <input
            className="input"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={provider.accountHint}
            autoFocus
          />
        </div>
        <p className="text-[11px] text-[var(--muted)] flex items-start gap-1.5">
          <i className="fa-solid fa-lock mt-0.5" />
          <span>
            HomePal uses read-only access and never stores your password. You can disconnect anytime.
          </span>
        </p>
        <button className="btn btn-primary w-full" onClick={authorize} disabled={busy}>
          {busy ? (
            <>
              <i className="fa-solid fa-spinner fa-spin" /> Connecting…
            </>
          ) : (
            <>
              <i className="fa-solid fa-shield-halved" /> Authorize &amp; Connect
            </>
          )}
        </button>
      </div>
    </div>
  );
}
