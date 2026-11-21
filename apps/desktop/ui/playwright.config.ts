import { defineConfig } from '@playwright/test';

const fixtureRoot = '.playwright-data';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    launchOptions: {
      // Bypass stalled SwiftShader/GL startup on headless Linux hosts.
      args: process.platform === 'linux' ? ['--use-gl=disabled'] : [],
    },
  },
  webServer: [
    {
      command: [
        'rm -rf',
        fixtureRoot,
        '&& mkdir -p',
        `${fixtureRoot}/data`,
        `${fixtureRoot}/config`,
        `${fixtureRoot}/state`,
        '&& XDG_DATA_HOME=$PWD/' + fixtureRoot + '/data',
        'XDG_CONFIG_HOME=$PWD/' + fixtureRoot + '/config',
        'XDG_STATE_HOME=$PWD/' + fixtureRoot + '/state',
        'DEEPBLOCK_SERVER_PORT=8010',
        'cargo run -p deepblock-server',
      ].join(' '),
      url: 'http://127.0.0.1:8010/health',
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: 'DEEPBLOCK_DEV_LOCAL=1 DEEPBLOCK_SERVER_PORT=8010 node ../../../scripts/dev.ts web',
      url: 'http://127.0.0.1:5173',
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      reuseExistingServer: false,
    },
  ],
});
