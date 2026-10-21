import { LazyImage } from "@/components/LazyImage";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import useEmblaCarousel from "embla-carousel-react";
import {
  Check,
  Flame,
  Heart,
  ImageIcon,
  Loader2,
  ShoppingCart,
} from "lucide-react";
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
      className="relative h-[306px] overflow-hidden bg-gradient-to-b from-zinc-50/20 via-zinc-50/10 to-transparent py-4"
    >
      <div className="mb-3 flex h-5 items-center gap-1.5 px-5">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-secondary" />
        </span>
        <h2 className="truncate text-xl font-extrabold leading-none tracking-tight text-zinc-950">
          {title}
        </h2>
      </div>
      <div
        ref={rola ? ref : undefined}
        className={cn("ml-5 h-[228px] overflow-hidden", !rola && "mr-5")}
      >
        <div className="flex gap-2.5 py-1">
          {ofertas.map(({ product, discount }) => (
            <CartaoOfertaCompacta
              key={product.id}
              product={product}
              discount={discount}
              largura={ofertas.length === 1 ? 350 : rola ? 156 : 170}
              largo={ofertas.length === 1}
              rola={rola}
              isFavorite={favorites.includes(product.id)}
              onToggleFavorite={onToggleFavorite}
              onProductClick={onProductClick}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex h-1.5 items-center justify-center gap-1.5">
        {rola &&
          Array.from({ length: Math.ceil(ofertas.length / 2) }, (_, i) => (
            <span
              key={i}
              data-pagina-ofertas
              aria-current={pagina === i ? "true" : undefined}
              aria-label={`Página ${i + 1} de ofertas`}
              className={cn(
                "h-1.5 rounded-full",
                pagina === i ? "w-6 bg-primary" : "w-1.5 bg-zinc-200",
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
}: Pick<
  PremiumOffersProps,
  "onToggleFavorite" | "onProductClick" | "onAddToCart"
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
  });
  const { prefetchView } = usePrefetchOnHover();
  const esgotado = product.stock <= 0;
  const botao = (
    <button
      type="button"
      onClick={handleAddToCartClick}
      aria-label={`Adicionar ${product.name} ao carrinho`}
      disabled={esgotado || cartStatus !== "idle"}
      className={cn(
        "z-10 flex items-center justify-center gap-1 rounded-full text-[11px] font-extrabold",
        largo
          ? "relative mt-auto h-11 w-full shrink-0"
          : "absolute right-[13px] top-[73px] size-11 ring-[3px] ring-white",
        esgotado
          ? "bg-zinc-200 text-zinc-500"
          : cartStatus === "success"
            ? "bg-emerald-600 text-white"
            : "bg-primary text-primary-foreground",
      )}
    >
      {cartStatus === "success" ? (
        <Check className="size-5" />
      ) : cartStatus === "loading" ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <ShoppingCart className="size-5" />
      )}
      {largo &&
        (esgotado
          ? "Esgotado"
          : hasActiveVariant
            ? "Escolher opções"
            : cartStatus === "success"
              ? "Adicionado!"
              : cartStatus === "loading"
                ? "Adicionando..."
                : "Adicionar")}
    </button>
  );
  return (
    <article
      data-oferta-compacta={product.id}
      style={{ width: largura }}
      onMouseEnter={() => prefetchView("product-detail")}
      onTouchStart={() => prefetchView("product-detail")}
      className={cn(
        "relative h-[220px] min-w-0 max-w-full rounded-[20px] border border-zinc-200 bg-white shadow-sm",
        rola && "shrink-0",
      )}
    >
      <div
        className={cn(
          "absolute left-[5px] top-[5px] overflow-hidden rounded-[14px] bg-slate-100",
          largo ? "h-[208px] w-[168px]" : "right-[5px] h-[120px]",
        )}
      >
        {product.images[0] ? (
          <LazyImage
            src={product.images[0]}
            alt={product.name}
            sizes="170px"
            className="size-full object-cover"
          />
        ) : (
          <div
            data-sem-foto
            className="flex size-full items-center justify-center"
          >
            <ImageIcon aria-hidden="true" className="size-7 text-slate-400" />
          </div>
        )}
        {esgotado && <div className="absolute inset-0 bg-white/70" />}
      </div>
      {precoAntigo && discount > 0 && (
        <div className="pointer-events-none absolute left-[11px] top-[11px] flex h-[22px] overflow-hidden rounded-full bg-emerald-50 text-[11px] font-extrabold text-emerald-700">
          <span className="flex w-[26px] items-center justify-center bg-zinc-950 text-white">
            <Flame className="size-3 fill-current" />
          </span>
          <span className="px-1.5 leading-[22px]">{discount}% OFF</span>
        </div>
      )}
      <button
        type="button"
        onClick={handleFavoriteClick}
        aria-label={rotuloDeFavoritar(product.name, isFavorite)}
        className={cn(
          "absolute top-[7px] z-10 flex size-11 items-center justify-center",
          largo ? "left-[125px]" : "right-[7px]",
        )}
      >
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full",
            isFavorite ? "bg-red-50 text-red-500" : "bg-white text-slate-500",
          )}
        >
          <Heart className={cn("size-[18px]", isFavorite && "fill-current")} />
        </span>
      </button>
      {(esgotado || product.stock <= 10) && (
        <span
          className={cn(
            "pointer-events-none absolute left-[11px] flex h-[22px] items-center rounded-full px-1.5 text-[11px] font-extrabold",
            largo ? "bottom-[13px]" : "top-[95px]",
            esgotado ? "bg-zinc-950 text-white" : "bg-red-50 text-red-700",
          )}
        >
          {esgotado
            ? "Esgotado"
            : product.stock === 1
              ? "Resta 1!"
              : `Restam ${product.stock}`}
        </span>
      )}
      {!largo && botao}
      <div
        className={cn(
          "absolute",
          largo
            ? "bottom-[9px] left-[183px] right-[11px] top-[15px] flex flex-col"
            : "bottom-[9px] left-[9px] right-[9px]",
        )}
      >
        <h3
          className={cn(
            "text-[13px] font-semibold leading-[17px]",
            largo ? "mb-auto line-clamp-3" : "mb-1 h-[34px] line-clamp-2",
            esgotado ? "text-zinc-500" : "text-zinc-900",
          )}
        >
          {product.name}
        </h3>
        <div
          className={cn(
            "h-[14px] text-[11px] font-medium leading-[14px] line-through",
            esgotado ? "text-zinc-500" : "text-slate-500",
          )}
        >
          {precoAntigo ? `De: ${formatCurrency(precoAntigo)}` : null}
        </div>
        <div
          className={cn(
            "flex h-6 items-baseline gap-1 whitespace-nowrap font-extrabold",
            esgotado
              ? "text-zinc-500"
              : precoAntigo
                ? "text-emerald-700"
                : "text-slate-900",
          )}
        >
          {precoAntigo && product.price < 1000 && (
            <span className="text-[11px] leading-[14px]">Por:</span>
          )}
          <span className="text-[18px] leading-6 -tracking-wide">
            {formatCurrency(product.price)}
          </span>
        </div>
        {largo && savings > 0 && (
          <span className="mb-2 mt-1 w-fit rounded bg-emerald-50 px-1.5 text-[11px] font-extrabold leading-[22px] text-emerald-700">
            Economize {formatCurrency(savings)}
          </span>
        )}
        {largo && botao}
      </div>
      <button
        type="button"
        aria-label={`Ver ${product.name}`}
        onClick={handleCardClick}
        className="absolute inset-0 rounded-[20px] focus-visible:ring-2 focus-visible:ring-primary"
      />
    </article>
  );
}
