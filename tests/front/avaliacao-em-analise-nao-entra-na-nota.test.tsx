// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V4: quem está logado lê a tabela de avaliações
// direto, e a política do banco devolve também a avaliação AINDA NÃO APROVADA
// (status 'pendente') do próprio autor e de quem administra. A página do
// produto contava essa linha como publicada: entrava na nota, na contagem
// ("Avaliações (3)") e nas barras de 1 a 5 estrelas. Agora só 'publicada'
// (ou sem status, que é o que a vitrine pública devolve) entra na conta; a
// avaliação em análise continua visível, com o selo "Em análise" no cartão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, Review } from "@/types";

let avaliacoesDoHook: Review[] = [];

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: avaliacoesDoHook,
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
  id: "prod-analise",
  name: "Produto Avaliado",
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
};

function avaliacao(
  id: string,
  rating: number,
  status?: Review["status"],
): Review {
  return {
    id,
    productId: "prod-analise",
    customerName: `Cliente ${id}`,
    rating,
    comment: `Comentário ${id}`,
    verified: true,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    ...(status ? { status } : {}),
  };
}

describe("ProductView — avaliação em análise não entra na nota nem na contagem (V4)", () => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
    avaliacoesDoHook = [];
  });

  async function montar() {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const textoDaSecao = () =>
    hospedeiro.querySelector("#reviews-section")?.textContent ?? "";

  it("duas publicadas (5 e 3) e uma em análise (1): nota 4,0, 'Avaliações (2)', barra de 1 estrela zerada", async () => {
    avaliacoesDoHook = [
      avaliacao("a", 5, "publicada"),
      avaliacao("b", 3),
      avaliacao("c", 1, "pendente"),
    ];
    await montar();

    const secao = textoDaSecao();
    expect(secao).toContain("4.0");
    expect(secao).toContain("Baseado em 2 experiências");
    expect(secao).toContain("2 opiniões dos consumidores");
    expect(hospedeiro.textContent).toContain("Avaliações (2)");
    expect(hospedeiro.textContent).not.toContain("Avaliações (3)");

    // Barras 5,4,3,2,1 estrelas: estrela + contagem. A em análise (1 estrela)
    // não soma.
    const linhas = Array.from(
      hospedeiro.querySelectorAll('#reviews-section [class~="group/row"]'),
    ).map((el) => el.textContent);
    expect(linhas).toEqual(["51", "40", "31", "20", "10"]);
  });

  it("a avaliação em análise continua na lista, com o selo 'Em análise'; as publicadas não levam o selo", async () => {
    avaliacoesDoHook = [
      avaliacao("a", 5, "publicada"),
      avaliacao("c", 1, "pendente"),
    ];
    await montar();

    const cartaoDe = (comentario: string) =>
      Array.from(hospedeiro.querySelectorAll("#reviews-section p"))
        .find((p) => p.textContent === comentario)
        ?.closest(".rounded-3xl");
    const secao = textoDaSecao();
    expect(secao).toContain("Comentário c");
    expect(secao).toContain("Em análise");
    expect(secao.match(/Em análise/g)?.length).toBe(1);
    const cartaoPendente = cartaoDe("Comentário c");
    const cartaoPublicado = cartaoDe("Comentário a");
    expect(cartaoPendente).toBeTruthy();
    expect(cartaoPublicado).toBeTruthy();
    expect(cartaoPendente?.textContent).toContain("Em análise");
    expect(cartaoPublicado?.textContent).not.toContain("Em análise");
  });

  it("borda: SÓ uma avaliação em análise: nota e contagem zeradas, sem painel de estrelas, cartão visível", async () => {
    avaliacoesDoHook = [avaliacao("c", 1, "pendente")];
    await montar();

    const secao = textoDaSecao();
    expect(secao).toContain("Sem avaliações ainda");
    expect(secao).not.toContain("Baseado em");
    expect(secao).toContain("Em análise");
    expect(hospedeiro.textContent).toContain("Avaliações (0)");
  });
});
