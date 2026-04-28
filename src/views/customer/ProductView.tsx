import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Heart, Share2, MessageCircle, Truck, ShieldCheck, Flame,
  ChevronLeft, ChevronRight, Check, Star, ShoppingCart
} from 'lucide-react';
import type { Product } from '@/types';
import { QuantitySelector } from '@/components/ui/custom/QuantitySelector';
import { StarRating } from '@/components/ui/custom/StarRating';
import { ReviewCard } from '@/components/ui/custom/ReviewCard';
import { ReviewForm } from '@/components/ui/custom/ReviewForm';
import { ProductQA } from '@/components/ui/custom/ProductQA';
import { useReviews } from '@/hooks/useReviews';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useProducts } from '@/hooks/useProducts';
import { useFavorites } from '@/hooks/useFavorites';
import { useStore } from '@/contexts/StoreContext';
import { ProductCard } from '@/components/ui/custom/ProductCard';
import { ProductCardSkeleton } from '@/components/ui/custom/ProductCardSkeleton';
import { MarkdownRenderer } from '@/components/ui/custom/MarkdownRenderer';

interface ProductViewProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onAddToCart: (quantity: number, variantId?: string, variantNames?: string) => void;
  onBack: () => void;
  onProductClick?: (productId: string) => void;
  scrollProgress?: number;
}

export function ProductView({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onBack,
  onProductClick,
  scrollProgress = 0
}: ProductViewProps) {
  const [quantity, setQuantity] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showAddedToast, setShowAddedToast] = useState(false);
  const [activeTab, setActiveTab] = useState<'description' | 'reviews' | 'questions'>('description');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});

  const { config } = useStore();
  const { reviews, loading: loadingReviews, getReviewsByProduct, markHelpful } = useReviews();
  const { trackRecommendationClick, fetchRecommendations } = useProducts({ autoFetch: false });
  const { isFavorite: checkFavorite, toggleFavorite } = useFavorites();
  const { user } = useAuth();

  const [recommendations, setRecommendations] = useState<Product[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);

  const scrolled = scrollProgress > 400;

  useEffect(() => {
    getReviewsByProduct(product.id);
  }, [product.id, getReviewsByProduct]);

  useEffect(() => {
    const loadRecs = async () => {
      setLoadingRecs(true);
      const recs = await fetchRecommendations(product.id);
      setRecommendations(recs);
      setLoadingRecs(false);
    };
    loadRecs();
  }, [product.id, fetchRecommendations]);

  // Calculate average rating and count on the fly based on fetched reviews
  const reviewCount = reviews.length;
  const averageRating = reviewCount > 0
    ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount
    : 0;

  // Group variants by name
  const variantGroups = product.variants?.reduce((acc, v) => {
    if (!v.active) return acc;
    if (!acc[v.name]) acc[v.name] = [];
    acc[v.name].push(v);
    return acc;
  }, {} as Record<string, typeof product.variants>) || {};

  // Calculate current price and stock
  const selectedVariantObjects = Object.entries(selectedVariants).map(([name, value]) =>
    product.variants?.find(v => v.name === name && v.value === value)
  ).filter(Boolean);

  const currentPrice = selectedVariantObjects.reduce((acc, v) => v?.priceOverride || acc, product.price);
  const currentStock = product.stock + selectedVariantObjects.reduce((acc, v) => acc + (v?.stockIncrement || 0), 0);
  const variantImage = selectedVariantObjects.find(v => v?.imageUrl)?.imageUrl;

  const isLowStock = currentStock <= 3;
  const isOutOfStock = currentStock === 0;
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - currentPrice) / product.originalPrice) * 100)
    : 0;

  // Um produto é elegível para frete grátis se o frete grátis estiver habilitado na loja
  const isEligibleForFreeShipping = config.freeShippingMin > 0;

  const handleAddToCart = () => {
    const variantNames = Object.entries(selectedVariants).map(([name, value]) => `${name}: ${value}`).join(', ');
    onAddToCart(quantity, selectedVariantObjects[0]?.id, variantNames);
    setShowAddedToast(true);
    setTimeout(() => setShowAddedToast(false), 2000);
  };

  const handleShare = async () => {
    const shareData = {
      title: product.name,
      text: `${config.shareText} ${product.name} por R$${product.price.toFixed(2)}`,
      url: globalThis.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (_err) {
        console.log('Share cancelled');
      }
    } else {
      navigator.clipboard.writeText(`${shareData.text} - ${shareData.url}`);
      toast.success('Link copiado!', {
        description: 'O link do produto foi copiado para a área de transferência.'
      });
    }
  };

  const handleWhatsApp = () => {
    const variantInfo = Object.entries(selectedVariants).map(([n, v]) => `${n}: ${v}`).join(', ');
    const message = `Olá! Tenho interesse no produto: ${product.name}${variantInfo ? ` (${variantInfo})` : ''} - R$ ${currentPrice.toFixed(2).replace('.', ',')}`;
    const url = `https://wa.me/55${config.whatsappNumber}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, '_blank');
  };

  const nextImage = () => {
    if (!product.images?.length) return;
    setCurrentImageIndex((prev) => (prev + 1) % product.images.length);
  };

  const prevImage = () => {
    if (!product.images?.length) return;
    setCurrentImageIndex((prev) => (prev - 1 + product.images.length) % product.images.length);
  };

  // Schema.org JSON-LD
  const structuredData = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": product.name,
    "image": product.images,
    "description": product.description,
    "sku": product.id,
    "offers": {
      "@type": "Offer",
      "url": globalThis.location.href,
      "priceCurrency": "BRL",
      "price": product.price,
      "availability": isOutOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition"
    },
    ...(reviewCount > 0 && {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": averageRating.toFixed(1),
        "reviewCount": reviewCount
      }
    })
  };

  return (
    <div className="min-h-full bg-white pb-32">
      <Helmet>
        <title>{product.metaTitle || `${product.name} | Loja`}</title>
        <meta name="description" content={product.metaDescription || product.description?.substring(0, 150) || ''} />
        <meta property="og:title" content={product.metaTitle || product.name} />
        <meta property="og:description" content={product.metaDescription || product.description?.substring(0, 150) || ''} />
        <meta property="og:image" content={product.images?.[0] || ''} />
        <meta property="og:type" content="product" />
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      </Helmet>

      {/* Image Gallery */}
      <div className="relative aspect-square bg-[#F8F9FA] group">
        <div className="flex justify-center items-center w-full h-full lg:h-[70vh] overflow-hidden">
          <img
            src={variantImage || product.images?.[currentImageIndex] || ''}
            alt={product.name}
            className="w-auto h-full max-w-full object-contain transition-opacity duration-500"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </div>

        {/* Navigation Arrows */}
        {(product.images?.length || 0) > 1 && !variantImage && (
          <div className="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
            <button
              onClick={prevImage}
              className="w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-premium hover:bg-white transition-all pointer-events-auto active:scale-95"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={nextImage}
              className="w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-premium hover:bg-white transition-all pointer-events-auto active:scale-95"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Image Indicators - Glass Pill */}
        {(product.images?.length || 0) > 1 && !variantImage && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5 px-4 py-2 bg-white/10 backdrop-blur-xl rounded-full border border-white/20 shadow-2xl">
            {product.images?.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentImageIndex(index)}
                className={`h-1 rounded-full transition-all duration-500 ${index === currentImageIndex ? 'bg-white w-8' : 'bg-white/30 hover:bg-white/50 w-2'
                  }`}
              />
            ))}
          </div>
        )}


        {/* Action Buttons */}
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          <button
            onClick={onToggleFavorite}
            className="w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-premium hover:bg-white transition-all active:scale-95"
          >
            <Heart className={`w-5 h-5 transition-colors ${isFavorite ? 'fill-red-500 text-red-500' : 'text-zinc-600'}`} />
          </button>
          <button
            onClick={handleShare}
            className="w-10 h-10 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-premium hover:bg-white transition-all active:scale-95"
          >
            <Share2 className="w-5 h-5 text-zinc-600" />
          </button>
        </div>
      </div>

      {/* Sticky Top Bar on Scroll */}
      <div className={`fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-2xl border-b border-zinc-100/30 p-4 z-50 transition-all duration-500 transform ${scrolled ? 'translate-y-0 opacity-100 shadow-2xl shadow-black/5' : '-translate-y-full opacity-0'}`}>
        <div className="max-w-screen-md mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img src={variantImage || product.images?.[0] || ''} className="w-10 h-10 rounded-xl object-cover shadow-sm ring-1 ring-black/5" alt={product.name} />
              {discount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[7px] font-black px-1 rounded-full">{discount}%</span>}
            </div>
            <div className="flex flex-col">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 line-clamp-1 max-w-[150px]">{product.name}</h2>
              <span className="text-sm font-black text-zinc-900 tracking-tighter">R$ {currentPrice.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>
          <button
            onClick={handleAddToCart}
            className="bg-zinc-900 text-white px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-zinc-200 hover:bg-black"
          >
            Adicionar ao Carrinho
          </button>
        </div>
      </div>

      {/* Product Info */}
      <div className="px-6 py-8">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 mb-6 overflow-x-auto whitespace-nowrap scrollbar-hide text-[10px] font-black uppercase tracking-widest text-zinc-400">
          <button onClick={onBack} className="hover:text-zinc-900 transition-colors">Início</button>
          <ChevronRight className="w-3 h-3" />
          <button className="hover:text-zinc-900 transition-colors">{product.category}</button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-zinc-900 line-clamp-1">{product.name}</span>
        </nav>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          {discount > 0 && (
            <span className="px-3 py-1 bg-red-500 text-white text-[10px] font-black tracking-wider rounded-full shadow-sm shadow-red-200 uppercase">
              {discount}% OFF
            </span>
          )}
          {product.isBestseller && (
            <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black tracking-wider rounded-full flex items-center gap-1 uppercase border border-amber-200">
              <Flame className="w-3 h-3 text-orange-500" />
              Hit de Vendas
            </span>
          )}
          {isEligibleForFreeShipping && (
            <span className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-[10px] font-black tracking-wider rounded-full flex items-center gap-2 border border-emerald-400/30 uppercase shadow-lg shadow-emerald-500/10 group/fs">
              <Truck className="w-4 h-4 animate-bounce-subtle" />
              Frete Grátis
            </span>
          )}
        </div>

        {/* Name */}
        <h1 className="text-2xl font-black text-zinc-900 mb-2 leading-tight tracking-tight">
          {product.name}
        </h1>

        {/* Rating */}
        {reviewCount > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <StarRating rating={averageRating} size={16} />
            <span className="text-sm text-gray-600">
              {averageRating.toFixed(1)} ({reviewCount} avaliações)
            </span>
          </div>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-3 mb-6">
          <span className="text-3xl font-black text-zinc-900 tracking-tighter">
            R$ {currentPrice.toFixed(2).replace('.', ',')}
          </span>
          {product.originalPrice && (
            <span className="text-lg text-zinc-400 line-through font-medium">
              R$ {product.originalPrice.toFixed(2).replace('.', ',')}
            </span>
          )}
        </div>

        {/* Variant Selectors - Jewelry Style */}
        {Object.entries(variantGroups).length > 0 && (
          <div className="space-y-6 mb-10">
            {Object.entries(variantGroups).map(([name, values]) => (
              <div key={name}>
                <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] mb-4 ml-1">
                  Selecione {name}
                </label>
                <div className="flex flex-wrap gap-3">
                  {values!.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariants(prev => ({ ...prev, [name]: v.value }))}
                      className={`min-w-[64px] px-6 py-4 text-xs font-black rounded-3xl border-2 transition-all duration-500 active:scale-90 flex flex-col items-center gap-2 ${selectedVariants[name] === v.value
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-2xl shadow-zinc-200 scale-105'
                        : 'border-zinc-100 bg-zinc-50/50 text-zinc-400 hover:border-zinc-200 hover:bg-white hover:text-zinc-900'
                        }`}
                    >
                      {v.imageUrl && (
                        <img src={v.imageUrl} className="w-8 h-8 rounded-full object-cover shadow-sm bg-white" />
                      )}
                      <span>{v.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stock Info */}
        <div className={`flex items-center gap-1.5 sm:gap-2 mb-3 sm:mb-4 p-2.5 sm:p-3 rounded-lg ${isLowStock ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}>
          {isLowStock ? (
            <>
              <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-xs sm:text-sm font-medium">
                Corre, estão acabando! Apenas {currentStock} unidades
              </span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-xs sm:text-sm font-medium">
                Em estoque: {currentStock} {currentStock === 1 ? 'unidade' : 'unidades'}
              </span>
            </>
          )}
        </div>

        {/* Luxury Segmented Tabs - iOS Style */}
        <div className="bg-zinc-100/50 p-1.5 rounded-[2rem] flex items-center gap-1 mb-8 border border-zinc-100 max-w-sm mx-auto">
          {[
            { id: 'description', label: 'Detalhes' },
            { id: 'reviews', label: `Reviews (${reviewCount})` },
            { id: 'questions', label: 'Chat' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-3 px-4 rounded-[1.6rem] text-[10px] font-black uppercase tracking-widest transition-all duration-500 ${activeTab === tab.id
                ? 'bg-white text-zinc-900 shadow-xl shadow-black/5 ring-1 ring-black/5 scale-[1.02]'
                : 'text-zinc-400 hover:text-zinc-600'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'description' && (
          <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <MarkdownRenderer content={product.description || ''} />

            {/* Benefits */}
            <div className="space-y-3 mt-6">
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <span>Troca garantida em até 24h após entrega</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <Truck className="w-4 h-4" />
                </div>
                <span>Entrega em Monte Carmelo, MG</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <span>Produto em estoque - Envio rápido</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reviews' && (
          <div className="mb-6 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {!showReviewForm ? (
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg">Opiniões dos consumidores</h3>
                {user && (
                  <Button variant="outline" size="sm" onClick={() => setShowReviewForm(true)}>
                    Avaliar produto
                  </Button>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-semibold">Escreva sua avaliação</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowReviewForm(false)}>Cancelar</Button>
                </div>
                <ReviewForm
                  productId={product.id}
                  onSuccess={() => setShowReviewForm(false)}
                />
              </div>
            )}

            {loadingReviews ? (
              <div className="text-center py-12">
                <div className="w-10 h-10 border-4 border-zinc-100 border-t-zinc-900 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-zinc-400 text-sm font-black uppercase tracking-widest">Carregando Reviews</p>
              </div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-16 bg-zinc-50 rounded-[2.5rem] border border-zinc-100">
                <Star className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
                <p className="text-zinc-900 font-black text-lg tracking-tighter">Nenhuma avaliação ainda</p>
                <p className="text-zinc-400 text-xs mt-1">Seja o primeiro a compartilhar sua experiência!</p>
              </div>
            ) : (
              <>
                {/* Rating Distribution Chart */}
                <div className="bg-zinc-950 rounded-[3rem] p-10 mb-8 text-white shadow-3xl shadow-zinc-200/50 relative overflow-hidden group border border-white/5">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-[80px] group-hover:bg-primary/30 transition-colors duration-1000" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-[40px]" />

                  <div className="relative z-10 flex flex-col sm:flex-row items-center gap-10">
                    <div className="text-center sm:text-left">
                      <p className="text-6xl font-black tracking-tighter mb-2 bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">{averageRating.toFixed(1)}</p>
                      <StarRating rating={averageRating} size={20} />
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mt-6 antialiased">Baseado em {reviewCount} experiências</p>
                    </div>

                    <div className="flex-1 w-full space-y-3">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = reviews.filter(r => r.rating === star).length;
                        const percentage = reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                        return (
                          <div key={star} className="flex items-center gap-4 group/row">
                            <span className="text-[10px] font-black w-4 text-zinc-400 group-hover/row:text-white transition-colors">{star}</span>
                            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden p-[1px]">
                              <div
                                className="h-full bg-gradient-to-r from-zinc-400 to-white rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-black text-zinc-500 w-8 text-right group-hover/row:text-zinc-300 transition-colors">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <ReviewCard
                      key={review.id}
                      review={review}
                      onHelpful={markHelpful}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ProductQA productId={product.id} />
          </div>
        )}

        {/* Recommendations - Magazine Style */}
        <div className="mt-20 pt-10 border-t border-zinc-100">
          <div className="flex flex-col items-center text-center mb-10">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-3">Curadoria Especial</span>
            <h3 className="text-3xl font-black tracking-tighter text-zinc-900 leading-none">Você também pode gostar</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 -mx-4 px-2">
            {loadingRecs ? (
              Array(4).fill(0).map((_, i) => <ProductCardSkeleton key={i} />)
            ) : (
              recommendations.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  isFavorite={checkFavorite(p.id)}
                  onToggleFavorite={(e) => {
                    e.stopPropagation();
                    toggleFavorite(p);
                  }}
                  onAddToCart={(e) => {
                    e.stopPropagation();
                    onAddToCart(1, undefined);
                  }}
                  onClick={() => {
                    trackRecommendationClick(p.id, 'product_view');
                    if (onProductClick) {
                      onProductClick(p.id);
                    } else {
                      globalThis.location.href = `?product=${p.id}`;
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="fixed bottom-16 md:bottom-20 left-0 right-0 bg-white/80 backdrop-blur-2xl border-t border-zinc-100 p-4 z-40 shadow-2xl rounded-t-[2.5rem]">
        <div className="max-w-screen-md mx-auto">
          {/* Quantity Selector */}
          {!isOutOfStock && (
            <div className="flex items-center justify-between mb-4 px-1">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Quantidade</span>
              <QuantitySelector
                quantity={quantity}
                maxQuantity={currentStock}
                onChange={setQuantity}
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleWhatsApp}
              className="flex-shrink-0 w-14 h-14 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all duration-500 active:scale-90 border border-emerald-100"
            >
              <MessageCircle className="w-6 h-6" />
            </button>

            <button
              onClick={handleAddToCart}
              disabled={isOutOfStock}
              className="flex-1 h-14 bg-zinc-900 text-white text-xs font-black uppercase tracking-[0.2em] rounded-3xl hover:bg-black disabled:bg-zinc-100 disabled:text-zinc-300 disabled:cursor-not-allowed transition-all duration-500 active:scale-[0.98] shadow-2xl shadow-zinc-200 flex items-center justify-center gap-2"
            >
              {isOutOfStock ? (
                'Esgotado'
              ) : (
                <>
                  <ShoppingCart className="w-5 h-5" />
                  Adicionar ao Carrinho
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Added to Cart Toast */}
      {showAddedToast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black text-white px-6 py-3 rounded-xl shadow-lg z-50 animate-in fade-in zoom-in duration-200">
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-400" />
            <span className="font-medium">Adicionado ao carrinho!</span>
          </div>
        </div>
      )}
    </div>
  );
}
