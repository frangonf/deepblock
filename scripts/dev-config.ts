import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

export type Environment = Record<string, string | undefined>;
export type Interfaces = Record<string, { address: string; family: string; internal: boolean }[] | undefined>;

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127;
  }
  return isIP(address) === 6 && /^(fc|fd)/i.test(address);
}

export function selectHost(interfaces: Interfaces = networkInterfaces(), requested?: string, local = false) {
  if (local) return '127.0.0.1';
  if (requested) {
    if (requested === '127.0.0.1' || requested === '::1') return requested;
    const assigned = Object.values(interfaces).flat().some((entry) => entry?.address === requested);
    if (!privateAddress(requested) || !assigned) throw new Error('DEEPBLOCK_DEV_BIND must be an assigned private IP address or loopback (not a wildcard/public bind)');
    return requested;
  }
  const addresses = [...new Set(Object.entries(interfaces)
    .filter(([name]) => !/^(docker|veth|br-|utun|tun|tailscale)/.test(name))
    .flatMap(([, entries]) => (entries ?? []).filter((entry) => !entry.internal && entry.family === 'IPv4' && privateAddress(entry.address)).map((entry) => entry.address)))];
  if (addresses.length > 1) throw new Error(`Multiple private interfaces: ${addresses.join(', ')}. Set DEEPBLOCK_DEV_BIND or DEEPBLOCK_DEV_LOCAL=1.`);
  return addresses[0] ?? '127.0.0.1';
}

function port(value: string | undefined, fallback: number) {
  const result = value ?? String(fallback);
  if (!/^\d+$/.test(result) || Number(result) < 1 || Number(result) > 65535) throw new Error(`Invalid port: ${result}`);
  return Number(result);
}

export function developmentConfig(environment: Environment = process.env, interfaces: Interfaces = networkInterfaces()) {
  const host = selectHost(interfaces, environment.DEEPBLOCK_DEV_BIND, environment.DEEPBLOCK_DEV_LOCAL === '1');
  const frontendPort = port(environment.DEEPBLOCK_DEV_PORT, 5173);
  const backendPort = port(environment.DEEPBLOCK_SERVER_PORT, 8000);
  const hostnames = (environment.DEEPBLOCK_DEV_HOSTNAMES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  for (const hostname of hostnames) {
    if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(hostname)
      || hostname.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) throw new Error(`Invalid development hostname: ${hostname}`);
  }
  const authority = host.includes(':') ? `[${host}]` : host;
  const origins = [...new Set([`http://${authority}:${frontendPort}`, ...hostnames.map((name) => `http://${name.toLowerCase()}:${frontendPort}`)].map((value) => new URL(value).origin))];
  const proxyTarget = `http://127.0.0.1:${backendPort}`;
  const env: Environment = { ...environment, DEEPBLOCK_DEV_BIND: host, DEEPBLOCK_DEV_PORT: String(frontendPort), DEEPBLOCK_DEV_HOSTNAMES: hostnames.join(','), DEEPBLOCK_SERVER_HOST: '127.0.0.1', DEEPBLOCK_SERVER_PORT: String(backendPort), DEEPBLOCK_DEV_MODE: '1', DEEPBLOCK_DEV_ORIGINS: origins.join(','), DEEPBLOCK_DEV_PROXY_TARGET: proxyTarget };
  delete env.VITE_API_BASE;
  delete env.VITE_WS_URL;
  return { host, frontendPort, backendPort, origins, proxyTarget, url: origins[0], env };
}
