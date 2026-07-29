import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ProductCardSkeleton } from "@/components/ui/custom/ProductCardSkeleton";
import { useStore } from "@/contexts/StoreContext";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import type { Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import { ArrowRight, Heart, ShoppingBag } from "lucide-react";
import React, { useCallback } from "react";
import { createPortal } from "react-dom";

interface FavoritesViewProps {
  favorites: Product[];
  loading?: boolean;
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  selectedProductId?: string;
  isActive?: boolean;
}

export const FavoritesView = React.memo(function FavoritesView({
  favorites,
  loading = false,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  selectedProductId,
  isActive = true,
}: FavoritesViewProps) {
  const { config } = useStore();
  const { prefetchView } = usePrefetchOnHover();
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(380);

  const handleToggleFavorite = useCallback(
    (product: Product) => {
      haptic.light();
      onToggleFavorite(product);
    },
    [onToggleFavorite],
  );

  const handleProductClick = useCallback(
    (productId: string) => {
      haptic.medium();
      onProductClick(productId);
    },
    [onProductClick],
  );

  const handlePrefetchProductDetail = useCallback(() => {
    prefetchView("product-detail");
  }, [prefetchView]);

  if (loading) {
    return (
      <div className="min-h-full overflow-x-hidden bg-zinc-50/30 pb-customer">
        {/* Header Premium - Minimalist & Compact */}
        <div className="sticky top-[-2px] z-40 flex items-center justify-between border-b border-zinc-100 bg-white/80 p-4 backdrop-blur-md transition-all duration-300 xs:px-6">
          <div className="flex items-center gap-2.5">
            <Heart className="size-4 fill-zinc-950/10 text-zinc-950" />
            <h1 className="pt-0.5 text-[13px] font-black uppercase tracking-[0.25em] text-zinc-950">
              Favoritos
            </h1>
          </div>
        </div>

        {/* Skeletons Grid */}
        <div className="px-4 py-2">
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            {Array.from({ length: 4 }).map((_, idx) => (
              <ProductCardSkeleton key={idx} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-white px-6 pb-customer pt-4">
        {/* Abstract Background Elements */}
        <div className="absolute left-[-10%] top-[-10%] -z-10 h-[400px] w-[400px] rounded-full bg-red-50/30 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] -z-10 h-[300px] w-[300px] rounded-full bg-zinc-100 blur-[100px]" />

        {/* Center Container - Illustration, Text & Action Button */}
        <div className="flex w-full max-w-xs flex-col items-center justify-center text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-8 sm:mb-12"
          >
            {/* Animated Icon Container */}
            <div className="relative mx-auto size-24 sm:size-32">
              <motion.div
                animate={{
                  y: [0, -8, 0],
                  scale: [1, 1.05, 1],
                }}
                transition={{
                  duration: 4,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="relative z-10 flex size-full items-center justify-center rounded-[3rem] border border-white/10 bg-zinc-950 p-4 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)]"
              >
                <Heart
                  size={40}
                  className="relative z-10 fill-white text-white"
                />
              </motion.div>

              {/* Decorative Rings */}
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.05, 0.2] }}
                transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
                className="absolute inset-0 -z-10 rounded-[3rem] border-2 border-zinc-100"
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-8 space-y-4 sm:mb-10"
          >
            <h2 className="text-3xl font-black uppercase italic leading-none tracking-tighter text-zinc-900 sm:text-5xl">
              Lista <br />
              <span className="text-2xl not-italic text-zinc-400 sm:text-3xl">
                Vazia
              </span>
            </h2>
            <p className="px-4 text-[10px] font-black uppercase leading-relaxed tracking-[0.3em] text-zinc-400 sm:text-sm">
              Salve seus favoritos aqui <br className="hidden sm:block" />
              para não perdê-los de vista!
            </p>
          </motion.div>

          {/* Action Button inside Center Container */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="w-full"
          >
            <button
              onClick={() => {
                haptic.medium();
                onNavigate("home");
              }}
              className="group relative w-full overflow-hidden rounded-2xl bg-zinc-950 p-px shadow-xl shadow-zinc-200 transition-all hover:scale-[1.02] active:scale-95"
            >
              <div className="relative flex items-center justify-center gap-3 rounded-2xl bg-zinc-950 px-8 py-4 transition-all group-hover:bg-zinc-900">
                <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white">
                  Explorar Produtos
                </span>
                <ArrowRight className="size-4 text-white transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full overflow-x-hidden bg-zinc-50/30 pb-customer">
      {/* Header Premium - Minimalist & Compact */}
      <div className="sticky top-[-2px] z-40 flex items-center justify-between border-b border-zinc-100 bg-white/80 p-4 backdrop-blur-md transition-all duration-300 xs:px-6">
        <div className="flex items-center gap-2.5">
          <Heart className="size-4 fill-zinc-950/10 text-zinc-950" />
          <h1 className="pt-0.5 text-[13px] font-black uppercase tracking-[0.25em] text-zinc-950">
            Favoritos
          </h1>
        </div>
        <div className="flex items-center">
          <span className="rounded-full border border-zinc-200/20 bg-zinc-100/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {favorites.length} {favorites.length === 1 ? "item" : "itens"}
          </span>
        </div>
      </div>

      {/* Products Grid with AnimatePresence */}
      <div className="px-4 py-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            {favorites.map((product, index) => (
              <motion.div
                key={product.id}
                layout
                className="flex h-full flex-col"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.1,
                  type: "spring",
                  stiffness: 100,
                  damping: 15,
                }}
              >
                <ProductCard
                  product={product}
                  isFavorite={true}
                  onToggleFavorite={handleToggleFavorite}
                  onClick={handleProductClick}
                  isEligibleForFreeShipping={config.freeShippingMin > 0}
                  onMouseEnter={handlePrefetchProductDetail}
                  onTouchStart={handlePrefetchProductDetail}
                  selectedProductId={selectedProductId}
                />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      </div>

      {/* Futuristic CTA - Portal to Body for Fixed Viewport Position */}
      {typeof document !== "undefined" &&
        document.body &&
        createPortal(
          <AnimatePresence>
            {isActive && isPresent && isReady && (
              <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+var(--safe-area-bottom,0px)+12px)] z-[90] px-6 md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="w-full"
                >
                  <button
                    onClick={() => {
                      haptic.medium();
                      onNavigate("home");
                    }}
                    className="group pointer-events-auto relative flex h-16 w-full items-center justify-center gap-4 overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/95 text-white shadow-[0_20px_50px_-10px_rgba(0,0,0,0.3)] backdrop-blur-2xl transition-all hover:bg-black active:scale-95"
                  >
                    <div className="relative z-10 flex items-center gap-3">
                      <ShoppingBag className="size-5 text-zinc-400 transition-colors group-hover:text-white" />
                      <span className="pt-0.5 text-[11px] font-black uppercase tracking-[0.3em]">
                        Descobrir Mais
                      </span>
                    </div>

                    {/* Animated Glow Effect */}
                    <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
                      <div className="animate-shimmer absolute left-1/4 top-0 h-full w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                    </div>

                    <ArrowRight className="size-4 text-zinc-500 transition-all group-hover:translate-x-1.5 group-hover:text-white" />
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
});
