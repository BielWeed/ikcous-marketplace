import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ProductCardSkeleton } from "@/components/ui/custom/ProductCardSkeleton";
import { useStore } from "@/contexts/StoreContext";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import type { Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import { ArrowRight, Heart, ShoppingBag, Sparkles } from "lucide-react";
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
  const { config, products } = useStore();
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
      <div className="pb-customer min-h-full overflow-x-hidden bg-zinc-50/30">
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
    const suggestedProducts = products?.slice(0, 4) || [];

    return (
      <div className="pb-customer relative flex min-h-full flex-col items-center justify-start overflow-x-hidden bg-gradient-to-b from-rose-50/70 via-pink-50/30 to-white px-4 py-8 sm:px-6">
        {/* Soft Ambient Background Elements & Cherry Blossom Blooms */}
        <div className="absolute left-[-15%] top-[-5%] -z-10 h-[380px] w-[380px] rounded-full bg-rose-200/40 blur-[110px]" />
        <div className="absolute right-[-15%] top-[20%] -z-10 h-[300px] w-[300px] rounded-full bg-pink-300/30 blur-[120px]" />
        <div className="absolute bottom-[5%] left-[20%] -z-10 h-[250px] w-[250px] rounded-full bg-rose-100/60 blur-[90px]" />

        {/* Hero Section Container */}
        <div className="flex w-full max-w-sm flex-col items-center justify-center text-center">
          {/* Brand Badge - Price Point & Store Persona */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-rose-200/80 bg-white/90 px-4 py-1.5 shadow-sm backdrop-blur-md"
          >
            <Sparkles className="size-3.5 fill-rose-500/20 text-rose-500 animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-wider text-[#5C061E]">
              Preço Único R$ 10,00 • SR Tudo 10
            </span>
          </motion.div>

          {/* Animated Hero Illustration with Cherry Blossom Petals */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-6"
          >
            {/* Animated Petals Floating Around */}
            <motion.div
              animate={{
                y: [-6, 6, -6],
                rotate: [0, 15, -10, 0],
                opacity: [0.7, 1, 0.7],
              }}
              transition={{
                duration: 5,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
              className="pointer-events-none absolute -left-6 top-2 text-rose-300"
            >
              🌸
            </motion.div>

            <motion.div
              animate={{
                y: [6, -6, 6],
                rotate: [0, -15, 10, 0],
                opacity: [0.6, 0.9, 0.6],
              }}
              transition={{
                duration: 4.2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
                delay: 0.5,
              }}
              className="pointer-events-none absolute -right-5 bottom-4 text-pink-300 text-xl"
            >
              🌸
            </motion.div>

            {/* Glowing Heart Icon Container */}
            <div className="relative mx-auto size-28 sm:size-32">
              <motion.div
                animate={{
                  y: [0, -10, 0],
                  scale: [1, 1.03, 1],
                }}
                transition={{
                  duration: 3.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="relative z-10 flex size-full items-center justify-center rounded-[2.8rem] border border-white/40 bg-gradient-to-tr from-[#5C061E] via-rose-600 to-rose-400 p-4 shadow-[0_20px_45px_-10px_rgba(199,65,86,0.38)]"
              >
                <Heart
                  size={46}
                  className="relative z-10 fill-white text-white drop-shadow-md"
                />
              </motion.div>

              {/* Glowing Pulse Rings */}
              <motion.div
                animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.08, 0.35] }}
                transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
                className="absolute inset-0 -z-10 rounded-[2.8rem] border-2 border-rose-300/60 bg-rose-200/20"
              />
            </div>
          </motion.div>

          {/* Copywriting - Tom de Amiga & Warm Persona */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-6 space-y-2.5"
          >
            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 sm:text-3xl">
              Sua lista de desejos <br />
              <span className="bg-gradient-to-r from-[#5C061E] via-rose-600 to-pink-500 bg-clip-text text-transparent italic not-italic">
                tá tão vazia... 💕
              </span>
            </h2>
            <p className="px-2 text-xs font-medium leading-relaxed text-slate-600 sm:text-sm">
              Que tal rechear com as makes e acessórios mais fofos de Monte
              Carmelo? Tudo com aquele preço único incrível de{" "}
              <span className="font-bold text-[#5C061E]">R$ 10,00</span>!
            </p>
          </motion.div>

          {/* Primary Action Button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="w-full"
          >
            <button
              onClick={() => {
                haptic.medium();
                onNavigate("home");
              }}
              className="group relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl border border-rose-400/30 bg-gradient-to-r from-[#5C061E] via-rose-700 to-rose-600 px-5 text-white shadow-[0_12px_28px_-6px_rgba(199,65,86,0.4)] transition-all hover:scale-[1.02] active:scale-95"
            >
              <div className="relative z-10 flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-white/15 text-rose-200">
                  <Sparkles className="size-4 fill-rose-200/30 text-rose-100 animate-pulse" />
                </div>
                <span className="text-[12px] font-black uppercase tracking-wider text-white">
                  Explorar por R$ 10,00
                </span>
              </div>

              <div className="relative z-10 flex size-8 items-center justify-center rounded-xl bg-white/20 text-white backdrop-blur-sm transition-transform group-hover:translate-x-1">
                <ArrowRight className="size-4 text-white" />
              </div>

              {/* Shimmer overlay */}
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
            </button>
          </motion.div>
        </div>

        {/* Quick Suggestions Block - Queridinhos de R$ 10 */}
        {suggestedProducts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="mt-10 w-full max-w-md border-t border-rose-100/80 pt-6"
          >
            <div className="mb-4 text-center">
              <span className="inline-block rounded-full bg-rose-100/70 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#5C061E]">
                ✨ Destaques por R$ 10,00
              </span>
              <h3 className="mt-1 text-sm font-black uppercase tracking-tight text-slate-800">
                Mais Amados da Loja
              </h3>
              <p className="text-[11px] font-medium text-slate-500">
                Toque no coraçãozinho para salvar nos seus favoritos!
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {suggestedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  isFavorite={false}
                  onToggleFavorite={handleToggleFavorite}
                  onClick={handleProductClick}
                  isEligibleForFreeShipping={config.freeShippingMin > 0}
                  onMouseEnter={handlePrefetchProductDetail}
                  onTouchStart={handlePrefetchProductDetail}
                  selectedProductId={selectedProductId}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-customer-summary min-h-full overflow-x-hidden bg-zinc-50/30">
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
              <div className="bottom-docked-navigation pointer-events-none fixed inset-x-0 z-[90] px-6 md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2">
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
                    className="group pointer-events-auto relative flex h-16 w-full items-center justify-center gap-4 overflow-hidden rounded-[2rem] border border-rose-200/40 bg-white/95 text-slate-800 shadow-[0_20px_50px_-10px_rgba(199,65,86,0.15)] backdrop-blur-2xl transition-all hover:bg-rose-50/50 active:scale-95"
                  >
                    <div className="relative z-10 flex items-center gap-3">
                      <ShoppingBag className="size-5 text-rose-500" />
                      <span className="pt-0.5 text-[11px] font-black uppercase tracking-[0.3em] text-slate-800">
                        Descobrir Mais
                      </span>
                    </div>

                    {/* Animated Glow Effect */}
                    <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
                      <div className="animate-shimmer absolute left-1/4 top-0 h-full w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-rose-500/5 to-transparent" />
                    </div>

                    <ArrowRight className="size-4 text-rose-500 transition-all group-hover:translate-x-1.5" />
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
