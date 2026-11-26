# CI & quality gates (Phase 10)

## One manual step: install the workflow

The automation account used to build this repo does not have GitHub's
Workflows permission, so `.github/workflows/ci.yml` cannot be pushed by it.
Install it once, in the GitHub web UI (≈2 minutes):

1. Open the repo → **Add file → Create new file**.
2. Name it exactly: `.github/workflows/ci.yml`
3. Paste the full contents of `ci/ci.yml` from this repo.
4. Commit to `main`.

From then on, every push and pull request runs two jobs:

- **App** — `npm ci`, typecheck, lint, Vitest unit tests, production build,
  and the Playwright smoke tests (login renders, protected routes redirect,
  the AI endpoint refuses anonymous calls).
- **Database** — installs PostgreSQL 16 + pgTAP, applies the platform stubs
  (`supabase/tests/platform-stubs.sql`) and every migration in order, then
  runs the pgTAP suites via `ci/run-db-tests.sh`. This job is marked
  `continue-on-error` until its first green run is observed (the suites were
  previously only replicated in a local harness); remove that line in the
  workflow once it passes.

`dependabot.yml` (in this folder, same install pattern →
`.github/dependabot.yml`) turns on weekly npm + Actions update PRs.

## Running the gates locally

```bash
npm test              # Vitest unit tests (src/**/*.test.ts)
npm run build         # production build (needs the two NEXT_PUBLIC_ vars)
npx playwright install chromium && npm run test:e2e   # smoke tests
PGHOST=... PGUSER=... ./ci/run-db-tests.sh            # DB suites (needs pgTAP)
```

## Sentry (error monitoring)

The SDK is wired and **env-gated**: with no DSN it is a no-op. To enable:

1. Create a project at sentry.io (Next.js platform) and copy its DSN.
2. In Vercel → Project → Settings → Environment Variables (Production), set
   `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` to that DSN.
3. Redeploy. Client, server, and edge errors now report to the project.
