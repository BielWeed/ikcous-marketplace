// @vitest-environment jsdom
//
// Prova da garantia central da Trilha 2 (ADMIN-090, issue #101): o
// interruptor "Avaliações dos Clientes" mudava o pill do admin para Inativo
// mas nenhuma tela de cliente lia o flag `enableReviews`. Este arquivo prova
// os DOIS lados do critério de aceite na página do produto:
//
//   - com o flag DESLIGADO, a nota no cabeçalho, a aba "Avaliações", a seção
//     inteira de avaliações e o `aggregateRating` do JSON-LD somem;
//   - com o flag LIGADO, tudo volta a se comportar exatamente como hoje
//     ("desligar demais é tão ruim quanto desligar de menos").
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// o mesmo raciocínio de checkout-view-flag-off.test.tsx -- o que este teste
// prova é a ÁRVORE renderizada mudando (ou não) com a flag, e o JSON-LD só
// existe de verdade no <head> depois que o useEffect de useDocumentMeta roda.
//
// ProductQA (renderizado dentro de ProductView) é de OUTRA trilha desta
// mesma onda e está sendo editado em paralelo neste working tree -- é
// mockado para um stub vazio, tanto para não pagar o custo de carregar as
// dependências dele (Radix, date-fns) quanto para não acoplar este teste ao
// que a Trilha 3 está mudando.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});
const markHelpful = vi.fn();

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem. Sem o stub, `new IntersectionObserver`
// lança "IntersectionObserver is not defined" e o render inteiro falha antes
// de chegar perto do que este arquivo testa.
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
    markHelpful,
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

// Stub vazio: ProductQA é de outra trilha, editada em paralelo neste working
// tree -- ver nota no cabeçalho do arquivo.
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews },
    isLoaded: true,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx: sem ela o React reclama "not configured to
// support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-101",
  name: "Produto Avaliado",
  description: "Descrição de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
};

// ProductView passa `jsonLdId: "product-structured-data"` para
// useDocumentMeta (src/views/customer/ProductView.tsx:710) — não é o
// "app-structured-data" que é o padrão do hook.
function jsonLd(): Record<string, unknown> | null {
  const script = document.getElementById("product-structured-data");
  if (!script?.textContent) return null;
  return JSON.parse(script.textContent);
}

describe("ProductView — gate do interruptor de Avaliações (ADMIN-090, #101)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    // jsdom não implementa `CSS.escape` -- useDocumentMeta usa para montar o
    // seletor do <script> de JSON-LD. `jsonLdId` aqui é sempre a constante
    // "product-structured-data" (sem caractere que precise de escape de
    // verdade), então um passthrough é suficiente.
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    // O jsdom desta versão não expõe `window.localStorage` como Storage de
    // verdade (`getItem is not a function`) — o cache de recomendações do
    // ProductView usa. Mesmo dublê em memória de checkout-view-flag-off.test.tsx.
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
    enableReviews = true;
  });

  it("com o flag DESLIGADO, some a nota do cabeçalho, a aba, a seção e o aggregateRating do JSON-LD", async () => {
    enableReviews = false;
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

    expect(hospedeiro.textContent).not.toContain("Avaliações (12)");
    expect(hospedeiro.querySelector("#reviews-section")).toBeNull();
    // A nota do cabeçalho ("4.5 (12)") não pode aparecer em lugar nenhum da
    // árvore com o flag desligado.
    expect(hospedeiro.textContent).not.toContain("4.5 (12)");

    const ld = jsonLd();
    expect(ld).not.toBeNull();
    expect(ld).not.toHaveProperty("aggregateRating");
  });

  it("com o flag LIGADO, continua exatamente como hoje: nota, aba, seção e aggregateRating presentes", async () => {
    enableReviews = true;
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

    expect(hospedeiro.textContent).toContain("Avaliações (12)");
    expect(hospedeiro.querySelector("#reviews-section")).not.toBeNull();
    expect(hospedeiro.textContent).toContain("4.5 (12)");

    const ld = jsonLd();
    expect(ld).not.toBeNull();
    expect(ld).toHaveProperty("aggregateRating");
    expect((ld as any).aggregateRating).toMatchObject({
      "@type": "AggregateRating",
      ratingValue: "4.5",
      reviewCount: 12,
    });
  });
});

// CORREÇÃO 1 (revisão da Trilha 2, #101): com o flag desligado a seção de
// avaliações some da árvore, então `reviewsSectionRef.current` é `null` e a
// guarda `if (!detailsEl || !reviewsEl || !chatEl) return;` do scroll-spy
// (ProductView.tsx:402) abortava TODO evento de scroll antes de chegar em
// `setActiveTab`. O pill da barra de abas ficava travado em "Detalhes".
//
// jsdom não faz layout: `getBoundingClientRect()` sempre devolve 0 para
// qualquer elemento. Isso não estraga a prova -- ao contrário, é o que
// permite provar a guarda sem depender de layout de verdade: como o
// `offsetThreshold` é 120, a seção "Perguntas" (checada primeiro no
// if/else) já teria `top(0) <= 120` verdadeiro na primeira chamada de
// `handleScrollSpy()`, disparada no mount (ProductView.tsx:422). Antes do
// conserto essa chamada nunca roda porque a função aborta antes; depois do
// conserto ela roda e muda a aba ativa já no mount.
describe("ProductView — scroll-spy sobrevive à seção de avaliações ausente (#101)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let mainEl: HTMLElement;

  beforeEach(() => {
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
    subscribeToReviews.mockImplementation(() => () => {});
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
    // O scroll-spy só roda se existir um <main> na árvore
    // (ProductView.tsx:379 -- `document.querySelector("main")`); sem ele o
    // efeito retorna cedo e nunca chega perto da guarda que este teste
    // prova. O `ProductView` não renderiza o próprio `<main>` (é o shell do
    // app quem faz isso), então o teste precisa fornecê-lo.
    mainEl = document.createElement("main");
    hospedeiro = document.createElement("div");
    mainEl.appendChild(hospedeiro);
    document.body.appendChild(mainEl);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    mainEl.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
    enableReviews = true;
  });

  it("com o flag desligado, a aba ativa ainda é decidida no mount (a guarda não aborta)", async () => {
    enableReviews = false;
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

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoPerguntas = botoes.find((b) => b.textContent === "Perguntas");
    expect(botaoPerguntas).toBeDefined();

    const rotulo = botaoPerguntas!.querySelector("span");
    // Se a guarda ainda abortasse, `activeTab` nunca sairia do valor
    // inicial "description" e este span não teria a classe de "ativo".
    expect(rotulo?.className).toContain("text-zinc-950");
  });
});

// CORREÇÃO 2 (revisão da Trilha 2, #102): `getReviewsByProduct` e
// `subscribeToReviews` rodavam incondicionalmente em ProductView.tsx:458-468,
// mesmo com `config.enableReviews` desligado -- uma consulta ao banco e uma
// assinatura de tempo real jogadas fora a cada visita de produto, já que
// nada do que volta é renderizado com o flag off.
describe("ProductView — efeito de avaliações respeita o flag (#102)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
    subscribeToReviews.mockImplementation(() => () => {});
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
    enableReviews = true;
  });

  it("com o flag desligado, não busca nem assina avaliações", async () => {
    enableReviews = false;
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

    expect(getReviewsByProduct).not.toHaveBeenCalled();
    expect(subscribeToReviews).not.toHaveBeenCalled();
  });

  it("com o flag ligado, assina avaliações e cancela a assinatura anterior ao trocar de produto", async () => {
    enableReviews = true;
    const cancelarProdutoA = vi.fn();
    subscribeToReviews.mockImplementationOnce(() => cancelarProdutoA);
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

    expect(getReviewsByProduct).toHaveBeenCalledWith(produto.id);
    expect(subscribeToReviews).toHaveBeenCalledTimes(1);
    expect(cancelarProdutoA).not.toHaveBeenCalled();

    const outroProduto: Product = { ...produto, id: "prod-999" };
    await act(async () => {
      raiz.render(
        <ProductView
          product={outroProduto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    // O cleanup do efeito antigo (produto original) precisa ter rodado
    // antes de assinar de novo para o novo produto.
    expect(cancelarProdutoA).toHaveBeenCalledTimes(1);
    expect(getReviewsByProduct).toHaveBeenCalledWith("prod-999");
  });

  it("liga o flag de volta sem remontar volta a buscar avaliações", async () => {
    enableReviews = false;
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

    expect(getReviewsByProduct).not.toHaveBeenCalled();

    enableReviews = true;
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

    expect(getReviewsByProduct).toHaveBeenCalledWith(produto.id);
    expect(subscribeToReviews).toHaveBeenCalledTimes(1);
  });
});
