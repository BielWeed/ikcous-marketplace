// @vitest-environment jsdom
//
// Defeito reportado pelo Gabriel em 01/09: com a lista de favoritos vazia,
// a seção "Destaques da Loja / Mais Amados da Loja" mostrava produtos
// PAUSADOS no painel admin.
//
// O mecanismo: as sugestões usam a lista `products` do contexto sem
// filtrar. Para o CLIENTE a lista já nasce da view pública (só ativos),
// mas para o DONO da loja — logado como admin — o cofre guarda o catálogo
// INTEIRO (inclusive pausados), e a vitrine dele acabava anunciando
// produto que a loja nem está vendendo. Conserto: a sugestão só sugere
// produto ATIVO — quem pausou não quer ele em vitrine nenhuma, nem na
// própria.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const refresh = vi.fn();

let productsDaLoja: Product[] = [];

vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { name: string } }) => (
    <div data-testid="sugestao">{product.name}</div>
  ),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    isFavorite: () => false,
    loading: false,
    erro: null,
    refresh,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: productsDaLoja }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ativo = (id: string, name: string) =>
  ({ id, name, isActive: true, price: 10 }) as unknown as Product;
const pausado = (id: string, name: string) =>
  ({ id, name, isActive: false, price: 10 }) as unknown as Product;

describe("FavoritesView — sugestões não anunciam produto pausado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  type ViewMod = typeof import("@/views/customer/FavoritesView");
  let FavoritesView: ViewMod["FavoritesView"];

  beforeEach(async () => {
    ({ FavoritesView } = await import("@/views/customer/FavoritesView"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("pausado na lista do cofre não entra nas sugestões; ativos entram", async () => {
    productsDaLoja = [
      ativo("a1", "Calça Ativa Um"),
      pausado("p1", "Bolsa Pausada"),
      ativo("a2", "Calça Ativa Dois"),
    ];

    const texto = await renderizar();

    expect(texto).toContain("Calça Ativa Um");
    expect(texto).toContain("Calça Ativa Dois");
    expect(texto).not.toContain("Bolsa Pausada");
    const sugestoes = hospedeiro.querySelectorAll("[data-testid='sugestao']");
    expect(sugestoes.length).toBe(2);
  });

  it("quando TODO o catálogo está pausado, a seção de sugestões nem aparece", async () => {
    productsDaLoja = [
      pausado("p1", "Bolsa Pausada Um"),
      pausado("p2", "Bolsa Pausada Dois"),
    ];

    const texto = await renderizar();

    expect(texto).not.toContain("Bolsa Pausada Um");
    expect(texto).not.toContain("Mais Amados da Loja");
  });
});
