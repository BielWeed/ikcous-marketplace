// @vitest-environment jsdom
//
// O texto de compartilhar produto promete o que os presets do painel vendem.
//
// A tela de Atendimento (AdminWhatsAppConfigView.tsx:27+) oferece ~30 presets
// de mensagem com os marcadores [nome], [preco] e [link] — "mensagem pronta",
// diz a UI. Mas o handleShare do ProductView concatenava config.shareText
// CRU: a cliente compartilhava no WhatsApp da amiga "Confira: [nome] por
// apenas [preco]! Acesse: [link]" — marcadores literais, com nome e preço
// GRUDADOS DEPOIS em outro formato. Este teste prende a substituição: texto
// COM marcador é mensagem completa da lojista (substitui, sem sufixo extra);
// texto SEM marcador (o default "Olha que achei na Loja X!") mantém o
// comportamento de sempre, colando nome e preço na frente.
//
// Montagem real (react-dom/client + jsdom) reaproveitada de
// product-view-remove-troca-garantida.test.tsx, inclusive os stubs de
// IntersectionObserver, CSS.escape e localStorage. O caminho medido é o do
// clipboard (navigator.share não existe no jsdom) — o mesmo handler.
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

// shareText variável por caso: a fábrica roda no import e useStore no
// render — o valor lido é o reatribuído por cada teste.
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

describe("ProductView — share substitui os marcadores que o painel promete", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let textoCopiado: string;

  beforeEach(() => {
    shareTextDaLoja = "Olha que achei na Loja X!";
    textoCopiado = "";
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
    // jsdom não tem navigator.share: o handler cai no clipboard, que também
    // não existe — o dublê captura o texto medido.
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
    vi.unstubAllGlobals();
  });

  async function compartilhar() {
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
    expect(botaoShare).toBeDefined();
    await act(async () => {
      botaoShare!.click();
      await Promise.resolve();
    });
    return textoCopiado;
  }

  it("texto com marcadores [nome]/[preco]/[link]: substituídos, sem sufixo duplicado", async () => {
    shareTextDaLoja =
      "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]";
    const texto = await compartilhar();

    // Âncora: o clique chegou ao clipboard.
    expect(texto).not.toBe("");

    expect(texto).toContain("Produto Compartilhavel");
    expect(texto).toContain("R$ 49,90");
    expect(texto).toContain(globalThis.location.href);
    expect(texto).not.toContain("[nome]");
    expect(texto).not.toContain("[preco]");
    expect(texto).not.toContain("[link]");
    // Mensagem com marcador é completa: o sufixo padrão não se gruda depois.
    expect(texto).not.toContain(" por R$49.90");
  });

  it("texto sem marcadores (o default): mantém o comportamento de sempre", async () => {
    shareTextDaLoja = "Olha que achei na Loja X!";
    const texto = await compartilhar();

    // Exatamente o formato atual: shareText + nome + "por R$" com ponto,
    // e o link colado no final pelo caminho do clipboard.
    expect(texto).toBe(
      `Olha que achei na Loja X! Produto Compartilhavel por R$49.90 - ${globalThis.location.href}`,
    );
  });
});
