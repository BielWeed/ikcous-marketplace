import { LazyImage } from "@/components/LazyImage";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO } from "@/lib/cor-do-preco-promocional";
import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import { Check, Heart, ImageIcon, Loader2, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type PremiumOffersProps,
  ordenarOfertas,
  useAcoesDaOferta,
} from "./PremiumOffers";

/** O módulo só é baixado quando a vitrine de Ofertas escolheu Compacto. */
export default function OfertasCompactas({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
  title = "Super Descontos",
}: PremiumOffersProps) {
  const ofertas = ordenarOfertas(products);
  const rola = ofertas.length > 2;
  const [pagina, setPagina] = useState(0);
  const [ref, api] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 2,
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
      data-testid="ofertas-compactas"
      className="relative min-h-[392px] bg-white py-4"
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
            <CartaoOfertaCompacta
              key={product.id}
              product={product}
              discount={discount}
              largura={ofertas.length === 1 ? 350 : 165}
              largo={ofertas.length === 1}
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
          Array.from({ length: Math.ceil(ofertas.length / 2) }, (_, i) => (
            <span
              key={i}
              data-pagina-ofertas
              aria-current={pagina === i ? "true" : undefined}
              aria-label={`Página ${i + 1} de ofertas`}
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

function CartaoOfertaCompacta({
  product,
  discount,
  largura,
  largo,
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
  largura: number;
  largo: boolean;
  rola: boolean;
  isFavorite: boolean;
}) {
  const {
    cartStatus,
    handleCardClick,
    handleAddToCartClick,
    handleFavoriteClick,
    hasActiveVariant,
    savings,
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
  const desconto =
    precoAntigo && discount > 0 ? (
      <span
        className={cn(
          "text-[11px] font-bold leading-4",
          CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO,
        )}
      >
        {discount}% OFF
      </span>
    ) : null;
  const estoque =
    esgotado || product.stock <= 10 ? (
      <span className="text-[11px] font-bold leading-4 text-red-800">
        {esgotado
          ? "Esgotado"
          : product.stock === 1
            ? "Resta 1!"
            : `Restam ${product.stock}`}
      </span>
    ) : null;
  const rotuloCompra = esgotado
    ? "Esgotado"
    : hasActiveVariant
      ? "Escolher opções"
      : cartStatus === "success"
        ? "Adicionado"
        : cartStatus === "loading"
          ? "Adicionando"
          : "Adicionar";
  return (
    <article
      data-oferta-compacta={product.id}
      style={{ width: largura }}
      onMouseEnter={() => prefetchView("product-detail")}
      onTouchStart={() => prefetchView("product-detail")}
      className={cn(
        "relative flex min-h-[290px] min-w-0 max-w-full rounded-[20px] border border-zinc-200 bg-white",
        largo ? "flex-row gap-4 p-3" : "flex-col",
        rola && "shrink-0 max-[359px]:!w-[145px]",
      )}
    >
      <div
        data-foto-oferta
        className={cn(
          "relative shrink-0 overflow-hidden bg-zinc-100",
          largo
            ? "min-h-[264px] w-[44%] self-stretch rounded-[14px]"
            : "h-[136px] w-full rounded-t-[19px]",
        )}
      >
        {product.images[0] ? (
          <LazyImage
            src={product.images[0]}
            alt={product.name}
            sizes="165px"
            className="size-full object-cover"
          />
        ) : (
          <div
            data-sem-foto
            className="flex size-full min-h-[136px] flex-col items-center justify-center gap-2 text-zinc-500"
          >
            <ImageIcon aria-hidden="true" className="size-6" />
            <span className="text-xs">Sem foto</span>
          </div>
        )}
        {esgotado && (
          <div className="pointer-events-none absolute inset-0 bg-white/70" />
        )}
        {!largo && (
          <>
            {/* Pastilha branca: o texto fica legivel sobre qualquer foto (clara ou escura). */}
            {desconto && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/90 px-1.5 py-0.5">
                {desconto}
              </div>
            )}
            {estoque && (
              <div className="pointer-events-none absolute bottom-2 left-3 rounded-md bg-white/90 px-1.5 py-0.5">
                {estoque}
              </div>
            )}
          </>
        )}
        <button
          type="button"
          onClick={handleFavoriteClick}
          aria-label={rotuloDeFavoritar(product.name, isFavorite)}
          aria-pressed={isFavorite}
          className={cn(
            "absolute right-1 top-1 z-20 flex size-11 items-center justify-center rounded-xl bg-white focus-visible:ring-2 focus-visible:ring-zinc-950",
            isFavorite ? "text-zinc-950" : "text-zinc-500",
          )}
        >
          <Heart
            aria-hidden="true"
            className={cn("size-6", isFavorite && "fill-current")}
          />
        </button>
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", !largo && "p-2.5")}>
        {largo && <div className="mb-3">{desconto}</div>}
        <h3
          className={cn(
            "mb-1.5 min-h-8 break-words text-[13px] font-medium leading-4 text-zinc-950",
            largo && "mb-auto pb-3",
          )}
        >
          {product.name}
        </h3>
        <div className="min-h-3.5 text-[11px] leading-[14px] text-zinc-500 line-through">
          {precoAntigo ? `De: ${formatCurrency(precoAntigo)}` : null}
        </div>
        <span
          data-preco-oferta
          className={cn(
            "break-words text-[22px] font-extrabold leading-7 tracking-tight",
            esgotado
              ? "text-zinc-950"
              : precoAntigo
                ? CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO
                : "text-slate-900",
          )}
        >
          {formatCurrency(product.price)}
        </span>
        {largo && savings > 0 && (
          <span
            className={cn(
              "mt-2 break-words text-[11px] font-bold leading-4",
              CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO,
            )}
          >
            Economize {formatCurrency(savings)}
          </span>
        )}
        {largo && <div className="mt-2">{estoque}</div>}
        <button
          type="button"
          onClick={handleAddToCartClick}
          data-compra-oferta
          aria-label={
            esgotado
              ? `Esgotado: ${product.name}`
              : hasActiveVariant
                ? `Escolher opções de ${product.name}`
                : cartStatus === "success"
                  ? `Adicionado ao carrinho: ${product.name}`
                  : `${rotuloCompra} ${product.name} ao carrinho`
          }
          disabled={esgotado || cartStatus !== "idle"}
          className={cn(
            "relative z-10 mt-2 flex min-h-11 min-w-11 w-full shrink-0 items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
            esgotado
              ? "border-zinc-100 bg-zinc-100 text-zinc-500"
              : cartStatus === "success"
                ? "border-zinc-200 bg-white text-emerald-700"
                : "border-zinc-950 bg-zinc-950 text-white",
          )}
        >
          {cartStatus === "success" ? (
            <Check aria-hidden="true" className="size-4 shrink-0" />
          ) : cartStatus === "loading" ? (
            <Loader2
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin"
            />
          ) : !esgotado && !hasActiveVariant ? (
            <ShoppingCart aria-hidden="true" className="size-[18px] shrink-0" />
          ) : null}
          <span aria-live="polite">{rotuloCompra}</span>
        </button>
      </div>
      <button
        type="button"
        aria-label={`Ver ${product.name}`}
        onClick={handleCardClick}
        className="absolute inset-0 min-h-11 min-w-11 rounded-[20px] focus-visible:ring-2 focus-visible:ring-zinc-950"
      />
    </article>
  );
}
