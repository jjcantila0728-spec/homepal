// ---------------------------------------------------------------------------
// Plan entitlements. Pure functions, no I/O — unit-test friendly.
// Free gets the core hub (calendar, finance, chores, family).
// Pro unlocks the connected smart-home surface.
// ---------------------------------------------------------------------------

export type Feature = 'automations' | 'cctv' | 'voice' | 'discovery' | 'unlimited_members';

export const FEATURES: Feature[] = ['automations', 'cctv', 'voice', 'discovery', 'unlimited_members'];

/** Human-readable labels for upgrade prompts. */
export const FEATURE_LABELS: Record<Feature, string> = {
  automations: 'Automations & Scenes',
  cctv: 'Cameras',
  voice: 'Voice Assistant Control',
  discovery: 'Device Discovery',
  unlimited_members: 'Unlimited Family Members',
};

/** Which features each plan unlocks. Free unlocks none of the gated features. */
export const PLAN_FEATURES: Record<string, Feature[]> = {
  free: [],
  pro: ['automations', 'cctv', 'voice', 'discovery', 'unlimited_members'],
};

/** Returns true when the given plan unlocks the given feature. */
export function can(plan: string, feature: Feature): boolean {
  const granted = PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
  return granted.includes(feature);
}
