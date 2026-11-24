// @vitest-environment jsdom
//
// Ao voltar à aba, a página do produto relê o catálogo (`fetchProducts`) E as
// recomendações (`recarregar`, do hook). Sem a segunda, os cards de "Você
// também pode gostar" ficavam com o preço/estoque de antes. Aqui se prende a
// ligação: um único gatilho (visibilitychange → visível) chama as DUAS, uma vez
// cada, e no máximo uma vez por janela de 30 s (`aoVoltarAAba`); aba indo para o
// fundo não chama nenhuma. O comportamento do `recarregar`
// em si está em recomendacoes-do-produto-recarregam-sem-novo-loop.test.tsx.
import { INTERVALO_MINIMO_AO_VOLTAR_MS } from "@/lib/atualizar-ao-voltar-a-aba";
import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchProducts, recarregar } = vi.hoisted(() => ({
  fetchProducts: vi.fn(async () => {}),
  recarregar: vi.fn(),
}));

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
    fetchProducts,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [],
    carregando: true,
    consultado: false,
    recarregar,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "11999999999" },
    isLoaded: true,
  }),
}));

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "produto-aba",
  name: "Blusa de teste",
  description: "Descrição da blusa",
  price: 100,
  images: ["/foto-1.png"],
  category: "Roupas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-28T12:00:00Z",
};

function avancarRelogio(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

function mudarVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("página do produto — voltar à aba relê catálogo e recomendações", () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(async () => {
    fetchProducts.mockClear();
    recarregar.mockClear();
    // Só o relógio (Date) é falso: a janela do `aoVoltarAAba` conta por ele, e
    // os temporizadores reais do React seguem como sempre.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("matchMedia", undefined);
    host = document.createElement("main");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.getElementById("product-structured-data")?.remove();
    // Tira o getter próprio: volta ao do prototype do jsdom.
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aba volta a ficar visível depois da janela: relê o catálogo e as recomendações, uma vez cada", async () => {
    await act(async () => {
      avancarRelogio(INTERVALO_MINIMO_AO_VOLTAR_MS + 1_000);
      mudarVisibilidade("visible");
    });

    expect(fetchProducts).toHaveBeenCalledTimes(1);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("aba indo para o fundo não relê nada", async () => {
    await act(async () => {
      avancarRelogio(INTERVALO_MINIMO_AO_VOLTAR_MS + 1_000);
      mudarVisibilidade("hidden");
    });

    expect(fetchProducts).not.toHaveBeenCalled();
    expect(recarregar).not.toHaveBeenCalled();
  });

  // O catálogo inteiro é lido em páginas de 200 produtos: alternar app/WhatsApp
  // várias vezes em meio minuto não pode refazer essa leitura a cada volta.
  it("voltar à aba duas vezes em menos de 30 s relê UMA vez; passada a janela, relê de novo", async () => {
    await act(async () => {
      avancarRelogio(INTERVALO_MINIMO_AO_VOLTAR_MS + 1_000);
      mudarVisibilidade("visible");
    });
    expect(fetchProducts).toHaveBeenCalledTimes(1);

    await act(async () => {
      avancarRelogio(10_000);
      mudarVisibilidade("hidden");
      mudarVisibilidade("visible");
    });
    expect(fetchProducts).toHaveBeenCalledTimes(1);
    expect(recarregar).toHaveBeenCalledTimes(1);

    await act(async () => {
      avancarRelogio(INTERVALO_MINIMO_AO_VOLTAR_MS);
      mudarVisibilidade("visible");
    });
    expect(fetchProducts).toHaveBeenCalledTimes(2);
    expect(recarregar).toHaveBeenCalledTimes(2);
  });

  it("voltar logo depois de abrir a ficha (a leitura acabou de acontecer) não relê", async () => {
    await act(async () => {
      avancarRelogio(5_000);
      mudarVisibilidade("visible");
    });

    expect(fetchProducts).not.toHaveBeenCalled();
    expect(recarregar).not.toHaveBeenCalled();
  });
});
