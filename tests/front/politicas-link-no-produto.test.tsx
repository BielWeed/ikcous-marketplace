// @vitest-environment jsdom
//
// A cliente que está prestes a comprar precisa achar "Trocas e devoluções"
// na própria página do produto, perto do botão de comprar — e ler sem perder
// o tamanho/cor que acabou de escolher (por isso abre em folha, não em outra
// página). Harness herdado de `aviso-de-variacao-diz-o-que-falta`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: () => () => {},
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
    config: { enableReviews: false, storeName: "Loja da Ana" },
    isLoaded: true,
  }),
}));
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: null, error: { message: "fora do ar" } }),
      };
      return cadeia;
    },
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const VARIANTES: ProductVariant[] = ["P", "M"].map((valor) => ({
  id: `var-${valor.toLowerCase()}`,
  productId: "prod-camiseta",
  name: "Tamanho",
  value: valor,
  stockIncrement: 5,
  active: true,
}));

const PRODUTO: Product = {
  id: "prod-camiseta",
  name: "Camiseta",
  description: "Descrição de teste",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: VARIANTES,
};

describe("ProductView — Trocas e devoluções perto do botão de comprar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onAddToCart = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => void armazem.set(c, v),
      removeItem: (c: string) => void armazem.delete(c),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
  });

  async function montar(produto: Product = PRODUTO) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={onAddToCart}
          onBack={() => {}}
        />,
      );
    });
  }

  const link = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      '[data-testid="link-trocas-e-devolucoes"]',
    );

  async function aguardarFolha(): Promise<Element> {
    for (let i = 0; i < 80; i++) {
      const f = document.querySelector('[data-testid="folha-politica"]');
      if (f) return f;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    throw new Error("a folha da política não abriu");
  }

  function botaoAdicionar(): HTMLButtonElement {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Adicionar"),
    );
    if (!achado) throw new Error("botão Adicionar não encontrado");
    return achado;
  }

  it("o link existe, com texto claro, DEPOIS do botão de comprar", async () => {
    await montar();
    const l = link();
    expect(l).not.toBeNull();
    expect(l?.textContent).toBe("Trocas e devoluções");
    const posicao = botaoAdicionar().compareDocumentPosition(l as Node);
    expect(posicao & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("produto esgotado também mostra o link (a regra não depende de estoque)", async () => {
    await montar({ ...PRODUTO, stock: 0, variants: undefined });
    expect(link()).not.toBeNull();
  });

  it("abrir e fechar a folha NÃO tira o tamanho escolhido nem adiciona nada", async () => {
    await montar();
    // Escolhe o tamanho P.
    const rotulo = [...hospedeiro.querySelectorAll("legend")].find(
      (s) => s.textContent === "Tamanho",
    );
    const botaoP = [
      ...(rotulo?.parentElement?.querySelectorAll("button") ?? []),
    ].find((b) => b.textContent?.startsWith("P"));
    expect(botaoP).toBeDefined();
    act(() => botaoP?.click());

    act(() => link()?.click());
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Trocas e devoluções");
    expect(onAddToCart).not.toHaveBeenCalled();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();

    // A escolha continua valendo: comprar agora leva a variação P.
    await act(async () => {
      botaoAdicionar().click();
    });
    expect(onAddToCart).toHaveBeenCalledTimes(1);
    const chamada = onAddToCart.mock.calls[0];
    expect(JSON.stringify(chamada)).toContain("var-p");
  });

  it("Voltar do aparelho com a folha aberta: fecha só a folha, fica na página (com ?id=) e o tamanho escolhido continua", async () => {
    globalThis.history.replaceState(
      { view: "product-detail", id: PRODUTO.id },
      "",
      `/product-detail?id=${PRODUTO.id}`,
    );
    const roteadorDoApp = vi.fn();
    globalThis.addEventListener("popstate", roteadorDoApp);
    try {
      await montar();
      const rotulo = [...hospedeiro.querySelectorAll("legend")].find(
        (s) => s.textContent === "Tamanho",
      );
      const botaoP = [
        ...(rotulo?.parentElement?.querySelectorAll("button") ?? []),
      ].find((b) => b.textContent?.startsWith("P"));
      expect(botaoP).toBeDefined();
      act(() => botaoP?.click());

      act(() => link()?.click());
      await aguardarFolha();

      await act(async () => {
        globalThis.history.back();
        await new Promise((r) => setTimeout(r, 60));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(
        document.querySelector('[data-testid="folha-politica"]'),
      ).toBeNull();
      expect(roteadorDoApp).not.toHaveBeenCalled();
      expect(globalThis.location.pathname + globalThis.location.search).toBe(
        `/product-detail?id=${PRODUTO.id}`,
      );
      expect(onAddToCart).not.toHaveBeenCalled();
      // A escolha do tamanho continua valendo: a compra leva a variação P.
      await act(async () => {
        botaoAdicionar().click();
      });
      expect(onAddToCart).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(onAddToCart.mock.calls[0])).toContain("var-p");
    } finally {
      globalThis.removeEventListener("popstate", roteadorDoApp);
    }
  });
});
