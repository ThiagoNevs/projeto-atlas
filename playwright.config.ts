import { defineConfig, devices } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:3101';
const webUrl = 'http://127.0.0.1:3100';
const issuerUrl = 'http://127.0.0.1:3199';
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
      command: 'node tests/auth/test-oidc-provider.mjs',
      url: `${issuerUrl}/.well-known/openid-configuration`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        TEST_OIDC_ISSUER: issuerUrl,
        TEST_WEB_URL: webUrl,
        TEST_AUTH_AUDIENCE: apiUrl,
        TEST_AUTH_CLIENT_ID: 'atlas-web',
      },
    },
    {
      command: 'corepack pnpm --filter @atlas/api exec nest start',
      url: `${apiUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: e2eDatabaseUrl,
        FINDING_REVIEW_CASES_ENABLED: 'true',
        PORT: '3101',
        WEB_ORIGIN: webUrl,
        AUTH_ISSUER: issuerUrl,
        AUTH_AUDIENCE: apiUrl,
        AUTH_ALLOWED_ALGORITHMS: 'RS256',
        AUTH_CLOCK_TOLERANCE_SECONDS: '0',
        AUTH_JWKS_URI: `${issuerUrl}/jwks`,
        AUTH_HUMAN_CLIENT_ID: 'atlas-web',
        AUTH_ROLE_CLAIM: 'groups',
        AUTH_ATLAS_ACCESS_VALUES: 'atlas-user',
      },
    },
    {
      command: 'corepack pnpm --filter @atlas/web dev --hostname 127.0.0.1 --port 3100',
      url: `${webUrl}/conflict-review-cases`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_AUTH_ISSUER: issuerUrl,
        NEXT_PUBLIC_AUTH_CLIENT_ID: 'atlas-web',
        NEXT_PUBLIC_AUTH_AUDIENCE: apiUrl,
        NEXT_PUBLIC_AUTH_SCOPE: 'openid profile atlas:access',
        NEXT_PUBLIC_AUTH_REDIRECT_URI: `${webUrl}/auth/callback`,
        NEXT_PUBLIC_AUTH_POST_LOGOUT_REDIRECT_URI: webUrl,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
