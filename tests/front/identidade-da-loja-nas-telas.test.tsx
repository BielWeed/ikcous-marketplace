// @vitest-environment jsdom
//
// Tarefa 6 do plano "o app para de inventar endereço".
//
// Duas coisas nesta suíte, e a segunda é independente da primeira:
//
// (a) A cidade da loja sai do código: HomeView passa a ler `config.storeCity`
//     / `config.storeState`, e omite o trecho inteiro quando a loja não
//     configurou — nunca vírgula solta, travessão solto ou "|" seguido de
//     nada.
// (b) A home parava de prometer "entrega ultrarrápida" e "troca garantida"
//     (mesma mentira que o PR #225 já tinha tirado do carrinho — ver
//     cart-view-promessas-que-a-loja-nao-cumpre.test.tsx): não existe fluxo
//     de troca (#46, #108 seguem abertas) nem entrega ultrarrápida.
//
// POR QUE RENDER DE VERDADE: `useDocumentMeta` escreve `document.title` e as
// metatags via efeito imperativo (ver src/hooks/useDocumentMeta.ts). Ler o
// DOM depois do render prova que o texto realmente chegou à página — não
// que a string existe em algum lugar do arquivo fonte.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

// Mock mutável: cada teste ajusta `mockConfig` antes de renderizar. Os
// componentes leem `config` em tempo de render (não no import), então mudar
// a variável entre testes funciona mesmo com o módulo já carregado.
let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("HomeView — a cidade vem do config, e a home para de prometer o que não cumpre", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    // jsdom não implementa `CSS.escape` -- useDocumentMeta usa para montar o
    // seletor do <script> de JSON-LD. Mesmo dublê de
    // product-view-gate-avaliacoes.test.tsx (`jsonLdId` aqui é sempre a
    // constante "home-structured-data", sem caractere que precise de escape
    // de verdade).
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarHome() {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={[]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("a home não promete entrega ultrarrápida nem troca garantida", async () => {
    mockConfig = { storeCity: "Uberlândia", storeState: "MG" };
    await renderizarHome();

    const metaDescricao = document.head
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    const metaOg = document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");

    expect(metaDescricao).not.toContain("ultrarrápida");
    expect(metaDescricao).not.toContain("troca garantida");
    expect(metaOg).not.toContain("ultrarrápida");
    expect(metaOg).not.toContain("troca garantida");
  });

  it("a home não promete entrega expressa quando a loja tem cidade configurada", async () => {
    // Achado de revisão: a `homeDescription` (que alimenta og:description e
    // twitter:description — a prévia de compartilhamento no WhatsApp) só
    // aparecia com "entrega expressa" quando a loja TINHA cidade. O caso sem
    // cidade acima nunca exercitava esse ramo, e a promessa sobreviveu ao
    // PR #225 escondida atrás da condição.
    mockConfig = { storeCity: "Uberlândia", storeState: "MG" };
    await renderizarHome();

    const metaDescricao = document.head
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");
    const metaOg = document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    const metaTwitter = document.head
      .querySelector('meta[name="twitter:description"]')
      ?.getAttribute("content");

    expect(metaDescricao).not.toContain("expressa");
    expect(metaOg).not.toContain("expressa");
    expect(metaTwitter).not.toContain("expressa");
    // O frete grátis é de verdade (configurável, com mínimo) — só a
    // promessa de entrega expressa é que não pode sobrar.
    expect(metaOg).toContain("frete grátis");
  });

  it("a home mostra a cidade da loja quando configurada", async () => {
    mockConfig = { storeCity: "Uberlândia", storeState: "MG" };
    await renderizarHome();

    expect(document.title).toContain("Uberlândia");
  });

  it("a home não mostra cidade nenhuma quando a loja não configurou", async () => {
    mockConfig = {};
    await renderizarHome();

    expect(document.title).not.toContain("Monte Carmelo");
    // Nunca "Nome | " com o separador solto no fim, nem vírgula sobrando.
    expect(document.title).not.toMatch(/\|\s*$/);
    expect(document.title).not.toMatch(/,\s*$/);
    expect(document.title).not.toContain(", ,");
  });
});

describe("FreeShippingBlock — o rótulo de cidade lê o config, ou some", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarBloco() {
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock onNavigate={() => {}} />);
    });
  }

  it("mostra a cidade da loja quando ela está configurada", async () => {
    mockConfig = {
      freeShippingMin: 50,
      storeCity: "Uberlândia",
      storeState: "MG",
    };
    await renderizarBloco();

    expect(hospedeiro.textContent).toContain("Uberlândia");
    expect(hospedeiro.textContent).not.toContain("Monte Carmelo");
  });

  it("omite o rótulo (e o separador) quando a loja não configurou cidade", async () => {
    mockConfig = { freeShippingMin: 50 };
    await renderizarBloco();

    expect(hospedeiro.textContent).not.toContain("Monte Carmelo");
    // "Entrega Grátis" continua sozinho, sem "•" nem cidade na frente.
    expect(hospedeiro.textContent).toContain("Entrega Grátis");
  });
});
