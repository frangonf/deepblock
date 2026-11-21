// Native test-harness helpers, shared with focused regression tests.
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

export function containsBodyText(text: unknown, fragment: string): text is string {
  return typeof text === 'string' && text.toLowerCase().includes(fragment.toLowerCase());
}

export async function cleanupNativeRuntime(
  deleteSession: (() => Promise<unknown>) | undefined,
  driver: ChildProcess | undefined,
  fixtureRoot: string | undefined,
  sessionTimeoutMs = 3_000,
  terminateGraceMs = 1_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = (name: NodeJS.Signals) => {
    if (!driver?.pid) return;
    try { process.kill(process.platform === 'win32' ? driver.pid : -driver.pid, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  try {
    if (deleteSession) {
      // Session deletion is best effort; it must never prevent local cleanup.
      await Promise.race([
        Promise.resolve().then(deleteSession).catch(() => {}),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, sessionTimeoutMs); }),
      ]);
    }
  } finally {
    clearTimeout(timer);
    try {
      if (driver?.pid) {
        signal('SIGTERM');
        await new Promise<void>((resolve) => setTimeout(resolve, terminateGraceMs));
        // Kill remaining descendants too, even when the pnpm wrapper exited.
        signal('SIGKILL');
      }
    } finally {
      if (fixtureRoot) rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }
}
