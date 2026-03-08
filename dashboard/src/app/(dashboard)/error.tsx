"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

export default function DashboardError({
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
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          Page Error
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {error.message || "This page encountered an error. Your data is safe."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:ring-offset-2"
            aria-label="Retry loading this page"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
          <Link
            href="/overview"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:ring-offset-2"
            aria-label="Go to dashboard home"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
