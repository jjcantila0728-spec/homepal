import type { Member } from './types';

// Date helpers (client-evaluated). Mirror the legacy core.js semantics.
export function today(): Date {
  return new Date();
}
export function ds(offset = 0): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
  return d.toISOString().split('T')[0];
}
export function money(n: number | string): string {
  return (
    '$' +
    (Math.round((+n || 0) * 100) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}
export function fd(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const n = new Date();
  const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function mKey(dateStr: string): string {
  return (dateStr || '').slice(0, 7);
}
export function nextDue(dateStr: string, freq: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

// Avatar: the initials chip used throughout the UI.
export function Avatar({
  member,
  size = 36,
  fontSize = 13,
  radius = 10,
}: {
  member?: Partial<Member> | null;
  size?: number;
  fontSize?: number;
  radius?: number;
}) {
  const m = member || {};
  return (
    <div
      className="avatar"
      style={{
        background: m.color || '#10B981',
        width: size,
        height: size,
        fontSize,
        borderRadius: radius,
      }}
    >
      {m.init || ''}
    </div>
  );
}
