import { useSyncExternalStore } from 'react';

// The root theme boundary also drives libraries that require an appearance prop.
// Changing palettes is CSS-only; changing appearance updates library runtimes.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
  return () => observer.disconnect();
}

function snapshot(): 'dark' | 'light' {
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
}

export function useThemeMode() {
  return useSyncExternalStore(subscribe, snapshot, () => 'dark' as const);
}
