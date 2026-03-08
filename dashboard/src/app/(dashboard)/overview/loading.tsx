import { StatsGridSkeleton, ChartSkeleton } from "@/components/ui/skeleton";

export default function OverviewLoading() {
  return (
    <div className="space-y-6">
      <StatsGridSkeleton />
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
}
