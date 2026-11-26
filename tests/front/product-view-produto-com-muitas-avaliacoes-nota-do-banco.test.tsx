// @vitest-environment jsdom
//
// Loja grande (26/11/2026): a página do produto passou a ler só as 20
// avaliações mais recentes (`useReviews`, teto `AVALIACOES_POR_LEITURA`).
// A nota, a contagem e as barras eram calculadas sobre a lista lida — com o
// teto, virariam a nota das 20. Quando o hook avisa que há mais no banco
// (`resumoDasAvaliacoes.temMais`), elas vêm da contagem do banco por estrela;
// "Ver mais avaliações" continua aparecendo e, passando das que já chegaram,
// pede a próxima leva ao hook.
//
// Harness copiado de product-view-titulo-longo-e-avaliacoes-em-paginas.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, Review } from "@/types";

type Resumo = {
  productId: string;
  temMais: boolean;
  porNota: number[] | null;
};

const h = vi.hoisted(() => ({
  avaliacoes: [] as unknown[],
  resumo: null as unknown,
  carregarMais: vi.fn(),
}));

vi.mock("@/hooks/useReviews", () => ({
  AVALIACOES_POR_LEITURA: 20,
  useReviews: () => ({
    reviews: h.avaliacoes,
    resumoDasAvaliacoes: h.resumo,
    carregarMaisAvaliacoes: h.carregarMais,
    userIdAtual: "cliente-atual",
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
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-grande",
  name: "Produto Muito Avaliado",
  description: "Descrição de teste",
  price: 50,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  // Números do catálogo (média e contagem do banco): só valem enquanto a
  // contagem por estrela não chegou.
  rating: 4.2,
  reviewCount: 2990,
};

function avaliacao(n: number, rating = 5): Review {
  return {
    id: `r${n}`,
    productId: "prod-grande",
    customerName: `Cliente ${n}`,
    rating,
    comment: `Comentário ${n}`,
    verified: true,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    status: "publicada",
  };
}

// As 20 mais recentes são todas 5 estrelas: a média DELAS seria 5,0.
const vinteDeCinco = () =>
  Array.from({ length: 20 }, (_, i) => avaliacao(i + 1, 5));

describe("ProductView — produto com mais avaliações do que a lista trouxe", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    h.carregarMais.mockClear();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
    h.avaliacoes = [];
    h.resumo = null;
  });

  async function montar(p: Product = produto) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const comentariosVisiveis = () =>
    Array.from(hospedeiro.querySelectorAll("#reviews-section p")).filter((p) =>
      /^Comentário \d+$/.test(p.textContent ?? ""),
    ).length;

  const botaoVerMais = () =>
    Array.from(hospedeiro.querySelectorAll("#reviews-section button")).find(
      (b) => b.textContent?.includes("Ver mais avaliações"),
    ) as HTMLButtonElement | undefined;

  it("nota, contagem e barras vêm da contagem do banco, não das 20 da lista", async () => {
    h.avaliacoes = vinteDeCinco();
    // 1000 de 1 estrela, 2000 de 5: média (1000 + 10000) / 3000 = 3,666… → 3,7.
    h.resumo = {
      productId: "prod-grande",
      temMais: true,
      porNota: [1000, 0, 0, 0, 2000],
    } satisfies Resumo;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Avaliações (3000)");
    expect(texto).toContain("Baseado em 3000 experiências");
    expect(texto).toContain("3000 opiniões dos consumidores");
    expect(texto).toContain("3,7");
    expect(texto).not.toContain("5,0");
    // A barra de 1 estrela mostra as 1000 do banco (a lista não tem nenhuma).
    const larguras = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>(
        "#reviews-section [style*='width']",
      ),
    ).map((el) => el.style.width);
    expect(larguras).toContain(`${(1000 / 3000) * 100}%`);
  });

  it("sem a contagem por estrela (falhou), a nota e a contagem vêm do catálogo", async () => {
    h.avaliacoes = vinteDeCinco();
    h.resumo = {
      productId: "prod-grande",
      temMais: true,
      porNota: null,
    } satisfies Resumo;
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Avaliações (2990)");
    expect(texto).toContain("4,2");
    expect(texto).not.toContain("Avaliações (20)");
  });

  it("resumo de OUTRO produto não vale para este: a página conta pela lista", async () => {
    h.avaliacoes = Array.from({ length: 3 }, (_, i) => avaliacao(i + 1, 5));
    h.resumo = {
      productId: "outro-produto",
      temMais: true,
      porNota: [1000, 0, 0, 0, 2000],
    } satisfies Resumo;
    await montar();

    expect(hospedeiro.textContent).toContain("Avaliações (3)");
  });

  it("'Ver mais' segue aparecendo depois das 20 e pede a próxima leva ao hook", async () => {
    h.avaliacoes = vinteDeCinco();
    h.resumo = {
      productId: "prod-grande",
      temMais: true,
      porNota: [0, 0, 0, 0, 3000],
    } satisfies Resumo;
    await montar();

    expect(comentariosVisiveis()).toBe(10);
    await act(async () => {
      botaoVerMais()?.click();
    });
    // Das 11 às 20 já estavam na lista: não precisa ir ao banco.
    expect(comentariosVisiveis()).toBe(20);
    expect(h.carregarMais).not.toHaveBeenCalled();
    expect(botaoVerMais()).toBeTruthy();

    await act(async () => {
      botaoVerMais()?.click();
    });
    expect(h.carregarMais).toHaveBeenCalledWith("prod-grande");
  });

  it("sem mais no banco, o botão some no fim da lista (como antes)", async () => {
    h.avaliacoes = vinteDeCinco();
    h.resumo = null;
    await montar();

    await act(async () => {
      botaoVerMais()?.click();
    });
    expect(comentariosVisiveis()).toBe(20);
    expect(botaoVerMais()).toBeUndefined();
    expect(h.carregarMais).not.toHaveBeenCalled();
  });
});
