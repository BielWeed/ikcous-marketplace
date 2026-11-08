// @vitest-environment jsdom
//
// Onda 49, achado 3: a releitura dos favoritos (ao voltar ao app) falha por
// rede ruim com a lista de antes ainda na tela. O contexto guarda `erro` e
// mantém a lista, mas a tela só lia o `erro` com a lista VAZIA: com a lista
// cheia ela parecia atual, e favoritos que a cliente já tirou em outro aparelho
// seguiam com o coração cheio, sem aviso. Agora a lista fica (não se esconde
// nada) e um recado avisa que pode estar desatualizada, com "Tentar de novo"
// (mesmo molde dos avisos de NotificationsView e OrderDetailsView).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const refresh = vi.fn();
let erroDaVez: string | null = null;

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    loading: false,
    erro: erroDaVez,
    refresh,
    pendingCount: 0,
    retentarPendentes: vi.fn(() => Promise.resolve()),
    favoritosIndisponiveis: 0,
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

const AVISO = /pode estar desatualizada/i;

describe("FavoritesView — lista antiga com a releitura falhada", () => {
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
    erroDaVez = null;
    refresh.mockClear();
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
  }

  const textoDaTela = () => hospedeiro.textContent ?? "";
  const botaoTentar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;

  it("com a lista cheia e a releitura falhada: a lista continua e o recado avisa que pode estar velha", async () => {
    erroDaVez = "Não conseguimos carregar seus favoritos.";
    await renderizar([umProduto("a"), umProduto("b")]);

    // Nada some: os dois produtos seguem na tela.
    expect(textoDaTela()).toContain("Produto a");
    expect(textoDaTela()).toContain("Produto b");
    // E o recado aparece, anunciado para quem usa leitor de tela.
    expect(
      [...hospedeiro.querySelectorAll('[role="status"]')].some((el) =>
        AVISO.test(el.textContent ?? ""),
      ),
    ).toBe(true);
    // Não é a tela de erro da lista vazia.
    expect(textoDaTela()).not.toContain("Verifique sua conexão");

    await act(async () => {
      botaoTentar()?.click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("controle: com a lista cheia e SEM erro, não há recado nem botão de tentar de novo", async () => {
    erroDaVez = null;
    await renderizar([umProduto("a")]);

    expect(textoDaTela()).toContain("Produto a");
    expect(textoDaTela()).not.toMatch(AVISO);
    expect(botaoTentar()).toBeUndefined();
  });

  it("o recado some junto com o erro, assim que a releitura dá certo", async () => {
    erroDaVez = "Não conseguimos carregar seus favoritos.";
    await renderizar([umProduto("a")]);
    expect(textoDaTela()).toMatch(AVISO);

    erroDaVez = null;
    await renderizar([umProduto("a")]);

    expect(textoDaTela()).not.toMatch(AVISO);
    expect(textoDaTela()).toContain("Produto a");
  });
});
