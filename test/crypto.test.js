import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, maskRtsp } from '../server/crypto.js';

test('encrypt/decrypt round-trips', () => {
  const url = 'rtsp://admin:p%40ss@192.168.1.50:554/stream1';
  const enc = encryptSecret(url);
  assert.notEqual(enc, url);
  assert.equal(decryptSecret(enc), url);
});

test('ciphertext differs each call (random IV)', () => {
  assert.notEqual(encryptSecret('x'), encryptSecret('x'));
});

test('maskRtsp hides credentials but keeps host/path', () => {
  assert.equal(
    maskRtsp('rtsp://admin:secret@192.168.1.50:554/stream1'),
    'rtsp://***@192.168.1.50:554/stream1'
  );
  assert.equal(maskRtsp('rtsp://192.168.1.50/s'), 'rtsp://192.168.1.50/s');
});

test('decryptSecret throws on tampered text', () => {
  const enc = encryptSecret('hello');
  const bad = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
  assert.throws(() => decryptSecret(bad));
});
