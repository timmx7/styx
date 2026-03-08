import { Skeleton, CardSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function RoutingLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <CardSkeleton />
      <TableSkeleton rows={5} cols={3} />
    </div>
  );
}
