import { normalizeText } from "@/lib/utils";
import type { Product } from "@/types";
import { useMemo, useState } from "react";
import { useDebounce } from "./useDebounce";

export type SortOption = "price_asc" | "price_desc" | "name_asc" | "newest";

export function useSearch(products: Product[]) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [minPrice, setMinPrice] = useState<number | "">("");
  const [maxPrice, setMaxPrice] = useState<number | "">("");
  const [sort, setSort] = useState<SortOption>("newest");

  // Debounce inputs to avoid excessive re-filtering
  const debouncedQuery = useDebounce(query, 300);
  const debouncedMinPrice = useDebounce(minPrice, 500);
  const debouncedMaxPrice = useDebounce(maxPrice, 500);

  const filteredProducts = useMemo(() => {
    return products
      .filter((product) => {
        // Os DOIS lados normalizados: quem digita "alianca" acha "Alianca"
        // E quem digita "Alianca" tambem acha (BUSCA-010, #20).
        const productName = normalizeText(product.name);
        const productDesc = normalizeText(product.description);
        const searchQuery = normalizeText(debouncedQuery);

        const matchesQuery =
          productName.includes(searchQuery) ||
          productDesc.includes(searchQuery);
        const matchesCategory =
          category === "Todas" ||
          product.category.toLowerCase().trim() ===
            category.toLowerCase().trim();

        const matchesMinPrice =
          debouncedMinPrice === "" || product.price >= debouncedMinPrice;
        const matchesMaxPrice =
          debouncedMaxPrice === "" || product.price <= debouncedMaxPrice;

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
          case "price_asc":
            return a.price - b.price;
          case "price_desc":
            return b.price - a.price;
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
