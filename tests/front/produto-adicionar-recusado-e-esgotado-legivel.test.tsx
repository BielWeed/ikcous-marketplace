// @vitest-environment jsdom
//
// Lote 223 (caça 10): (1) a página do produto comemorava ("Adicionado" verde +
// bolinha voando) mesmo quando o carrinho recusou (entrou === 0) -- o mesmo
// critério do ProductCard agora vale aqui; (3) "Esgotado"/"Indisponível" saía
// em zinc-300 sobre zinc-100 (~1,4:1) e a pílula de estoque ficava verde
// dizendo "Esgotado". Montagem reaproveitada de
// botao-de-comprar-legivel-em-cor-clara.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const voo = vi.fn();
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: (...args: unknown[]) => voo(...args),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({ ProductQA: () => null }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: "Olha que achei na Loja X!",
    },
    isLoaded: true,
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-223",
  name: "Produto Lote 223",
  description: "Descricao de teste",
  price: 49.9,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

describe("ProductView — adicionar recusado e esgotado legível", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    voo.mockClear();
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar(
    onAddToCart: () => number | undefined,
    p: Product = produto,
  ) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={onAddToCart}
          onBack={() => {}}
        />,
      );
    });
  }

  function botoes(rotulo: RegExp): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll("button")).filter((b) =>
      rotulo.test(b.textContent ?? ""),
    );
  }

  async function tocarEm(b: HTMLButtonElement) {
    await act(async () => {
      b.click();
      await vi.advanceTimersByTimeAsync(900);
    });
  }

  it("carrinho recusou (entrou 0): sem voo e sem 'Adicionado'", async () => {
    const onAdd = vi.fn(() => 0);
    await montar(onAdd);
    await tocarEm(botoes(/Adicionar/)[0]);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(voo).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Adicionado/);
    expect(document.body.textContent).not.toMatch(/Adicionando/);
  });

  it("carrinho aceitou (entrou 1): voa e comemora", async () => {
    await montar(() => 1);
    await tocarEm(botoes(/Adicionar/)[0]);
    expect(voo).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/Adicionado/);
  });

  it("sem retorno (chamadores antigos): continua comemorando", async () => {
    await montar(() => undefined);
    await tocarEm(botoes(/Adicionar/)[0]);
    expect(document.body.textContent).toMatch(/Adicionado/);
  });

  it("esgotado: texto legível e pílula de estoque não verde", async () => {
    await montar(() => 1, { ...produto, stock: 0 });
    const esgotados = botoes(/Esgotado/);
    expect(esgotados.length).toBeGreaterThanOrEqual(1);
    for (const b of esgotados) {
      expect(b.className).not.toMatch(/text-zinc-300/);
      expect(b.className).toMatch(/text-zinc-600/);
    }
    const pilula = Array.from(document.querySelectorAll("div")).find(
      (d) =>
        d.className.includes("rounded-full") &&
        d.className.includes("text-[11px]") &&
        /Esgotado/.test(d.textContent ?? ""),
    );
    expect(pilula).toBeTruthy();
    expect(pilula?.className).not.toMatch(/bg-emerald-50/);
  });
});
