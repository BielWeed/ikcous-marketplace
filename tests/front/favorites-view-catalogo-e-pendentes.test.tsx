// @vitest-environment jsdom
//
// Favoritos não afirma "você não tem favoritos" por falta de catálogo, e não
// esconde o que ficou retido sem aviso.
//
// (1) A lista é o cruzamento dos ids salvos com o catálogo da loja. Com o
// catálogo ainda carregando (abertura a frio pelo atalho /favorites) ou
// falhado, o cruzamento dá [] e a tela caía em "Você ainda não tem favoritos"
// para quem tem. Home e Busca já separam "carregando" e "catálogo com erro".
// (2) Favoritos do visitante que não sincronizaram no login ficam numa fila
// invisível; o contexto expõe `pendingCount` justamente para a tela avisar, e
// o aviso do login promete "tentar de novo". A tela precisa dizer quantos
// faltam e dar um botão que tenta agora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const refresh = vi.fn();
const retentarPendentes = vi.fn(() => Promise.resolve());
const fetchProducts = vi.fn(() => Promise.resolve());

let pendentesDaVez = 0;
let lojaDaVez: {
  products: Product[];
  loadingProducts: boolean;
  catalogoErro: boolean;
} = { products: [], loadingProducts: false, catalogoErro: false };

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    loading: false,
    erro: null,
    refresh,
    pendingCount: pendentesDaVez,
    retentarPendentes,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, fetchProducts, ...lojaDaVez }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FavoritesView — catálogo carregando/falhado e favoritos retidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pendentesDaVez = 0;
    lojaDaVez = { products: [], loadingProducts: false, catalogoErro: false };
    refresh.mockClear();
    retentarPendentes.mockClear();
    fetchProducts.mockClear();
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

  async function renderizar() {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={[]}
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

  const botao = (trecho: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    ) as HTMLButtonElement | undefined;

  it("catálogo ainda carregando: esqueleto, nunca 'Você ainda não tem favoritos'", async () => {
    lojaDaVez = { products: [], loadingProducts: true, catalogoErro: false };
    const texto = await renderizar();

    expect(texto).not.toContain("Você ainda não tem favoritos");
    expect(texto).not.toContain("Nenhum produto salvo ainda");
    expect(
      hospedeiro.querySelector(
        '[role="status"][aria-label="Carregando favoritos"]',
      ),
    ).not.toBeNull();
  });

  it("catálogo falhou e está vazio: erro com 'Tentar de novo' que busca o catálogo", async () => {
    lojaDaVez = { products: [], loadingProducts: false, catalogoErro: true };
    const texto = await renderizar();

    expect(texto).not.toContain("Você ainda não tem favoritos");
    expect(texto).toContain("Não conseguimos carregar");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    await act(async () => {
      tentar!.click();
    });
    expect(fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("catálogo carregou e nenhum id bate: o estado vazio continua lá", async () => {
    const texto = await renderizar();

    expect(texto).toContain("Você ainda não tem favoritos");
    expect(texto).not.toContain("Tentar de novo");
    expect(texto).not.toContain("sendo salvo");
  });

  it("favoritos retidos: mostra quantos faltam e 'Tentar agora' chama a retentativa", async () => {
    pendentesDaVez = 2;
    const texto = await renderizar();

    expect(texto).toContain("2 favoritos ainda estão sendo salvos");
    const tentarAgora = botao("Tentar agora");
    expect(tentarAgora).toBeDefined();
    await act(async () => {
      tentarAgora!.click();
    });
    expect(retentarPendentes).toHaveBeenCalledTimes(1);
  });

  it("um favorito retido: singular", async () => {
    pendentesDaVez = 1;
    const texto = await renderizar();

    expect(texto).toContain("1 favorito ainda está sendo salvo");
  });
});
