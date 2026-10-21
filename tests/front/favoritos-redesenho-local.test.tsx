// @vitest-environment jsdom
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false }, products: [] }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));

function produto(
  id: string,
  name: string,
  price: number,
  category: string,
  originalPrice?: number,
): Product {
  return {
    id,
    name,
    price,
    category,
    originalPrice,
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
}
const favoritos = [
  produto("a", "Zebra", 90, "Brinquedo"),
  produto("b", "Bola", 12, "Brinquedo", 25),
  produto("c", "Agenda", 30, "Papelaria", 30),
];
let raiz: Root;
let container: HTMLDivElement;
const navegar = vi.fn();

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  navegar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function montar(lista = favoritos, isActive = true) {
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={lista}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={navegar}
        isActive={isActive}
      />,
    ),
  );
}
function nomes() {
  return [...container.querySelectorAll("h3 button")].map(
    (el) => el.textContent,
  );
}
function botao(nome: string) {
  const el = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );
  expect(el, `botão ${nome}`).toBeDefined();
  return el!;
}
function tocar(nome: string) {
  act(() => botao(nome).click());
}

describe("Favoritos — desenho aprovado com controles locais", () => {
  it("mostra título, contador e ação acessível no portal sem perder a reserva do rodapé", () => {
    montar();
    expect(container.querySelector("h1")?.textContent).toBe("Favoritos");
    expect(container.textContent).toContain("3 produtos que você salvou");
    const acao = botao("Ver mais produtos");
    expect(acao.getAttribute("aria-label")).toBe("Ver mais produtos");
    expect(container.contains(acao)).toBe(false);
    expect(acao.closest(".bottom-docked-navigation")).not.toBeNull();
    expect(
      container.firstElementChild?.classList.contains("pb-customer-summary"),
    ).toBe(true);
    act(() => acao.click());
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("ordena por preço e nome sem modificar a lista recebida; o padrão preserva a ordem original", () => {
    montar();
    const ordem = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Ordem dos favoritos"]',
    );
    expect(ordem).not.toBeNull();
    expect(nomes()).toEqual(["Zebra", "Bola", "Agenda"]);
    for (const [valor, esperado] of [
      ["menor", ["Bola", "Agenda", "Zebra"]],
      ["maior", ["Zebra", "Agenda", "Bola"]],
      ["nome", ["Agenda", "Bola", "Zebra"]],
      ["original", ["Zebra", "Bola", "Agenda"]],
    ] as const) {
      act(() => {
        ordem!.value = valor;
        ordem!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(nomes()).toEqual(esperado);
    }
    expect(favoritos.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("filtra categoria e desconto, mostra vazio e limpar devolve todos os produtos", () => {
    montar();
    tocar("Brinquedo 2");
    expect(nomes()).toEqual(["Zebra", "Bola"]);
    expect(botao("Brinquedo 2").getAttribute("aria-pressed")).toBe("true");
    tocar("Com desconto 1");
    expect(nomes()).toEqual(["Bola"]);
    tocar("Papelaria 1");
    expect(nomes()).toEqual([]);
    expect(container.textContent).toContain(
      "Nenhum favorito com esses filtros.",
    );
    tocar("Limpar filtros");
    expect(nomes()).toEqual(["Zebra", "Bola", "Agenda"]);
    expect(botao("Todas 3").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Com desconto 1").getAttribute("aria-pressed")).toBe("false");
  });

  it("oferece categoria única com contagem, sem inventar desconto com preço original igual", () => {
    montar([favoritos[2]]);
    expect(container.textContent).toContain("1 produto que você salvou");
    expect(container.textContent).not.toContain("Com desconto");
    expect(botao("Todas 1").getAttribute("aria-pressed")).toBe("true");
    tocar("Papelaria 1");
    expect(nomes()).toEqual(["Agenda"]);
    expect(botao("Papelaria 1").getAttribute("aria-pressed")).toBe("true");
  });

  it("inclui brinde com preço zero no desconto e não inventa promoção com preço original menor", () => {
    montar([
      produto("gratis", "Brinde", 0, "", 10),
      produto("normal", "Normal", 20, "", 10),
    ]);
    tocar("Com desconto 1");
    expect(nomes()).toEqual(["Brinde"]);
  });

  it("ao remover o último item da categoria selecionada, permite limpar sem alterar favoritos", () => {
    montar();
    tocar("Papelaria 1");
    montar(favoritos.slice(0, 2));
    expect(nomes()).toEqual([]);
    tocar("Limpar filtros");
    expect(nomes()).toEqual(["Zebra", "Bola"]);
  });

  it("não deixa a ação fixa da tela inativa por cima de outra tela", () => {
    montar(favoritos, false);
    expect(
      document.body.querySelector('[aria-label="Ver mais produtos"]'),
    ).toBeNull();
  });
});
