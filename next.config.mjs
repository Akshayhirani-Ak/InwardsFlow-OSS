import pkg from '@sentry/nextjs/config';

const { withSentryConfig } = pkg;

// Sentry wrap (Phase 10): injects the client config and SDK plumbing.
// Without a DSN the SDK stays disabled at runtime; without an auth token
// no source maps are uploaded — builds stay self-contained.
/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Loads src/instrumentation.ts (Sentry server/edge init, Phase 10).
    instrumentationHook: true,
  },
  eslint: {
    // Lint runs in CI and locally; builds must not silently skip it.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config) => {
    // Phase 36: pdfjs-dist (client-side PDF rasterising for oversized
    // scans) optionally requires the Node 'canvas' package for server
    // rendering. In the browser bundle it must resolve to nothing —
    // pdf.js only touches it under Node.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, { silent: true });
