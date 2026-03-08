import { Skeleton, StatsGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function AlertsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <StatsGridSkeleton count={3} />
      <TableSkeleton rows={5} cols={3} />
    </div>
  );
}
