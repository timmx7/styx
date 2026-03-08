import { Skeleton, CardSkeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/4" />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
