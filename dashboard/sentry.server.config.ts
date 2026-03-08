// Sentry server-side initialization — runs in Node.js server context.
// Configure SENTRY_DSN in your .env to activate.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Performance: sample 10% in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Don't send PII
    sendDefaultPii: false,
  });
}
