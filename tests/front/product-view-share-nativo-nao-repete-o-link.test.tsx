// @vitest-environment jsdom
//
// Compartilhar pelo menu do celular não pode sair com o link DUPLICADO.
//
// Os modelos de mensagem da lojista trazem [link], e o handleShare já
// substitui esse marcador pela URL dentro do texto. Mas ele também passava a
// MESMA URL no campo `url` do navigator.share — e os apps que recebem o
// compartilhamento (WhatsApp no Android, por exemplo) costumam juntar `text`
// e `url` numa mensagem só, então a URL aparecia duas vezes. Este teste prende
// a regra: o que o navigator.share recebe contém a URL UMA vez só, com ou sem
// [link] no modelo. O caminho de copiar (sem navigator.share) não muda.
//
// Montagem real (react-dom/client + jsdom) reaproveitada de
// product-view-share-sem-marcador-de-link.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct,
    markHelpful: vi.fn(),
    subscribeToReviews,
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

let shareTextDaLoja = "Olha que achei na Loja X!";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: shareTextDaLoja,
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão do
// teste vizinho.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-101",
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

type DadosDoShare = { title?: string; text?: string; url?: string };

describe("ProductView — o menu de compartilhar do celular recebe a URL uma vez só", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let share: ReturnType<typeof vi.fn>;
  let textoCopiado: string;

  beforeEach(() => {
    shareTextDaLoja = "Olha que achei na Loja X!";
    textoCopiado = "";
    share = vi.fn().mockResolvedValue(undefined);
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
      value: {
        writeText: (t: string) => {
          textoCopiado = t;
          return Promise.resolve();
        },
      },
    });
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
  });

  async function compartilhar(comMenuDoCelular: boolean) {
    if (comMenuDoCelular) {
      Object.defineProperty(globalThis.navigator, "share", {
        configurable: true,
        writable: true,
        value: share,
      });
    }
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
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function ocorrenciasDaUrl(dados: DadosDoShare): number {
    const url = globalThis.location.href;
    const tudo = `${dados.text ?? ""}\n${dados.url ?? ""}`;
    return tudo.split(url).length - 1;
  }

  it("modelo com [link]: o menu recebe a URL uma única vez", async () => {
    shareTextDaLoja =
      "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]";
    await compartilhar(true);

    expect(share).toHaveBeenCalledTimes(1);
    const dados = share.mock.calls[0][0] as DadosDoShare;
    expect(ocorrenciasDaUrl(dados)).toBe(1);
    // O formato do modelo da lojista é preservado: o link fica onde ela pôs.
    expect(dados.text).toContain(`Acesse: ${globalThis.location.href}`);
    expect(dados.text).toContain("Produto Compartilhavel");
  });

  it("modelo sem [link] (nem marcador): o menu recebe a URL uma única vez", async () => {
    shareTextDaLoja = "Olha que achei na Loja X!";
    await compartilhar(true);

    expect(share).toHaveBeenCalledTimes(1);
    const dados = share.mock.calls[0][0] as DadosDoShare;
    expect(ocorrenciasDaUrl(dados)).toBe(1);
    expect(dados.url).toBe(globalThis.location.href);
  });

  it("modelo com [nome]/[preco] mas sem [link]: a URL ainda vai, uma vez só", async () => {
    shareTextDaLoja = "[nome] por apenas [preco]. Acesse nossa loja!";
    await compartilhar(true);

    expect(share).toHaveBeenCalledTimes(1);
    const dados = share.mock.calls[0][0] as DadosDoShare;
    expect(ocorrenciasDaUrl(dados)).toBe(1);
  });

  it("sem menu do celular: o texto copiado continua igual ao de sempre", async () => {
    shareTextDaLoja =
      "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]";
    await compartilhar(false);

    expect(share).not.toHaveBeenCalled();
    expect(textoCopiado).toBe(
      `Confira este produto incrível: Produto Compartilhavel por apenas R$ 49,90! Acesse: ${globalThis.location.href}`,
    );
  });
});
