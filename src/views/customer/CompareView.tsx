import { ArrowLeft, X, Check, Truck, Package } from 'lucide-react';
import type { Product, View } from '@/types';
import { StarRating } from '@/components/ui/custom/StarRating';

interface CompareViewProps {
  products: Product[];
  onNavigate: (view: View) => void;
  onRemoveProduct: (productId: string) => void;
  onClearAll: () => void;
  onProductClick: (productId: string) => void;
}

export function CompareView({
  products,
  onNavigate,
  onRemoveProduct,
  onClearAll,
  onProductClick
}: CompareViewProps) {
  if (products.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 pb-24">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <Package className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Nenhum produto para comparar</h2>
        <p className="text-sm text-gray-500 text-center mb-6">
          Adicione produtos à lista de comparação para ver as diferenças
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

  const features = [
    { key: 'price', label: 'Preço', format: (p: Product) => `R$ ${p.price.toFixed(2).replace('.', ',')}` },
    { key: 'rating', label: 'Avaliação', format: (p: Product) => p.rating ? `${p.rating.toFixed(1)}/5` : 'Sem avaliações' },
    { key: 'stock', label: 'Estoque', format: (p: Product) => `${p.stock} unidades` },
    { key: 'sold', label: 'Vendidos', format: (p: Product) => `${p.sold}` },
    { key: 'category', label: 'Categoria', format: (p: Product) => p.category },
    { key: 'shipping', label: 'Frete Grátis', format: (p: Product) => p.freeShipping ? 'Sim' : 'Não' },
  ];

  const getBestValue = (key: string) => {
    if (products.length < 2) return null;

    switch (key) {
      case 'price':
        return products.reduce((min, p) => p.price < min.price ? p : min, products[0]).id;
      case 'rating': {
        const ratedProducts = products.filter(p => p.rating);
        if (ratedProducts.length === 0) return null;
        return ratedProducts.reduce((max, p) => (p.rating || 0) > (max.rating || 0) ? p : max, ratedProducts[0]).id;
      }
      case 'stock':
        return products.reduce((max, p) => p.stock > max.stock ? p : max, products[0]).id;
      case 'sold':
        return products.reduce((max, p) => p.sold > max.sold ? p : max, products[0]).id;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => onNavigate('home')} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold">Comparar Produtos</h1>
          </div>
          <button
            onClick={onClearAll}
            className="text-sm text-red-500 font-medium hover:text-red-600"
          >
            Limpar tudo
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{products.length} produto(s) na comparação</p>
      </div>

      {/* Products Grid */}
      <div className="p-4">
        <div className={`grid gap-4 ${products.length === 2 ? 'grid-cols-2' :
          products.length === 3 ? 'grid-cols-3' :
            'grid-cols-2 md:grid-cols-4'
          }`}>
          {products.map((product) => (
            <div key={product.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* Image */}
              <div className="relative aspect-square bg-gray-50">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => onRemoveProduct(product.id)}
                  className="absolute top-2 right-2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>

              {/* Info */}
              <div className="p-3">
                <h3
                  onClick={() => onProductClick(product.id)}
                  className="text-sm font-medium text-gray-900 line-clamp-2 mb-2 cursor-pointer hover:text-black"
                >
                  {product.name}
                </h3>
                <button
                  onClick={() => onProductClick(product.id)}
                  className="w-full py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition-colors"
                >
                  Ver produto
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison Table */}
        <div className="mt-6 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-100">
            <h2 className="font-bold">Comparação de Especificações</h2>
          </div>

          <div className="divide-y divide-gray-100">
            {features.map((feature) => {
              const bestId = getBestValue(feature.key);

              return (
                <div key={feature.key} className="grid divide-x divide-gray-100">
                  <div className={`grid ${products.length === 2 ? 'grid-cols-3' :
                    products.length === 3 ? 'grid-cols-4' :
                      'grid-cols-2 md:grid-cols-5'
                    }`}>
                    <div className="p-3 bg-gray-50 text-xs font-medium text-gray-600 flex items-center">
                      {feature.label}
                    </div>
                    {products.map((product) => {
                      const isBest = bestId === product.id;
                      const value = feature.format(product);

                      return (
                        <div
                          key={product.id}
                          className={`p-3 text-sm flex items-center justify-center ${isBest ? 'bg-green-50 text-green-700 font-medium' : ''
                            }`}
                        >
                          {feature.key === 'rating' && product.rating ? (
                            <div className="flex flex-col items-center">
                              <StarRating rating={product.rating} size={14} />
                              <span className="text-xs mt-1">{value}</span>
                            </div>
                          ) : feature.key === 'shipping' ? (
                            <div className="flex items-center gap-1">
                              {product.freeShipping ? (
                                <>
                                  <Check className="w-4 h-4 text-green-500" />
                                  <Truck className="w-4 h-4 text-green-500" />
                                </>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              {isBest && <Check className="w-4 h-4 text-green-500" />}
                              {value}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-green-50 border border-green-200 rounded" />
            <span>Melhor opção</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Check className="w-4 h-4 text-green-500" />
            <span>Destaque</span>
          </div>
        </div>
      </div>
    </div>
  );
}
