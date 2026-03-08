import { StatsGridSkeleton, ChartSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6">
      <StatsGridSkeleton />
      <ChartSkeleton />
      <ChartSkeleton />
      <TableSkeleton />
    </div>
  );
}
