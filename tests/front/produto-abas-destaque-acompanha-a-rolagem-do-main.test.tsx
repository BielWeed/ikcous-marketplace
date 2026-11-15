// @vitest-environment jsdom
//
// Página de produto, barra de abas (Detalhes / Avaliações / Perguntas): o
// destaque da aba ativa (scroll-spy) tem de medir a seção RELATIVA AO TOPO DO
// <main>, que é a área que rola -- e não relativa à janela.
//
// Defeito medido num Chromium de verdade (1024, 1280 e 1920 px; no celular de
// 390 px aparece menos): clicar em "Avaliações" rola a seção até ela pousar a
// 90 px do topo do <main> (`totalOffset - 10` em `scrollToSection`). O
// scroll-spy comparava `getBoundingClientRect().top` (da JANELA) com 120.
// No computador o cabeçalho tem 121 px e o <main> começa em y=121: a seção
// pousa a 211 px da janela (> 120) e basta rolar ~8 px para o destaque VOLTAR
// à aba anterior com o título da seção ainda na tela (zona morta de 91 px; no
// celular, <main> em y=53, a seção pousa a 143 px: zona morta de 23 px).
// Rolando à mão a troca vinha com a seção 69-92 px ACIMA da base da barra.
//
// Os números de layout abaixo são os medidos (abas-*.json): <main> em y=121 no
// computador e y=53 no celular; o pouso do clique a 90 px do topo do <main>.
import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    products: catalogo,
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    loading: false,
    erro: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [],
    carregando: true,
    consultado: false,
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
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      shippingFee: 10,
      freeShippingMin: 0,
      storeName: "Loja de teste",
    },
    isLoaded: true,
    products: catalogo,
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function umProduto(id: string): Product {
  return {
    id,
    name: `Blusa ${id}`,
    description: "Descrição",
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
}
const catalogo: Product[] = ["a", "b", "c", "d"].map(umProduto);

// Posição de cada seção DENTRO do conteúdo do <main> (rolagem 0), em px.
const Y = { details: 200, reviews: 900, chat: 1300 };
// A rolagem do clique pousa a seção a 90 px do topo do <main>.
const POUSO = 90;
// Limite do scroll-spy: a seção "chegou" quando fica a até 120 px do topo do
// <main> (90 do pouso + 30 de folga, igual para os dois lados do pouso).
const LIMITE = 120;

describe("Produto — destaque da aba acompanha a rolagem do <main>", () => {
  let root: Root;
  let host: HTMLElement;
  let rolagem = 0;
  let chamadasScrollTo: number[] = [];

  beforeEach(() => {
    rolagem = 0;
    chamadasScrollTo = [];
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
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    host.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  /** Monta a página e simula o layout: <main> em `mainTop` da janela. */
  async function montar(mainTop: number) {
    await act(async () =>
      root.render(
        <ProductView
          product={umProduto("produto-abas")}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      ),
    );
    const rect = (top: number) =>
      ({
        top,
        bottom: top + 10,
        left: 0,
        right: 10,
        width: 10,
        height: 10,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const noLayout = (el: Element, y: number) => {
      el.getBoundingClientRect = () => rect(mainTop + y - rolagem);
    };
    host.getBoundingClientRect = () => rect(mainTop);
    Object.defineProperty(host, "scrollTop", {
      configurable: true,
      get: () => rolagem,
    });
    host.scrollTo = ((opts: ScrollToOptions) => {
      rolagem = opts.top ?? 0;
      chamadasScrollTo.push(rolagem);
    }) as typeof host.scrollTo;
    noLayout(document.getElementById("details-section")!, Y.details);
    noLayout(document.getElementById("reviews-section")!, Y.reviews);
    noLayout(document.getElementById("chat-section")!, Y.chat);
    const nav = document.querySelector("nav[aria-label='Seções do produto']")!;
    // a sentinela é o irmão que vem antes da barra sticky
    noLayout(nav.parentElement!.previousElementSibling!, 0);

    const abas = () =>
      [...nav.querySelectorAll("button")] as HTMLButtonElement[];
    const rolarPara = (v: number) => {
      rolagem = v;
      act(() => {
        host.dispatchEvent(new Event("scroll"));
      });
    };
    // posiciona a rolagem para a seção `y` ficar a `rel` px do topo do <main>
    const secaoA = (y: number, rel: number) => rolarPara(y - rel);
    const ativa = () =>
      abas()
        .find((b) => b.getAttribute("aria-current") === "true")
        ?.textContent?.replace(/\s*\(.*$/, "");
    const clicar = (rotulo: string) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      act(() => {
        abas()
          .find((b) => b.textContent?.startsWith(rotulo))!
          .click();
      });
    };
    const soltarATrava = () => {
      act(() => {
        vi.advanceTimersByTime(800);
      });
      vi.useRealTimers();
    };
    rolarPara(0);
    return { ativa, clicar, soltarATrava, rolarPara, secaoA };
  }

  const LAYOUTS = [
    ["computador (<main> em y=121)", 121],
    ["celular (<main> em y=53)", 53],
  ] as const;

  describe.each(LAYOUTS)("%s", (_nome, mainTop) => {
    it("a rolagem do clique continua pousando a seção a 90 px do topo do <main>", async () => {
      const t = await montar(mainTop);
      t.clicar("Avaliações");
      expect(chamadasScrollTo).toEqual([Y.reviews - POUSO]);
      t.soltarATrava();
      t.clicar("Perguntas");
      expect(chamadasScrollTo).toEqual([Y.reviews - POUSO, Y.chat - POUSO]);
      t.soltarATrava();
    });

    it("clicar em Avaliações e rolar 8 px NÃO devolve o destaque para Detalhes", async () => {
      const t = await montar(mainTop);
      t.clicar("Avaliações");
      t.soltarATrava();
      expect(t.ativa()).toBe("Avaliações");
      t.rolarPara(Y.reviews - POUSO + 8);
      expect(t.ativa()).toBe("Avaliações");
    });

    it("clicar em Perguntas e rolar 8 px NÃO devolve o destaque para Avaliações", async () => {
      const t = await montar(mainTop);
      t.clicar("Perguntas");
      t.soltarATrava();
      expect(t.ativa()).toBe("Perguntas");
      t.rolarPara(Y.chat - POUSO + 8);
      expect(t.ativa()).toBe("Perguntas");
    });

    it("à mão: Avaliações acende quando a seção chega a 120 px do topo do <main>, não antes", async () => {
      const t = await montar(mainTop);
      t.secaoA(Y.reviews, LIMITE + 1);
      expect(t.ativa()).toBe("Detalhes");
      t.secaoA(Y.reviews, LIMITE);
      expect(t.ativa()).toBe("Avaliações");
    });

    it("à mão: Perguntas acende quando a seção chega a 120 px do topo do <main>, não antes", async () => {
      const t = await montar(mainTop);
      t.secaoA(Y.chat, LIMITE + 1);
      expect(t.ativa()).toBe("Avaliações");
      t.secaoA(Y.chat, LIMITE);
      expect(t.ativa()).toBe("Perguntas");
    });

    it("à mão, subindo: volta para Detalhes só quando Avaliações desce além de 120 px", async () => {
      const t = await montar(mainTop);
      t.secaoA(Y.reviews, 40);
      expect(t.ativa()).toBe("Avaliações");
      t.secaoA(Y.reviews, LIMITE);
      expect(t.ativa()).toBe("Avaliações");
      t.secaoA(Y.reviews, LIMITE + 1);
      expect(t.ativa()).toBe("Detalhes");
    });

    it("durante a rolagem do clique (800 ms) o destaque não pula", async () => {
      const t = await montar(mainTop);
      t.clicar("Avaliações");
      // a rolagem suave passa por posições intermediárias: nada de piscar
      t.rolarPara(0);
      expect(t.ativa()).toBe("Avaliações");
      t.soltarATrava();
    });
  });

  it("<main> em y=0: mesmos pontos de troca de quando se media pela janela", async () => {
    // Com o <main> no topo da janela a medida relativa e a da janela são a
    // mesma conta -- o que valia antes do conserto continua valendo.
    const t = await montar(0);
    t.secaoA(Y.reviews, LIMITE + 1);
    expect(t.ativa()).toBe("Detalhes");
    t.secaoA(Y.reviews, LIMITE);
    expect(t.ativa()).toBe("Avaliações");
    t.secaoA(Y.chat, LIMITE + 1);
    expect(t.ativa()).toBe("Avaliações");
    t.secaoA(Y.chat, LIMITE);
    expect(t.ativa()).toBe("Perguntas");
  });
});
