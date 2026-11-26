import { defineConfig } from '@playwright/test';

// Phase 10 smoke tests. By default Playwright boots the production build
// (`npm run build` first) with placeholder Supabase env — the smoke tests
// only assert public behaviour (login renders, protected routes redirect,
// the AI endpoint refuses anonymous calls), never real data. Set
// PLAYWRIGHT_BASE_URL to run against a deployed environment instead.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: { baseURL },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
        },
      },
});
