"use client";

import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-6 animate-pulse",
        className,
      )}
    >
      <div className="space-y-3">
        <div className="h-3 w-1/3 rounded bg-muted" />
        <div className="h-8 w-1/2 rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden animate-pulse",
        className,
      )}
    >
      {/* Header */}
      <div className="flex gap-4 border-b border-border px-6 py-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-3 flex-1 rounded bg-muted" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex gap-4 border-b border-border/50 px-6 py-4 last:border-0"
        >
          {Array.from({ length: columns }).map((_, col) => (
            <div
              key={col}
              className="h-3 flex-1 rounded bg-muted"
              style={{ width: `${60 + Math.random() * 40}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-6 animate-pulse",
        className,
      )}
    >
      <div className="mb-4 space-y-2">
        <div className="h-3 w-1/4 rounded bg-muted" />
        <div className="h-3 w-1/3 rounded bg-muted" />
      </div>
      <div className="flex h-[200px] items-end gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-muted"
            style={{ height: `${30 + Math.random() * 70}%` }}
          />
        ))}
      </div>
    </div>
  );
}
