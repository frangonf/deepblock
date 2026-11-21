import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentConfig, selectHost } from '../dev-config.ts';

const interfaces = { en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] };

test('private interface is selected and URLs, origin policy and proxy ports agree', () => {
  const config = developmentConfig({ DEEPBLOCK_DEV_PORT: '5175', DEEPBLOCK_SERVER_PORT: '8012', DEEPBLOCK_DEV_HOSTNAMES: 'devbox.lan' }, interfaces);
  assert.equal(config.host, '192.168.1.20');
  assert.equal(config.url, 'http://192.168.1.20:5175');
  assert.deepEqual(config.origins, ['http://192.168.1.20:5175', 'http://devbox.lan:5175']);
  assert.equal(config.env.DEEPBLOCK_SERVER_HOST, '127.0.0.1');
  assert.equal(config.env.DEEPBLOCK_DEV_MODE, '1');
  assert.equal(config.proxyTarget, 'http://127.0.0.1:8012');
});

test('no private interface falls back to loopback, not a public interface', () => {
  assert.equal(selectHost({ eth0: [{ address: '203.0.113.2', family: 'IPv4', internal: false }] }), '127.0.0.1');
});

test('multiple private addresses require an explicit choice', () => {
  const multiple = { ...interfaces, eth1: [{ address: '10.0.0.20', family: 'IPv4', internal: false }] };
  assert.throws(() => selectHost(multiple), /DEEPBLOCK_DEV_BIND/);
  assert.equal(selectHost(multiple, '10.0.0.20'), '10.0.0.20');
  assert.equal(selectHost(multiple, undefined, true), '127.0.0.1');
});

test('untrusted binds, hostnames and invalid ports are rejected', () => {
  for (const bind of ['0.0.0.0', '203.0.113.2', 'example.com']) {
    assert.throws(() => developmentConfig({ DEEPBLOCK_DEV_BIND: bind }, interfaces));
  }
  for (const hostname of ['*.lan', 'evil/path', 'user@host', 'host:5173']) {
    assert.throws(() => developmentConfig({ DEEPBLOCK_DEV_HOSTNAMES: hostname }, interfaces));
  }
  for (const port of ['0', '65536', 'not-a-port', '5173;echo injected']) {
    assert.throws(() => developmentConfig({ DEEPBLOCK_DEV_PORT: port }, interfaces));
  }
});

test('default HTTP port produces canonical origins matching browser headers', () => {
  const config = developmentConfig({ DEEPBLOCK_DEV_PORT: '80' }, interfaces);
  assert.deepEqual(config.origins, ['http://192.168.1.20']);
});

test('assigned VPN addresses can be selected explicitly', () => {
  const vpn = { vpn0: [{ address: '100.64.0.20', family: 'IPv4', internal: false }] };
  assert.equal(selectHost(vpn, '100.64.0.20'), '100.64.0.20');
});

test('localhost mode overrides LAN selection and clears inherited URL overrides', () => {
  const config = developmentConfig({ DEEPBLOCK_DEV_LOCAL: '1', VITE_API_BASE: 'http://elsewhere:8000', VITE_WS_URL: 'ws://elsewhere/ws' }, interfaces);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.env.VITE_API_BASE, undefined);
  assert.equal(config.env.VITE_WS_URL, undefined);
});
