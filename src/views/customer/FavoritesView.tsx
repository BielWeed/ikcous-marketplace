import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ProductCardSkeleton } from "@/components/ui/custom/ProductCardSkeleton";
import { useStore } from "@/contexts/StoreContext";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { medirRodapeCliente } from "@/lib/medir-rodape-cliente";
import { precoVendido } from "@/lib/preco-vendido";
import "./FavoritesView.css";
import type { Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import { ArrowDownUp, ArrowRight, Heart, Sparkles } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

interface FavoritesViewProps {
  favorites: Product[];
  loading?: boolean;
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  selectedProductId?: string;
  isActive?: boolean;
  /** O carrinho do App (mesma função que a Home recebe). Sem ela os cards
   * ficam sem como adicionar: viram "Ver produto" em vez de fingir que
   * adicionaram. */
  onAddToCart?: (
    product: Product,
    quantity?: number,
    variantId?: string,
    variantNames?: string,
  ) => void;
}

export const FavoritesView = React.memo(function FavoritesView({
  favorites,
  loading = false,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  selectedProductId,
  isActive = true,
  onAddToCart,
}: FavoritesViewProps) {
  const { config, products } = useStore();
  // B3 do item 2 da fila (19/09): o selo "Frete Grátis" do card obedece ao
  // preset da LOJA (ProductCard-520), derivado do MESMO config que já
  // alimentava `showRating` — mesmo padrão do ProductView.
  const promessasDaLoja = useMemo(() => promessasDeFrete(config), [config]);
  const { prefetchView } = usePrefetchOnHover();
  // A LISTA continua vindo por props (App.tsx é o dono do fluxo); o estado
  // de ERRO do fetch vem direto do contexto — falha de consulta não pode
  // renderizar o mesmo "lista vazia" de quem nunca favoritou nada.
  const { erro: favoritosErro, refresh: favoritosRefresh } = useFavorites();
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(380);
  const [categoria, setCategoria] = useState("");
  const [comDesconto, setComDesconto] = useState(false);
  const [ordem, setOrdem] = useState("original");
  const { categorias, descontos, visiveis } = useMemo(() => {
    const categorias = new Map<string, number>();
    const promocionais = new Set<string>();
    for (const produto of favorites) {
      if (produto.category) {
        categorias.set(
          produto.category,
          (categorias.get(produto.category) ?? 0) + 1,
        );
      }
      if (
        produto.originalPrice != null &&
        produto.originalPrice > precoVendido(produto, undefined)
      ) {
        promocionais.add(produto.id);
      }
    }
    const visiveis = favorites.filter(
      (produto) =>
        (!categoria || produto.category === categoria) &&
        (!comDesconto || promocionais.has(produto.id)),
    );
    // A ordem recebida já é a da lista salva. Nunca ordenar a prop no lugar.
    if (ordem === "nome") {
      visiveis.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    } else if (ordem !== "original") {
      visiveis.sort(
        (a, b) =>
          (precoVendido(a, undefined) - precoVendido(b, undefined)) *
          (ordem === "maior" ? -1 : 1),
      );
    }
    return { categorias, descontos: promocionais.size, visiveis };
  }, [favorites, categoria, comDesconto, ordem]);

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

  // Mesmos dois caminhos da Home. O card chama `onAddToCart(produto, clique)`:
  // o invólucro entrega só o produto — o clique no lugar de `quantity` viraria
  // quantidade. Com opções (tamanho/cor), o card abre a folha e entrega
  // variação + quantidade escolhidas.
  const handleAddToCart = useCallback(
    (product: Product) => {
      onAddToCart?.(product);
    },
    [onAddToCart],
  );
  const handleAddToCartWithVariants = useCallback(
    (
      product: Product,
      variantId: string | undefined,
      variantNames: string,
      quantity = 1,
    ) => {
      onAddToCart?.(product, quantity, variantId, variantNames);
    },
    [onAddToCart],
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

  if (favoritosErro && favorites.length === 0) {
    return (
      <div className="pb-customer flex min-h-full flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-amber-50 dark:bg-amber-950/40">
          <Heart className="size-9 text-amber-500" />
        </div>
        <h2 className="mb-2 text-base font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
          Não conseguimos carregar
        </h2>
        <p className="mb-7 max-w-xs text-xs font-semibold leading-relaxed text-zinc-400 dark:text-zinc-500">
          {favoritosErro} Verifique sua conexão e tente de novo.
        </p>
        <button
          onClick={() => favoritosRefresh()}
          className="rounded-2xl bg-zinc-900 px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (favorites.length === 0) {
    // Defeito da prova de rua (01/09): para o DONO da loja (logado como
    // admin) a lista do contexto carrega o catálogo INTEIRO, inclusive
    // pausados — e a sugestão acabava anunciando produto que a loja não
    // está vendendo. Sugestão só de produto ATIVO.
    const suggestedProducts =
      products?.filter((p) => p.isActive).slice(0, 4) || [];

    return (
      <div className="pb-customer relative flex min-h-full flex-col items-center justify-start overflow-x-hidden bg-gradient-to-b from-zinc-50 via-white to-white px-4 py-8 sm:px-6">
        {/* Soft Ambient Background Elements */}
        <div className="absolute left-[-15%] top-[-5%] -z-10 h-[380px] w-[380px] rounded-full bg-zinc-200/40 blur-[110px]" />
        <div className="absolute right-[-15%] top-[20%] -z-10 h-[300px] w-[300px] rounded-full bg-secondary/10 blur-[120px]" />
        <div className="absolute bottom-[5%] left-[20%] -z-10 h-[250px] w-[250px] rounded-full bg-zinc-100/60 blur-[90px]" />

        {/* Hero Section Container */}
        <div className="flex w-full max-w-sm flex-col items-center justify-center text-center">
          {/* Animated Hero Illustration with Cherry Blossom Petals */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-6"
          >
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
                className="relative z-10 flex size-full items-center justify-center rounded-[2.8rem] border border-white/40 bg-gradient-to-tr from-primary via-primary to-secondary p-4 shadow-[0_20px_45px_-10px_rgba(24,24,27,0.38)]"
              >
                <Heart
                  size={46}
                  className="relative z-10 fill-primary-foreground text-primary-foreground drop-shadow-md"
                />
              </motion.div>

              {/* Glowing Pulse Rings */}
              <motion.div
                animate={{ scale: [1, 1.25, 1], opacity: [0.35, 0.08, 0.35] }}
                transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY }}
                className="absolute inset-0 -z-10 rounded-[2.8rem] border-2 border-secondary/40 bg-secondary/10"
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
              <span className="bg-gradient-to-r from-primary via-primary to-secondary bg-clip-text text-transparent italic not-italic">
                tá tão vazia... 💕
              </span>
            </h2>
            <p className="px-2 text-xs font-medium leading-relaxed text-slate-600 sm:text-sm">
              Que tal dar uma olhada nos produtos mais desejados da loja?
              Encontre aqui suas{" "}
              <span className="font-bold text-primary">
                próximas compras favoritas
              </span>
              !
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
              className="group relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl border border-primary/20 bg-primary px-5 text-primary-foreground shadow-[0_12px_28px_-6px_rgba(24,24,27,0.4)] transition-all hover:scale-[1.02] active:scale-95"
            >
              <div className="relative z-10 flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-xl bg-white/15 text-secondary">
                  <Sparkles className="size-4 fill-secondary/30 text-secondary animate-pulse" />
                </div>
                <span className="text-[12px] font-black uppercase tracking-wider text-primary-foreground">
                  Explorar Produtos
                </span>
              </div>

              <div className="relative z-10 flex size-8 items-center justify-center rounded-xl bg-white/20 text-primary-foreground backdrop-blur-sm transition-transform group-hover:translate-x-1">
                <ArrowRight className="size-4 text-primary-foreground" />
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
            className="mt-10 w-full max-w-md border-t border-zinc-100 pt-6"
          >
            <div className="mb-4 text-center">
              <span className="inline-block rounded-full bg-secondary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                ✨ Destaques da Loja
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
                  onAddToCart={onAddToCart ? handleAddToCart : undefined}
                  onAddToCartWithVariants={
                    onAddToCart ? handleAddToCartWithVariants : undefined
                  }
                  showRating={config.enableReviews}
                  promessasDeFrete={promessasDaLoja}
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
    <div className="pb-customer-summary min-h-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 pb-4 pt-5">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Favoritos</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {favorites.length} {favorites.length === 1 ? "produto" : "produtos"}{" "}
            que você salvou
          </p>
        </div>
        <label className="relative flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-semibold text-card-foreground">
          <ArrowDownUp aria-hidden="true" className="size-4" />
          Ordem
          <select
            aria-label="Ordem dos favoritos"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            value={ordem}
            onChange={(event) => setOrdem(event.target.value)}
          >
            <option value="original">Ordem original</option>
            <option value="menor">Menor preço</option>
            <option value="maior">Maior preço</option>
            <option value="nome">A–Z</option>
          </select>
        </label>
      </header>

      <div
        role="group"
        aria-label="Filtrar favoritos"
        className="favorites-filters mx-4 mb-4 flex min-w-0 gap-2 overflow-x-auto pb-1"
      >
        <button
          type="button"
          aria-pressed={!categoria}
          onClick={() => setCategoria("")}
        >
          Todas {favorites.length}
        </button>
        {categorias.size > 1 &&
          Array.from(categorias, ([nome, quantidade]) => (
            <button
              key={nome}
              type="button"
              aria-pressed={categoria === nome}
              onClick={() => setCategoria(nome)}
            >
              {nome} {quantidade}
            </button>
          ))}
        {descontos > 0 && (
          <button
            type="button"
            aria-pressed={comDesconto}
            onClick={() => setComDesconto(!comDesconto)}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-emerald-600"
            />
            Com desconto {descontos}
          </button>
        )}
      </div>

      <p role="status" className="sr-only">
        {visiveis.length}{" "}
        {visiveis.length === 1 ? "produto encontrado" : "produtos encontrados"}
      </p>
      {visiveis.length === 0 && (
        <div className="px-4 py-10 text-center text-sm">
          <p className="text-muted-foreground">
            Nenhum favorito com esses filtros.
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full border border-border bg-card px-5 font-semibold text-card-foreground"
            onClick={() => {
              setCategoria("");
              setComDesconto(false);
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}
      <div className="px-4 pb-4">
        <AnimatePresence mode="popLayout" initial={false}>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4">
            {visiveis.map((product, index) => (
              <motion.div
                key={product.id}
                layout
                className="flex h-full min-w-0 flex-col"
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
                  className="favorites-product-card"
                  product={product}
                  isFavorite={true}
                  onToggleFavorite={handleToggleFavorite}
                  onClick={handleProductClick}
                  onAddToCart={onAddToCart ? handleAddToCart : undefined}
                  onAddToCartWithVariants={
                    onAddToCart ? handleAddToCartWithVariants : undefined
                  }
                  showRating={config.enableReviews}
                  promessasDeFrete={promessasDaLoja}
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
              <div
                ref={medirRodapeCliente}
                className="bottom-docked-navigation pointer-events-none fixed inset-x-0 z-[90] px-4 md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2"
              >
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
                    type="button"
                    aria-label="Descobrir mais produtos"
                    className="group pointer-events-auto flex min-h-[52px] w-full items-center justify-center gap-6 rounded-full border border-border bg-card px-4 text-sm font-semibold text-card-foreground transition-colors hover:bg-muted active:scale-95"
                  >
                    Ver mais produtos
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-1"
                    />
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
