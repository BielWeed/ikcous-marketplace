import { useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string, createdTime: number, stock = 5): Product => ({
  id,
  createdTime,
  stock,
  name: "Camisa",
  description: "",
  price: 100,
  images: [],
  category: "Roupas",
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "",
});

describe("busca: empate por data e id", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  let ultimo: ReturnType<typeof useSearch>;
  function Sonda({ produtos }: { produtos: Product[] }) {
    const retorno = useSearch(produtos);
    useEffect(() => {
      ultimo = retorno;
    });
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
  });
  it.each(["price_asc", "price_desc", "newest"] as const)(
    "%s nao depende da ordem de chegada",
    async (sort) => {
      const produtos = [
        produto("z", 1000),
        produto("c", 3000),
        produto("a", 3000),
        produto("esgotado", 5000, 0),
      ];
      for (const lista of [produtos, [...produtos].reverse()]) {
        await act(async () => raiz.render(<Sonda produtos={lista} />));
        await act(async () => {
          ultimo.setSort(sort);
          ultimo.setQuery("camisa");
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(350);
        });
        expect(ultimo.filteredProducts.map((p) => p.id)).toEqual([
          "a",
          "c",
          "z",
          "esgotado",
        ]);
      }
    },
  );
});
