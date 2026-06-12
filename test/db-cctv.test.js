import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHousehold, getState, putState } from '../server/db.js';

test('cctv config persists through putState/getState', () => {
  const email = `cctv_${Date.now()}@t.io`;
  const { hid } = registerHousehold({ householdName: 'T', adminName: 'A', email, password: 'pw123456' });
  const state = getState(hid);
  state.cctv = { enabled: true, storagePath: 'Z:/cctv', freeSpaceFloorGB: 20, cameras: [{ id: 'c1', name: 'Front', rtspUrl: 'ENC', sensitivity: 0.04, preRoll: 5, postRoll: 8, enabled: true }] };
  putState(hid, state);
  const reloaded = getState(hid);
  assert.equal(reloaded.cctv.storagePath, 'Z:/cctv');
  assert.equal(reloaded.cctv.cameras[0].id, 'c1');
});
