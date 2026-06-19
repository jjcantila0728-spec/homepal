import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeviceListRequest,
  buildControlRequest,
  buildPingRequest,
  parseMessages,
} from '../lib/integrations/deako/protocol.ts';

test('buildDeviceListRequest produces a DEVICE_LIST envelope', () => {
  const msg = JSON.parse(buildDeviceListRequest('tx-1').trim());
  assert.equal(msg.type, 'DEVICE_LIST');
  assert.equal(msg.dst, 'deako');
  assert.equal(msg.src, 'homepal');
  assert.equal(msg.transactionId, 'tx-1');
});

test('buildControlRequest carries target uuid and state', () => {
  const msg = JSON.parse(buildControlRequest('tx-2', 'uuid-9', { power: true, dim: 80 }).trim());
  assert.equal(msg.type, 'CONTROL');
  assert.equal(msg.data.target, 'uuid-9');
  assert.deepEqual(msg.data.state, { power: true, dim: 80 });
});

test('buildPingRequest is a PING envelope', () => {
  const msg = JSON.parse(buildPingRequest('tx-3').trim());
  assert.equal(msg.type, 'PING');
});

test('every request ends with a newline (frame delimiter)', () => {
  assert.ok(buildDeviceListRequest('t').endsWith('\n'));
});

test('parseMessages splits newline-framed JSON and buffers partial tails', () => {
  const a = '{"type":"PING"}\n{"type":"DEVICE_L';
  const r1 = parseMessages(a, '');
  assert.equal(r1.messages.length, 1);
  assert.equal(r1.messages[0].type, 'PING');
  assert.equal(r1.rest, '{"type":"DEVICE_L');

  const r2 = parseMessages('IST","data":{"name":"x"}}\n', r1.rest);
  assert.equal(r2.messages.length, 1);
  assert.equal(r2.messages[0].type, 'DEVICE_LIST');
  assert.equal(r2.rest, '');
});

test('parseMessages ignores malformed lines without throwing', () => {
  const r = parseMessages('not json\n{"type":"PING"}\n', '');
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].type, 'PING');
});
