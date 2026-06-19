'use client';

import { useState } from 'react';
import { useHousehold } from '@/store/household';
import { currentUser } from '@/lib/selectors';
import { connectorProviders, type ConnectorProvider } from '@/lib/constants';
import { Avatar } from '@/lib/format';
import { mapToEvents, mapToTxns, type ShiftRow, type TxnRow } from '@/lib/ai/connector-data';
import type { Connection, ConnectorKind } from '@/lib/types';

const KIND_META: Record<ConnectorKind, { title: string; sub: string; icon: string; color: string; syncedLabel: string }> = {
  calendar: {
    title: 'Work Schedule',
    sub: 'Bring your shifts in — paste, upload, or link your roster and AI files them into the Schedule.',
    icon: 'fa-calendar-days',
    color: 'var(--blue)',
    syncedLabel: 'events',
  },
  bank: {
    title: 'Bank Accounts',
    sub: 'Bring your spending in — paste or upload a statement and AI files transactions into Finance.',
    icon: 'fa-building-columns',
    color: 'var(--accent)',
    syncedLabel: 'transactions',
  },
};

function providerOf(id: string): ConnectorProvider | undefined {
  return connectorProviders.find((p) => p.id === id);
}

const REASON_MSG: Record<string, string> = {
  'ai-unavailable': 'AI extraction isn’t configured on this server (missing OPENAI_API_KEY).',
  'blocked-url': 'That URL isn’t allowed. Use a public link, or paste/upload instead.',
  'fetch-failed': 'Couldn’t read that URL. Try pasting the content or uploading a screenshot.',
  'no-content': 'Nothing to import — add some text, a file, or a link first.',
  'ai-error': 'The AI couldn’t process that. Try a clearer screenshot or paste the text.',
  'too-large': 'That file is too large. Try a smaller screenshot or paste the text.',
  unauthorized: 'Your session expired. Please sign in again.',
};

export function Connectors() {
  const { state, ui, update, toast, showModal, hideModal } = useHousehold();
  const me = currentUser(state, ui.userId);
  const mine = (state.connectors || []).filter((c) => c.memberId === ui.userId);
  const connectedIds = new Set(mine.map((c) => c.providerId));

  // Insert (or extend) a connection with freshly-extracted, managed read-only items.
  function commitImport(provider: ConnectorProvider, kind: ConnectorKind, rows: (ShiftRow | TxnRow)[], existing?: Connection) {
    update((d) => {
      if (!d.connectors) d.connectors = [];
      let connId: number;
      if (existing) {
        const conn = d.connectors.find((x) => x.id === existing.id);
        connId = existing.id;
        if (conn) {
          conn.synced += rows.length;
          conn.lastSync = 'Just now';
          conn.status = 'connected';
        }
      } else {
        connId = ++d.nid;
        d.connectors.push({
          id: connId,
          memberId: ui.userId,
          providerId: provider.id,
          kind: provider.kind,
          account: provider.name,
          status: 'connected',
          autoSync: false,
          lastSync: 'Just now',
          synced: rows.length,
        });
      }
      if (kind === 'calendar') {
        const evs = mapToEvents(rows as ShiftRow[], { connectionId: connId, memberId: ui.userId, idStart: d.nid });
        d.nid += evs.length;
        d.events.push(...evs);
      } else {
        const txns = mapToTxns(rows as TxnRow[], { connectionId: connId, memberId: ui.userId, idStart: d.nid });
        d.nid += txns.length;
        d.transactions.push(...txns);
      }
      d.alerts.unshift({
        id: ++d.nid,
        type: kind === 'calendar' ? 'system' : 'budget',
        msg: `${me.name} imported ${rows.length} ${KIND_META[kind].syncedLabel} from ${provider.name}`,
        time: 'Just now',
        sev: 'success',
        seen: false,
      });
    });
    hideModal();
    toast(`Imported ${rows.length} ${KIND_META[kind].syncedLabel}`, rows.length ? 'success' : 'info');
  }

  function disconnect(c: Connection) {
    const p = providerOf(c.providerId);
    update((d) => {
      d.connectors = (d.connectors || []).filter((x) => x.id !== c.id);
      // Remove every managed item this connection brought in.
      d.events = d.events.filter((e) => e.connectionId !== c.id);
      d.transactions = d.transactions.filter((t) => t.connectionId !== c.id);
    });
    toast(`${p?.name || 'Account'} disconnected`, 'warning');
  }

  function openConnect(provider: ConnectorProvider, existing?: Connection) {
    showModal(
      <ImportModal
        provider={provider}
        existing={existing}
        onImport={(rows) => commitImport(provider, provider.kind, rows, existing)}
        onClose={hideModal}
      />,
    );
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
                AI imports your shifts &amp; transactions — no passwords, ever.
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
        onSync={(c) => openConnect(providerOf(c.providerId)!, c)}
      />
      <Section
        kind="bank"
        connections={mine.filter((c) => c.kind === 'bank')}
        connectedIds={connectedIds}
        onConnect={openConnect}
        onDisconnect={disconnect}
        onSync={(c) => openConnect(providerOf(c.providerId)!, c)}
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
}: {
  kind: ConnectorKind;
  connections: Connection[];
  connectedIds: Set<string>;
  onConnect: (p: ConnectorProvider) => void;
  onDisconnect: (c: Connection) => void;
  onSync: (c: Connection) => void;
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
}: {
  c: Connection;
  syncedLabel: string;
  onDisconnect: (c: Connection) => void;
  onSync: (c: Connection) => void;
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
          {c.synced} {syncedLabel} &middot; synced {c.lastSync}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="icon-btn"
          style={{ width: 32, height: 32 }}
          onClick={() => onSync(c)}
          title="Import more"
          aria-label="Import more"
        >
          <i className="fa-solid fa-file-import text-xs" />
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

type ImportMode = 'paste' | 'upload' | 'url';

function ImportModal({
  provider,
  existing,
  onImport,
  onClose,
}: {
  provider: ConnectorProvider;
  existing?: Connection;
  onImport: (rows: (ShiftRow | TxnRow)[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [filePayload, setFilePayload] = useState<{ fileBase64?: string; mime?: string; text?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<(ShiftRow | TxnRow)[] | null>(null);
  const calendar = provider.kind === 'calendar';

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    if (f.type.startsWith('image/')) {
      reader.onload = () => setFilePayload({ fileBase64: String(reader.result), mime: f.type });
      reader.readAsDataURL(f);
    } else {
      reader.onload = () => setFilePayload({ text: String(reader.result) });
      reader.readAsText(f);
    }
  }

  async function extract() {
    if (busy) return;
    setError('');
    const body: Record<string, unknown> = { kind: provider.kind };
    if (mode === 'paste') {
      if (!text.trim()) return setError(REASON_MSG['no-content']);
      body.text = text;
    } else if (mode === 'url') {
      if (!url.trim()) return setError(REASON_MSG['no-content']);
      body.url = url.trim();
    } else {
      if (!filePayload) return setError('Choose a file first.');
      Object.assign(body, filePayload);
    }
    setBusy(true);
    try {
      const res = await fetch('/api/connectors/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(REASON_MSG[data.reason] || 'Something went wrong. Try again.');
      } else {
        setRows(data.items as (ShiftRow | TxnRow)[]);
        if (!data.items.length) setError('No items found in that content.');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // Preview step
  if (rows && rows.length) {
    return (
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">Review {rows.length} {calendar ? 'shifts' : 'transactions'}</h3>
          <button className="text-[var(--muted)] hover:text-[var(--fg)]" onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <p className="text-xs text-[var(--muted)] mb-3">
          AI extracted these from your {provider.name} content. They’ll be added as read-only items you can
          remove anytime by disconnecting.
        </p>
        <div className="space-y-1.5 max-h-64 overflow-auto mb-4">
          {rows.map((r, i) => (
            <PreviewRow key={i} row={r} calendar={calendar} />
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm flex-1" onClick={() => setRows(null)}>
            Back
          </button>
          <button className="btn btn-primary btn-sm flex-1" onClick={() => onImport(rows)}>
            <i className="fa-solid fa-check" /> Import {rows.length}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">{existing ? 'Import more from' : 'Connect'} {provider.name}</h3>
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
        <p className="text-xs text-[var(--muted)]">
          {calendar
            ? 'Paste your roster, upload a screenshot, or link a public calendar — AI reads the shifts.'
            : 'Paste or upload a statement (or screenshot) — AI reads the transactions.'}
        </p>
      </div>

      <div className="flex gap-1 mb-3 bg-[var(--surface2)] p-1 rounded-xl">
        {(['paste', 'upload', 'url'] as ImportMode[]).map((m) => (
          <button
            key={m}
            className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition ${mode === m ? 'bg-[var(--surface)] font-semibold' : 'text-[var(--muted)]'}`}
            onClick={() => { setMode(m); setError(''); }}
          >
            {m === 'url' ? 'Link' : m}
          </button>
        ))}
      </div>

      {mode === 'paste' && (
        <textarea
          className="input"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={calendar ? 'Mon 6/23  7:00–15:30\nTue 6/24  off\nWed 6/25  9am-5pm …' : 'Paste statement rows…'}
          autoFocus
        />
      )}
      {mode === 'upload' && (
        <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface2)] cursor-pointer hover:border-[var(--accent)] transition">
          <i className="fa-solid fa-cloud-arrow-up text-2xl text-[var(--muted)]" />
          <span className="text-xs text-[var(--muted)] text-center">
            {fileName || 'Upload a screenshot, CSV, or export'}
          </span>
          <input type="file" accept="image/*,.csv,.txt,text/plain" className="hidden" onChange={onFile} />
        </label>
      )}
      {mode === 'url' && (
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… public calendar or export link"
          autoFocus
        />
      )}

      {error && <p className="text-[11px] text-[var(--red)] mt-2">{error}</p>}

      <p className="text-[11px] text-[var(--muted)] flex items-start gap-1.5 mt-3">
        <i className="fa-solid fa-lock mt-0.5" />
        <span>HomePal never asks for or stores your password. Content is sent only to extract your data.</span>
      </p>
      <button className="btn btn-primary w-full mt-3" onClick={extract} disabled={busy}>
        {busy ? (
          <>
            <i className="fa-solid fa-spinner fa-spin" /> Reading with AI…
          </>
        ) : (
          <>
            <i className="fa-solid fa-wand-magic-sparkles" /> Extract with AI
          </>
        )}
      </button>
    </div>
  );
}

function PreviewRow({ row, calendar }: { row: ShiftRow | TxnRow; calendar: boolean }) {
  if (calendar) {
    const r = row as ShiftRow;
    return (
      <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-[var(--surface2)]">
        <span className="font-medium">{r.title || 'Work shift'}</span>
        <span className="text-[var(--muted)]">{r.date} · {r.start}{r.end ? `–${r.end}` : ''}</span>
      </div>
    );
  }
  const r = row as TxnRow;
  return (
    <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-[var(--surface2)]">
      <span className="font-medium truncate">{r.description || r.category || 'Transaction'}</span>
      <span style={{ color: r.type === 'income' ? 'var(--accent)' : 'var(--red)' }}>
        {r.type === 'income' ? '+' : '−'}${r.amount.toLocaleString()} · {r.date}
      </span>
    </div>
  );
}
