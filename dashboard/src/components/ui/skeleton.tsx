"use client";

import { cn } from "@/lib/utils";

/** Skeleton loading placeholder — replaces spinners for better perceived performance. */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/** Card skeleton with title, subtitle, and content area. */
function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-6 space-y-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

/** Table skeleton with header and rows. */
function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex gap-4 px-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 px-4 py-2">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={`r-${rowIdx}-${colIdx}`}
              className="h-4 flex-1"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart skeleton — a rectangular area with animated gradient. */
function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-6 space-y-4", className)}>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-[200px] w-full" />
    </div>
  );
}

/** Stats grid skeleton — for the overview dashboard cards. */
function StatsGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Page skeleton — full page loading state with stats + chart + table. */
function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <StatsGridSkeleton />
      <ChartSkeleton />
      <TableSkeleton />
    </div>
  );
}

export {
  Skeleton,
  CardSkeleton,
  TableSkeleton,
  ChartSkeleton,
  StatsGridSkeleton,
  PageSkeleton,
};
