import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function KeysLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}
