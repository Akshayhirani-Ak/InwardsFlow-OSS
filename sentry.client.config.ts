// InwardsFlow — Sentry (browser). Phase 10. See sentry.server.config.ts.
// The client can only see NEXT_PUBLIC_* variables, so production enablement
// is: set NEXT_PUBLIC_SENTRY_DSN in Vercel (and SENTRY_DSN for the server).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  debug: false,
});
