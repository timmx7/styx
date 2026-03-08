// Sentry client-side initialization — loaded in the browser.
// Configure NEXT_PUBLIC_SENTRY_DSN in your .env to activate.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Performance: sample 10% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Session replay: capture 1% normally, 100% on error
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration(),
    ],

    // Don't send PII
    sendDefaultPii: false,

    // Filter noisy errors
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection",
      "Network request failed",
    ],
  });
}
