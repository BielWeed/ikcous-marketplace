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
  ALTURA_CARTAO_DUPLO,
  alturaDaSecaoDuplo,
  fileirasDaFaixa,
} from "./ofertas-lateral-duplo-altura";

type Oferta = ReturnType<typeof ordenarOfertas>[number];

/** Cada coluna do carrossel leva 2 ofertas, uma sobre a outra. */
const OFERTAS_POR_COLUNA = 2;

function emColunas(ofertas: Oferta[]): Oferta[][] {
  const colunas: Oferta[][] = [];
  for (let i = 0; i < ofertas.length; i += OFERTAS_POR_COLUNA)
    colunas.push(ofertas.slice(i, i + OFERTAS_POR_COLUNA));
  return colunas;
}

/**
 * Quarto desenho das Ofertas ("Lateral em duas fileiras"): o cartão do Lateral (foto de um lado, texto do
 * outro), mas cada item do carrossel é uma COLUNA com 2 ofertas, e o carrossel rola de dupla em dupla.
 * O módulo só é baixado quando a vitrine de Ofertas escolheu este desenho; o Lateral de hoje não muda.
 */
export default function OfertasLateralDuplo({
  products,
  favorites,
  onToggleFavorite,
  onProductClick,
  onAddToCart,
  onQuickBuy,
  title = "Super Descontos",
}: PremiumOffersProps) {
  const ofertas = ordenarOfertas(products);
  const colunas = emColunas(ofertas);
  // Só rola com 3 ofertas ou mais (2 colunas); com 1 ou 2 a coluna ocupa a largura toda.
  const rola = ofertas.length > OFERTAS_POR_COLUNA;
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
      data-testid="ofertas-lateral-duplo"
      style={{
        minHeight: alturaDaSecaoDuplo(fileirasDaFaixa(ofertas.length)),
      }}
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
          {colunas.map((coluna) => (
            <div
              key={coluna[0].product.id}
              data-coluna-ofertas
              className={cn(
                "flex min-w-0 flex-col gap-2",
                rola ? "shrink-0 basis-[88%]" : "w-full",
              )}
            >
              {coluna.map(({ product, discount }) => (
                <CartaoOfertaDuplo
                  key={product.id}
                  product={product}
                  discount={discount}
                  isFavorite={favorites.includes(product.id)}
                  onToggleFavorite={onToggleFavorite}
                  onProductClick={onProductClick}
                  onAddToCart={onAddToCart}
                  onQuickBuy={onQuickBuy}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-1.5 items-center justify-center gap-1.5">
        {rola &&
          colunas.map((coluna, i) => (
            <span
              key={coluna[0].product.id}
              data-pagina-ofertas
              aria-current={pagina === i ? "true" : undefined}
              aria-label={`Página ${i + 1} de ${colunas.length}`}
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

// Tamanho do preço pela largura REAL da coluna de texto (ela é um container: 100cqw = 159px a 320px de
// tela, com a foto de 88px). A linha do preço reserva 48px à direita (pr-12) para o carrinho de 44px, então
// o preço dispõe de (100cqw - 48px). Largura por caractere do preço extrabold, medida em navegador real:
// ~0,55 x o corpo. O corpo vai de 16px (piso) a 20px (teto) e é o maior em que o preço inteiro cabe.
// Só o preço precisa de medida calculada: nome, "De" e estoque têm tamanho fixo (13 e 12px).
function medidasDoTexto(preco: string) {
  const largura = Math.round(preco.length * 0.55 * 1000) / 1000;
  return {
    "--fonte-preco": `clamp(16px, calc((100cqw - 48px) / ${largura}), 20px)`,
  } as CSSProperties;
}

function CartaoOfertaDuplo({
  product,
  discount,
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
  isFavorite: boolean;
}) {
  // As MESMAS ações do Lateral e dos outros desenhos: comprar, variação, favoritar e abrir.
  const {
    cartStatus,
    handleCardClick,
    handleAddToCartClick,
    handleFavoriteClick,
    hasActiveVariant,
    precoAntigo,
    preco,
    aPartirDe,
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
  const textoPreco = formatCurrency(preco);
  // UI-191 (G3): opções com preços diferentes -- o preço é o menor delas; a
  // linha de baixo diz "A partir de" (sem riscado) no lugar do "De".
  const textoDe = aPartirDe
    ? "A partir de"
    : precoAntigo
      ? `De ${formatCurrency(precoAntigo)}`
      : null;
  return (
    <article
      data-oferta-lateral-duplo={product.id}
      onMouseEnter={() => prefetchView("product-detail")}
      onTouchStart={() => prefetchView("product-detail")}
      style={{ height: ALTURA_CARTAO_DUPLO }}
      className="relative flex min-w-0 overflow-hidden rounded-[20px] border border-solid border-zinc-200 bg-white"
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
          // O aviso sobe (justify-start + pt-4) para não bater no selo de desconto, que fica embaixo.
          <div
            data-sem-foto
            className="flex size-full flex-col items-center justify-start gap-2 pt-4 text-zinc-500"
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
      {/* Linhas de altura fixa (soma 102px): nome 32 + 2 + preço 24 + "De" 16 + estoque 16 + pb 4 + pt 8. */}
      <div
        style={medidasDoTexto(textoPreco)}
        className="flex min-w-0 flex-1 flex-col pb-1 pl-3 pr-2.5 pt-2 [container-type:inline-size]"
      >
        <h3 className="line-clamp-2 h-8 break-words text-[13px] font-semibold leading-4 text-zinc-950">
          {product.name}
        </h3>
        <div
          data-preco-oferta
          className={cn(
            "mt-0.5 h-6 whitespace-nowrap pr-12 font-extrabold tracking-tight tabular-nums",
            "text-[length:var(--fonte-preco)]",
            // Depois do tamanho: o tailwind-merge descarta o leading que vem antes de text-*.
            "leading-6",
            esgotado
              ? "text-zinc-950"
              : precoAntigo
                ? CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO
                : "text-slate-900",
          )}
        >
          {textoPreco}
        </div>
        {/* "De" SEMPRE na linha de baixo do preço (nunca ao lado); a linha existe mesmo sem "De". */}
        {textoDe ? (
          <div
            data-de-oferta
            className={cn(
              "h-4 truncate pr-12 text-xs leading-4 text-zinc-500",
              !aPartirDe && "line-through",
            )}
          >
            {textoDe}
          </div>
        ) : (
          <div aria-hidden="true" className="h-4" />
        )}
        <div
          data-linha-estoque
          className="flex h-4 items-center gap-1.5 pr-12 text-xs font-bold leading-4"
        >
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
                data-estoque-oferta
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
      <button
        type="button"
        onClick={handleAddToCartClick}
        data-compra-oferta
        aria-label={rotuloCompra}
        title={rotuloCompra}
        disabled={esgotado || cartStatus !== "idle"}
        className={cn(
          "absolute bottom-2 right-2.5 z-20 flex size-11 shrink-0 items-center justify-center rounded-full border border-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
