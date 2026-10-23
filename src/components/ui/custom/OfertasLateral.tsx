import { LazyImage } from "@/components/LazyImage";
import { BotaoDeFavorito } from "@/components/ui/custom/BotaoDeFavorito";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO } from "@/lib/cor-do-preco-promocional";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import { Check, ImageIcon, Loader2, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
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
  return (
    <article
      data-oferta-lateral={product.id}
      onMouseEnter={() => prefetchView("product-detail")}
      onTouchStart={() => prefetchView("product-detail")}
      style={{ minHeight: ALTURA_CARTAO_LATERAL }}
      className={cn(
        "relative flex min-w-0 overflow-hidden rounded-[26px] border border-solid border-zinc-200 bg-white",
        rola ? "shrink-0 basis-[88%]" : "w-full",
      )}
    >
      <div className="relative w-2/5 shrink-0 self-stretch bg-zinc-100">
        {product.images[0] ? (
          // Absoluta: a proporção da foto não pode definir a altura do cartão.
          <div className="absolute inset-0">
            <LazyImage
              src={product.images[0]}
              alt={product.name}
              sizes="150px"
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
            className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-emerald-700 px-3 py-1"
          >
            <span className="text-xs font-bold leading-4 text-white">
              {discount}% OFF
            </span>
          </div>
        )}
        <BotaoDeFavorito
          nome={product.name}
          favorito={isFavorite}
          onClick={handleFavoriteClick}
          className="absolute right-2.5 top-2.5 z-20"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <h3 className="mb-1 line-clamp-2 min-h-10 break-words text-base font-bold leading-5 text-zinc-950">
          {product.name}
        </h3>
        <div className="min-h-4 truncate whitespace-nowrap text-xs leading-4 text-zinc-500 line-through">
          {precoAntigo ? `De ${formatCurrency(precoAntigo)}` : null}
        </div>
        {/* 22px cabe o maior preço comum na coluna de 154px (tela de 360px); de 10 mil em diante, 20px. */}
        <span
          data-preco-oferta
          className={cn(
            "whitespace-nowrap font-extrabold tracking-tight tabular-nums",
            product.price >= 10000 ? "text-[20px]" : "text-[22px]",
            // Depois do tamanho: o tailwind-merge descarta o leading que vem antes de text-[..].
            "leading-8",
            esgotado
              ? "text-zinc-950"
              : precoAntigo
                ? CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO
                : "text-slate-900",
          )}
        >
          {formatCurrency(product.price)}
        </span>
        {precoAntigo && discount > 0 && (
          <span
            data-economia-oferta
            className="truncate whitespace-nowrap text-xs font-medium leading-4 text-zinc-600"
          >
            Economiza {formatCurrency(precoAntigo - product.price)}
          </span>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold leading-4">
            {estoque && (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    esgotado ? "bg-red-700" : "bg-amber-600",
                  )}
                />
                <span className={esgotado ? "text-red-800" : "text-amber-700"}>
                  {estoque}
                </span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={handleAddToCartClick}
            data-compra-oferta
            aria-label={rotuloCompra}
            title={rotuloCompra}
            disabled={esgotado || cartStatus !== "idle"}
            className={cn(
              "relative z-20 flex size-12 shrink-0 items-center justify-center rounded-full border border-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
        </div>
      </div>
      <button
        type="button"
        aria-label={`Ver ${product.name}`}
        onClick={handleCardClick}
        className="absolute inset-0 min-h-11 min-w-11 rounded-[26px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
    </article>
  );
}
