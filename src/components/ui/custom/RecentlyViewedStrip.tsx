import { Clock, ChevronRight } from 'lucide-react';
import type { Product, View } from '@/types';

interface RecentlyViewedStripProps {
  products: Product[];
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
}

export function RecentlyViewedStrip({ products, onProductClick, onNavigate }: RecentlyViewedStripProps) {
  if (products.length === 0) return null;

  return (
    <div className="bg-white py-8 border-b border-zinc-50">
      <div className="flex items-center justify-between px-6 mb-5">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-0.5">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Pausa para Relembrar</span>
          </div>
          <h2 className="font-black text-xl tracking-tighter text-zinc-900">Vistos Recentemente</h2>
        </div>
        <button
          onClick={() => onNavigate('recently-viewed')}
          className="w-10 h-10 bg-zinc-50 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all duration-300 active:scale-90"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto px-6 pb-2 scrollbar-hide">
        {products.slice(0, 10).map((product) => (
          <button
            key={product.id}
            onClick={() => onProductClick(product.id)}
            className="flex-shrink-0 w-24 text-left group"
          >
            <div className="w-24 h-24 rounded-3xl overflow-hidden bg-zinc-50 mb-3 group-hover:shadow-xl group-hover:shadow-zinc-200 transition-all duration-500 group-hover:-translate-y-1">
              <img
                src={product.images[0]}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              />
            </div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider line-clamp-1 mb-0.5">{product.category}</p>
            <p className="text-xs text-zinc-900 font-black line-clamp-1 leading-tight tracking-tight">{product.name}</p>
            <p className="text-[10px] font-black mt-1 text-zinc-900">
              R$ {product.price.toFixed(2).replace('.', ',')}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
