import { ArrowLeft, Clock, Trash2 } from 'lucide-react';
import type { Product, View } from '@/types';
import { ProductCard } from '@/components/ui/custom/ProductCard';

interface RecentlyViewedViewProps {
  products: Product[];
  favorites: string[];
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  onClear: () => void;
}

export function RecentlyViewedView({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  onClear
}: RecentlyViewedViewProps) {
  if (products.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 pb-24">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <Clock className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Nenhum produto visto recentemente</h2>
        <p className="text-sm text-gray-500 text-center mb-6">
          Os produtos que você visualizar aparecerão aqui
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-6 py-3 bg-black text-white font-medium rounded-xl hover:bg-gray-900 transition-colors"
        >
          Explorar Produtos
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-zinc-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('home')} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Vistos Recentemente</h1>
              <p className="text-sm text-gray-500">{products.length} produto(s)</p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 text-sm text-red-500 font-medium hover:text-red-600 px-3 py-2 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Limpar
          </button>
        </div>
      </div>

      {/* Products Grid */}
      <div className="px-4 py-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isFavorite={favorites.includes(product.id)}
              onToggleFavorite={(e) => {
                e.stopPropagation();
                onToggleFavorite(product);
              }}
              onClick={() => onProductClick(product.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
