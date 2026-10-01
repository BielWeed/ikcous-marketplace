import type { Product } from "@/types";
import { SearchView } from "@/views/customer/SearchView";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const produtos = [
  {
    id: "produto",
    name: "Vestido",
    category: "Roupas",
    isActive: true,
    stock: 3,
  },
] as Product[];
let resultados = produtos;
const nada = () => {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: nada }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: nada }),
}));
vi.mock("@/hooks/useSearch", () => ({
  useSearch: () => ({
    query: "Vestido",
    category: "Todas",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
    setQuery: nada,
    setCategory: nada,
    setMinPrice: nada,
    setMaxPrice: nada,
    setSort: nada,
    filteredProducts: resultados,
    totalResults: resultados.length,
  }),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => <article>Vestido</article>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Busca no computador — F4", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    resultados = produtos;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });
  function renderizar() {
    act(() =>
      raiz.render(
        <SearchView onNavigate={nada} onBack={nada} initialQuery="Vestido" />,
      ),
    );
  }

  it.each([false, true])(
    "container, sticky e grade preservam celular (vazia=%s)",
    (vazia) => {
      if (vazia) resultados = [];
      renderizar();
      const cabecalho = hospedeiro.querySelector(".sticky")!;
      expect(classesDoCelular(cabecalho.className)).toBe(
        "sticky top-[-2px] z-50 border-b border-zinc-100 bg-white/90 backdrop-blur-2xl",
      );
      expect(cabecalho.classList.contains("lg:top-6")).toBe(true);
      const containers = hospedeiro.querySelectorAll(".max-w-7xl");
      expect(containers).toHaveLength(2);
      expect(classesDoCelular(containers[0].className)).toBe(
        "mx-auto max-w-7xl space-y-4 p-4",
      );
      expect(classesDoCelular(containers[1].className)).toBe(
        "mx-auto max-w-7xl px-4 py-8",
      );
      for (const container of containers) {
        expect(container.classList.contains("lg:max-w-[1280px]")).toBe(true);
        expect(container.classList.contains("2xl:max-w-[1440px]")).toBe(true);
      }
      const grade = hospedeiro.querySelector(".grid")!;
      expect(classesDoCelular(grade.className)).toBe("grid grid-cols-2 gap-6");
      expect(grade.classList.contains("lg:grid-cols-4")).toBe(true);
      expect(grade.classList.contains("xl:grid-cols-5")).toBe(true);
      expect(grade.classList.contains("lg:gap-5")).toBe(true);
      expect(hospedeiro.querySelector('[aria-label="Voltar"]')).not.toBeNull();
    },
  );

  it.each([false, true])(
    "filtros abrem embaixo no celular e à direita no computador (%s)",
    async (computador) => {
      vi.stubGlobal("matchMedia", (consulta: string) => ({
        matches: computador && consulta === "(min-width: 1024px)",
      }));
      renderizar();
      const filtros = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Filtros"),
      )!;
      await act(async () => filtros.click());
      const folha = document.querySelector('[data-slot="sheet-content"]')!;
      expect(folha).not.toBeNull();
      if (computador) {
        expect(folha.classList.contains("right-0")).toBe(true);
        expect(folha.classList.contains("lg:max-w-[440px]")).toBe(true);
        expect(folha.classList.contains("max-h-[90vh]")).toBe(false);
      } else {
        expect(folha.classList.contains("bottom-0")).toBe(true);
        for (const token of [
          "max-h-[90vh]",
          "overflow-y-auto",
          "rounded-t-[3rem]",
          "p-8",
        ]) {
          expect(folha.classList.contains(token)).toBe(true);
        }
      }
      const aplicar = [...folha.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Aplicar Filtros"),
      )!;
      await act(async () => aplicar.click());
      expect(
        document.querySelector(
          '[data-slot="sheet-content"][data-state="open"]',
        ),
      ).toBeNull();
    },
  );
});
