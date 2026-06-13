'use client';

import Link from 'next/link';
import { FEATURE_LABELS, type Feature } from '@/lib/entitlements';

const COPY: Record<Feature, string> = {
  cctv: 'Record your cameras to a UGREEN NAS with motion detection, encrypted credentials, and a built-in clip browser.',
  automations: 'Build trigger → action rules so your home runs itself — Good Night, Wake Up, and away/return scenes.',
  voice: 'Control your home hands-free and bridge Alexa, Google Assistant, and Siri Shortcuts.',
  discovery: 'Scan your home network to find and pair smart devices in one tap.',
  unlimited_members: 'Add everyone in your household — no member cap.',
};

const ICON: Record<Feature, string> = {
  cctv: 'fa-video',
  automations: 'fa-wand-magic-sparkles',
  voice: 'fa-microphone',
  discovery: 'fa-wifi',
  unlimited_members: 'fa-users',
};

export function UpgradePrompt({ feature }: { feature: Feature }) {
  return (
    <div className="max-w-xl mx-auto">
      <div
        className="card p-8 text-center"
        style={{ border: '1.5px solid var(--accent)', boxShadow: '0 8px 40px var(--accent-g)' }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'var(--accent-g)' }}
        >
          <i className={`fa-solid ${ICON[feature]} text-2xl`} style={{ color: 'var(--accent)' }} />
        </div>
        <div
          className="inline-block text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full mb-3"
          style={{ background: 'var(--accent-g)', color: 'var(--accent)' }}
        >
          Pro feature
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk' }}>
          {FEATURE_LABELS[feature]}
        </h2>
        <p className="text-sm text-[var(--muted)] max-w-sm mx-auto mb-6">{COPY[feature]}</p>
        <Link href="/app/billing" className="btn btn-primary !px-6 !py-3 justify-center inline-flex">
          <i className="fa-solid fa-crown" />
          Upgrade to Pro
        </Link>
      </div>
    </div>
  );
}
