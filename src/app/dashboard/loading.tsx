import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-8 h-4 w-72" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-4 !p-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-28" /></Card>
        ))}
      </div>
      <Skeleton className="mb-3 mt-10 h-6 w-32" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
      </div>
    </div>
  );
}
