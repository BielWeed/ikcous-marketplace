// @vitest-environment jsdom
//
// Favoritos — a faixa de atalhos de categoria acompanha a rolagem. As provas
// existentes usam posições folgadas; aqui ficam as FRONTEIRAS exatas:
//  - a seção cujo topo está EXATAMENTE em 35% da altura da tela já é a ativa
//    (um pixel abaixo, ainda não);
//  - "no fim da página" começa a 2 px do fundo (inclusive), nem 1 px antes.
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

function produto(id: string, name: string, category: string): Product {
  return {
    id,
    name,
    price: 10,
    category,
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

const quatro = [
  produto("a", "Bola", "Brinquedos"),
  produto("b", "Bloco", "Papelaria"),
  produto("c", "Camisa", "Roupas"),
  produto("d", "Solto", "Cozinha"),
];

let raiz: Root;
let container: HTMLDivElement;

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ALTURA_DA_TELA = 1000; // 35% = 350 px, número inteiro de propósito.
const ALTURA_TOTAL = 3000;
const ALTURA_VISIVEL = 800;

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
  vi.stubGlobal("innerHeight", ALTURA_DA_TELA);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={quatro}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={vi.fn()}
        isActive
      />,
    ),
  );
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Posiciona o topo de cada seção, a rolagem da janela, e avisa o scroll. */
function rolar(topos: number[], scrollTop: number) {
  const secoes = [...container.querySelectorAll("section")];
  secoes.forEach((sec, i) => {
    sec.getBoundingClientRect = () =>
      // eslint-disable-next-line security/detect-object-injection -- índice de uma lista fixa do próprio teste
      ({ top: topos[i], bottom: topos[i] + 100, height: 100 }) as DOMRect;
  });
  const alvo = document.documentElement;
  Object.defineProperty(alvo, "scrollHeight", {
    value: ALTURA_TOTAL,
    configurable: true,
  });
  Object.defineProperty(alvo, "clientHeight", {
    value: ALTURA_VISIVEL,
    configurable: true,
  });
  Object.defineProperty(alvo, "scrollTop", {
    value: scrollTop,
    configurable: true,
  });
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
}
const ativo = () =>
  [...container.querySelectorAll('nav[aria-label="Categorias"] button')]
    .filter((b) => b.getAttribute("aria-current") === "true")
    .map((b) => b.textContent);

describe("Favoritos — fronteiras do atalho ativo", () => {
  it("a seção com o topo exatamente a 35% da tela já é a ativa; 1 px abaixo, ainda não", () => {
    // Longe do fim da página (scrollTop 100), para só a linha de 35% decidir.
    rolar([-400, 350, 700, 1000], 100);
    expect(ativo()).toEqual(["Papelaria 1"]);

    rolar([-400, 351, 700, 1000], 100);
    expect(ativo()).toEqual(["Brinquedos 1"]);
  });

  it("no fim da página: a 2 px do fundo já vale (inclusive), a 3 px não", () => {
    const fundo = ALTURA_TOTAL - ALTURA_VISIVEL; // 2200 = encostou no fim
    // Topos em que, fora do fim, a ativa seria "Papelaria".
    const topos = [-400, 100, 700, 1000];

    rolar(topos, fundo - 2);
    expect(ativo()).toEqual(["Cozinha 1"]);

    rolar(topos, fundo - 3);
    expect(ativo()).toEqual(["Papelaria 1"]);
  });

  it("página que mal rola (altura total só 2 px maior que a visível) não conta como 'fim'", () => {
    const alvo = document.documentElement;
    const secoes = [...container.querySelectorAll("section")];
    const topos = [-400, 100, 700, 1000];
    secoes.forEach((sec, i) => {
      sec.getBoundingClientRect = () =>
        // eslint-disable-next-line security/detect-object-injection -- índice de uma lista fixa do próprio teste
        ({ top: topos[i], bottom: topos[i] + 100, height: 100 }) as DOMRect;
    });
    Object.defineProperty(alvo, "scrollHeight", {
      value: ALTURA_VISIVEL + 2,
      configurable: true,
    });
    Object.defineProperty(alvo, "clientHeight", {
      value: ALTURA_VISIVEL,
      configurable: true,
    });
    Object.defineProperty(alvo, "scrollTop", { value: 0, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(ativo()).toEqual(["Papelaria 1"]);
  });
});
