import { defineConfig, devices } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3101';
const webUrl = 'http://127.0.0.1:3100';
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;

if (!e2eDatabaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL is required and must point to a dedicated browser E2E database.',
  );
}

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'test-results',
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'corepack pnpm --filter @atlas/api exec nest start',
      url: `${apiUrl}/conflict-review-cases?pageSize=10`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: e2eDatabaseUrl,
        FINDING_REVIEW_CASES_ENABLED: 'true',
        PORT: '3101',
        WEB_ORIGIN: webUrl,
      },
    },
    {
      command: 'corepack pnpm --filter @atlas/web dev --hostname 127.0.0.1 --port 3100',
      url: `${webUrl}/conflict-review-cases`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
