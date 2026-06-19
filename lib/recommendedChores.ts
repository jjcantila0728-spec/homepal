// Curated weekly recurring-task recommendations for a typical single-family
// home in the USA, grouped by season. The Tasks → Chores tab surfaces the
// year-round set plus whichever season is current; the user can add a
// suggestion as-is, edit it first, or ignore it and create their own.
//
// Seasons use the meteorological Northern-Hemisphere calendar (US):
//   Spring Mar–May · Summer Jun–Aug · Fall Sep–Nov · Winter Dec–Feb.

export type Season = 'spring' | 'summer' | 'fall' | 'winter' | 'all';

export interface RecommendedChore {
  name: string;
  icon: string; // fa-solid icon name
  day: number; // suggested day of week, 0 = Sunday
  pts: number; // suggested chore points
}

export const SEASON_META: Record<Exclude<Season, 'all'>, { label: string; icon: string; color: string }> = {
  spring: { label: 'Spring', icon: 'fa-seedling', color: '#10B981' },
  summer: { label: 'Summer', icon: 'fa-sun', color: '#F59E0B' },
  fall: { label: 'Fall', icon: 'fa-leaf', color: '#F97316' },
  winter: { label: 'Winter', icon: 'fa-snowflake', color: '#3B82F6' },
};

// Determine the current US/Northern-Hemisphere season from a month (0–11).
export function seasonForMonth(month: number): Exclude<Season, 'all'> {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

const RECOMMENDED: Record<Season, RecommendedChore[]> = {
  all: [
    { name: 'Take out trash & recycling', icon: 'fa-trash-can', day: 0, pts: 10 },
    { name: 'Vacuum living areas', icon: 'fa-broom', day: 6, pts: 15 },
    { name: 'Clean the bathrooms', icon: 'fa-toilet', day: 6, pts: 20 },
    { name: 'Mop kitchen & entry floors', icon: 'fa-bucket', day: 6, pts: 15 },
    { name: 'Do the laundry', icon: 'fa-shirt', day: 0, pts: 15 },
    { name: 'Wipe down kitchen counters', icon: 'fa-sink', day: 3, pts: 10 },
    { name: 'Water the houseplants', icon: 'fa-seedling', day: 1, pts: 5 },
    { name: 'Weekly grocery run', icon: 'fa-cart-shopping', day: 6, pts: 15 },
    { name: 'Clean out the refrigerator', icon: 'fa-snowflake', day: 0, pts: 10 },
  ],
  spring: [
    { name: 'Mow the lawn', icon: 'fa-leaf', day: 6, pts: 20 },
    { name: 'Clean the gutters', icon: 'fa-house-chimney', day: 6, pts: 25 },
    { name: 'Power-wash deck & patio', icon: 'fa-spray-can-sparkles', day: 6, pts: 25 },
    { name: 'Plant & weed garden beds', icon: 'fa-seedling', day: 0, pts: 20 },
    { name: 'Wash exterior windows', icon: 'fa-window-maximize', day: 6, pts: 20 },
    { name: 'Service the A/C before summer', icon: 'fa-fan', day: 6, pts: 20 },
  ],
  summer: [
    { name: 'Mow & water the lawn', icon: 'fa-leaf', day: 6, pts: 20 },
    { name: 'Weed the garden beds', icon: 'fa-seedling', day: 0, pts: 15 },
    { name: 'Clean the grill / BBQ', icon: 'fa-fire-burner', day: 6, pts: 15 },
    { name: 'Check & rinse the A/C filter', icon: 'fa-fan', day: 0, pts: 10 },
    { name: 'Skim & test the pool', icon: 'fa-water-ladder', day: 6, pts: 20 },
    { name: 'Trim hedges & bushes', icon: 'fa-scissors', day: 6, pts: 20 },
  ],
  fall: [
    { name: 'Rake & bag the leaves', icon: 'fa-broom', day: 6, pts: 20 },
    { name: 'Clear leaves from gutters', icon: 'fa-house-chimney', day: 6, pts: 25 },
    { name: 'Winterize outdoor faucets', icon: 'fa-faucet', day: 6, pts: 15 },
    { name: 'Service the furnace / heater', icon: 'fa-fire', day: 6, pts: 20 },
    { name: 'Test smoke & CO detectors', icon: 'fa-bell', day: 0, pts: 10 },
    { name: 'Store patio furniture', icon: 'fa-chair', day: 0, pts: 15 },
  ],
  winter: [
    { name: 'Shovel snow & de-ice walkways', icon: 'fa-snowflake', day: 6, pts: 20 },
    { name: 'Weatherstrip drafty doors', icon: 'fa-door-closed', day: 0, pts: 15 },
    { name: 'Reverse the ceiling fans', icon: 'fa-fan', day: 0, pts: 5 },
    { name: 'Run faucets to prevent frozen pipes', icon: 'fa-faucet-drip', day: 0, pts: 10 },
    { name: 'Clean & inspect the fireplace', icon: 'fa-fire', day: 6, pts: 20 },
    { name: 'Replace the furnace filter', icon: 'fa-wind', day: 0, pts: 10 },
  ],
};

// Recommendations for a given date: year-round set first, then the current
// season's set. Each carries the season it came from for badge display.
export function recommendedChores(now: Date): { season: Season; chore: RecommendedChore }[] {
  const season = seasonForMonth(now.getMonth());
  return [
    ...RECOMMENDED.all.map((chore) => ({ season: 'all' as Season, chore })),
    ...RECOMMENDED[season].map((chore) => ({ season: season as Season, chore })),
  ];
}
