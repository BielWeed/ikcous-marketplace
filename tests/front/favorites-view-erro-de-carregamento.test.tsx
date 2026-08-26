// @vitest-environment jsdom
//
// Falha de fetch não é lista de desejos vazia.
//
// Até 25/08/2026 o catch do fetch de favoritos só fazia console.error: com a
// rede caída, a tela dizia "Sua lista de desejos tá tão vazia... 💕" para uma
// lista que a consulta não conseguiu trazer — dado emocional sumindo sem
// aviso, com cara de "você nunca favoritou nada". Este teste prende o ramo
// de erro: com `erro` no contexto e lista vazia, a tela diz "Não conseguimos
// carregar" com retry; o coração vazio fica para a lista vazia DE VERDADE.
//
// Vermelho analítico contra o HEAD: o componente antigo não lê `erro`
// nenhum — com este mock renderizaria o estado "tão vazia" e a asserção de
// ausência reprovaria (mesma declaração de método do
// notifications-view-erro-de-carregamento.test.tsx).
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
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: [] as Product[] }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FavoritesView — erro de carregamento não é 'tão vazia'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("com erro e lista vazia: mensagem de erro com retry, nunca 'tão vazia'", async () => {
    erroDaVez = "Não conseguimos carregar seus favoritos.";
    const texto = await renderizar();

    expect(texto).toContain("Não conseguimos carregar");
    expect(texto).toContain("Tentar de novo");
    expect(texto).not.toContain("tão vazia");

    const retry = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.click();
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("sem erro e lista vazia DE VERDADE: o 'tão vazia' continua lá", async () => {
    erroDaVez = null;
    const texto = await renderizar();

    expect(texto).toContain("tão vazia");
    expect(texto).not.toContain("Tentar de novo");
  });
});
