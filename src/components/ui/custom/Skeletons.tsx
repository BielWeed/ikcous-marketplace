import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
    return (
        <div className="space-y-4">
            <Skeleton className="aspect-square w-full rounded-[2.5rem]" />
            <div className="space-y-2 px-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex justify-between items-center pt-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-8 w-8 rounded-xl" />
                </div>
            </div>
        </div>
    );
}

export function CategorySkeleton() {
    return (
        <div className="flex gap-4 overflow-x-auto pb-6 px-6 no-scrollbar">
            {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-28 rounded-full shrink-0" />
            ))}
        </div>
    );
}

export function BannerSkeleton() {
    return (
        <div className="px-4 mt-4">
            <Skeleton className="h-48 w-full rounded-[2.5rem]" />
        </div>
    );
}

export function HomeSkeleton() {
    return (
        <div className="min-h-screen pb-24 space-y-8">
            <Skeleton className="h-8 w-full" /> {/* Top bar */}
            <BannerSkeleton />
            <div className="px-6 space-y-4">
                <Skeleton className="h-6 w-48" />
                <div className="flex gap-4 overflow-x-auto no-scrollbar">
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-32 w-64 rounded-[2.5rem] shrink-0" />
                    ))}
                </div>
            </div>
            <CategorySkeleton />
            <div className="px-6 grid grid-cols-2 md:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <ProductCardSkeleton key={i} />
                ))}
            </div>
        </div>
    );
}

export function ProductViewSkeleton() {
    return (
        <div className="min-h-screen pb-24">
            <Skeleton className="aspect-square w-full" />
            <div className="p-8 space-y-6">
                <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-8 w-32" />
                <div className="space-y-4 pt-6">
                    <Skeleton className="h-20 w-full rounded-2xl" />
                    <Skeleton className="h-16 w-full rounded-2xl" />
                </div>
            </div>
        </div>
    );
}

export function DashboardSkeleton() {
    return (
        <div className="space-y-8 animate-in fade-in duration-500 p-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-10 w-32 rounded-xl" />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-6 rounded-[2rem] border border-zinc-100 bg-white/50 space-y-4">
                        <div className="flex justify-between items-start">
                            <Skeleton className="h-10 w-10 rounded-xl" />
                            <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-24" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Skeleton className="h-[400px] w-full rounded-[2.5rem]" />
                <Skeleton className="h-[400px] w-full rounded-[2.5rem]" />
            </div>

            {/* Recent Orders */}
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-20 w-full rounded-2xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function ProfileSkeleton() {
    return (
        <div className="min-h-screen pb-24 space-y-10 px-6 pt-12 animate-pulse bg-white">
            <div className="flex flex-col items-center space-y-6 text-center">
                <div className="relative w-24 h-24 bg-zinc-100 rounded-[24px]" />
                <div className="space-y-3 flex flex-col items-center">
                    <Skeleton className="h-10 w-64 rounded-lg" />
                    <Skeleton className="h-4 w-48 rounded-lg" />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-28 w-full rounded-[2rem]" />
                ))}
            </div>
            <div className="space-y-4 pt-4">
                <Skeleton className="h-20 w-full rounded-[2rem]" />
                <Skeleton className="h-10 w-32 mx-auto rounded-lg" />
            </div>
        </div>
    );
}
