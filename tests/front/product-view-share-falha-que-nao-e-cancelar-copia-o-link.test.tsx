// @vitest-environment jsdom
//
// Compartilhar pelo menu do celular: o `catch` engolia QUALQUER rejeição do
// navigator.share como se fosse "cancelou". Se a folha do aparelho falhava por
// outro motivo (NotAllowedError, DataError...), nada acontecia e o link não era
// copiado. Agora: AbortError (a cliente fechou a folha) = silêncio; qualquer
// outro erro cai no mesmo caminho de copiar do navegador sem menu de compartilhar.
//
// Montagem real reaproveitada de product-view-share-nativo-nao-repete-o-link.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
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
    success: toastMock.success,
    error: toastMock.error,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-202",
  name: "Produto Compartilhavel",
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

const erroComNome = (nome: string) =>
  Object.assign(new Error(nome), { name: nome });

const enderecoDoProduto = `${globalThis.location.origin}/product-detail?id=prod-202`;

describe("ProductView — compartilhar: só 'cancelou' é silêncio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let copiou: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    copiou = vi.fn().mockResolvedValue(undefined);
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
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: copiou },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    // biome-ignore lint/performance/noDelete: o jsdom não tem `share`; o teste apaga o que ele mesmo criou.
    delete (globalThis.navigator as { share?: unknown }).share;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function compartilhar(share?: () => Promise<void>) {
    Object.defineProperty(globalThis.navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });
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
    const botaoShare = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    expect(botaoShare).not.toBeNull();
    await act(async () => {
      botaoShare!.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  const compartilharComShareQueRejeita = (erro: Error) =>
    compartilhar(vi.fn().mockRejectedValue(erro));

  it("share nativo funciona: não copia nem mostra aviso", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await compartilhar(share);

    expect(share).toHaveBeenCalledTimes(1);
    expect(copiou).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("share rejeita com NotAllowedError: o link é copiado e a cliente é avisada", async () => {
    await compartilharComShareQueRejeita(erroComNome("NotAllowedError"));

    expect(copiou).toHaveBeenCalledTimes(1);
    expect(copiou.mock.calls[0][0]).toContain(enderecoDoProduto);
    expect(toastMock.success).toHaveBeenCalledWith(
      "Link copiado!",
      expect.anything(),
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it.each([
    { cenario: "share indisponível", share: undefined },
    {
      cenario: "share rejeita",
      share: vi.fn().mockRejectedValue(erroComNome("NotAllowedError")),
    },
  ])(
    "$cenario e cópia falha: o aviso mostra o link para copiar à mão",
    async ({ share }) => {
      copiou.mockRejectedValue(new Error("bloqueado"));
      await compartilhar(share);

      expect(toastMock.error).toHaveBeenCalledWith(
        "Não consegui copiar",
        expect.anything(),
      );
      expect(toastMock.success).not.toHaveBeenCalled();

      const { description } = toastMock.error.mock.calls[0][1];
      await act(async () => {
        raiz.render(description);
      });
      expect(hospedeiro.textContent).toContain(enderecoDoProduto);
    },
  );

  it("share rejeita com AbortError (a cliente cancelou): silêncio, nada é copiado", async () => {
    await compartilharComShareQueRejeita(erroComNome("AbortError"));

    expect(copiou).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
