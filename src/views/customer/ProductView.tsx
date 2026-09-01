import { MarkdownRenderer } from "@/components/ui/custom/MarkdownRenderer";
import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ProductCardSkeleton } from "@/components/ui/custom/ProductCardSkeleton";
import { ProductQA } from "@/components/ui/custom/ProductQA";
import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { StarRating } from "@/components/ui/custom/StarRating";
import { useStore } from "@/contexts/StoreContext";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { useProducts } from "@/hooks/useProducts";
import { useReviews } from "@/hooks/useReviews";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { conjuntoDeImagens, imagemRedimensionada } from "@/lib/imageUrl";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { cn } from "@/lib/utils";
import type { Product, ProductVariant, View } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  Heart,
  MessageCircle,
  Share2,
  ShoppingCart,
  Star,
  Truck,
} from "lucide-react";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

const RECS_CACHE_KEY_PREFIX = "ikcous_recs_cache_";
const memoryRecsCache = new Map<string, Product[]>();

const getRecsCache = (productId: string): Product[] | null => {
  if (memoryRecsCache.has(productId)) {
    return memoryRecsCache.get(productId)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryRecsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse recommendations cache", e);
    }
  }
  return null;
};

const updateRecsCache = (productId: string, newRecs: Product[]) => {
  memoryRecsCache.set(productId, newRecs);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newRecs),
      );
    } catch (e) {
      console.error("Failed to update recommendations cache", e);
    }
  }
};

interface CompactVariantDropdownProps {
  name: string;
  values: ProductVariant[];
  selectedValue: string;
  onChange: (value: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  product: Product;
  selectedVariants: Record<string, string>;
}

const CompactVariantDropdown = React.memo(function CompactVariantDropdown({
  name,
  values,
  selectedValue,
  onChange,
  isOpen,
  onToggle,
  product,
  selectedVariants,
}: CompactVariantDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener("mousedown", handleClickOutside, {
      passive: true,
    });
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onToggle]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "flex items-center gap-1 bg-zinc-50 rounded-xl px-2.5 py-1.5 border border-zinc-200/50 hover:bg-zinc-100 transition-all duration-300 outline-none select-none",
          isOpen && "border-zinc-300 bg-zinc-100 shadow-inner",
        )}
      >
        <span className="text-[9px] font-black uppercase tracking-wider text-zinc-800">
          {selectedValue || name}
        </span>
        <ChevronDown
          className={cn(
            "w-2.5 h-2.5 text-zinc-500 transition-transform duration-300 ease-out",
            isOpen && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-1/2 z-[60] mb-2 flex min-w-[120px] -translate-x-1/2 flex-col gap-0.5 rounded-2xl border border-zinc-200/80 bg-white p-1 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]"
          >
            <div className="mb-0.5 select-none border-b border-zinc-100 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-400">
              {name}
            </div>
            {values.map((v) => {
              const isSelected = selectedValue === v.value;

              // Calculate stock for variant v
              const tentativeSelected = Object.entries(selectedVariants)
                .map(([gName, val]) => {
                  if (gName === name) return v;
                  return product.variants?.find(
                    (varObj) => varObj.name === gName && varObj.value === val,
                  );
                })
                .filter(Boolean) as ProductVariant[];

              if (!selectedVariants[name]) {
                tentativeSelected.push(v);
              }

              const variantStock = Math.min(
                ...tentativeSelected.map(
                  (varObj) => varObj.stockIncrement || 0,
                ),
              );

              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(v.value);
                    onToggle();
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all duration-200 flex items-center justify-between gap-2 select-none",
                    isSelected
                      ? "bg-primary text-white font-extrabold shadow-sm"
                      : "text-zinc-700 hover:bg-zinc-50 hover:text-primary",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{v.value}</span>
                    <span
                      className={cn(
                        "text-[8px] font-semibold opacity-60",
                        isSelected ? "text-white/60" : "text-zinc-400",
                      )}
                    >
                      ({variantStock > 0 ? `${variantStock} un.` : "Esgotado"})
                    </span>
                  </div>
                  {isSelected && (
                    <Check className="size-2.5 flex-shrink-0 text-white duration-200 animate-in zoom-in-50" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface ProductViewProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onAddToCart: (
    quantity: number,
    variantId?: string,
    variantNames?: string,
  ) => void;
  onBack: () => void;
  onProductClick?: (productId: string) => void;
  onAddToCartProduct?: (
    product: Product,
    quantity: number,
    variantId?: string,
    variantNames?: string,
  ) => void;
  onQuickBuy?: (product: Product, variantId?: string) => void;
  onNavigate?: (view: View, id?: string) => void;
}

export const ProductView = React.memo(function ProductView({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onBack,
  onProductClick,
  onAddToCartProduct,
  onQuickBuy,
  onNavigate,
}: ProductViewProps) {
  const isReady = useDeferredRender(220);
  const [quantity, setQuantity] = useState(1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [cartStatus, setCartStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  const [activeTab, setActiveTab] = useState<
    "description" | "reviews" | "questions"
  >("description");
  const [selectedVariants, setSelectedVariants] = useState<
    Record<string, string>
  >({});
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const { config } = useStore();
  const {
    reviews,
    loading: loadingReviews,
    getReviewsByProduct,
    markHelpful,
    subscribeToReviews,
  } = useReviews();
  const { trackRecommendationClick, fetchRecommendations } = useProducts({
    autoFetch: false,
  });
  const { isFavorite: checkFavorite, toggleFavorite } = useFavorites();
  // Laudo 0109 (C1): o preload das recomendações passa pelo prefetchImage,
  // que tem a guarda de rede lenta — 4 imagens pesadas sem o cliente pedir
  // em 3G é o defeito; em rede boa, aquecer o scroll-down é o benefício.
  const { prefetchImage } = usePrefetchOnHover();

  const handleToggleFavorite = useCallback(
    (p: Product) => {
      toggleFavorite(p);
    },
    [toggleFavorite],
  );

  const handleAddToCartFromCard = useCallback(
    (p: Product, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (onAddToCartProduct) {
        onAddToCartProduct(p, 1);
      } else {
        onAddToCart(1, undefined);
      }
    },
    [onAddToCart, onAddToCartProduct],
  );

  const handleQuickBuyFromCard = useCallback(
    (p: Product, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (onQuickBuy) {
        onQuickBuy(p, undefined);
      }
    },
    [onQuickBuy],
  );

  const handleProductClick = useCallback(
    (productId: string) => {
      trackRecommendationClick(productId, "product_view");
      if (onProductClick) {
        onProductClick(productId);
      } else {
        globalThis.location.href = `?product=${productId}`;
      }
    },
    [onProductClick, trackRecommendationClick],
  );

  const [recommendations, setRecommendations] = useState<Product[]>(() => {
    return getRecsCache(product.id) || [];
  });
  const [loadingRecs, setLoadingRecs] = useState(() => {
    return !getRecsCache(product.id);
  });

  const detailsSectionRef = useRef<HTMLDivElement>(null);
  const reviewsSectionRef = useRef<HTMLDivElement>(null);
  const chatSectionRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const scrollToSection = (
    sectionId: "description" | "reviews" | "questions",
  ) => {
    const sectionMap = {
      description: detailsSectionRef.current,
      reviews: reviewsSectionRef.current,
      questions: chatSectionRef.current,
    };
    const target = sectionMap[sectionId];
    const mainElement = document.querySelector("main");
    if (target && mainElement) {
      const headerHeight = 52;
      const tabBarHeight = 48;
      const totalOffset = headerHeight + tabBarHeight;

      const rect = target.getBoundingClientRect();
      const mainRect = mainElement.getBoundingClientRect();
      const targetScrollTop =
        mainElement.scrollTop + (rect.top - mainRect.top) - totalOffset + 10;

      mainElement.scrollTo({
        top: targetScrollTop,
        behavior: "smooth",
      });
    }
  };

  const handleTabClick = (tabId: "description" | "reviews" | "questions") => {
    setActiveTab(tabId);
    isScrollingRef.current = true;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollToSection(tabId);

    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 800) as any;
  };

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const [scrolled, setScrolled] = useState(false);
  const stickySentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mainElement = document.querySelector("main");
    if (!mainElement) return;

    const handleScrollSpy = () => {
      const sentinelEl = stickySentinelRef.current;
      if (sentinelEl) {
        const rect = sentinelEl.getBoundingClientRect();
        const shouldBeScrolled = rect.top <= 53;
        setScrolled((prev) =>
          prev !== shouldBeScrolled ? shouldBeScrolled : prev,
        );
      }

      if (isScrollingRef.current) return;

      const headerHeight = 52;
      const tabBarHeight = 48;
      const offsetThreshold = headerHeight + tabBarHeight + 20;

      const detailsEl = detailsSectionRef.current;
      const reviewsEl = reviewsSectionRef.current;
      const chatEl = chatSectionRef.current;

      // ADMIN-090 (#101): com o interruptor desligado, `reviewsEl` nunca
      // monta -- tratar a seção ausente como "ainda não alcançada", não
      // abortar o scroll-spy inteiro. A guarda existia para ref ainda não
      // montada, não para uma seção que sumiu por decisão de produto.
      if (!detailsEl || !chatEl) return;

      const chatRect = chatEl.getBoundingClientRect();
      const reviewsTop = reviewsEl
        ? reviewsEl.getBoundingClientRect().top
        : null;

      let currentActive: "description" | "reviews" | "questions" =
        "description";

      if (chatRect.top <= offsetThreshold) {
        currentActive = "questions";
      } else if (reviewsTop !== null && reviewsTop <= offsetThreshold) {
        currentActive = "reviews";
      } else {
        currentActive = "description";
      }

      setActiveTab(currentActive);
    };

    mainElement.addEventListener("scroll", handleScrollSpy, { passive: true });
    handleScrollSpy();

    return () => {
      mainElement.removeEventListener("scroll", handleScrollSpy);
    };
  }, [product.id]);

  const recsRef = useRef<HTMLDivElement>(null);
  const [recsVisible, setRecsVisible] = useState(false);

  useEffect(() => {
    setRecsVisible(false);
  }, [product.id]);

  useEffect(() => {
    const mainElement = document.querySelector("main");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setRecsVisible(true);
          observer.disconnect();
        }
      },
      { root: mainElement, threshold: 0.01, rootMargin: "300px" },
    );

    const currentRef = recsRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      observer.disconnect();
    };
  }, [product.id]);

  useEffect(() => {
    // ADMIN-090 (#102): com o interruptor desligado nada do que volta é
    // renderizado -- não gastar consulta ao banco nem assinatura de tempo
    // real por visita de produto. `config.enableReviews` entra nas
    // dependências para religar a busca se o flag voltar sem recarregar.
    if (!config.enableReviews) return;

    getReviewsByProduct(product.id);

    const unsubscribe = subscribeToReviews(() => {
      getReviewsByProduct(product.id);
    }, product.id);

    return () => {
      unsubscribe();
    };
  }, [
    product.id,
    config.enableReviews,
    getReviewsByProduct,
    subscribeToReviews,
  ]);

  useEffect(() => {
    if (!recsVisible) return;

    // 1. Initial SWR cache sync
    const cached = getRecsCache(product.id);
    if (cached) {
      setRecommendations(cached);
      setLoadingRecs(false);
    } else {
      setRecommendations([]);
      setLoadingRecs(true);
    }

    // 2. Fetch fresh data in background
    let isMounted = true;
    const loadRecs = async () => {
      const recs = await fetchRecommendations(product.id);
      if (isMounted) {
        setRecommendations(recs);
        updateRecsCache(product.id, recs);
        setLoadingRecs(false);
        // Preload primary images of the first 4 recommendations to make scroll-down instant
        // Laudo 0109 (C1): era `img.src = r.images[0]` cru — 4 ORIGINAIS
        // (vários MB cada) baixadas só de a seção existir. Agora: a mesma
        // largura que o card pede (640, o `src` padrão do LazyImage) e a
        // guarda de rede lenta de prefetchImage.
        recs.slice(0, 4).forEach((r) => {
          if (r.images?.[0] && typeof window !== "undefined") {
            prefetchImage(imagemRedimensionada(r.images[0], { width: 640 }));
          }
        });
      }
    };
    loadRecs();

    return () => {
      isMounted = false;
    };
  }, [product.id, fetchRecommendations, recsVisible, prefetchImage]);

  // Calculate average rating and count on the fly based on fetched reviews, with fallbacks from mapped product view
  const reviewCount =
    reviews.length > 0 ? reviews.length : (product.reviewCount ?? 0);
  const averageRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : (product.rating ?? 5);

  // Group variants by name
  const variantGroups =
    product.variants?.reduce(
      (acc, v) => {
        if (!v.active) return acc;
        if (!acc[v.name]) acc[v.name] = [];
        acc[v.name].push(v);
        return acc;
      },
      {} as Record<string, typeof product.variants>,
    ) || {};

  // Calculate current price and stock
  const selectedVariantObjects = Object.entries(selectedVariants)
    .map(([name, value]) =>
      product.variants?.find((v) => v.name === name && v.value === value),
    )
    .filter(Boolean);

  // Laudo 31/08 (menor E): `||` tratava o override ZERO como ausência — o
  // preço exibido de uma variação-brinde era o do produto. `??` só cai no
  // acumulado quando a variação não tem override de verdade (null/undefined),
  // a mesma semântica do COALESCE do servidor.
  const currentPrice = selectedVariantObjects.reduce(
    (acc, v) => v?.priceOverride ?? acc,
    product.price,
  );
  const currentStock =
    Object.entries(variantGroups).length > 0
      ? selectedVariantObjects.length > 0
        ? Math.min(...selectedVariantObjects.map((v) => v?.stockIncrement || 0))
        : product.stock
      : product.stock;
  const variantImage = selectedVariantObjects.find(
    (v) => v?.imageUrl,
  )?.imageUrl;

  const isLowStock = currentStock <= 3 && currentStock > 0;
  const isOutOfStock = currentStock === 0;
  const discount = product.originalPrice
    ? Math.round(
        ((product.originalPrice - currentPrice) / product.originalPrice) * 100,
      )
    : 0;

  // O selo/aviso de frete grátis desta tela só pode afirmar o que é
  // verdade PARA ESTE produto: `config.freeShippingMin` é a regra por
  // valor de compra da loja inteira (carrinho + login), não uma garantia
  // deste produto isolado -- ver o mesmo raciocínio em ProductCard.tsx.
  const isEligibleForFreeShipping = product.freeShipping;

  const handleAddToCart = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (cartStatus !== "idle") return;

    const missingVariations = Object.keys(variantGroups).filter(
      (groupName) => !selectedVariants[groupName],
    );

    if (missingVariations.length > 0) {
      // O título fica curto e fixo para nunca truncar -- o nome do grupo
      // que falta mora na descrição, que tem espaço de sobra e quebra em
      // várias linhas. Antes era o contrário: o grupo ficava no fim de um
      // título que cortava com reticências, e a pessoa nunca descobria o
      // que faltava escolher.
      const artigoEOpcao =
        missingVariations.length === 1 ? "a opção de" : "as opções de";
      toast.warning("Falta escolher", {
        description: `Escolha ${artigoEOpcao} ${missingVariations.join(", ")} antes de adicionar ao carrinho.`,
      });
      return;
    }

    const variantNames = Object.entries(selectedVariants)
      .map(([name, value]) => `${name}: ${value}`)
      .join(", ");
    const imgSrc = variantImage || product.images?.[0] || "";

    setCartStatus("loading");

    if (e?.currentTarget) {
      triggerFlyingCartAnimation(e.currentTarget, imgSrc);
    }

    onAddToCart(quantity, selectedVariantObjects[0]?.id, variantNames);

    setTimeout(() => {
      setCartStatus("success");
      setTimeout(() => {
        setCartStatus("idle");
      }, 1500);
    }, 750);
  };

  const handleShare = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    // O texto de compartilhar vem dos presets da tela de Atendimento
    // (AdminWhatsAppConfigView), que vendem mensagem pronta com [nome],
    // [preco] e [link]. Texto COM marcador é mensagem completa da lojista:
    // substitui e não gruda o sufixo padrão; texto SEM marcador (o default)
    // mantém o comportamento de sempre — nome e preço colados na frente.
    const temMarcador = /\[(nome|preco|link)\]/i.test(config.shareText);
    // Esta é uma decisão SEPARADA: só quando [link] está no preset é que a
    // substituição já colocou a URL dentro do texto. Um preset com [nome]
    // ou [preco] mas sem [link] (ex.: "[nome] por [preco]. Acesse nossa
    // loja!") cai no ramo temMarcador acima, mas continua sem URL nenhuma —
    // e é essa URL que falta colar no fim, no caminho do clipboard.
    const temMarcadorDeLink = /\[link\]/i.test(config.shareText);
    const textoDoShare = temMarcador
      ? config.shareText
          .replace(/\[nome\]/gi, product.name)
          .replace(
            /\[preco\]/gi,
            `R$ ${product.price.toFixed(2).replace(".", ",")}`,
          )
          .replace(/\[link\]/gi, globalThis.location.href)
      : `${config.shareText} ${product.name} por R$${product.price.toFixed(2)}`;
    const shareData = {
      title: product.name,
      text: textoDoShare,
      url: globalThis.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        console.log("Share cancelled");
      }
    } else {
      // A URL só fica de fora quando [link] já a colocou dentro do texto
      // substituído. Em qualquer outro caso — sem marcador nenhum, ou com
      // marcador mas sem [link] — ela continua entrando como sufixo, como
      // sempre entrou.
      const textoParaCopiar = temMarcadorDeLink
        ? textoDoShare
        : `${textoDoShare} - ${shareData.url}`;
      try {
        await navigator.clipboard.writeText(textoParaCopiar);
        toast.success("Link copiado!", {
          description:
            "O link do produto foi copiado para a área de transferência.",
        });
      } catch {
        toast.error("Não consegui copiar", {
          description:
            "Seu navegador bloqueou a cópia. Copie o endereço da barra do navegador.",
        });
      }
    }
  };

  const handleWhatsApp = () => {
    const missingVariations = Object.keys(variantGroups).filter(
      (groupName) => !selectedVariants[groupName],
    );

    if (missingVariations.length > 0) {
      toast.warning(`Por favor, selecione: ${missingVariations.join(", ")}`, {
        description:
          "Selecione todas as opções de variação antes de prosseguir para o WhatsApp.",
      });
      return;
    }

    const variantInfo = Object.entries(selectedVariants)
      .map(([n, v]) => `${n}: ${v}`)
      .join(", ");
    const message = `Olá! Tenho interesse no produto: ${product.name}${variantInfo ? ` (${variantInfo})` : ""} - R$ ${currentPrice.toFixed(2).replace(".", ",")}`;
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, "_blank");
  };

  const nextImage = () => {
    if (!product.images?.length) return;
    setCurrentImageIndex((prev) => (prev + 1) % product.images.length);
  };

  const prevImage = () => {
    if (!product.images?.length) return;
    setCurrentImageIndex(
      (prev) => (prev - 1 + product.images.length) % product.images.length,
    );
  };

  // Schema.org JSON-LD
  const structuredData = {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: product.name,
    image: product.images,
    description: product.description,
    sku: product.id,
    offers: {
      "@type": "Offer",
      url: globalThis.location.href,
      priceCurrency: "BRL",
      price: product.price,
      availability: isOutOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
    // ADMIN-090 (#101): com o interruptor "Avaliações dos Clientes"
    // desligado, o JSON-LD não pode publicar aggregateRating para os
    // buscadores — era o único gate que faltava além da UI.
    ...(config.enableReviews &&
      reviewCount > 0 && {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: averageRating.toFixed(1),
          reviewCount: reviewCount,
        },
      }),
  };

  const metaDescription =
    product.metaDescription || product.description?.substring(0, 150) || "";
  const metaTitle = product.metaTitle || product.name;
  const metaImage = product.images?.[0] || "";

  useDocumentMeta({
    title: product.metaTitle || `${product.name} | Loja`,
    names: {
      description: metaDescription,
      "twitter:card": "summary_large_image",
      "twitter:title": metaTitle,
      "twitter:description": metaDescription,
      "twitter:image": metaImage,
    },
    properties: {
      "og:title": metaTitle,
      "og:description": metaDescription,
      "og:image": metaImage,
      "og:type": "product",
      "og:url": `${globalThis.location?.origin || "https://ickous-marketplace.vercel.app"}/product-detail?id=${product.id}`,
    },
    jsonLd: structuredData,
    jsonLdId: "product-structured-data",
  });

  return (
    <div className="pb-customer relative min-h-full bg-white">
      {/* Image Gallery */}
      <div className="group relative aspect-[4/3] overflow-hidden rounded-b-[2rem] bg-[#F8F9FA] sm:aspect-[4/3] lg:aspect-square">
        <div className="relative flex size-full items-center justify-center overflow-hidden lg:h-[70vh]">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={currentImageIndex}
              src={imagemRedimensionada(
                variantImage || product.images?.[currentImageIndex] || "",
                { width: 960, quality: 80 },
              )}
              srcSet={
                conjuntoDeImagens(
                  variantImage || product.images?.[currentImageIndex] || "",
                  [480, 640, 960, 1280],
                  80,
                ) || undefined
              }
              // Ocupa a largura toda no celular; a partir do desktop fica limitada pela altura.
              sizes="(min-width: 1024px) 70vh, 100vw"
              alt={product.name}
              className="main-product-image h-full w-auto max-w-full object-contain"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              style={
                (isViewTransitionSupported &&
                currentImageIndex === 0 &&
                !variantImage
                  ? { viewTransitionName: "product-image" }
                  : undefined) as React.CSSProperties
              }
            />
          </AnimatePresence>
        </div>

        {/* Navigation Arrows */}
        {(product.images?.length || 0) > 1 && !variantImage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 opacity-100 transition-opacity duration-300 hover-hover:opacity-0 hover-hover:group-hover:opacity-100">
            <button
              onClick={prevImage}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full bg-white/80 shadow-premium backdrop-blur-md transition-all hover:bg-white active:scale-95"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={nextImage}
              className="pointer-events-auto flex size-8 items-center justify-center rounded-full bg-white/80 shadow-premium backdrop-blur-md transition-all hover:bg-white active:scale-95"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* Image Indicators - Glass Pill */}
        {(product.images?.length || 0) > 1 && !variantImage && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 shadow-2xl backdrop-blur-xl">
            {product.images?.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentImageIndex(index)}
                className={`h-1 rounded-full transition-all duration-500 ${
                  index === currentImageIndex
                    ? "w-6 bg-white"
                    : "w-1.5 bg-white/30 hover:bg-white/50"
                }`}
              />
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="absolute right-4 top-4 z-10 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            className="flex size-9 items-center justify-center rounded-full bg-white/85 shadow-premium backdrop-blur-md transition-all hover:bg-white active:scale-95"
          >
            <Heart
              className={cn(
                "size-4.5 transition-colors",
                isFavorite
                  ? "fill-red-500 text-red-500 animate-heart-pop"
                  : "text-zinc-600",
              )}
            />
          </button>
          <button
            onClick={handleShare}
            aria-label="Compartilhar"
            className="flex size-9 items-center justify-center rounded-full bg-white/85 shadow-premium backdrop-blur-md transition-all hover:bg-white active:scale-95"
          >
            <Share2 className="size-4.5 text-zinc-600" />
          </button>
        </div>
      </div>

      {/* Product Info */}
      <div className="px-5 py-4">
        {/* Breadcrumbs */}
        <nav className="scrollbar-hide mb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap text-[9px] font-bold uppercase tracking-widest text-zinc-400">
          <button
            onClick={onBack}
            className="transition-colors hover:text-zinc-900"
          >
            Início
          </button>
          <ChevronRight className="size-2.5" />
          <button className="transition-colors hover:text-zinc-900">
            {product.category}
          </button>
          <ChevronRight className="size-2.5" />
          <span className="max-w-[150px] truncate text-zinc-900">
            {product.name}
          </span>
        </nav>

        {/* Name, Rating & Stock Row */}
        <div className="mb-3 flex flex-col gap-1">
          <h1 className="text-xl font-black leading-tight tracking-tight text-zinc-900">
            {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {config.enableReviews && reviewCount > 0 && (
              <div className="flex items-center gap-1">
                <StarRating rating={averageRating} size={12} />
                <span className="text-[11px] font-medium text-zinc-500">
                  {averageRating.toFixed(1)} ({reviewCount})
                </span>
              </div>
            )}

            {/* Inline Stock Alert with blinking led */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full animate-pulse",
                  isOutOfStock
                    ? "bg-zinc-400"
                    : isLowStock
                      ? "bg-rose-500 animate-bounce"
                      : "bg-emerald-500",
                )}
              />
              <span
                className={
                  isOutOfStock
                    ? "text-zinc-500"
                    : isLowStock
                      ? "text-rose-600"
                      : "text-emerald-700"
                }
              >
                {isOutOfStock
                  ? "Esgotado"
                  : isLowStock
                    ? `Apenas ${currentStock} restam!`
                    : `Em estoque: ${currentStock}`}
              </span>
            </div>
          </div>
        </div>

        {/* Price & Promo Badges Row */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          {product.originalPrice && product.originalPrice > currentPrice ? (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-rose-600">
                R$ {currentPrice.toFixed(2).replace(".", ",")}
              </span>
              <span className="text-xs font-bold text-zinc-400 line-through">
                De: R$ {product.originalPrice.toFixed(2).replace(".", ",")}
              </span>
            </div>
          ) : (
            <span className="text-2xl font-black tracking-tight text-zinc-900">
              R$ {currentPrice.toFixed(2).replace(".", ",")}
            </span>
          )}

          <div className="flex items-center gap-1.5">
            {discount > 0 && (
              <span className="rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-rose-600">
                {discount}% OFF
              </span>
            )}
            {product.isBestseller && (
              <span className="flex items-center gap-1 rounded-md border border-amber-100 bg-amber-50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-700">
                <Flame className="size-3 fill-orange-500/20 text-orange-500" />
                EM ALTA
              </span>
            )}
            {isEligibleForFreeShipping && (
              <span className="flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-700">
                <Truck className="animate-bounce-subtle size-3 text-emerald-600" />
                Grátis
              </span>
            )}
          </div>
        </div>

        {/* Variant Selectors - Jewelry Style */}
        {Object.entries(variantGroups).length > 0 && (
          <div className="mb-5 space-y-4">
            {Object.entries(variantGroups).map(([name, values], index, arr) => {
              const isLastGroup = index === arr.length - 1;
              return (
                <div key={name}>
                  <span className="mb-2 ml-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Selecione {name}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {values?.map((v) => {
                      const isSelected = selectedVariants[name] === v.value;

                      // Calculate stock for variant v
                      const tentativeSelected = Object.entries(selectedVariants)
                        .map(([gName, val]) => {
                          if (gName === name) return v;
                          return product.variants?.find(
                            (varObj) =>
                              varObj.name === gName && varObj.value === val,
                          );
                        })
                        .filter(Boolean) as ProductVariant[];

                      if (!selectedVariants[name]) {
                        tentativeSelected.push(v);
                      }

                      const variantStock = Math.min(
                        ...tentativeSelected.map(
                          (varObj) => varObj.stockIncrement || 0,
                        ),
                      );

                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() =>
                            setSelectedVariants((prev) => ({
                              ...prev,
                              [name]: v.value,
                            }))
                          }
                          className={cn(
                            "px-3 py-1.5 text-xs font-bold rounded-xl border transition-all duration-300 active:scale-95 flex items-center gap-1.5 select-none",
                            isSelected
                              ? "border-primary bg-primary text-white shadow-md shadow-black/10"
                              : "border-zinc-200 bg-zinc-50/50 text-zinc-500 hover:border-zinc-300 hover:text-primary hover:bg-zinc-50",
                          )}
                        >
                          {v.imageUrl && (
                            <img
                              // Miniatura de 20px: baixar o original aqui era o
                              // desperdício mais extremo da tela.
                              src={imagemRedimensionada(v.imageUrl, {
                                width: 80,
                                quality: 70,
                              })}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="size-5 rounded-md bg-white object-cover shadow-sm"
                            />
                          )}
                          <span>{v.value}</span>
                          <span
                            className={cn(
                              "text-[9px] font-medium ml-1.5 transition-colors",
                              isSelected ? "text-zinc-300" : "text-zinc-400",
                            )}
                          >
                            (
                            {variantStock > 0
                              ? `${variantStock} un.`
                              : "Esgotado"}
                            )
                          </span>
                        </button>
                      );
                    })}
                    {isLastGroup && !isOutOfStock && (
                      <div className="ml-auto flex-shrink-0">
                        <QuantitySelector
                          quantity={quantity}
                          maxQuantity={currentStock}
                          onChange={setQuantity}
                          size="md"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Purchase Console (All in a single row) */}
        <div className="mb-5 flex items-center gap-2">
          {!isOutOfStock && Object.entries(variantGroups).length === 0 && (
            <div className="flex-shrink-0">
              <QuantitySelector
                quantity={quantity}
                maxQuantity={currentStock}
                onChange={setQuantity}
                size="md"
              />
            </div>
          )}

          {/* O botão de WhatsApp só existe com número configurado pela loja —
              sem cadastro ele SOME, nunca aponta para número inventado
              (laudo caça-bugs 30/08 + decisão do Gabriel no mesmo dia). */}
          {lojaTemWhatsapp(config.whatsappNumber) && (
            <button
              onClick={handleWhatsApp}
              title="Dúvidas no WhatsApp"
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600 transition-all duration-300 hover:bg-emerald-500 hover:text-white active:scale-95"
            >
              <MessageCircle className="size-5" />
            </button>
          )}

          <button
            onClick={handleAddToCart}
            disabled={isOutOfStock || cartStatus !== "idle"}
            className={cn(
              "flex-1 h-11 text-white text-[9px] min-[380px]:text-[10px] xs:text-[11px] font-black uppercase tracking-[0.025em] xs:tracking-[0.15em] rounded-2xl transition-all duration-500 flex items-center justify-center gap-1.5 xs:gap-2 overflow-hidden",
              cartStatus === "idle"
                ? "bg-primary hover:bg-primary/90 shadow-lg shadow-black/10 active:scale-[0.98]"
                : "bg-primary/80 shadow-none",
              cartStatus === "success" && "bg-emerald-600 shadow-emerald-200",
              isOutOfStock &&
                "bg-zinc-100 text-zinc-300 cursor-not-allowed hover:bg-zinc-100 shadow-none active:scale-100",
            )}
          >
            {isOutOfStock ? (
              "Esgotado"
            ) : cartStatus === "loading" ? (
              <span className="size-4 flex-shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : cartStatus === "success" ? (
              <Check className="size-4 flex-shrink-0 duration-300 animate-in zoom-in" />
            ) : (
              <>
                <ShoppingCart className="size-4 flex-shrink-0 xs:size-4.5" />
                <span className="hidden whitespace-nowrap min-[380px]:inline">
                  Adicionar ao Carrinho
                </span>
                <span className="inline whitespace-nowrap min-[380px]:hidden">
                  Adicionar
                </span>
              </>
            )}
          </button>
        </div>

        {/* Sentinel for tab bar stickiness */}
        <div
          ref={stickySentinelRef}
          className="pointer-events-none h-0 w-full opacity-0"
        />

        {/* Luxury Segmented Tabs - iOS Style & STICKY */}
        <div
          className={cn(
            "sticky top-0 z-40 transition-all duration-300 -mx-6 px-6 py-1 flex flex-col border-b mb-4",
            scrolled
              ? "bg-white/80 backdrop-blur-md border-zinc-200/60 shadow-sm"
              : "bg-transparent border-transparent",
          )}
        >
          <div className="mx-auto flex w-full max-w-[290px] items-center gap-0.5 rounded-full border border-zinc-200/40 bg-zinc-100/60 p-0.5">
            {[
              { id: "description", label: "Detalhes" },
              // ADMIN-090 (#101): com o interruptor desligado, a aba
              // "Avaliações" some da vitrine — não só o pill do admin.
              ...(config.enableReviews
                ? [{ id: "reviews", label: `Avaliações (${reviewCount})` }]
                : []),
              { id: "questions", label: "Perguntas" },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id as any)}
                  className="relative flex-1 rounded-full p-1 text-[9px] font-bold uppercase tracking-wider outline-none transition-colors duration-300"
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeDetailTabPill"
                      className="absolute inset-0 z-0 rounded-full border border-zinc-200/50 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 transition-colors duration-300",
                      isActive
                        ? "text-zinc-950 font-extrabold"
                        : "text-zinc-500 hover:text-zinc-800",
                    )}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sequential Sections */}
        <div
          id="details-section"
          ref={detailsSectionRef}
          className="mb-12 scroll-mt-[64px]"
        >
          <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
            <MarkdownRenderer content={product.description || ""} />

            {/* Benefits */}
            {/* "Troca garantida em até 24h após entrega" foi removida daqui:
                não existe fluxo de troca/devolução neste app (issues #46 e
                #108 seguem abertas), então a promessa era falsa. */}
            <div className="mt-6 space-y-3">
              {/* Sem cidade configurada, o bloco inteiro (ícone e texto)
                  não é renderizado — nunca "Entrega em" sem destino. */}
              {config.storeCity && (
                <div className="flex items-center gap-3 text-sm text-gray-700">
                  <div className="flex size-8 items-center justify-center rounded-full bg-gray-100">
                    <Truck className="size-4" />
                  </div>
                  <span>
                    Entrega em {config.storeCity}
                    {config.storeState ? `, ${config.storeState}` : ""}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <div className="flex size-8 items-center justify-center rounded-full bg-gray-100">
                  <ShoppingCart className="size-4" />
                </div>
                <span>Produto em estoque - Envio rápido</span>
              </div>
            </div>
          </div>
        </div>

        {/* ADMIN-090 (#101): com o interruptor desligado, a seção inteira
            some da vitrine — nota, distribuição e lista de comentários. */}
        {config.enableReviews && (
          <div
            id="reviews-section"
            ref={reviewsSectionRef}
            className="mb-12 scroll-mt-[64px] border-t border-zinc-100 pt-8"
          >
            <div className="space-y-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-extrabold tracking-tight text-zinc-900">
                    Avaliações
                  </h3>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                    {reviewCount > 0
                      ? `${reviewCount} opiniões dos consumidores`
                      : "Sem avaliações ainda"}
                  </p>
                </div>
              </div>

              {loadingReviews ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <div className="border-3 mb-3 size-8 animate-spin rounded-full border-zinc-100 border-t-zinc-950" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Carregando Avaliações...
                  </span>
                </div>
              ) : reviews.length === 0 ? (
                <div className="flex flex-col items-center rounded-3xl border border-zinc-100 bg-gradient-to-b from-zinc-50/50 to-zinc-100/10 px-6 py-12 text-center shadow-sm">
                  {/* Breathing Concentric Circle Stars */}
                  <div className="relative mb-4 flex size-16 items-center justify-center">
                    <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/5 opacity-75 duration-1000" />
                    <div className="flex size-12 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
                      <Star className="size-6 fill-amber-500/20 text-amber-500" />
                    </div>
                  </div>

                  <p className="text-sm font-bold tracking-tight text-zinc-900">
                    Este produto ainda não foi avaliado
                  </p>
                  <p className="mt-1.5 max-w-[280px] text-xs leading-relaxed text-zinc-500">
                    As avaliações podem ser enviadas por compradores confirmados
                    a partir da tela de detalhes do pedido após a entrega.
                  </p>
                </div>
              ) : (
                <>
                  {/* Rating Distribution Chart */}
                  <div className="group relative mb-6 overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 text-white shadow-xl">
                    {/* Subtle blur highlights */}
                    <div className="absolute right-0 top-0 size-48 -translate-y-1/2 translate-x-1/2 rounded-full bg-amber-500/10 blur-[60px]" />

                    <div className="relative z-10 flex flex-col items-center justify-between gap-6 md:flex-row md:gap-8">
                      {/* Left Panel */}
                      <div className="flex flex-col items-center text-center md:items-start md:text-left">
                        <div className="flex items-baseline justify-center gap-1.5 md:justify-start">
                          <span className="bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-5xl font-extrabold tracking-tighter text-transparent">
                            {averageRating.toFixed(1)}
                          </span>
                          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                            / 5
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <StarRating
                            rating={averageRating}
                            size={14}
                            readonly
                          />
                        </div>
                        <span className="mt-4 block text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                          Baseado em {reviewCount}{" "}
                          {reviewCount === 1 ? "experiência" : "experiências"}
                        </span>
                      </div>

                      {/* Right Panel: Bars */}
                      <div className="w-full flex-1 space-y-2 md:border-l md:border-zinc-800 md:pl-6">
                        {[5, 4, 3, 2, 1].map((star) => {
                          const count = reviews.filter(
                            (r) => r.rating === star,
                          ).length;
                          const percentage =
                            reviewCount > 0 ? (count / reviewCount) * 100 : 0;
                          return (
                            <div
                              key={star}
                              className="group/row flex items-center gap-3.5"
                            >
                              <span className="w-3 text-[10px] font-bold text-zinc-500 transition-colors group-hover/row:text-white">
                                {star}
                              </span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800/60 p-px">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)] transition-all duration-700 ease-out"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <span className="w-8 text-right text-[10px] font-bold text-zinc-600 transition-colors group-hover/row:text-zinc-300">
                                {count}
                              </span>
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
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div
          id="chat-section"
          ref={chatSectionRef}
          className="mb-6 scroll-mt-[64px] border-t border-zinc-100 pt-8"
        >
          <div className="duration-300 animate-in fade-in slide-in-from-bottom-2">
            <ProductQA productId={product.id} onNavigate={onNavigate} />
          </div>
        </div>

        {/* Recommendations - Magazine Style */}
        <div ref={recsRef} className="mt-20 border-t border-zinc-100 pt-10">
          <div className="mb-10 flex flex-col items-center text-center">
            <h3 className="text-3xl font-black leading-none tracking-tighter text-zinc-900">
              Você também pode gostar
            </h3>
          </div>
          <div className="-mx-4 grid grid-cols-2 gap-2 px-2 lg:grid-cols-4">
            {!isReady || loadingRecs
              ? Array(4)
                  .fill(0)
                  .map((_, i) => <ProductCardSkeleton key={i} />)
              : recommendations.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    isFavorite={checkFavorite(p.id)}
                    onToggleFavorite={handleToggleFavorite}
                    onAddToCart={handleAddToCartFromCard}
                    onQuickBuy={handleQuickBuyFromCard}
                    onClick={handleProductClick}
                    showRating={config.enableReviews}
                  />
                ))}
          </div>
        </div>

        {/* Reserva o fim da página para as barras fixas (compra dockada +
            navegação inferior) não cobrirem a última fileira de cards. */}
        <div aria-hidden="true" className="h-44 md:h-36" />
      </div>

      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {scrolled && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                className="bottom-docked-navigation fixed inset-x-0 z-50 flex items-center justify-between gap-3 border-t border-zinc-200/60 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] backdrop-blur-xl md:bottom-[88px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-t-2xl md:border-x md:border-zinc-200/60"
              >
                {/* Product Image and Details */}
                <div className="flex min-w-0 items-center gap-2.5">
                  <img
                    // Laudo 0109 (C1): src cru baixava a imagem ORIGINAL
                    // (vários MB) para uma miniatura de 40px. 200 é o menor
                    // degrau do pipeline e cobre a miniatura até em tela de
                    // alta densidade; se a transformação falhar, recai para
                    // a original uma única vez (mesma rede do LazyImage).
                    src={imagemRedimensionada(
                      variantImage || product.images?.[0] || "",
                      { width: 200 },
                    )}
                    onError={(e) => {
                      const alvo = e.currentTarget;
                      const original =
                        variantImage || product.images?.[0] || "";
                      // Guarda por URL falha (não por nó): trocar de variante
                      // precisa poder cair para a original de novo.
                      if (
                        original &&
                        alvo.src !== original &&
                        alvo.dataset.srcComFalha !== alvo.src
                      ) {
                        alvo.dataset.srcComFalha = alvo.src;
                        alvo.src = original;
                      }
                    }}
                    alt={product.name}
                    className="border-zinc-150/50 size-10 flex-shrink-0 rounded-xl border bg-zinc-50 object-cover"
                  />
                  <div className="flex min-w-0 flex-col justify-center">
                    <p className="max-w-[80px] truncate text-[11px] font-bold leading-tight text-zinc-900 sm:max-w-[110px]">
                      {product.name}
                    </p>
                    <p className="mt-0.5 text-[11px] font-black leading-tight text-rose-600">
                      R$ {currentPrice.toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                </div>

                {/* Compact Variant Selectors */}
                {Object.entries(variantGroups).length > 0 && (
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {Object.entries(variantGroups).map(([name, values]) => (
                      <CompactVariantDropdown
                        key={name}
                        name={name}
                        values={values!}
                        selectedValue={selectedVariants[name] || ""}
                        onChange={(val) =>
                          setSelectedVariants((prev) => ({
                            ...prev,
                            [name]: val,
                          }))
                        }
                        isOpen={activeDropdown === name}
                        onToggle={() =>
                          setActiveDropdown((prev) =>
                            prev === name ? null : name,
                          )
                        }
                        product={product}
                        selectedVariants={selectedVariants}
                      />
                    ))}
                  </div>
                )}

                {/* Quantity Selector */}
                {!isOutOfStock && (
                  <div className="flex-shrink-0 origin-center scale-90 sm:scale-100">
                    <QuantitySelector
                      quantity={quantity}
                      maxQuantity={currentStock}
                      onChange={setQuantity}
                      size="sm"
                    />
                  </div>
                )}

                {/* Add to Cart button */}
                <button
                  onClick={handleAddToCart}
                  disabled={isOutOfStock || cartStatus !== "idle"}
                  className={cn(
                    "h-9 px-3.5 text-white text-[9px] font-black uppercase tracking-[0.15em] rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 min-w-[82px] flex-shrink-0 active:scale-95",
                    cartStatus === "idle"
                      ? "bg-primary hover:bg-primary/90 shadow-md shadow-black/10"
                      : "bg-primary/80 shadow-none",
                    cartStatus === "success" &&
                      "bg-emerald-600 shadow-emerald-200/30",
                    isOutOfStock &&
                      "bg-zinc-100 text-zinc-300 cursor-not-allowed hover:bg-zinc-100 shadow-none active:scale-100",
                  )}
                >
                  {isOutOfStock ? (
                    "Esgotado"
                  ) : cartStatus === "loading" ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : cartStatus === "success" ? (
                    <Check className="size-3.5 text-white duration-300 animate-in zoom-in" />
                  ) : (
                    <>
                      <ShoppingCart className="size-3" />
                      <span>+</span>
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
});
