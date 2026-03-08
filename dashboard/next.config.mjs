import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],
  eslint: {
    // Test files have their own lint rules; don't block production builds
    dirs: ["src/app", "src/components", "src/lib", "src/hooks"],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    NEXT_PUBLIC_ROUTER_URL: process.env.NEXT_PUBLIC_ROUTER_URL || "http://localhost:8080",
  },

  // ── Content Security Policy (D-C1) ─────────────────────────────────
  // A strict CSP that locks down what can load and execute on the page.
  // 'unsafe-inline' is required for the theme antiflash script and Tailwind
  // injected styles. No dynamic code execution directives are included.
  async headers() {
    const csp = [
      "default-src 'self'",
      // Scripts: self + inline (theme antiflash, JSON-LD) + Stripe.js
      "script-src 'self' 'unsafe-inline' https://js.stripe.com",
      // Styles: inline required for Tailwind and Next.js font injection
      "style-src 'self' 'unsafe-inline'",
      // Fonts: Next.js/font self-hosts at build time; data: for icon fonts
      "font-src 'self' data:",
      // Images: data URIs for icons/placeholders, blob for canvas exports
      "img-src 'self' data: blob: https:",
      // API/WS connections: backend, router, Stripe, Supabase auth, Sentry
      // NEXT_PUBLIC_API_URL is baked at build time (e.g. http://localhost:8000 in dev)
      // NEXT_PUBLIC_ROUTER_URL is the Go router (e.g. http://localhost:8080 in dev)
      `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"} ${process.env.NEXT_PUBLIC_ROUTER_URL || "http://localhost:8080"} https://api.stripe.com https://*.supabase.co wss://*.supabase.co https://ingest.sentry.io`,
      // Stripe payment iframe
      "frame-src https://js.stripe.com",
      // Block plugins/objects entirely
      "object-src 'none'",
      // Restrict base tag to same origin (prevents base-tag hijacking)
      "base-uri 'self'",
      // Forms can only submit to same origin
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

// Wrap with Sentry only if DSN is configured (no-op otherwise)
const sentryConfig = {
  // Suppress source map upload warnings when no auth token is set
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Don't widen the scope of the build process
  disableLogger: true,
};

export default withSentryConfig(nextConfig, sentryConfig);
