import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
  return (
    // Laudo de acessibilidade 03/09, achado 12: a prateleira era silêncio
    // para leitor de tela — role="status" + sr-only anunciam "Carregando
    // produtos" e nada muda de visual (sr-only não renderiza).
    <div
      role="status"
      className="flex h-full flex-1 flex-col gap-0.5 overflow-hidden rounded-[2rem] border border-zinc-200/60 bg-zinc-50/30 p-2.5"
    >
      <span className="sr-only">Carregando produtos</span>
      {/* Image Skeleton */}
      <Skeleton className="mb-2 aspect-[4/5] w-full rounded-2xl" />

      {/* Category Skeleton */}
      <Skeleton className="mb-1 h-3 w-1/3" />

      {/* Title Skeleton */}
      <Skeleton className="mb-1 h-4 w-full" />
      <Skeleton className="mb-2 h-4 w-2/3" />

      {/* Price & Action Skeleton */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="space-y-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-8 w-16 flex-shrink-0 rounded-xl" />
      </div>
    </div>
  );
}
