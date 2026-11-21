export type ClientRuntime = 'desktop' | 'web';
const WEB_SERVER_PORT_CANDIDATES = [8005, 8000] as const;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function hasWindowObject() {
  return typeof window !== 'undefined';
}

export function getClientRuntime(): ClientRuntime {
  if (hasWindowObject() && window.__TAURI_INTERNALS__) {
    return 'desktop';
  }

  return 'web';
}

export function isTauriRuntime() {
  return getClientRuntime() === 'desktop';
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, '');
}

function pushCandidate(candidates: string[], candidate: string | null | undefined) {
  if (!candidate) {
    return;
  }

  const normalized = normalizeBaseUrl(candidate);
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

async function endpointIsReachable(baseUrl: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    // Require a JSON response: dev servers with SPA fallbacks answer unknown
    // paths with a 200 HTML page, which is not a real API endpoint.
    const contentType = response.headers.get('content-type') ?? '';
    return response.ok && contentType.includes('application/json');
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function resolveBrowserApiBaseUrl(explicitBaseUrl?: string) {
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  const candidates: string[] = [];
  if (hasWindowObject()) {
    // Prefer same-origin traffic when the dev server proxies /api to the Rust
    // server: no cross-origin requests, no CORS preflights.
    pushCandidate(candidates, '/api');
    const host = window.location.hostname || '127.0.0.1';
    for (const port of WEB_SERVER_PORT_CANDIDATES) {
      pushCandidate(candidates, `http://${host}:${port}`);
    }
  }

  for (const port of WEB_SERVER_PORT_CANDIDATES) {
    pushCandidate(candidates, `http://127.0.0.1:${port}`);
    pushCandidate(candidates, `http://localhost:${port}`);
  }

  for (const candidate of candidates) {
    if (await endpointIsReachable(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? 'http://127.0.0.1:8005';
}

export async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri command '${command}' is only available in the desktop shell.`);
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function isNotificationPermissionGranted() {
  if (isTauriRuntime()) {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    return isPermissionGranted();
  }

  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function requestNotificationPermission() {
  if (isTauriRuntime()) {
    const { requestPermission } = await import('@tauri-apps/plugin-notification');
    return (await requestPermission()) === 'granted';
  }

  if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
    return false;
  }

  return (await Notification.requestPermission()) === 'granted';
}

export async function sendRuntimeNotification(payload: { title: string; body: string }) {
  if (isTauriRuntime()) {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    await sendNotification(payload);
    return;
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }

  new Notification(payload.title, { body: payload.body });
}
