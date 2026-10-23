import { LazyImage } from "@/components/LazyImage";
import { BotaoDeFavorito } from "@/components/ui/custom/BotaoDeFavorito";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO } from "@/lib/cor-do-preco-promocional";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import { Check, ImageIcon, Loader2, ShoppingCart } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import {
  type PremiumOffersProps,
  ordenarOfertas,
  useAcoesDaOferta,
} from "./PremiumOffers";
import {
  ALTURA_CARTAO_LATERAL,
  ALTURA_SECAO_LATERAL,
} from "./ofertas-lateral-altura";

/** O módulo só é baixado quando a vitrine de Ofertas escolheu Lateral. */
export default function OfertasLateral({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
  title = "Super Descontos",
}: PremiumOffersProps) {
  const ofertas = ordenarOfertas(products);
  const rola = ofertas.length > 1;
  const [pagina, setPagina] = useState(0);
  const [ref, api] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    loop: false,
    active: rola,
  });
  useEffect(() => {
    if (!api) return;
    const selecionar = () => setPagina(api.selectedScrollSnap());
    selecionar();
    api.on("select", selecionar);
    api.on("reInit", selecionar);
    return () => {
      api.off("select", selecionar);
      api.off("reInit", selecionar);
    };
  }, [api]);
  if (ofertas.length === 0) return null;
  return (
    <section
      data-testid="ofertas-lateral"
      style={{ minHeight: ALTURA_SECAO_LATERAL }}
      className="relative bg-white py-4"
    >
      <div className="mb-5 flex min-h-6 items-center justify-between gap-3 px-5">
        <h2 className="min-w-0 break-words text-xl font-extrabold leading-6 tracking-tight text-zinc-950">
          {title}
        </h2>
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full text-emerald-700"
        >
          <svg viewBox="0 0 6 6" className="size-full" aria-hidden="true">
            <circle cx="3" cy="3" r="3" fill="currentColor" />
          </svg>
        </span>
      </div>
      <div
        ref={rola ? ref : undefined}
        className={cn(
          "ml-3 overflow-hidden min-[360px]:ml-5",
          !rola && "mr-3 min-[360px]:mr-5",
        )}
      >
        <div className="flex gap-2.5 py-1">
          {ofertas.map(({ product, discount }) => (
            <CartaoOfertaLateral
              key={product.id}
              product={product}
              discount={discount}
              rola={rola}
              isFavorite={favorites.includes(product.id)}
              onToggleFavorite={onToggleFavorite}
              onProductClick={onProductClick}
              onAddToCart={onAddToCart}
              onQuickBuy={onQuickBuy}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-1.5 items-center justify-center gap-1.5">
        {rola &&
          ofertas.map(({ product }, i) => (
            <span
              key={product.id}
              data-pagina-ofertas
              aria-current={pagina === i ? "true" : undefined}
              aria-label={`Oferta ${i + 1} de ${ofertas.length}`}
              className={cn(
                "h-1.5 rounded-full",
                pagina === i ? "w-6 bg-zinc-950" : "w-1.5 bg-zinc-200",
              )}
            />
          ))}
      </div>
    </section>
  );
}

// Tamanho do texto pela largura REAL da coluna de texto (a coluna é um container: 100cqw = 159px a 320px (foto de 88px abaixo de 340px)
// de tela, 171px a 360px, 198px a 390px). Larguras por caractere medidas em navegador real: preço
// extrabold ~0,55 x corpo, "De" ~0,54 x corpo. O corpo do preço é o maior (13 a 20px) em que preço + "De"
// cabem na coluna, com o "De" em 55% do preço (mínimo 10px); sem espaço nem no piso, o "De" inteiro passa
// para a linha de baixo e é recortado (flex-wrap + overflow-hidden), nunca aparece cortado no meio.
// "Economiza" divide a faixa com o carrinho (44px + 4 de respiro) e vai de 12px até 10px.
function medidasDoTexto(
  preco: string,
  de: string | null,
  economia: string | null,
) {
  const n = (x: number) => Math.round(x * 1000) / 1000;
  const p = n(preco.length * 0.55);
  const d = de ? n(de.length * 0.54) : 0;
  const preco20 = de
    ? `min(calc((100cqw - 6px) / ${n(p + d * 0.55)}), calc((100cqw - ${n(6 + d * 10)}px) / ${p}))`
    : `calc(100cqw / ${p})`;
  return {
    "--fonte-preco": `clamp(13px, ${preco20}, 20px)`,
    "--fonte-de": "max(10px, calc(var(--fonte-preco) * 0.55))",
    "--fonte-economia": economia
      ? `clamp(10px, calc((100cqw - 48px) / ${n(economia.length * 0.56)}), 12px)`
      : "12px",
  } as CSSProperties;
}

function CartaoOfertaLateral({
  product,
  discount,
  rola,
  isFavorite,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
}: Pick<
  PremiumOffersProps,
  "onToggleFavorite" | "onProductClick" | "onAddToCart" | "onQuickBuy"
> & {
  product: Product;
  discount: number;
  rola: boolean;
  isFavorite: boolean;
}) {
  const {
    cartStatus,
    handleCardClick,
    handleAddToCartClick,
    handleFavoriteClick,
    hasActiveVariant,
    precoAntigo,
  } = useAcoesDaOferta({
    product,
    onToggleFavorite,
    onProductClick,
    onAddToCart,
    onQuickBuy,
  });
  const { prefetchView } = usePrefetchOnHover();
  const esgotado = product.stock <= 0;
  const estoque =
    esgotado || product.stock <= 10
      ? esgotado
        ? "Esgotado"
        : product.stock === 1
          ? "Resta 1!"
          : `Restam ${product.stock}`
      : null;
  const rotuloCompra = esgotado
    ? `Esgotado: ${product.name}`
    : hasActiveVariant
      ? `Escolher opções de ${product.name}`
      : cartStatus === "success"
        ? `Adicionado ao carrinho: ${product.name}`
        : `Adicionar ${product.name} ao carrinho`;
  const textoPreco = formatCurrency(product.price);
  const textoDe = precoAntigo ? `De ${formatCurrency(precoAntigo)}` : null;
  const textoEconomia =
    precoAntigo && discount > 0
      ? `Economiza ${formatCurrency(precoAntigo - product.price)}`
      : null;
  const medidas = medidasDoTexto(textoPreco, textoDe, textoEconomia);
  return (
    <article
      data-oferta-lateral={product.id}
      onMouseEnter={() => prefetchView("product-detail")}
      onTouchStart={() => prefetchView("product-detail")}
      style={{ height: ALTURA_CARTAO_LATERAL }}
      className={cn(
        "relative flex min-w-0 overflow-hidden rounded-[20px] border border-solid border-zinc-200 bg-white",
        rola ? "shrink-0 basis-[88%]" : "w-full",
      )}
    >
      <div className="relative w-[104px] shrink-0 self-stretch bg-zinc-100 max-[339px]:w-[88px]">
        {product.images[0] ? (
          // Absoluta: a proporção da foto não pode definir a altura do cartão.
          <div className="absolute inset-0">
            <LazyImage
              src={product.images[0]}
              alt={product.name}
              sizes="104px"
              className="size-full object-cover"
            />
          </div>
        ) : (
          <div
            data-sem-foto
            className="flex size-full flex-col items-center justify-center gap-2 text-zinc-500"
          >
            <ImageIcon aria-hidden="true" className="size-6" />
            <span className="text-xs">Sem foto</span>
          </div>
        )}
        {esgotado && (
          <div className="pointer-events-none absolute inset-0 bg-white/70" />
        )}
        {/* Verde escuro com texto branco (5,5:1): legível sobre qualquer foto. */}
        {precoAntigo && discount > 0 && (
          <div
            data-selo-desconto
            className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-16px)] whitespace-nowrap rounded-full bg-emerald-700 px-2.5 py-1"
          >
            <span className="text-xs font-bold leading-4 text-white">
              {discount}% OFF
            </span>
          </div>
        )}
        {/* Visual de 30px; o ::after estende a área de toque a 44px (7px de cada lado), toda dentro da foto. */}
        <BotaoDeFavorito
          nome={product.name}
          favorito={isFavorite}
          onClick={handleFavoriteClick}
          className="absolute right-2 top-2 z-20 size-[30px] after:absolute after:inset-[-7px] after:content-['']"
        />
      </div>
      <div
        style={medidas}
        className="flex min-w-0 flex-1 flex-col py-2.5 pl-3 pr-2.5 [container-type:inline-size]"
      >
        <h3 className="line-clamp-2 h-9 break-words text-sm font-semibold leading-[18px] text-zinc-950">
          {product.name}
        </h3>
        <div className="mt-0.5 flex h-7 flex-wrap content-start items-baseline gap-x-1.5 overflow-hidden whitespace-nowrap">
          <span
            data-preco-oferta
            className={cn(
              "shrink-0 whitespace-nowrap font-extrabold tracking-tight tabular-nums",
              "text-[length:var(--fonte-preco)]",
              // Depois do tamanho: o tailwind-merge descarta o leading que vem antes de text-*.
              "leading-7",
              esgotado
                ? "text-zinc-950"
                : precoAntigo
                  ? CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO
                  : "text-slate-900",
            )}
          >
            {textoPreco}
          </span>
          {textoDe && (
            <span
              className={cn(
                "text-[length:var(--fonte-de)]",
                // Depois do tamanho: o tailwind-merge descarta o leading que vem antes de text-[..].
                "leading-4 text-zinc-500 line-through",
              )}
            >
              {textoDe}
            </span>
          )}
        </div>
        {/* O item vazio (16px de altura) na frente deixa o texto ir para a linha de baixo (recortada) se não couber: some inteiro, nunca cortado no meio. */}
        <div className="flex h-4 flex-wrap content-start overflow-hidden">
          {textoEconomia && <span aria-hidden="true" className="h-4 w-0" />}
          {textoEconomia && (
            <span
              data-economia-oferta
              className={cn(
                "shrink-0 whitespace-nowrap pr-12 font-medium text-[length:var(--fonte-economia)]",
                "leading-4 text-zinc-600",
              )}
            >
              {textoEconomia}
            </span>
          )}
        </div>
        <div className="mt-auto flex h-4 items-center gap-1.5 pr-12 text-xs font-bold leading-4">
          {estoque && (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  esgotado ? "bg-red-700" : "bg-amber-600",
                )}
              />
              <span
                className={cn(
                  "truncate",
                  esgotado ? "text-red-800" : "text-amber-700",
                )}
              >
                {estoque}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Só na faixa de baixo (topo a ~74px; a linha do preço termina em ~70px): não bate no preço. */}
      <button
        type="button"
        onClick={handleAddToCartClick}
        data-compra-oferta
        aria-label={rotuloCompra}
        title={rotuloCompra}
        disabled={esgotado || cartStatus !== "idle"}
        className={cn(
          "absolute bottom-1 right-2.5 z-20 flex size-11 shrink-0 items-center justify-center rounded-full border border-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          esgotado
            ? "border-zinc-100 bg-zinc-100 text-zinc-500"
            : cartStatus === "success"
              ? "border-zinc-200 bg-white text-emerald-700"
              : "border-zinc-950 bg-zinc-950 text-white",
        )}
      >
        {cartStatus === "success" ? (
          <Check aria-hidden="true" className="size-5 shrink-0" />
        ) : cartStatus === "loading" ? (
          <Loader2
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin"
          />
        ) : (
          <ShoppingCart aria-hidden="true" className="size-5 shrink-0" />
        )}
        <span aria-live="polite" className="sr-only">
          {cartStatus === "loading"
            ? "Adicionando"
            : cartStatus === "success"
              ? "Adicionado"
              : ""}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Ver ${product.name}`}
        onClick={handleCardClick}
        className="absolute inset-0 min-h-11 min-w-11 rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
    </article>
  );
}
