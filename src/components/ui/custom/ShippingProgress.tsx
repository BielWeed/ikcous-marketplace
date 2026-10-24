import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Minus,
  Plus,
  ShoppingCart,
  Sparkles as SparklesIcon,
  Truck,
} from "lucide-react";
import { useState } from "react";

/**
 * T3-2 (23/09/2026): o estado visual da barra — decidido pela função pura
 * `estadoDaBarraDeFrete` (CartView.tsx), nunca por `shipping === 0` aqui
 * dentro. "liberado" (grátis de verdade), "meta" (falta valor, mostra
 * "Faltam" e o catálogo "Atinja a Meta"), "gratis_so_na_mais_barata" (meta
 * batida mas a opção escolhida não é a mais barata — alcance nacional
 * "mais_barata") e "meta_atingida_sem_gratis" (meta batida, opção escolhida
 * cobra, e o alcance não é "mais_barata" — cotação nacional desatualizada,
 * caso raro).
 */
export type EstadoDaBarraDeFrete =
  | "liberado"
  | "meta"
  | "gratis_so_na_mais_barata"
  | "meta_atingida_sem_gratis";

interface ShippingProgressProps {
  estado: EstadoDaBarraDeFrete;
  savings: number;
  progressPercent: number;
  amountToFree: number;
  isNearlyThere: boolean;
  freeShippingProducts: Product[];
  onAddToCart?: (product: Product, quantity?: number) => void;
  deferred?: boolean;
  onNavigate?: (view: any, id?: string) => void;
}

export function ShippingProgress({
  estado,
  savings,
  progressPercent,
  amountToFree,
  isNearlyThere,
  freeShippingProducts,
  onAddToCart,
  deferred = false,
  onNavigate,
}: ShippingProgressProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const getQuantity = (productId: string) => quantities[productId] || 1;
  const updateQuantity = (productId: string, delta: number) => {
    haptic.light();
    setQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(1, (prev[productId] || 1) + delta),
    }));
  };

  // Rede de segurança (achado CartView-328): quem monta este componente
  // (CartView) já filtra pela regra de frete via `deveExibirMetaDeFreteGratis`,
  // mas o componente não pode DEPENDER de o chamador lembrar disso. Uma meta
  // de valor genuinamente ativa nunca chega com os dois zerados ao mesmo
  // tempo: 0% só acontece enquanto falta valor (`amountToFree` > 0), e faltar
  // R$ 0,00 só acontece com a meta batida (progresso 100%, e mesmo assim o
  // grátis já garantido entra aqui com progressPercent=100 — CartView.tsx).
  // 0%/R$ 0,00 juntos só significa "não existe meta nenhuma configurada".
  if (progressPercent === 0 && amountToFree === 0) {
    return null;
  }

  // T3-2 (23/09/2026, plano estrategias-de-frete-local-e-nacional): o texto
  // e a cor deixam de ler `shipping === 0` — dois defeitos vinham dele: (1)
  // retirada na loja sempre chega com preço 0 mesmo sem a meta batida
  // (comemorava "Liberado" cedo demais); (2) meta batida com alcance
  // "mais_barata" e a opção escolhida NÃO sendo a mais barata (freteGratis
  // falso, mas `amountToFree` zerado) dizia "Faltam R$ 0,00" para um frete
  // que a cliente vai pagar. `estado` é a fonte única, decidida pela função
  // pura `estadoDaBarraDeFrete` (CartView.tsx) — este componente só
  // renderiza o que ela mandou, sem reconstruir a decisão a partir do preço.
  const liberado = estado === "liberado";
  const mostraMeta = estado === "meta";

  // REVISÃO Opus (BLOQUEIA 1, 23/09/2026): "Frete grátis na opção mais
  // barata" mede ~270px em Inter e a coluna do título no celular de 375px
  // tem ~221px — cortava para "FRETE GRÁTIS NA OPÇÃO MAI…" (`truncate`
  // abaixo), sumindo exatamente a restrição e sugerindo que a opção
  // ESCOLHIDA é grátis, o que o dono proibiu (contrato §3, CartView.tsx).
  // Os títulos não-"liberado" agora entram pela restrição e cabem em
  // ~200px (piso operável em teste, já que jsdom não mede layout: ~24
  // caracteres — ver o teste de comprimento em
  // carrinho-barra-de-frete-fala-da-opcao-escolhida.test.tsx).
  const titulo =
    estado === "liberado"
      ? "Frete Grátis Liberado"
      : estado === "gratis_so_na_mais_barata"
        ? "Grátis só na mais barata"
        : estado === "meta_atingida_sem_gratis"
          ? "Meta atingida"
          : "Meta Frete Grátis";

  const subtitulo =
    estado === "liberado"
      ? "Seu carrinho já ganhou entrega grátis!"
      : estado === "gratis_so_na_mais_barata"
        ? "A opção escolhida não entra no grátis"
        : estado === "meta_atingida_sem_gratis"
          ? "Recalcule o frete para aplicar o grátis"
          : "Benefício exclusivo";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[18px] border bg-background p-4",
        liberado
          ? "border-emerald-300 dark:border-emerald-500/50"
          : "border-border",
      )}
    >
      {/* Top Row: Icon + Title + Savings */}
      <div className="mb-4 flex items-center gap-3">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            liberado
              ? "bg-emerald-500 text-white"
              : "bg-muted/60 text-foreground",
          )}
        >
          {liberado ? (
            <SparklesIcon className="size-5" />
          ) : (
            <Truck className="size-5" />
          )}
        </motion.div>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-[15px] font-semibold leading-tight",
              liberado
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-foreground",
            )}
          >
            {titulo}
          </h3>
          {/* REVISÃO Opus (BLOQUEIA 2, 23/09/2026): o subtítulo dos estados
              não-liberado carrega informação de dinheiro (a opção escolhida
              cobra) e precisa passar do AA (4,5:1) — `text-zinc-400` media
              2,56:1. `text-muted-foreground` mede o mesmo que o antigo
              `zinc-600` e, sem opacidade, não reprova nos dois temas. */}
          <p
            className={cn(
              "mt-0.5 text-[13px] leading-snug",
              liberado
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {subtitulo}
          </p>
        </div>

        {savings > 0 && (
          <div className="flex flex-col items-end text-right">
            <span className="mb-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400">
              Economia
            </span>
            <span className="shrink-0 text-sm font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
              + {formatCurrency(savings)}
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar System */}
      <div>
        <div className="mb-1.5 flex items-end justify-between gap-2">
          <span
            className={cn(
              "text-sm font-bold tracking-tight",
              liberado
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-foreground",
            )}
          >
            {Math.floor(progressPercent)}%
          </span>
          {mostraMeta && (
            <span className="text-[13px] text-muted-foreground">
              Faltam{" "}
              <strong className="font-bold tracking-tight text-foreground">
                {formatCurrency(amountToFree)}
              </strong>
            </span>
          )}
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progressPercent / 100 }}
            transition={{ duration: 1.2, ease: "circOut" }}
            style={{ originX: 0 }}
            className={cn(
              "h-full w-full rounded-full",
              liberado
                ? "bg-emerald-500"
                : isNearlyThere
                  ? "bg-amber-500"
                  : "bg-foreground",
            )}
          />
        </div>
      </div>

      {/* Free Shipping Catalog Section (Compact) */}
      {mostraMeta && freeShippingProducts.length > 0 && !deferred && (
        <div className="mt-5 border-t border-dashed border-border pt-4">
          <h4 className="mb-3 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            Atinja a Meta
          </h4>

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 pb-1">
            {freeShippingProducts.map((p: Product) => {
              // Rede de segurança: a lista já vem filtrada em
              // getFreeShippingEligibleProducts (useProducts.ts), mas o
              // "Adicionar" daqui não passa pelo ProductCard -- se um
              // produto com variação ativa chegar de outro jeito, o botão
              // não pode adicionar sem a escolha (mesmo critério do
              // ProductCard: `variants?.some(v => v.active)`).
              const hasActiveVariant =
                p.variants?.some((v) => v.active) ?? false;
              const goToProduct = () => {
                haptic.light();
                if (onNavigate) {
                  onNavigate("product-detail", p.id);
                } else {
                  globalThis.history.pushState(
                    { view: "product-detail", id: p.id },
                    "",
                    `?product=${p.id}`,
                  );
                  globalThis.dispatchEvent(new PopStateEvent("popstate"));
                }
              };
              return (
                <div
                  key={p.id}
                  onClick={goToProduct}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goToProduct();
                    }
                  }}
                  className="w-[148px] flex-shrink-0 cursor-pointer rounded-[14px] border border-border p-2 transition-colors hover:border-foreground/40"
                >
                  <div className="mb-2 aspect-square overflow-hidden rounded-lg bg-muted">
                    <img
                      src={p.images[0]}
                      alt={p.name}
                      className="size-full object-cover"
                    />
                  </div>
                  <p className="mb-1 line-clamp-2 min-h-10 text-[13px] font-medium leading-tight text-foreground">
                    {p.name}
                  </p>
                  <p className="mb-2 text-sm font-bold tracking-tight text-foreground">
                    {formatCurrency(p.price)}
                  </p>

                  <div className="mb-2 flex items-center justify-between rounded-full bg-muted p-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(p.id, -1);
                      }}
                      aria-label="Diminuir quantidade"
                      className="flex size-11 items-center justify-center rounded-full text-foreground active:scale-90"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="text-sm font-bold text-foreground">
                      {getQuantity(p.id)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateQuantity(p.id, 1);
                      }}
                      aria-label="Aumentar quantidade"
                      className="flex size-11 items-center justify-center rounded-full text-foreground active:scale-90"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasActiveVariant) {
                        goToProduct();
                        return;
                      }
                      haptic.medium();
                      onAddToCart?.(p, getQuantity(p.id));
                    }}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-foreground text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-95"
                  >
                    <ShoppingCart className="size-3.5" />
                    {hasActiveVariant ? "Escolher opções" : "Adicionar"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
