import { Skeleton, CardSkeleton } from "@/components/ui/skeleton";

export default function BillingLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <div className="grid gap-4 md:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <Skeleton className="h-[200px] w-full rounded-xl" />
    </div>
  );
}
