// @vitest-environment jsdom

import { Header } from "@/components/ui/custom/Header";
import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "capas", name: "Capas", isActive: true }],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
    }),
  },
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { readonly product: Product }) => (
    <article data-produto={product.id}>{product.name}</article>
  ),
}));

const produto = (
  id: string,
  name: string,
  category: string,
  description = "",
): Product => ({
  id,
  name,
  category,
  description,
  price: 50,
  images: [],
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-06T00:00:00.000Z",
});
const produtos = [
  produto("capa", "Capa Azul", "Capas"),
  produto(
    "carregador",
    "Carregador portátil",
    "Eletrônicos",
    "Capacidade de 10.000 mAh",
  ),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

it("o chip Capas escolhe a categoria, limpa a busca e exclui Capacidade de outra categoria", async () => {
  function Vitrine() {
    const [busca, setBusca] = useState("");
    const [categoria, setCategoria] = useState("Todas");
    return (
      <>
        <Header
          onNavigate={() => {}}
          searchQuery={busca}
          onSearch={setBusca}
          onCategorySelect={setCategoria}
        />
        <HomeView
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery={busca}
          selectedCategory={categoria}
          onCategoryChange={setCategoria}
          sortBy="default"
          onSortByChange={() => {}}
        />
      </>
    );
  }
  await act(async () => raiz.render(<Vitrine />));
  const campo = hospedeiro.querySelector<HTMLInputElement>(
    'input[name="search"]',
  )!;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, "capa");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(
    hospedeiro.querySelector('[data-produto="carregador"]'),
  ).not.toBeNull();
  const titulo = Array.from(hospedeiro.querySelectorAll("span")).find(
    (s) => s.textContent === "Categorias Encontradas",
  );
  const chip = titulo?.parentElement?.parentElement?.querySelector("button");
  expect(chip?.textContent).toContain("Capas");
  await act(async () => chip?.click());
  expect(campo.value).toBe("");
  expect(hospedeiro.querySelector('[data-produto="capa"]')).not.toBeNull();
  expect(hospedeiro.querySelector('[data-produto="carregador"]')).toBeNull();
  expect(hospedeiro.textContent).not.toContain("Categorias Encontradas");
  // O debounce antigo não pode repor "capa" depois do toque.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(campo.value).toBe("");
  expect(hospedeiro.querySelector('[data-produto="carregador"]')).toBeNull();
});
