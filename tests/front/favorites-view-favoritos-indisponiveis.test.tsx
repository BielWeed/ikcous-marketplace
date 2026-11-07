// @vitest-environment jsdom
//
// Favorito de produto pausado (ou fora do catálogo) sumia em silêncio, e a tela
// chegava a dizer "Você ainda não tem favoritos" para quem tinha. O contexto
// agora expõe `favoritosIndisponiveis`; a tela avisa, acima da lista e no
// estado vazio.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

let indisponiveisDaVez: number | undefined = 0;

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    loading: false,
    erro: null,
    refresh: vi.fn(),
    pendingCount: 0,
    retentarPendentes: vi.fn(() => Promise.resolve()),
    favoritosIndisponiveis: indisponiveisDaVez,
    limparIndisponiveis: vi.fn(async () => {}),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    fetchProducts: vi.fn(() => Promise.resolve()),
    products: [],
    loadingProducts: false,
    catalogoErro: false,
  }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const umProduto = (id: string): Product => ({
  id,
  name: `Produto ${id}`,
  price: 20,
  category: "Roupas",
  description: "",
  images: [],
  stock: 4,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-10-20T12:00:00Z",
  variants: [],
});

describe("FavoritesView — favoritos indisponíveis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    indisponiveisDaVez = 0;
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

  async function renderizar(favorites: Product[]) {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={favorites}
          loading={false}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  const avisos = () =>
    [...hospedeiro.querySelectorAll('[role="status"]')]
      .map((el) => el.textContent ?? "")
      .filter((t) => t.includes("indispon"));

  it("lista vazia com guardados indisponíveis: não diz que não há favoritos e avisa quantos", async () => {
    indisponiveisDaVez = 2;
    const texto = await renderizar([]);

    expect(texto).not.toContain("Você ainda não tem favoritos");
    expect(texto).not.toContain("Nenhum produto salvo ainda");
    expect(texto).toContain("Seus favoritos estão indisponíveis agora");
    expect(avisos()).toEqual([
      "2 favoritos seus não estão disponíveis na loja.Limpar indisponíveis",
    ]);
  });

  it("um indisponível: singular certo", async () => {
    indisponiveisDaVez = 1;
    await renderizar([]);

    expect(avisos()).toEqual([
      "1 favorito seu não está disponível na loja.Limpar indisponíveis",
    ]);
  });

  it("lista com itens e um indisponível: o aviso aparece acima da lista", async () => {
    indisponiveisDaVez = 1;
    await renderizar([umProduto("a")]);

    expect(avisos()).toEqual([
      "1 favorito seu não está disponível na loja.Limpar indisponíveis",
    ]);
    const aviso = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (el) => el.textContent?.includes("indispon"),
    ) as Element;
    const lista = hospedeiro.querySelector("[data-secao]") as Element;
    expect(lista).not.toBeNull();
    // `aviso` vem ANTES da lista na ordem do documento.
    expect(
      aviso.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("nenhum indisponível: sem aviso, e o estado vazio de sempre", async () => {
    indisponiveisDaVez = 0;
    const texto = await renderizar([]);

    expect(avisos()).toEqual([]);
    expect(texto).toContain("Você ainda não tem favoritos");
    expect(texto).toContain("Nenhum produto salvo ainda");
  });

  it("contexto sem o campo (visitante/dublê antigo): inalterado", async () => {
    indisponiveisDaVez = undefined;
    const texto = await renderizar([]);

    expect(avisos()).toEqual([]);
    expect(texto).toContain("Você ainda não tem favoritos");
  });
});
