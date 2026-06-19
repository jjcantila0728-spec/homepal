# Schedules: multi-day events, member work shifts, and holidays

**Date:** 2026-06-19
**Status:** Approved, implementing

Two independent features that both live in the Schedule view. Build Feature 1
first (self-contained), then Feature 2.

## Feature 1 — Multi-day scheduling + member work shifts

### Data model (`lib/types.ts`)
- `CalEvent` gains `endTime?: string` (`"HH:MM"`). Existing single-time events
  remain valid with `endTime` undefined.
- New `Shift { id: number; label: string; start: string; end: string }`.
- `Member` gains `shifts?: Shift[]` — the reusable "presaved working times,"
  multiple named shifts per member.

### Member shift editor
- The existing member edit modal grows a "Work shifts" list: add / rename /
  delete rows (label + start + end), persisted on the member.

### Multi-day selection (month grid)
- A "Select days" toggle in the Schedule header. When on, clicking a day toggles
  it into a highlighted set (`ui.selectedDates: string[]`) rather than navigating.
  A bar shows "N days selected → Add event." When off, behavior is unchanged
  (single `ui.selectedDate`).

### Add Event modal (unified)
- Always operates on a set of dates: `[selectedDate]` in normal mode, or the
  multi-selected set. Dates shown as read-only chips.
- Fields: title, category, assign-to member, start time, end time, description.
- "Use saved shift" dropdown from the chosen member's `shifts` — picking one
  fills start + end (and the title if still empty).
- Save creates one `CalEvent` per selected date. `saveEvent` takes
  `dates: string[]` + optional `endTime` instead of a single `date`.

### Display
- Event rows show `07:00–19:30` when `endTime` is set, else just the start time.

## Feature 2 — Holidays from family location

### Data model
- `HouseholdState` gains `location?: { country: string; region?: string }`.

### Source (`lib/holidays.ts`)
- Pure `getHolidays(country, region, year)` → `{ date, name }[]`, built from a
  rule table (fixed-date + nth-weekday rules) per country. Ships a starter set
  including Philippines and US; easily extended. No network, no API keys.
- Unit-tested in isolation.

### Settings
- A "Location" section near the family-name editor: country + optional region.

### Display
- Holidays for the visible month are computed (not stored as events) and shown
  as a distinct badge on the day plus a read-only "Holiday: Name" row in the day
  panel. They never mix into editable events.

## Testing / verification
- Unit test `getHolidays` (pure function).
- Typecheck + build green.
- Manual: create a multi-day shift across several days using a saved shift;
  verify one event per day; set a country and confirm holiday badges render.
