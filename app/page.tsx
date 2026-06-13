import Link from 'next/link';

// Marketing landing. Fleshed out in Phase 4 (pricing/billing); this proves the
// compiled design system renders identically to the legacy app shell.
export default function LandingPage() {
  return (
    <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <i className="fa-solid fa-house-chimney text-white text-xl" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Space Grotesk' }}>
          HomePal
        </h1>
      </div>
      <h2 className="text-4xl sm:text-5xl font-bold max-w-2xl leading-tight grad-text" style={{ fontFamily: 'Space Grotesk' }}>
        Your whole home, in one place.
      </h2>
      <p className="text-[var(--muted)] max-w-xl mt-5 text-base sm:text-lg">
        Shared calendar, finances, smart-home control, chores, and CCTV — a private hub for the
        whole family, behind real accounts.
      </p>
      <div className="flex items-center gap-3 mt-8">
        <Link href="/register" className="btn btn-primary !px-6 !py-3 text-sm">
          Get started free
        </Link>
        <Link href="/pricing" className="btn btn-secondary !px-6 !py-3 text-sm">
          See pricing
        </Link>
      </div>
      <p className="text-xs text-[var(--muted)] mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-[var(--accent)] font-semibold">
          Sign in
        </Link>
      </p>
    </main>
  );
}
