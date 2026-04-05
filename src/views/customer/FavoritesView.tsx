import { motion, AnimatePresence } from 'framer-motion';
import { Heart, ShoppingBag, ArrowRight, Sparkles } from 'lucide-react';
import type { Product, View } from '@/types';
import { ProductCard } from '@/components/ui/custom/ProductCard';
import { haptic } from '@/utils/haptic';

interface FavoritesViewProps {
  favorites: Product[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
}

export function FavoritesView({
  favorites,
  onToggleFavorite,
  onProductClick,
  onNavigate
}: FavoritesViewProps) {
  if (favorites.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center px-6 pt-4 pb-20 bg-white relative overflow-hidden">
        {/* Abstract Background Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[400px] h-[400px] bg-red-50/30 rounded-full blur-[120px] -z-10" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[300px] h-[300px] bg-zinc-100 rounded-full blur-[100px] -z-10" />

        {/* Top/Center Container - Illustration & Text */}
        <div className="flex-1 flex flex-col items-center justify-center text-center max-w-xs w-full">
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-8 sm:mb-12"
          >
            {/* Animated Icon Container */}
            <div className="relative w-24 h-24 sm:w-32 sm:h-32 mx-auto">
              <motion.div
                animate={{
                  y: [0, -8, 0],
                  scale: [1, 1.05, 1]
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-full h-full bg-zinc-950 rounded-[3rem] flex items-center justify-center shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)] border border-white/10 relative z-10 p-4"
              >
                <Heart size={40} className="text-white fill-white relative z-10" />
              </motion.div>

              {/* Decorative Rings */}
              <motion.div
                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.05, 0.2] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="absolute inset-0 border-2 border-zinc-100 rounded-[3rem] -z-10"
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-4"
          >
            <h2 className="text-3xl sm:text-5xl font-black text-zinc-900 tracking-tighter leading-none italic uppercase">
              Lista <br />
              <span className="text-zinc-400 not-italic text-2xl sm:text-3xl">Vazia</span>
            </h2>
            <p className="text-[10px] sm:text-sm font-black uppercase tracking-[0.3em] text-zinc-400 leading-relaxed px-4">
              Salve seus favoritos aqui <br className="hidden sm:block" />
              para não perdê-los de vista!
            </p>
          </motion.div>
        </div>

        {/* Bottom Container - Action Button */}
        <div className="w-full max-w-xs mt-auto">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <button
              onClick={() => {
                haptic.medium();
                onNavigate('home');
              }}
              className="w-full group relative overflow-hidden rounded-2xl bg-zinc-950 p-px transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-zinc-200"
            >
              <div className="relative flex items-center justify-center gap-3 bg-zinc-950 px-8 py-4 transition-all group-hover:bg-zinc-900 rounded-2xl">
                <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white">
                  Explorar Produtos
                </span>
                <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full pb-48 bg-zinc-50/30 overflow-x-hidden">
      {/* Header Premium */}
      <div className="px-6 pt-12 pb-8 bg-gradient-to-b from-white to-transparent flex flex-col mb-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-zinc-400 fill-zinc-400/10" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-400 leading-none pt-1">
              Curadoria Elite
            </span>
          </div>
          <h1 className="text-5xl font-black tracking-tighter text-zinc-900 leading-none mb-3 italic uppercase">
            Desejos
          </h1>
          <div className="flex items-center gap-3">
            <div className="h-1 w-12 bg-zinc-900 rounded-full" />
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              {favorites.length} {favorites.length === 1 ? 'Escolha Premium' : 'Escolhas Premium'}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Products Grid with AnimatePresence */}
      <div className="px-4 py-2">
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            {favorites.map((product, index) => (
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.1,
                  type: "spring",
                  stiffness: 100,
                  damping: 15
                }}
              >
                <ProductCard
                  product={product}
                  isFavorite={true}
                  onToggleFavorite={(e) => {
                    e.stopPropagation();
                    haptic.light();
                    onToggleFavorite(product);
                  }}
                  onClick={() => {
                    haptic.medium();
                    onProductClick(product.id);
                  }}
                />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      </div>

      {/* Futuristic Floating CTA */}
      <div className="fixed bottom-24 left-6 right-6 z-40">
        <motion.button
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.5, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => {
            haptic.medium();
            onNavigate('home');
          }}
          className="w-full group relative overflow-hidden h-16 bg-zinc-950/95 backdrop-blur-2xl text-white rounded-[2rem] border border-white/10 hover:bg-black transition-all flex items-center justify-center gap-4 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.3)] active:scale-95"
        >
          <div className="flex items-center gap-3 relative z-10">
            <ShoppingBag className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
            <span className="text-[11px] font-black uppercase tracking-[0.3em] pt-0.5">
              Descobrir Mais
            </span>
          </div>

          {/* Animated Glow Effect */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <div className="absolute top-0 left-1/4 w-1/2 h-full bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-[-20deg] animate-shimmer" />
          </div>

          <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white group-hover:translate-x-1.5 transition-all" />
        </motion.button>
      </div>
    </div>
  );
}
