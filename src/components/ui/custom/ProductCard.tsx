import { memo, useState } from 'react';
import { Heart, Truck, Flame, ShoppingCart, Check, Loader2 } from 'lucide-react';
import type { Product } from '@/types';
import { StarRating } from './StarRating';
import { Badge } from '@/components/ui/badge';
import { StockStatus } from './StockStatus';
import { UrgencyBadge } from './UrgencyBadge';
import { cn, formatCurrency } from '@/lib/utils';
import { LazyImage } from '@/components/LazyImage';
import { triggerFlyingCartAnimation } from '@/utils/cartAnimation';

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product, e: React.MouseEvent) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
  onQuickBuy?: (product: Product, e: React.MouseEvent) => void;
  onClick: (productId: string) => void;
  onMouseEnter?: (productId: string) => void;
  onTouchStart?: (productId: string) => void;
  className?: string;
  priority?: boolean;
  isEligibleForFreeShipping?: boolean;
  selectedProductId?: string;
}

export const ProductCard = memo(function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onQuickBuy,
  onClick,
  onMouseEnter,
  onTouchStart,
  className,
  priority = false,
  isEligibleForFreeShipping = false,
  selectedProductId
}: Readonly<ProductCardProps>) {
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const [cartStatus, setCartStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cartStatus !== 'idle') return;

    setCartStatus('loading');

    if (onAddToCart) {
      onAddToCart(product, e);
    }

    const startEl = (e.currentTarget as HTMLElement) || document.body;
    triggerFlyingCartAnimation(startEl, product.images[0]);

    setTimeout(() => {
      setCartStatus('success');
      setTimeout(() => {
        setCartStatus('idle');
      }, 1500);
    }, 600);
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const img = e.currentTarget.querySelector('img');
    if (img) {
      img.style.viewTransitionName = 'product-image';
    }
    onClick(product.id);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const img = e.currentTarget.querySelector('img');
      if (img) {
        img.style.viewTransitionName = 'product-image';
      }
      onClick(product.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onMouseEnter={onMouseEnter ? () => onMouseEnter(product.id) : undefined}
      onTouchStart={onTouchStart ? () => onTouchStart(product.id) : undefined}
      onKeyDown={handleCardKeyDown}
      className={cn(
        "group bg-zinc-50/30 rounded-[2.5rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-[transform,box-shadow,background-color] duration-300 ease-out cursor-pointer border border-zinc-200/60 flex flex-col relative active:scale-[0.98] h-full gpu-accelerated",
        className
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-50">
        <LazyImage
          src={product.images[0]}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out"
          priority={priority}
          style={selectedProductId === product.id ? { viewTransitionName: 'product-image' } : undefined}
        />

        {/* Action Buttons */}
        <div className="absolute top-3 right-3 flex flex-col gap-2 translate-x-12 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-500 ease-out">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(product, e);
            }}
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
            {(isEligibleForFreeShipping || product.freeShipping) && (
              <div className="flex shrink-0 items-center gap-1 bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-md text-[8px] font-black border border-emerald-100/50">
                <Truck className="w-2.5 h-2.5 animate-bounce-subtle shrink-0" />
                <span className="truncate">Frete Grátis</span>
              </div>
            )}
          </div>
          <h3 className="text-[14px] font-black text-slate-900 line-clamp-2 leading-tight group-hover:text-primary transition-colors duration-300 min-h-[2.5rem]">
            {product.name}
          </h3>
          <div className="flex items-center pt-0.5">
            <StarRating rating={product.rating || 5} size={11} />
          </div>
        </div>

        {/* Price */}
        <div className="flex items-end mt-auto pt-1">
          <div className="flex flex-col w-full">
            {product.originalPrice && product.originalPrice > product.price ? (
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-none">
                  De: <span className="line-through">{formatCurrency(product.originalPrice)}</span>
                </span>
                <span className="text-[15px] font-black text-rose-600 tracking-tight leading-none mt-1">
                  Por: {formatCurrency(product.price)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-[9px] text-transparent select-none leading-none">Spacer</span>
                <span className="text-[15px] font-black text-slate-900 tracking-tight leading-none mt-1">
                  {formatCurrency(product.price)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap gap-1.5 mt-2">
          <button
            onClick={handleAddToCartClick}
            disabled={product.stock <= 0 || cartStatus !== 'idle'}
            className={cn(
              "flex-1 min-w-[70px] py-2 px-1.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] shadow-[0_4px_10px_rgba(0,0,0,0.1)] flex items-center justify-center gap-1",
              product.stock <= 0 
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none" 
                : cartStatus === 'success' 
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
                  : "bg-zinc-900 hover:bg-black text-white"
            )}
          >
            {cartStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
            {cartStatus === 'success' && <Check className="w-3 h-3 shrink-0" />}
            {cartStatus === 'idle' && product.stock > 0 && <ShoppingCart className="w-3 h-3 shrink-0" />}
            <span className="truncate">
              {product.stock <= 0 
                ? 'Esgotado' 
                : cartStatus === 'idle' 
                  ? 'Carrinho' 
                  : cartStatus === 'loading' 
                    ? 'Salvando...' 
                    : 'Salvo!'}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickBuy?.(product, e);
            }}
            disabled={product.stock <= 0}
            className={cn(
              "flex-1 min-w-[50px] py-2 px-1.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center truncate",
              product.stock <= 0
                ? "bg-zinc-50 text-zinc-300 border border-zinc-100 cursor-not-allowed"
                : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/50"
            )}
          >
            Comprar
          </button>
        </div>
      </div>
    </div>
  );
});
