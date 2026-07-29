import { Skeleton } from "@/components/ui/skeleton";

export function ProfileSkeleton() {
  return (
    <div className="min-h-screen animate-pulse space-y-10 bg-white px-6 pb-24 pt-12">
      <div className="flex flex-col items-center space-y-6 text-center">
        <div className="relative size-24 rounded-[24px] bg-zinc-100" />
        <div className="flex flex-col items-center space-y-3">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-4 w-48 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-[2rem]" />
        ))}
      </div>
      <div className="space-y-4 pt-4">
        <Skeleton className="h-20 w-full rounded-[2rem]" />
        <Skeleton className="mx-auto h-10 w-32 rounded-lg" />
      </div>
    </div>
  );
}
