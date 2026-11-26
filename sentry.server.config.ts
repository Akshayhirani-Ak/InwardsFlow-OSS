// InwardsFlow — Sentry (server). Phase 10.
// Env-gated: with no DSN set the SDK stays disabled and this is a no-op, so
// local dev and CI builds behave exactly as before. To enable in production,
// create a project at sentry.io and set SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN)
// in the Vercel project env.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  debug: false,
});
