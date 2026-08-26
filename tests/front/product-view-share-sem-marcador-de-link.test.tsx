// @vitest-environment jsdom
//
// O texto de compartilhar produto tinha UM booleano só (temMarcador) decidindo
// DUAS coisas diferentes: (a) se substitui os marcadores em vez de grudar o
// sufixo padrão, e (b) se cola a URL no fim, no caminho do clipboard. Um
// preset como "[nome] por apenas [preco]. Acesse nossa loja!" tem marcador
// (cai em (a), correto) mas NÃO tem [link] — e caía também em (b), que omite
// a URL. Resultado real: o app copia o texto SEM link nenhum e ainda assim
// mostra "Link copiado!". Este teste prende a URL sendo colada quando falta
// [link], mesmo com outros marcadores presentes; prende também que a URL não
// duplica quando [link] está presente; e prende que uma falha real do
// clipboard (permissão negada, documento sem foco) vira toast.error, nunca
// toast.success mentindo sucesso.
//
// Montagem real (react-dom/client + jsdom) reaproveitada de
// product-view-share-substitui-os-marcadores.test.tsx, inclusive os stubs de
// IntersectionObserver, CSS.escape, localStorage, sonner, StoreContext e do
// navigator.clipboard.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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

describe("ProductView — share sem [link] ainda cola a URL, e clipboard não mente sucesso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let textoCopiado: string;
  let writeTextImpl: (t: string) => Promise<void>;

  beforeEach(() => {
    shareTextDaLoja = "Olha que achei na Loja X!";
    textoCopiado = "";
    writeTextImpl = (t: string) => {
      textoCopiado = t;
      return Promise.resolve();
    };
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
    // não existe — o dublê captura o texto medido. writeTextImpl é indireto
    // para o caso de falha poder trocar o comportamento por teste.
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => writeTextImpl(t),
      },
    });
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
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
      await Promise.resolve();
    });
    return textoCopiado;
  }

  it("marcador sem [link]: substitui nome/preço e ainda cola a URL no fim", async () => {
    shareTextDaLoja = "[nome] por apenas [preco]. Acesse nossa loja!";
    const texto = await compartilhar();

    // Âncora: o clique chegou ao clipboard.
    expect(texto).not.toBe("");

    expect(texto).toContain(globalThis.location.href);
    expect(texto).toContain("Produto Compartilhavel");
    expect(texto).toContain("R$ 49,90");
    expect(texto).not.toContain("[nome]");
    expect(texto).not.toContain("[preco]");
  });

  it("marcador com [link]: a URL aparece uma vez só, sem duplicar no fim", async () => {
    shareTextDaLoja =
      "Confira este produto incrível: [nome] por apenas [preco]! Acesse: [link]";
    const texto = await compartilhar();

    expect(texto).not.toBe("");

    const url = globalThis.location.href;
    const ocorrencias = texto.split(url).length - 1;
    expect(ocorrencias).toBe(1);
  });

  it("falha do clipboard: não afirma sucesso, avisa o erro", async () => {
    writeTextImpl = () => Promise.reject(new Error("permissão negada"));
    shareTextDaLoja = "Olha que achei na Loja X!";
    await compartilhar();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
