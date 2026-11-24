// @vitest-environment jsdom
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: [] }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));

const favorito: Product = {
  id: "agenda",
  name: "Agenda",
  price: 30,
  category: "Papelaria",
  description: "",
  images: [],
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-10-20T12:00:00Z",
  variants: [],
};

let raiz: Root;
let container: HTMLDivElement;

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={[favorito]}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={vi.fn()}
      />,
    ),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function botao(nome: string) {
  const elemento = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );
  expect(elemento, `botão ${nome}`).toBeDefined();
  return elemento!;
}

it("leva o foco para o título da lista restaurada ao limpar filtros", () => {
  act(() => botao("Com desconto").click());
  expect(container.querySelector("h3 button")).toBeNull();

  const limpar = botao("Limpar filtros");
  limpar.focus();
  expect(document.activeElement).toBe(limpar);
  act(() => limpar.click());

  expect(limpar.isConnected).toBe(false);
  expect(container.querySelector("h3 button")?.textContent).toBe("Agenda");
  expect(document.activeElement?.tagName).toBe("H2");
  expect(document.activeElement?.textContent).toBe("Papelaria");
});

it("mantém o foco no filtro ao desligar o desconto pelo próprio botão", () => {
  const filtro = botao("Com desconto");
  filtro.focus();
  act(() => filtro.click());
  expect(filtro.getAttribute("aria-pressed")).toBe("true");

  act(() => filtro.click());

  expect(container.querySelector("h3 button")?.textContent).toBe("Agenda");
  expect(document.activeElement).toBe(filtro);
});
