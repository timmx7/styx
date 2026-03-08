"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body className="bg-black text-white flex items-center justify-center min-h-screen font-sans">
        <div className="text-center max-w-md px-6">
          <h1 className="text-4xl font-bold mb-4">Something went wrong</h1>
          <p className="text-white/60 mb-8">
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={reset}
            className="px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 transition-colors font-medium"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
