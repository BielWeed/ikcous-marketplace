import { LazyImage } from "@/components/LazyImage";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { imagemRedimensionada } from "@/lib/imageUrl";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Flame,
  Heart,
  Loader2,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { memo, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { StarRating } from "./StarRating";

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product, e: React.MouseEvent) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
  onQuickBuy?: (product: Product, e: React.MouseEvent) => void;
  /**
   * Card inteligente (pedido do Gabriel, 02/09): presente, o botão "Escolher
   * opções" EXPANDE as variações no próprio card — preço e imagem reagem à
   * escolha — e "Adicionar" entrega a variação escolhida. Ausente, o botão
   * leva para a tela do produto (comportamento de sempre, retrocompatível).
   * Assinatura igual ao `handleAddToCart` do App com quantity fixo em 1.
   */
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
  ) => void;
  onClick: (productId: string) => void;
  onMouseEnter?: (productId: string) => void;
  onTouchStart?: (productId: string) => void;
  className?: string;
  priority?: boolean;
  selectedProductId?: string;
  /**
   * ADMIN-091 (#202): espelha `config.enableReviews` do StoreContext. Vem
   * por prop, não por `useStore()` direto aqui dentro, porque ProductCard é
   * renderizado aos dezenas numa grade (ProductList, SearchView,
   * FavoritesView, ProductCarousel) -- cada um desses já chama `useStore()`
   * uma vez só e repassa `showRating` do mesmo jeito. Ler o contexto em cada
   * card assinaria a árvore inteira do StoreContext (que muda a cada
   * `fetchProducts`) em cada instância, mesmo protegida por `memo`, porque
   * `useContext` força re-render independente de memo.
   * **Obrigatório de propósito, sem default.** A primeira versão desta
   * correção usava `showRating = true`, e foi exatamente isso que deixou
   * `ProductView` (produtos relacionados, no rodapé) continuar publicando a
   * nota com o interruptor desligado: quem esquece de passar o prop cai no
   * lado que a issue quer esconder, sem erro nenhum. Sendo obrigatório, o
   * `npm run typecheck` recusa qualquer chamador novo que esqueça — a
   * completude passa a ser provada pelo compilador, não por revisão.
   */
  showRating: boolean;
}

// Global trackers for view transitions to prevent duplicate view-transition-names
let activeTransitionCardId: string | null = null;

export const ProductCard = memo(function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onAddToCartWithVariants,
  onClick,
  onMouseEnter,
  onTouchStart,
  className,
  priority = false,
  selectedProductId,
  showRating,
}: Readonly<ProductCardProps>) {
  const instanceId = useId();
  const { prefetchImage } = usePrefetchOnHover();

  const discount = product.originalPrice
    ? Math.round(
        ((product.originalPrice - product.price) / product.originalPrice) * 100,
      )
    : 0;

  const [cartStatus, setCartStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  // ── Escolha de opções no próprio card ──────────────────────────────────
  // Mesmas regras da página de produto (ProductView): só variantes ATIVAS
  // agrupadas por `name`; preço = último `priceOverride` da escolha (`??`
  // para override ZERO ser um preço de verdade); estoque = menor
  // `stockIncrement` das escolhidas. Map em vez de Record: objeto indexado
  // por variável é o warning `security/detect-object-injection` que o teto
  // do lint reprova — e Map é a estrutura certa para a escolha.
  const [painelOpcoesAberto, setPainelOpcoesAberto] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Map<string, string>>(
    () => new Map(),
  );

  const variantGroups = useMemo(() => {
    const grupos = new Map<string, ProductVariant[]>();
    product.variants?.forEach((v) => {
      if (!v.active) return;
      const lista = grupos.get(v.name);
      if (lista) lista.push(v);
      else grupos.set(v.name, [v]);
    });
    return grupos;
  }, [product.variants]);
  const temGruposDeOpcao = variantGroups.size > 0;

  const selecionadasObjs = Array.from(selecionadas)
    .map(([nome, valor]) =>
      product.variants?.find((v) => v.name === nome && v.value === valor),
    )
    .filter(Boolean) as ProductVariant[];

  const precoAtual = selecionadasObjs.reduce(
    (acc, v) => v?.priceOverride ?? acc,
    product.price,
  );
  const estoqueAtual = temGruposDeOpcao
    ? selecionadasObjs.length > 0
      ? Math.min(...selecionadasObjs.map((v) => v?.stockIncrement || 0))
      : product.stock
    : product.stock;
  const imagemDaVariante = selecionadasObjs.find((v) => v?.imageUrl)?.imageUrl;
  const srcImagem = imagemDaVariante || product.images[0];

  const escolhaCompleta =
    selecionadas.size >= variantGroups.size &&
    Array.from(variantGroups.keys()).every((nome) => selecionadas.has(nome));

  // Safely determine if this specific card should have the view transition name applied.
  // We apply it strictly to the clicked instance (via activeTransitionCardId) to avoid duplicate transition names.
  let shouldApplyTransitionName = false;
  if (isViewTransitionSupported && selectedProductId === product.id) {
    if (activeTransitionCardId === instanceId) {
      shouldApplyTransitionName = true;
    }
  }

  // O card não pode deixar comprar sem escolher a variação.
  // Com a prop `onAddToCartWithVariants`, o botão EXPANDE as opções no
  // próprio card — a escolha acontece aqui, sem sair da vitrine. Sem a
  // prop, leva para a tela do produto, que é onde a escolha é obrigatória
  // (ProductView.tsx). Sem isso o pedido nascia com `variant_id = NULL` no
  // banco, cobrando o preço do produto (ignorando `price_override`) e
  // decrementando só `produtos.estoque`, nunca a variação escolhida.
  const hasActiveVariant = product.variants?.some((v) => v.active) ?? false;

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Card inteligente: o mesmo botão abre o painel de opções e, com a
    // escolha completa, vira "Adicionar" — o clique final é o
    // `handleAdicionarComOpcoes`, abaixo.
    if (hasActiveVariant && onAddToCartWithVariants) {
      if (estoqueAtual <= 0 || cartStatus !== "idle") return;
      if (!painelOpcoesAberto) {
        setPainelOpcoesAberto(true);
        return;
      }
      handleAdicionarComOpcoes(e);
      return;
    }

    if (hasActiveVariant) {
      onClick(product.id);
      return;
    }

    if (cartStatus !== "idle") return;

    setCartStatus("loading");

    if (onAddToCart) {
      onAddToCart(product, e);
    }

    const startEl = (e.currentTarget as HTMLElement) || document.body;
    triggerFlyingCartAnimation(startEl, product.images[0]);

    setTimeout(() => {
      setCartStatus("success");
      setTimeout(() => {
        setCartStatus("idle");
      }, 1500);
    }, 600);
  };

  const handleAdicionarComOpcoes = (e: React.MouseEvent) => {
    if (cartStatus !== "idle") return;

    // Mesma exigência da página de produto: TODOS os grupos de opção
    // precisam de uma escolha antes do carrinho — e a mensagem diz qual
    // falta, pelo mesmo motivo de lá.
    const faltando = Array.from(variantGroups.keys()).filter(
      (grupo) => !selecionadas.get(grupo),
    );
    if (faltando.length > 0) {
      const artigoEOpcao =
        faltando.length === 1 ? "a opção de" : "as opções de";
      toast.warning("Falta escolher", {
        description: `Escolha ${artigoEOpcao} ${faltando.join(", ")} antes de adicionar ao carrinho.`,
      });
      return;
    }

    const variantId = selecionadasObjs[0]?.id;
    const variantNames = Array.from(selecionadas)
      .map(([nome, valor]) => `${nome}: ${valor}`)
      .join(", ");
    const imgSrc = imagemDaVariante || product.images?.[0] || "";

    setCartStatus("loading");
    triggerFlyingCartAnimation(e.currentTarget as HTMLElement, imgSrc);
    onAddToCartWithVariants?.(product, variantId, variantNames);

    setTimeout(() => {
      setCartStatus("success");
      setTimeout(() => {
        setCartStatus("idle");
        setPainelOpcoesAberto(false);
        setSelecionadas(new Map());
      }, 1500);
    }, 600);
  };

  const alternarOpcao = (e: React.MouseEvent, nome: string, valor: string) => {
    e.stopPropagation();
    setSelecionadas((antes) => {
      const depois = new Map(antes);
      if (depois.get(nome) === valor) {
        depois.delete(nome);
      } else {
        depois.set(nome, valor);
      }
      return depois;
    });
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    activeTransitionCardId = instanceId;
    if (isViewTransitionSupported) {
      // Só IMAGENS: é o único nome que troca de dono entre telas
      // ("product-image"). O seletor largo `img, [style*=...]` que existia
      // aqui roubava o nome da BottomNav e do Header no clique — a metade
      // restante do pisca consertado no useViewTransition (02/09).
      document.querySelectorAll<HTMLElement>("img").forEach((el) => {
        el.style.removeProperty("view-transition-name");
      });
      const img = e.currentTarget.querySelector("img");
      if (img) {
        img.style.setProperty("view-transition-name", "product-image");
      }
    }
    onClick(product.id);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activeTransitionCardId = instanceId;
      if (isViewTransitionSupported) {
        document.querySelectorAll<HTMLElement>("img").forEach((el) => {
          el.style.removeProperty("view-transition-name");
        });
        const img = e.currentTarget.querySelector("img");
        if (img) {
          img.style.setProperty("view-transition-name", "product-image");
        }
      }
      onClick(product.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onMouseEnter={() => {
        prefetchImage(imagemRedimensionada(srcImagem, { width: 640 }));
        if (onMouseEnter) onMouseEnter(product.id);
      }}
      onTouchStart={() => {
        // Laudo 0109 (C1): o prefetch baixava a ORIGINAL em paralelo com a
        // variante redimensionada que o LazyImage já baixava — download
        // duplo no toque. 640 é o `src` padrão que o LazyImage deste card
        // pede; a guarda de rede lenta segue dentro do prefetchImage.
        prefetchImage(imagemRedimensionada(srcImagem, { width: 640 }));
        if (onTouchStart) onTouchStart(product.id);
      }}
      onKeyDown={handleCardKeyDown}
      className={cn(
        "group bg-zinc-50/30 rounded-[2rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-[transform,box-shadow,background-color] duration-300 ease-out cursor-pointer border border-zinc-200/60 flex flex-col relative active:scale-[0.98] h-full flex-1 gpu-accelerated",
        className,
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-[4/5] overflow-hidden bg-slate-50">
        <LazyImage
          src={srcImagem}
          alt={product.name}
          className="size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
          priority={priority}
          // Grade de 2 colunas no celular, card fixo a partir do tablet.
          sizes="(min-width: 640px) 280px, 50vw"
          style={
            shouldApplyTransitionName
              ? { viewTransitionName: "product-image" }
              : undefined
          }
        />

        {/* Action Buttons */}
        <div className="absolute right-3 top-3 flex translate-x-0 flex-col gap-2 opacity-100 transition-all duration-500 ease-out hover-hover:translate-x-12 hover-hover:opacity-0 hover-hover:group-hover:translate-x-0 hover-hover:group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(product, e);
            }}
            aria-label={
              isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
            }
            title={
              isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"
            }
            className={cn(
              "p-2.5 rounded-full glass transition-all active:scale-75",
              isFavorite
                ? "bg-red-500 text-white border-red-500/20 shadow-lg shadow-red-200/50"
                : "text-slate-600 hover:text-red-500",
            )}
          >
            <Heart
              className={cn(
                "size-4",
                isFavorite && "fill-current animate-heart-pop",
              )}
            />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="max-w-[80%] truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
              {product.category}
            </p>
            {/* O selo só pode afirmar o que é verdade PARA ESTE produto: o
                card não conhece o subtotal do carrinho nem se a cliente
                está logada, então não tem como saber se ela cumpre o
                mínimo da loja (`config.freeShippingMin`) -- só o próprio
                `product.freeShipping` é verdade aqui, sempre. A promessa
                por valor de compra mora no `FreeShippingBlock` (Home). */}
            {product.freeShipping && (
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-100/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-800">
                <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                <span className="truncate">Frete Grátis</span>
              </div>
            )}
          </div>
          <h3 className="line-clamp-2 text-[13px] font-black leading-tight text-slate-900 transition-colors duration-300 group-hover:text-primary sm:text-[14px]">
            {product.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {/* LOJA-01 (auditoria 26/08/2026): `produtos.rating` nasce com
                DEFAULT 5 e nada recalcula esse campo a partir das
                avaliações -- sem `reviewCount > 0` não existe avaliação de
                verdade por trás do número, e mostrar a estrela seria
                inventar nota. Calcular a nota certa é outra tarefa
                (migration com gatilho); esta só impede a mentira. */}
            {showRating && (product.reviewCount ?? 0) > 0 && (
              <StarRating rating={product.rating ?? 0} size={11} />
            )}
            {/*
              ADMIN-091 (#202): com `showRating=false` a linha fica só com o
              indicador de estoque. Em vez de deixar a linha "pobre" (o que
              o plano pediu para evitar), ele ganha mais destaque -- ponto
              maior e texto um degrau maior -- reaproveitando um sinal que o
              card já tinha, em vez de inventar um selo novo.
            */}
            <div
              className={cn(
                "flex items-center gap-1 font-bold",
                showRating ? "text-[9px]" : "text-[10px]",
              )}
            >
              <span
                className={cn(
                  "rounded-full animate-pulse",
                  showRating ? "w-1 h-1" : "w-1.5 h-1.5",
                  estoqueAtual <= 0
                    ? "bg-zinc-400"
                    : estoqueAtual <= 5
                      ? "bg-rose-500"
                      : "bg-emerald-500",
                )}
              />
              <span
                className={
                  estoqueAtual <= 0
                    ? "text-zinc-500"
                    : estoqueAtual <= 5
                      ? "text-rose-600"
                      : "text-emerald-700"
                }
              >
                {estoqueAtual <= 0
                  ? "Esgotado"
                  : estoqueAtual <= 5
                    ? `Apenas ${estoqueAtual} restam!`
                    : `Estoque: ${estoqueAtual}`}
              </span>
            </div>
          </div>
        </div>

        {/* Price */}
        <div className="mt-auto flex w-full items-end justify-between gap-2 pt-1">
          <div className="flex flex-col justify-end">
            {/* Preço DINÂMICO: com variação escolhida no card, mostra o
                priceOverride da escolha (mesma semântica da página do
                produto: `??` preserva override zero). */}
            {product.originalPrice && product.originalPrice > precoAtual ? (
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase leading-none tracking-wider text-slate-400">
                  De:{" "}
                  <span className="line-through">
                    {formatCurrency(product.originalPrice)}
                  </span>
                </span>
                <span className="mt-1 text-[15px] font-black leading-none tracking-tight text-rose-600">
                  Por: {formatCurrency(precoAtual)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-[15px] font-black leading-none tracking-tight text-slate-900">
                  {formatCurrency(precoAtual)}
                </span>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex shrink-0 items-center gap-1">
            {discount > 0 && (
              <span className="shrink-0 select-none rounded border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-rose-700">
                {discount}% OFF
              </span>
            )}
            {product.isBestseller && (
              <span className="flex shrink-0 select-none items-center gap-0.5 rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">
                <Flame className="size-2.5 shrink-0 fill-orange-500/20 text-orange-500" />
                <span>EM ALTA</span>
              </span>
            )}
          </div>
        </div>

        {/* Painel de opções NO CARD (card inteligente, pedido do Gabriel
            02/09): abre embaixo do preço, com a mesma regra da página do
            produto — grupos de variantes ativas, preço reagindo à escolha.
            O stopPropagation impede o clique (e o Enter) de abrir a página
            do produto enquanto o cliente escolhe. */}
        <AnimatePresence initial={false}>
          {painelOpcoesAberto &&
            hasActiveVariant &&
            onAddToCartWithVariants && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="mt-2 rounded-2xl border border-zinc-200/70 bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
                      Escolha as opções
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPainelOpcoesAberto(false);
                      }}
                      aria-label="Fechar opções"
                      className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <X className="size-3" />
                    </button>
                  </div>

                  <div className="mt-2 space-y-2.5">
                    {Array.from(variantGroups).map(([nome, valores]) => (
                      <div key={nome}>
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                          {nome}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {valores.map((v) => {
                            const semEstoque = (v.stockIncrement ?? 0) <= 0;
                            const ativa = selecionadas.get(nome) === v.value;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                disabled={semEstoque}
                                // Laudo de acessibilidade 03/09, achado 3: a
                                // opção marcada só se distinguia pela cor —
                                // `aria-pressed` anuncia o estado (padrão do
                                // CategoryFilter).
                                aria-pressed={ativa}
                                onClick={(e) => alternarOpcao(e, nome, v.value)}
                                title={
                                  semEstoque
                                    ? `${v.value} — sem estoque`
                                    : undefined
                                }
                                className={cn(
                                  "rounded-xl border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide transition-all active:scale-95",
                                  ativa
                                    ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900",
                                  semEstoque &&
                                    "cursor-not-allowed line-through opacity-40 hover:border-zinc-200 hover:text-zinc-600",
                                )}
                              >
                                {v.value}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
        </AnimatePresence>

        {/* Action Button */}
        <div className="mt-1.5">
          <button
            data-testid="product-card-action"
            onClick={handleAddToCartClick}
            disabled={estoqueAtual <= 0 || cartStatus !== "idle"}
            className={cn(
              "w-full py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-[0_4px_10px_rgba(24,24,27,0.1)] flex items-center justify-center gap-1.5",
              estoqueAtual <= 0
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none"
                : cartStatus === "success"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-primary hover:opacity-90 text-primary-foreground",
            )}
          >
            {cartStatus === "loading" && (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            )}
            {cartStatus === "success" && <Check className="size-3 shrink-0" />}
            {cartStatus === "idle" &&
              estoqueAtual > 0 &&
              !(painelOpcoesAberto && onAddToCartWithVariants) && (
                <ShoppingCart className="size-3 shrink-0" />
              )}
            <span className="truncate">
              {estoqueAtual <= 0
                ? "Esgotado"
                : painelOpcoesAberto && onAddToCartWithVariants
                  ? cartStatus === "loading"
                    ? "Salvando..."
                    : cartStatus === "success"
                      ? "Salvo!"
                      : escolhaCompleta
                        ? "Adicionar"
                        : "Escolha acima"
                  : hasActiveVariant
                    ? "Escolher opções"
                    : cartStatus === "idle"
                      ? "Carrinho"
                      : cartStatus === "loading"
                        ? "Salvando..."
                        : "Salvo!"}
            </span>
            {hasActiveVariant &&
              onAddToCartWithVariants &&
              estoqueAtual > 0 && (
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 transition-transform duration-200",
                    painelOpcoesAberto && "rotate-180",
                  )}
                />
              )}
          </button>
        </div>
      </div>
    </div>
  );
});
