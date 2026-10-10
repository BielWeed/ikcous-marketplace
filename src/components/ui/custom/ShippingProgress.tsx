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
        "mx-4 sm:mx-6 mt-4 mb-2 p-4 sm:p-5 rounded-[2rem] relative overflow-hidden transition-all duration-700 border",
        liberado
          ? "bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 border-emerald-100 shadow-[0_8px_30px_-10px_rgba(16,185,129,0.15)]"
          : "bg-white border-zinc-200/60 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.06)]",
      )}
    >
      {/* Animated Orbs for Premium Vibe */}
      {liberado && (
        <div className="pointer-events-none absolute right-0 top-0 size-48 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
      )}

      {/* Top Row: Icon + Title + Savings */}
      <div className="relative z-10 mb-4 flex items-center gap-3">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-colors duration-500",
            liberado
              ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30"
              : "bg-zinc-100 text-zinc-900 border border-zinc-200",
          )}
        >
          {liberado ? (
            <SparklesIcon className="size-5 drop-shadow-md" />
          ) : (
            <Truck className="size-5" />
          )}
        </motion.div>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-sm font-black uppercase tracking-tight truncate transition-colors",
              liberado ? "text-emerald-700" : "text-zinc-900",
            )}
          >
            {titulo}
          </h3>
          {/* REVISÃO Opus (BLOQUEIA 2, 23/09/2026): `text-zinc-400` sobre
              branco mede 2,56:1 (mesmo valor REPROVADO em
              order-list-contraste-do-card.test.tsx:9) — abaixo do mínimo AA
              (4,5:1). Os estados "gratis_so_na_mais_barata" e
              "meta_atingida_sem_gratis" carregam informação de dinheiro (a
              opção escolhida cobra) que precisa ser lida; `zinc-600` (mesmo
              tom aplicado a todo estado não-liberado, por simplicidade —
              inclusive o "Benefício exclusivo" decorativo do estado
              "meta") resolve para os três. */}
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-widest mt-0.5",
              liberado ? "text-emerald-700" : "text-zinc-600",
            )}
          >
            {subtitulo}
          </p>
        </div>

        {savings > 0 && (
          <div className="flex flex-col items-end text-right animate-in fade-in slide-in-from-right-4">
            <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-700">
              Economia
            </span>
            <span className="shrink-0 rounded-lg bg-emerald-100/50 px-2 py-0.5 text-xs font-black tracking-tighter text-emerald-700 sm:text-sm">
              + {formatCurrency(savings)}
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar System */}
      <div className="relative z-10">
        <div className="mb-1.5 flex items-end justify-between px-0.5">
          <span
            className={cn(
              "text-sm font-black tracking-tighter transition-colors",
              liberado ? "text-emerald-700" : "text-zinc-900",
            )}
          >
            {Math.floor(progressPercent)}%
          </span>
          {mostraMeta && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Faltam{" "}
              <strong className="font-black tracking-tight text-zinc-900">
                {formatCurrency(amountToFree)}
              </strong>
            </span>
          )}
        </div>

        <div
          className={cn(
            "h-2.5 w-full rounded-full overflow-hidden p-[2px]",
            liberado ? "bg-emerald-100" : "bg-zinc-100",
          )}
        >
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: progressPercent / 100 }}
            transition={{ duration: 1.2, ease: "circOut" }}
            style={{ originX: 0 }}
            className={cn(
              "h-full w-full rounded-full relative transition-colors duration-1000",
              liberado
                ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                : isNearlyThere
                  ? "bg-amber-400"
                  : "bg-zinc-900",
            )}
          />
        </div>
      </div>

      {/* Free Shipping Catalog Section (Compact) */}
      {mostraMeta && freeShippingProducts.length > 0 && !deferred && (
        <div className="relative z-10 mt-5 border-t border-dashed border-zinc-100 pt-4 duration-1000 animate-in fade-in slide-in-from-bottom-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <h4 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
              <SparklesIcon className="size-3.5 text-amber-500" />
              Atinja a Meta
            </h4>
          </div>

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 pb-2 sm:-mx-5 sm:px-5">
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
                  className="group/card w-[124px] flex-shrink-0 cursor-pointer rounded-2xl border border-zinc-100 bg-zinc-50 p-2 transition-colors hover:border-zinc-300"
                >
                  <div className="relative mb-2 aspect-square overflow-hidden rounded-xl border border-black/[0.03] bg-white shadow-sm">
                    <img
                      src={p.images[0]}
                      alt={p.name}
                      className="size-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                    />
                  </div>
                  <div className="px-0.5">
                    <p className="mb-1 line-clamp-2 min-h-[26px] text-[9px] font-black uppercase leading-snug tracking-tight text-zinc-600">
                      {p.name}
                    </p>
                    <p className="mb-2 text-[11px] font-black tracking-tighter text-zinc-900">
                      R$ {p.price.toFixed(2).replace(".", ",")}
                    </p>

                    <div className="mb-2 flex items-center justify-between gap-1 rounded-lg border border-zinc-200 bg-white p-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateQuantity(p.id, -1);
                        }}
                        className="flex size-5 items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="flex-1 text-center text-[10px] font-black text-zinc-900">
                        {getQuantity(p.id)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateQuantity(p.id, 1);
                        }}
                        className="flex size-5 items-center justify-center rounded-md bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                      >
                        <Plus className="size-3" />
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
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 py-1.5 text-white shadow-sm transition-colors hover:bg-zinc-800 active:scale-95"
                    >
                      <ShoppingCart className="size-3" />
                      <span className="text-[9px] font-black uppercase tracking-widest">
                        {hasActiveVariant ? "Escolher opções" : "Adicionar"}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
