import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHolidays, holidayMap, HOLIDAY_COUNTRIES } from '../lib/holidays.ts';

function find(list, name) {
  return list.find((h) => h.name === name);
}

test('PH fixed holidays land on the right dates', () => {
  const h = getHolidays('PH', undefined, 2026);
  assert.equal(find(h, "New Year's Day").date, '2026-01-01');
  assert.equal(find(h, 'Independence Day').date, '2026-06-12');
  assert.equal(find(h, 'Christmas Day').date, '2026-12-25');
  assert.equal(find(h, 'Rizal Day').date, '2026-12-30');
});

test('PH Easter-relative holidays (2026 Easter = Apr 5)', () => {
  const h = getHolidays('PH', undefined, 2026);
  assert.equal(find(h, 'Maundy Thursday').date, '2026-04-02');
  assert.equal(find(h, 'Good Friday').date, '2026-04-03');
});

test('PH National Heroes Day = last Monday of August 2026', () => {
  const h = getHolidays('PH', undefined, 2026);
  assert.equal(find(h, 'National Heroes Day').date, '2026-08-31');
});

test('US nth-weekday holidays for 2026', () => {
  const h = getHolidays('US', undefined, 2026);
  assert.equal(find(h, 'Martin Luther King Jr. Day').date, '2026-01-19'); // 3rd Mon Jan
  assert.equal(find(h, 'Memorial Day').date, '2026-05-25'); // last Mon May
  assert.equal(find(h, 'Labor Day').date, '2026-09-07'); // 1st Mon Sep
  assert.equal(find(h, 'Thanksgiving').date, '2026-11-26'); // 4th Thu Nov
});

test('results are sorted by date', () => {
  const h = getHolidays('US', undefined, 2026);
  const dates = h.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('unknown country yields no holidays', () => {
  assert.deepEqual(getHolidays('ZZ', undefined, 2026), []);
  assert.deepEqual(getHolidays(undefined, undefined, 2026), []);
});

test('holidayMap keys by date string', () => {
  const m = holidayMap('PH', undefined, 2026);
  assert.equal(m['2026-12-25'], 'Christmas Day');
});

test('HOLIDAY_COUNTRIES exposes selectable countries', () => {
  const codes = HOLIDAY_COUNTRIES.map((c) => c.code);
  assert.ok(codes.includes('PH'));
  assert.ok(codes.includes('US'));
});
