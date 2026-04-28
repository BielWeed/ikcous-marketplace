import { memo } from 'react';
import { Heart, Truck, Flame, ShoppingCart } from 'lucide-react';
import type { Product } from '@/types';
import { StarRating } from './StarRating';
import { Badge } from '@/components/ui/badge';
import { StockStatus } from './StockStatus';
import { UrgencyBadge } from './UrgencyBadge';
import { cn } from '@/lib/utils';
import { useStore } from '@/contexts/StoreContext';

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onAddToCart?: (e: React.MouseEvent) => void;
  onQuickBuy?: (e: React.MouseEvent) => void;
  onClick: () => void;
  className?: string;
  priority?: boolean;
}

export const ProductCard = memo(function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onQuickBuy,
  onClick,
  className,
  priority = false
}: Readonly<ProductCardProps>) {
  const { config } = useStore();
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const isEligibleForFreeShipping = config.freeShippingMin > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group bg-zinc-50/30 rounded-[2.5rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-all duration-500 cursor-pointer border border-zinc-200/60 flex flex-col relative active:scale-[0.98] h-full",
        className
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-50">
        <img
          src={product.images[0]}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding={priority ? "sync" : "async"}
        />

        {/* Action Buttons */}
        <div className="absolute top-3 right-3 flex flex-col gap-2 translate-x-12 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-500 ease-out">
          <button
            onClick={onToggleFavorite}
            className={cn(
              "p-2.5 rounded-full glass transition-all active:scale-75",
              isFavorite ? "bg-red-500 text-white border-red-500/20 shadow-lg shadow-red-200/50" : "text-slate-600 hover:text-red-500"
            )}
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Floating Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start max-w-[calc(100%-48px)]">
          {product.stock > 0 ? (
            <UrgencyBadge stock={product.stock} className="mb-0" />
          ) : (
            <StockStatus stock={product.stock} className="mb-0" />
          )}
          {discount > 0 && (
            <Badge variant="destructive" className="bg-red-500 border-none px-2 py-0.5 rounded-md shadow-lg shadow-red-200/50 font-black text-[10px] whitespace-nowrap">
              {discount}% OFF
            </Badge>
          )}
          {product.isBestseller && (
            <Badge className="bg-slate-900/90 backdrop-blur-md border-none px-2 py-0.5 rounded-md shadow-lg flex items-center gap-1 font-black text-[10px] whitespace-nowrap">
              <Flame className="w-3 h-3 text-orange-400 fill-orange-400" />
              HOT
            </Badge>
          )}
        </div>

      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col gap-1">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest truncate max-w-[80%]">
              {product.category}
            </p>
            {isEligibleForFreeShipping && (
              <div className="flex shrink-0 items-center gap-1 bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-md text-[8px] font-black border border-emerald-100/50">
                <Truck className="w-2.5 h-2.5 animate-bounce-subtle shrink-0" />
                <span className="truncate">Frete Grátis</span>
              </div>
            )}
          </div>
          <h3 className="text-[14px] font-black text-slate-900 line-clamp-2 leading-tight group-hover:text-primary transition-colors duration-300 min-h-[2.5rem]">
            {product.name}
          </h3>
        </div>

        {/* Rating and Price */}
        <div className="flex items-end justify-between mt-1 gap-2">
          <div className="flex flex-col min-w-0">
            {product.originalPrice && product.originalPrice > product.price && (
              <span className="text-[10px] text-slate-400 line-through font-bold truncate">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.originalPrice)}
              </span>
            )}
            <span className="text-[16px] font-black text-slate-900 tracking-tight truncate leading-none mt-0.5">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price)}
            </span>
          </div>
          <div className="shrink-0 mb-0.5">
            <StarRating rating={product.rating || 5} size={12} />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap gap-1.5 mt-2">
          <button
            onClick={onAddToCart}
            className="flex-1 min-w-[70px] bg-zinc-900 hover:bg-black text-white py-2 px-1.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] shadow-[0_4px_10px_rgba(0,0,0,0.1)] flex items-center justify-center gap-1"
          >
            <ShoppingCart className="w-3 h-3 shrink-0" />
            <span className="truncate">Carrinho</span>
          </button>
          <button
            onClick={onQuickBuy}
            className="flex-1 min-w-[50px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/50 py-2 px-1.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center truncate"
          >
            Comprar
          </button>
        </div>
      </div>
    </div>
  );
});

