import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
    return (
        <div className="bg-white rounded-xl overflow-hidden border border-gray-100 shadow-sm p-3">
            {/* Image Skeleton */}
            <Skeleton className="aspect-square w-full rounded-lg mb-3" />

            {/* Category Skeleton */}
            <Skeleton className="h-3 w-1/3 mb-1.5" />

            {/* Title Skeleton */}
            <Skeleton className="h-4 w-full mb-1" />
            <Skeleton className="h-4 w-2/3 mb-3" />

            {/* Price & Action Skeleton */}
            <div className="flex items-center justify-between gap-2 mt-auto">
                <div className="space-y-1">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-5 w-20" />
                </div>
                <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
            </div>
        </div>
    );
}
