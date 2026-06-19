import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { DeakoClient } from '../lib/integrations/deako/client.ts';

// Minimal fake Deako device: on DEVICE_LIST it replies with two devices; on
// CONTROL it echoes a state-change for the targeted uuid.
function startFakeDeako() {
  const server = net.createServer((sock) => {
    let carry = '';
    sock.on('data', (b) => {
      carry += b.toString('utf8');
      let i;
      while ((i = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, i);
        carry = carry.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'DEVICE_LIST') {
          const reply = (uuid, name, power, dim) => JSON.stringify({
            type: 'DEVICE_LIST', transactionId: msg.transactionId,
            data: { uuid, name, state: { power, dim } },
          }) + '\n';
          sock.write(reply('u1', 'Kitchen', false, 0));
          sock.write(reply('u2', 'Hall', true, 60));
        } else if (msg.type === 'CONTROL') {
          sock.write(JSON.stringify({
            type: 'EVENT', transactionId: msg.transactionId,
            data: { uuid: msg.data.target, state: msg.data.state },
          }) + '\n');
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('connect + listDevices returns the roster from the fake device', async () => {
  const server = await startFakeDeako();
  const { port } = server.address();
  const client = new DeakoClient('127.0.0.1', port);
  await client.connect();
  const devices = await client.listDevices();
  assert.equal(devices.length, 2);
  assert.equal(devices[0].uuid, 'u1');
  assert.equal(devices[1].state.dim, 60);
  client.close();
  server.close();
});

test('setDevice sends CONTROL and resolves with the new state', async () => {
  const server = await startFakeDeako();
  const { port } = server.address();
  const client = new DeakoClient('127.0.0.1', port);
  await client.connect();
  await client.listDevices();
  const state = await client.setDevice('u1', { power: true, dim: 100 });
  assert.equal(state.power, true);
  assert.equal(state.dim, 100);
  client.close();
  server.close();
});

test('connect rejects on a closed port', async () => {
  const client = new DeakoClient('127.0.0.1', 1); // nothing listening
  await assert.rejects(() => client.connect());
  client.close();
});
