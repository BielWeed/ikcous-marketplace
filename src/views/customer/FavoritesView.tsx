import { ProductCard } from "@/components/ui/custom/ProductCard";
import { useStore } from "@/contexts/StoreContext";
import { useFavorites } from "@/hooks/useFavorites";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { precoVendido } from "@/lib/preco-vendido";
import "./FavoritesView.css";
import type { Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Heart,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

interface FavoritesViewProps {
  favorites: Product[];
  loading?: boolean;
  onToggleFavorite: (product: Product) => void;
  onProductClick: (productId: string) => void;
  onNavigate: (view: View) => void;
  selectedProductId?: string;
  /** Mantida por compatibilidade com o App. Desde 22/10/2026 a ação "Ver mais
   * produtos" mora no fim da lista (não é mais um botão fixo por cima dela),
   * então não há nada a esconder quando a aba fica inativa. */
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

/** Quantos itens cada categoria mostra antes de "Ver todos". */
const ITENS_POR_CATEGORIA = 3;
/** Atalhos de categoria só valem a pena a partir de 3 categorias. */
const CATEGORIAS_PARA_ATALHOS = 3;
const SEM_CATEGORIA = "Outros";

const textoDeProdutos = (n: number) =>
  `${n} ${n === 1 ? "produto" : "produtos"}`;

interface Secao {
  nome: string;
  itens: Product[];
}

export const FavoritesView = React.memo(function FavoritesView({
  favorites,
  loading = false,
  onToggleFavorite,
  onProductClick,
  onNavigate,
  selectedProductId,
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
  const idBase = useId();
  const listaRef = useRef<HTMLDivElement>(null);
  const [comDesconto, setComDesconto] = useState(false);
  const [ordem, setOrdem] = useState("original");
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [categoriaAtiva, setCategoriaAtiva] = useState("");

  const { descontos, secoes, total } = useMemo(() => {
    const promocionais = new Set<string>();
    for (const produto of favorites) {
      if (
        produto.originalPrice != null &&
        produto.originalPrice > precoVendido(produto, undefined)
      ) {
        promocionais.add(produto.id);
      }
    }
    const visiveis = favorites.filter(
      (produto) => !comDesconto || promocionais.has(produto.id),
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
    // As seções seguem a ordem em que cada categoria aparece na lista SALVA
    // (não pulam de lugar ao trocar a ordem); a ordem escolhida vale dentro
    // de cada uma.
    const porCategoria = new Map<string, Product[]>();
    for (const produto of favorites) {
      porCategoria.set(produto.category || SEM_CATEGORIA, []);
    }
    for (const produto of visiveis) {
      porCategoria.get(produto.category || SEM_CATEGORIA)?.push(produto);
    }
    const secoes: Secao[] = [];
    for (const [nome, itens] of porCategoria) {
      if (itens.length > 0) secoes.push({ nome, itens });
    }
    return { descontos: promocionais.size, secoes, total: visiveis.length };
  }, [favorites, comDesconto, ordem]);

  const idDaSecao = (indice: number) => `${idBase}-secao-${indice}`;
  const mostrarAtalhos = secoes.length >= CATEGORIAS_PARA_ATALHOS;
  const chaveDasSecoes = secoes.map((secao) => secao.nome).join("\u0000");
  const atalhoAtivo = secoes.some((secao) => secao.nome === categoriaAtiva)
    ? categoriaAtiva
    : (secoes[0]?.nome ?? "");

  // O atalho ativo acompanha a seção que está no topo da tela.
  useEffect(() => {
    if (!mostrarAtalhos || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver(
      (entradas) => {
        const noTopo = entradas
          .filter((entrada) => entrada.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        const nome = (noTopo?.target as HTMLElement | undefined)?.dataset.secao;
        if (nome) setCategoriaAtiva(nome);
      },
      { rootMargin: "0px 0px -65% 0px" },
    );
    for (const el of listaRef.current?.querySelectorAll("[data-secao]") ?? []) {
      observador.observe(el);
    }
    return () => observador.disconnect();
  }, [mostrarAtalhos, chaveDasSecoes]);

  const irParaSecao = (nome: string, indice: number) => {
    setCategoriaAtiva(nome);
    const reduzir = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.getElementById(idDaSecao(indice))?.scrollIntoView?.({
      behavior: reduzir ? "auto" : "smooth",
      block: "start",
    });
  };

  const alternarSecao = (nome: string) => {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(nome)) proximo.add(nome);
      return proximo;
    });
  };

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
      <div className="pb-customer min-h-full overflow-x-hidden bg-background">
        <header className="px-4 pb-4 pt-5">
          <h1 className="text-3xl font-bold tracking-tight">Favoritos</h1>
        </header>
        <div role="status" aria-label="Carregando favoritos" className="px-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="flex min-h-[112px] items-center gap-3 border-b border-border py-3"
            >
              <div className="size-[88px] shrink-0 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (favoritosErro && favorites.length === 0) {
    return (
      <div className="pb-customer flex min-h-full flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40">
          <Heart aria-hidden="true" className="size-9 text-amber-600" />
        </div>
        <h2 className="mb-2 text-lg font-bold text-foreground">
          Não conseguimos carregar
        </h2>
        <p className="mb-7 max-w-xs text-sm leading-relaxed text-muted-foreground">
          {favoritosErro} Verifique sua conexão e tente de novo.
        </p>
        <button
          type="button"
          onClick={() => favoritosRefresh()}
          className="min-h-11 rounded-full bg-foreground px-6 text-sm font-semibold text-background active:scale-95"
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
      <div className="pb-customer min-h-full min-w-0 overflow-x-hidden bg-background text-foreground">
        <header className="px-4 pb-4 pt-5">
          <h1 className="text-3xl font-bold tracking-tight">Favoritos</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Nenhum produto salvo ainda
          </p>
        </header>

        <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
          <div className="mb-6 grid size-28 place-items-center rounded-full bg-muted">
            <Heart
              aria-hidden="true"
              className="size-12 text-muted-foreground"
            />
          </div>
          <h2 className="text-xl font-bold">Você ainda não tem favoritos</h2>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Toque no coração de um produto para guardar ele aqui.
          </p>
          <button
            type="button"
            onClick={() => {
              haptic.medium();
              onNavigate("home");
            }}
            className="mt-6 flex min-h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-semibold text-background active:scale-95"
          >
            Ver produtos
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>

        {/* Quick Suggestions Block */}
        {suggestedProducts.length > 0 && (
          <div className="mx-4 mt-4 border-t border-border pt-6">
            <div className="mb-4">
              <h3 className="text-base font-bold">Mais Amados da Loja</h3>
              <p className="text-xs text-muted-foreground">
                Toque no coração para salvar nos seus favoritos.
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
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-customer min-h-full min-w-0 overflow-x-hidden bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 pb-3 pt-5">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Favoritos</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {textoDeProdutos(favorites.length)} que você salvou
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="favorites-chip"
            aria-pressed={comDesconto}
            onClick={() => setComDesconto(!comDesconto)}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-emerald-600"
            />
            Com desconto{descontos > 0 ? ` ${descontos}` : ""}
          </button>
          <label className="favorites-chip relative">
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
        </div>
      </header>

      {mostrarAtalhos && (
        <nav
          aria-label="Categorias"
          className="favorites-atalhos mx-4 mb-1 flex min-w-0 gap-2 overflow-x-auto pb-1"
        >
          {secoes.map((secao, indice) => (
            <button
              key={secao.nome}
              type="button"
              className="favorites-chip"
              aria-current={atalhoAtivo === secao.nome ? "true" : undefined}
              onClick={() => irParaSecao(secao.nome, indice)}
            >
              {secao.nome} {secao.itens.length}
            </button>
          ))}
        </nav>
      )}

      <p role="status" className="sr-only">
        {total} {total === 1 ? "produto encontrado" : "produtos encontrados"}
      </p>
      {total === 0 && (
        <div className="px-4 py-10 text-center text-sm">
          <p className="text-muted-foreground">
            Nenhum favorito com esses filtros.
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full border border-border bg-card px-5 font-semibold text-card-foreground"
            onClick={() => setComDesconto(false)}
          >
            Limpar filtros
          </button>
        </div>
      )}

      <div ref={listaRef} className="px-4">
        {secoes.map((secao, indice) => {
          const aberta = expandidas.has(secao.nome);
          const temMais = secao.itens.length > ITENS_POR_CATEGORIA;
          const itens =
            aberta || !temMais
              ? secao.itens
              : secao.itens.slice(0, ITENS_POR_CATEGORIA);
          const idTitulo = `${idDaSecao(indice)}-titulo`;
          const idLista = `${idDaSecao(indice)}-lista`;
          return (
            <section
              key={secao.nome}
              id={idDaSecao(indice)}
              data-secao={secao.nome}
              aria-labelledby={idTitulo}
              className="scroll-mt-4 pt-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id={idTitulo}
                  className="min-w-0 break-words text-lg font-bold"
                >
                  {secao.nome}
                </h2>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {textoDeProdutos(secao.itens.length)}
                </span>
              </div>
              <ul id={idLista}>
                {itens.map((product) => (
                  <li key={product.id}>
                    <ProductCard
                      layout="linha"
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
                  </li>
                ))}
              </ul>
              {temMais && (
                <button
                  type="button"
                  className="favorites-chip mx-auto mt-3"
                  aria-expanded={aberta}
                  aria-controls={idLista}
                  onClick={() => alternarSecao(secao.nome)}
                >
                  {aberta
                    ? "Mostrar menos"
                    : `Ver todos (${secao.itens.length})`}
                  {aberta ? (
                    <ChevronUp aria-hidden="true" className="size-4" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-4" />
                  )}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex justify-center px-4 pb-4 pt-6">
        <button
          onClick={() => {
            haptic.medium();
            onNavigate("home");
          }}
          type="button"
          aria-label="Ver mais produtos"
          className="group flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-foreground active:scale-95 motion-reduce:transition-none"
        >
          Ver mais produtos
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
});
