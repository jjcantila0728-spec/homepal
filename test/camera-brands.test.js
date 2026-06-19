import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRtspUrl } from '../lib/cameras/brands.ts';

test('tapo HD builds stream1 with encoded creds', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '192.168.1.50', username: 'cam', password: 'p@ss', streamQuality: 'hd' });
  assert.equal(r.rtspUrl, 'rtsp://cam:p%40ss@192.168.1.50:554/stream1');
});

test('tapo SD builds stream2', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '10.0.0.9', username: 'u', password: 'pw', streamQuality: 'sd' });
  assert.equal(r.rtspUrl, 'rtsp://u:pw@10.0.0.9:554/stream2');
});

test('tapo defaults to HD when streamQuality omitted', () => {
  const r = buildRtspUrl({ brand: 'tapo', host: '10.0.0.9', username: 'u', password: 'pw' });
  assert.ok(r.rtspUrl.endsWith('/stream1'));
});

test('tapo missing host throws', () => {
  assert.throws(() => buildRtspUrl({ brand: 'tapo', username: 'u', password: 'pw' }), /host/i);
});

test('generic passes through a full rtsp url', () => {
  const r = buildRtspUrl({ brand: 'generic', rtspUrl: 'rtsp://x:y@192.168.1.7:554/h264' });
  assert.equal(r.rtspUrl, 'rtsp://x:y@192.168.1.7:554/h264');
  assert.ok(r.warnings.some((w) => /best-effort/i.test(w)));
});

test('generic rejects a non-rtsp url', () => {
  assert.throws(() => buildRtspUrl({ brand: 'generic', rtspUrl: 'http://nope' }), /rtsp:\/\//i);
});

test('onvif builds from host + path', () => {
  const r = buildRtspUrl({ brand: 'onvif', host: '192.168.1.8', username: 'a', password: 'b', rtspPath: 'profile1' });
  assert.equal(r.rtspUrl, 'rtsp://a:b@192.168.1.8:554/profile1');
});
