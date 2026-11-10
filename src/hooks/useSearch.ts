import {
  pontuadorDaBusca,
  produtoCombinaComBusca,
} from "@/lib/busca-de-produtos";
import { categoriaValidaDaBusca } from "@/lib/categoria-valida-da-busca";
import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import { produtoDisponivel } from "@/lib/vitrine";
import type { Category, Product } from "@/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "./useDebounce";

export type SortOption = "price_asc" | "price_desc" | "name_asc" | "newest";

/** Categoria, faixa de preço e ordenação: o que a cliente refina na busca. */
export interface FiltrosDaBusca {
  category: string;
  minPrice: number | "";
  maxPrice: number | "";
  sort: SortOption;
}

/**
 * A tela de busca é desmontada ao abrir um produto. Quem a hospeda (o App)
 * guarda os filtros fora dela: `iniciais` é o que ficou guardado e `aoMudar`
 * recebe o conjunto inteiro a cada mudança. Sem isto o gancho funciona como
 * sempre, só com estado local.
 */
export interface MemoriaDosFiltros {
  iniciais?: FiltrosDaBusca;
  aoMudar?: (filtros: FiltrosDaBusca) => void;
  /** O termo que o App guardou. Vale desde o primeiro desenho (e já entra no
   * debounce), para a lista não aparecer inteira por 300 ms ao voltar. */
  termoInicial?: string;
}

export function useSearch(
  products: Product[],
  memoria?: MemoriaDosFiltros,
  catalogo?: {
    carregando?: boolean;
    categorias?: readonly Pick<Category, "name" | "isActive">[];
  },
) {
  const [query, setQuery] = useState(memoria?.termoInicial ?? "");
  // `iniciais` vale só no nascimento (useState ignora a mudança depois).
  const [categoriaSelecionada, setCategory] = useState(
    memoria?.iniciais?.category ?? "Todas",
  );
  // Usa o valor reconciliado já neste desenho: não mostra um vazio por um frame.
  // Depois guarda o mesmo valor no estado, inclusive para a memória do App.
  const category = categoriaValidaDaBusca(
    categoriaSelecionada,
    products,
    catalogo?.carregando,
    catalogo?.categorias,
  );
  useEffect(() => {
    if (category !== categoriaSelecionada) setCategory(category);
  }, [category, categoriaSelecionada]);

  const [minPrice, setMinPrice] = useState<number | "">(
    memoria?.iniciais?.minPrice ?? "",
  );
  const [maxPrice, setMaxPrice] = useState<number | "">(
    memoria?.iniciais?.maxPrice ?? "",
  );
  const [sort, setSort] = useState<SortOption>(
    memoria?.iniciais?.sort ?? "newest",
  );

  // Avisa só quando um dos quatro valores muda (o aviso em si pode ser uma
  // função nova a cada render do pai, então fica fora da lista de dependências).
  const aoMudarRef = useRef(memoria?.aoMudar);
  useEffect(() => {
    aoMudarRef.current = memoria?.aoMudar;
  });
  useEffect(() => {
    aoMudarRef.current?.({ category, minPrice, maxPrice, sort });
  }, [category, minPrice, maxPrice, sort]);

  // Debounce inputs to avoid excessive re-filtering
  const debouncedQuery = useDebounce(query, 300);
  const debouncedMinPrice = useDebounce(minPrice, 500);
  const debouncedMaxPrice = useDebounce(maxPrice, 500);

  const filteredProducts = useMemo(() => {
    // Com termo e a ordenação no padrão, vale a RELEVÂNCIA -- a mesma pontuação
    // da caixinha do topo e da Home --, e a data só desempata. Sem termo não há
    // o que pontuar e vale "mais novos primeiro".
    const pontuar = debouncedQuery.trim()
      ? pontuadorDaBusca(debouncedQuery)
      : null;
    const pontos = new Map<string, number>();
    return products
      .filter((product) => {
        // Palavra por palavra, em qualquer ordem, ignorando acento e plural
        // simples: a MESMA regra do catalogo (BUSCA-010, #20).
        const matchesQuery = produtoCombinaComBusca(product, debouncedQuery);
        const matchesCategory =
          category === "Todas" ||
          product.category.toLowerCase().trim() ===
            category.toLowerCase().trim();

        // A faixa vale para o preço que o card ANUNCIA (menor das opções à
        // venda), o mesmo da ordenação -- não para o preço base.
        const precoDoCard = precoDeVitrine(product).preco;
        const matchesMinPrice =
          debouncedMinPrice === "" || precoDoCard >= debouncedMinPrice;
        const matchesMaxPrice =
          debouncedMaxPrice === "" || precoDoCard <= debouncedMaxPrice;

        return (
          matchesQuery && matchesCategory && matchesMinPrice && matchesMaxPrice
        );
      })
      .sort((a, b) => {
        const aAvailable = produtoDisponivel(a) ? 1 : 0;
        const bAvailable = produtoDisponivel(b) ? 1 : 0;
        if (aAvailable !== bAvailable) {
          return bAvailable - aAvailable;
        }

        const desempate =
          (b.createdTime ?? 0) - (a.createdTime ?? 0) ||
          a.id.localeCompare(b.id);
        switch (sort) {
          // Ordena pelo preço que o card ANUNCIA (menor das opções à venda).
          case "price_asc":
            return (
              precoDeVitrine(a).preco - precoDeVitrine(b).preco || desempate
            );
          case "price_desc":
            return (
              precoDeVitrine(b).preco - precoDeVitrine(a).preco || desempate
            );
          case "name_asc":
            return a.name.localeCompare(b.name);
          case "newest": {
            if (pontuar) {
              const pontosDe = (p: Product) => {
                let valor = pontos.get(p.id);
                if (valor === undefined) {
                  valor = pontuar(p);
                  pontos.set(p.id, valor);
                }
                return valor;
              };
              const diferenca = pontosDe(b) - pontosDe(a);
              if (diferenca !== 0) return diferenca;
            }
            return desempate;
          }
          default:
            return 0;
        }
      });
  }, [
    products,
    debouncedQuery,
    category,
    debouncedMinPrice,
    debouncedMaxPrice,
    sort,
  ]);

  return {
    query,
    setQuery,
    category,
    setCategory,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    sort,
    setSort,
    filteredProducts,
    totalResults: filteredProducts.length,
  };
}
