'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ART } from '@/lib/constants';

function Feature({ ic, t, s }: { ic: string; t: string; s: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(255,255,255,.08)' }}
      >
        <i className={`fa-solid ${ic}`} style={{ color: 'var(--accent)' }} />
      </div>
      <div>
        <div className="text-sm font-semibold">{t}</div>
        <div className="text-[11px] text-[var(--muted)]">{s}</div>
      </div>
    </div>
  );
}

function ArtPanel() {
  return (
    <div className="auth-art">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
          <i className="fa-solid fa-house-chimney text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk'" }}>
            HomePal
          </h1>
          <p className="text-xs text-[var(--muted)] -mt-0.5">Your family hub</p>
        </div>
      </div>
      <div style={{ margin: '10px 0 4px' }} dangerouslySetInnerHTML={{ __html: ART.home() }} />
      <div className="space-y-3">
        <Feature ic="fa-calendar-check" t="Shared calendar" s="Everyone in sync" />
        <Feature ic="fa-wallet" t="Finances & budgets" s="Track every dollar" />
        <Feature ic="fa-house-signal" t="Smart home" s="Lights, locks & scenes" />
        <Feature ic="fa-wand-magic-sparkles" t="Automations" s="The home runs itself" />
      </div>
    </div>
  );
}

export type AuthMode = 'login' | 'register';

export function AuthCard({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [householdName, setHouseholdName] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body =
      mode === 'login'
        ? { email: email.trim(), password }
        : { name: name.trim(), householdName: householdName.trim(), email: email.trim(), password };
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        setError(data.error || (mode === 'login' ? 'Sign in failed' : 'Could not create account'));
        setBusy(false);
        return;
      }
      router.push('/app');
      router.refresh();
    } catch {
      setError('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center" style={{ padding: 20 }}>
      <div className="card auth-card relative z-10">
        <ArtPanel />
        <div className="auth-form">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <i className="fa-solid fa-house-chimney text-white text-sm" />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk'" }}>
                Welcome
              </h2>
              <p className="text-[11px] text-[var(--muted)] -mt-0.5">Sign in to your household</p>
            </div>
          </div>
          <div className="flex gap-2 mb-4">
            <Link
              href="/login"
              className={`sec-tab ${mode === 'login' ? 'active' : ''}`}
              prefetch={false}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className={`sec-tab ${mode === 'register' ? 'active' : ''}`}
              prefetch={false}
            >
              Create account
            </Link>
          </div>
          {error && (
            <div
              className="mb-3 px-3 py-2 rounded-lg text-xs"
              style={{
                background: 'rgba(239,68,68,.12)',
                color: 'var(--red)',
                border: '1px solid rgba(239,68,68,.3)',
              }}
              role="alert"
            >
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="space-y-3">
              {mode === 'register' && (
                <>
                  <div>
                    <label>Your name</label>
                    <input
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Marcus"
                      required
                    />
                  </div>
                  <div>
                    <label>
                      Household name <span className="font-normal text-[var(--muted)]">(optional)</span>
                    </label>
                    <input
                      className="input"
                      value={householdName}
                      onChange={(e) => setHouseholdName(e.target.value)}
                      placeholder="The Cantila Home"
                    />
                  </div>
                </>
              )}
              <div>
                <label>Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label>Password</label>
                <div className="relative">
                  <input
                    className="input"
                    style={{ paddingRight: 40 }}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'register' ? 'At least 8 characters' : undefined}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
                    title={showPw ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--muted)]"
                    style={{ background: 'transparent', border: 0, cursor: 'pointer' }}
                    tabIndex={-1}
                  >
                    <i className={`fa-solid ${showPw ? 'fa-eye-slash' : 'fa-eye'}`} />
                  </button>
                </div>
              </div>
              <button className="btn btn-primary w-full" type="submit" disabled={busy}>
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </div>
          </form>
          <p className="text-[11px] text-[var(--muted)] text-center mt-4">
            Register with any email — your hub is stored on this server, ready with starter rooms,
            scenes &amp; automations to explore.
          </p>
        </div>
      </div>
    </div>
  );
}
