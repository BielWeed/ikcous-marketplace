import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import type { Product } from "@/types";
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
}

export function useSearch(products: Product[], memoria?: MemoriaDosFiltros) {
  const [query, setQuery] = useState("");
  // `iniciais` vale só no nascimento (useState ignora a mudança depois).
  const [category, setCategory] = useState(
    memoria?.iniciais?.category ?? "Todas",
  );
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
        const aAvailable = a.stock > 0 ? 1 : 0;
        const bAvailable = b.stock > 0 ? 1 : 0;
        if (aAvailable !== bAvailable) {
          return bAvailable - aAvailable;
        }

        switch (sort) {
          // Ordena pelo preço que o card ANUNCIA (menor das opções à venda).
          case "price_asc":
            return precoDeVitrine(a).preco - precoDeVitrine(b).preco;
          case "price_desc":
            return precoDeVitrine(b).preco - precoDeVitrine(a).preco;
          case "name_asc":
            return a.name.localeCompare(b.name);
          case "newest":
            return (b.createdTime ?? 0) - (a.createdTime ?? 0);
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
