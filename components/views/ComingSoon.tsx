import { ART } from '@/lib/constants';

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="card text-center" style={{ padding: '48px 24px' }}>
      <div className="empty-art" dangerouslySetInnerHTML={{ __html: ART.empty('var(--accent)') }} />
      <h3 className="font-semibold text-lg mt-2">{title}</h3>
      <p className="text-sm text-[var(--muted)] mt-1">This view is coming soon.</p>
    </div>
  );
}
