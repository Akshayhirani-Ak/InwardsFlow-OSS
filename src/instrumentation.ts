// InwardsFlow — Next.js instrumentation hook (Phase 10): loads the Sentry
// server/edge configs in the right runtime. Both configs are env-gated
// no-ops until a DSN is configured.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
