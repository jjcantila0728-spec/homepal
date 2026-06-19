// Built-in, offline public-holiday generator. Pure and deterministic: given a
// country (and optional region) plus a year, it returns the holidays for that
// year. No network, no API keys. Extend COUNTRIES to add more places.
//
// Islamic/lunar holidays that are proclaimed per-year (e.g. Eid in PH) are
// intentionally omitted — they can't be derived from a fixed rule.

export interface Holiday {
  date: string; // "YYYY-MM-DD"
  name: string;
}

export interface HolidayCountry {
  code: string;
  name: string;
  regions?: { code: string; name: string }[];
}

type Rule =
  | { type: 'fixed'; month: number; day: number; name: string } // month 1-12
  | { type: 'nth'; month: number; weekday: number; n: number; name: string } // weekday 0=Sun; n>0 or -1 for last
  | { type: 'easter'; offset: number; name: string }; // days relative to Easter Sunday

interface CountryDef {
  code: string;
  name: string;
  regions?: { code: string; name: string }[];
  rules: Rule[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday.
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

// nth weekday of a month. n>0 = nth from start; n=-1 = last in month.
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const offset = (weekday - firstDow + 7) % 7;
    return 1 + offset + (n - 1) * 7;
  }
  // last occurrence
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const back = (lastDow - weekday + 7) % 7;
  return lastDay - back;
}

function resolveRule(rule: Rule, year: number): Holiday {
  if (rule.type === 'fixed') {
    return { date: iso(year, rule.month, rule.day), name: rule.name };
  }
  if (rule.type === 'nth') {
    const day = nthWeekday(year, rule.month, rule.weekday, rule.n);
    return { date: iso(year, rule.month, day), name: rule.name };
  }
  // easter-relative
  const e = easterSunday(year);
  const base = new Date(Date.UTC(year, e.month - 1, e.day));
  base.setUTCDate(base.getUTCDate() + rule.offset);
  return {
    date: iso(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()),
    name: rule.name,
  };
}

const COUNTRIES: CountryDef[] = [
  {
    code: 'PH',
    name: 'Philippines',
    rules: [
      { type: 'fixed', month: 1, day: 1, name: "New Year's Day" },
      { type: 'easter', offset: -3, name: 'Maundy Thursday' },
      { type: 'easter', offset: -2, name: 'Good Friday' },
      { type: 'fixed', month: 4, day: 9, name: 'Araw ng Kagitingan' },
      { type: 'fixed', month: 5, day: 1, name: 'Labor Day' },
      { type: 'fixed', month: 6, day: 12, name: 'Independence Day' },
      { type: 'fixed', month: 8, day: 21, name: 'Ninoy Aquino Day' },
      { type: 'nth', month: 8, weekday: 1, n: -1, name: 'National Heroes Day' },
      { type: 'fixed', month: 11, day: 1, name: "All Saints' Day" },
      { type: 'fixed', month: 11, day: 30, name: 'Bonifacio Day' },
      { type: 'fixed', month: 12, day: 8, name: 'Immaculate Conception' },
      { type: 'fixed', month: 12, day: 25, name: 'Christmas Day' },
      { type: 'fixed', month: 12, day: 30, name: 'Rizal Day' },
      { type: 'fixed', month: 12, day: 31, name: "New Year's Eve" },
    ],
  },
  {
    code: 'US',
    name: 'United States',
    rules: [
      { type: 'fixed', month: 1, day: 1, name: "New Year's Day" },
      { type: 'nth', month: 1, weekday: 1, n: 3, name: 'Martin Luther King Jr. Day' },
      { type: 'nth', month: 2, weekday: 1, n: 3, name: "Presidents' Day" },
      { type: 'nth', month: 5, weekday: 1, n: -1, name: 'Memorial Day' },
      { type: 'fixed', month: 6, day: 19, name: 'Juneteenth' },
      { type: 'fixed', month: 7, day: 4, name: 'Independence Day' },
      { type: 'nth', month: 9, weekday: 1, n: 1, name: 'Labor Day' },
      { type: 'nth', month: 10, weekday: 1, n: 2, name: 'Columbus Day' },
      { type: 'fixed', month: 11, day: 11, name: 'Veterans Day' },
      { type: 'nth', month: 11, weekday: 4, n: 4, name: 'Thanksgiving' },
      { type: 'fixed', month: 12, day: 25, name: 'Christmas Day' },
    ],
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    rules: [
      { type: 'fixed', month: 1, day: 1, name: "New Year's Day" },
      { type: 'easter', offset: -2, name: 'Good Friday' },
      { type: 'easter', offset: 1, name: 'Easter Monday' },
      { type: 'nth', month: 5, weekday: 1, n: 1, name: 'Early May Bank Holiday' },
      { type: 'nth', month: 5, weekday: 1, n: -1, name: 'Spring Bank Holiday' },
      { type: 'nth', month: 8, weekday: 1, n: -1, name: 'Summer Bank Holiday' },
      { type: 'fixed', month: 12, day: 25, name: 'Christmas Day' },
      { type: 'fixed', month: 12, day: 26, name: 'Boxing Day' },
    ],
  },
  {
    code: 'CA',
    name: 'Canada',
    rules: [
      { type: 'fixed', month: 1, day: 1, name: "New Year's Day" },
      { type: 'easter', offset: -2, name: 'Good Friday' },
      { type: 'nth', month: 5, weekday: 1, n: -1, name: 'Victoria Day' },
      { type: 'fixed', month: 7, day: 1, name: 'Canada Day' },
      { type: 'nth', month: 9, weekday: 1, n: 1, name: 'Labour Day' },
      { type: 'nth', month: 10, weekday: 1, n: 2, name: 'Thanksgiving' },
      { type: 'fixed', month: 11, day: 11, name: 'Remembrance Day' },
      { type: 'fixed', month: 12, day: 25, name: 'Christmas Day' },
      { type: 'fixed', month: 12, day: 26, name: 'Boxing Day' },
    ],
  },
  {
    code: 'AU',
    name: 'Australia',
    rules: [
      { type: 'fixed', month: 1, day: 1, name: "New Year's Day" },
      { type: 'fixed', month: 1, day: 26, name: 'Australia Day' },
      { type: 'easter', offset: -2, name: 'Good Friday' },
      { type: 'easter', offset: 1, name: 'Easter Monday' },
      { type: 'fixed', month: 4, day: 25, name: 'Anzac Day' },
      { type: 'fixed', month: 12, day: 25, name: 'Christmas Day' },
      { type: 'fixed', month: 12, day: 26, name: 'Boxing Day' },
    ],
  },
];

/** Countries available for the location selector, with display names. */
export const HOLIDAY_COUNTRIES: HolidayCountry[] = COUNTRIES.map((c) => ({
  code: c.code,
  name: c.name,
  regions: c.regions,
}));

/**
 * Public holidays for a country/year, sorted by date. `region` is accepted for
 * forward compatibility (regional rules) but currently unused. Unknown country
 * codes return an empty list.
 */
export function getHolidays(country: string | undefined, region: string | undefined, year: number): Holiday[] {
  const def = COUNTRIES.find((c) => c.code === country);
  if (!def) return [];
  return def.rules
    .map((r) => resolveRule(r, year))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Map of "YYYY-MM-DD" → holiday name for a given country/year, for fast lookup. */
export function holidayMap(country: string | undefined, region: string | undefined, year: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of getHolidays(country, region, year)) out[h.date] = h.name;
  return out;
}
