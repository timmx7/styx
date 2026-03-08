import { Skeleton, ChartSkeleton } from "@/components/ui/skeleton";

export default function PromptsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <ChartSkeleton className="h-[400px]" />
    </div>
  );
}
