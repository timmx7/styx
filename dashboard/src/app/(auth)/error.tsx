"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

export default function AuthError({
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
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center">
        <h2 className="mb-2 text-lg font-semibold text-foreground">
          Authentication Error
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {error.message || "Something went wrong during authentication."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            aria-label="Try again"
          >
            Try again
          </button>
          <Link
            href="/login"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary"
            aria-label="Go to login page"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
