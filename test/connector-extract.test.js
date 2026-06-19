import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normDate,
  normTime,
  parseShiftRows,
  parseTxnRows,
  mapToEvents,
  mapToTxns,
} from '../lib/ai/connector-data.ts';

// ---- normDate ----
test('normDate passes ISO through', () => {
  assert.equal(normDate('2026-06-19'), '2026-06-19');
});
test('normDate zero-pads YYYY/M/D', () => {
  assert.equal(normDate('2026/6/9'), '2026-06-09');
});
test('normDate reads M/D/YYYY US-style', () => {
  assert.equal(normDate('3/7/2026'), '2026-03-07');
});
test('normDate rejects garbage and bad ranges', () => {
  assert.equal(normDate('not a date'), null);
  assert.equal(normDate('2026-13-01'), null);
  assert.equal(normDate(42), null);
});

// ---- normTime ----
test('normTime handles 24h and 12h', () => {
  assert.equal(normTime('19:30'), '19:30');
  assert.equal(normTime('7:30 AM'), '07:30');
  assert.equal(normTime('7pm'), '19:00');
  assert.equal(normTime('12am'), '00:00');
  assert.equal(normTime('12pm'), '12:00');
  assert.equal(normTime('9'), '09:00');
});
test('normTime rejects bad input', () => {
  assert.equal(normTime('25:00'), null);
  assert.equal(normTime('7:99'), null);
  assert.equal(normTime('lunch'), null);
});

// ---- parseShiftRows ----
test('parseShiftRows accepts well-formed shifts under a wrapper key', () => {
  const rows = parseShiftRows({
    shifts: [
      { date: '2026-06-20', start: '07:00', end: '19:30', title: 'Floor', category: 'Work' },
      { day: '6/21/2026', from: '9am', to: '5pm' },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { date: '2026-06-20', start: '07:00', end: '19:30', title: 'Floor', category: 'Work' });
  assert.equal(rows[1].date, '2026-06-21');
  assert.equal(rows[1].start, '09:00');
  assert.equal(rows[1].end, '17:00');
});
test('parseShiftRows drops rows missing date or start, and ignores end<=start', () => {
  const rows = parseShiftRows([
    { date: '2026-06-20' }, // no start -> dropped
    { start: '07:00' }, // no date -> dropped
    { date: '2026-06-20', start: '07:00', end: '06:00' }, // bad end -> kept w/o end
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].end, undefined);
});
test('parseShiftRows tolerates non-array garbage', () => {
  assert.deepEqual(parseShiftRows(null), []);
  assert.deepEqual(parseShiftRows('oops'), []);
  assert.deepEqual(parseShiftRows({ nope: 1 }), []);
});

// ---- parseTxnRows ----
test('parseTxnRows infers type from sign and strips currency', () => {
  const rows = parseTxnRows({
    transactions: [
      { date: '2026-06-01', amount: -42.5, category: 'Groceries', merchant: 'Aldi' },
      { date: '2026-06-02', amount: '$1,200.00', type: 'deposit' },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { date: '2026-06-01', amount: 42.5, type: 'expense', category: 'Groceries', description: 'Aldi' });
  assert.equal(rows[1].type, 'income');
  assert.equal(rows[1].amount, 1200);
});
test('parseTxnRows drops zero/NaN/dateless rows', () => {
  const rows = parseTxnRows([
    { date: '2026-06-01', amount: 0 },
    { date: 'x', amount: 5 },
    { amount: 5 },
  ]);
  assert.equal(rows.length, 0);
});

// ---- mapToEvents / mapToTxns ----
test('mapToEvents tags source, connection, member and assigns sequential ids', () => {
  const rows = [
    { date: '2026-06-20', start: '07:00', end: '19:30' },
    { date: '2026-06-21', start: '09:00', title: 'Clinic', category: 'Health' },
  ];
  const evs = mapToEvents(rows, { connectionId: 7, memberId: 3, idStart: 100 });
  assert.equal(evs[0].id, 101);
  assert.equal(evs[1].id, 102);
  assert.equal(evs[0].title, 'Work shift');
  assert.equal(evs[0].cat, 'work');
  assert.equal(evs[1].cat, 'health');
  assert.equal(evs[0].source, 'connector');
  assert.equal(evs[0].connectionId, 7);
  assert.equal(evs[0].memberId, 3);
  assert.equal(evs[0].endTime, '19:30');
});
test('mapToTxns tags + defaults category by type', () => {
  const txns = mapToTxns(
    [
      { date: '2026-06-01', amount: 42.5, type: 'expense' },
      { date: '2026-06-02', amount: 1200, type: 'income' },
    ],
    { connectionId: 9, memberId: 2, idStart: 0 },
  );
  assert.equal(txns[0].id, 1);
  assert.equal(txns[0].cat, 'Other');
  assert.equal(txns[1].cat, 'Salary');
  assert.equal(txns[0].source, 'connector');
  assert.equal(txns[1].connectionId, 9);
  assert.equal(txns[0].memberId, 2);
});
