// @vitest-environment jsdom
//
// A lojista pausa um produto ("Pausar Produto", grava `ativo = false`). Na
// barra de busca (SearchBar.tsx) a sugestão some, na vitrine (HomeView) some,
// e nas "Tendências" do estado vazio desta mesma tela (SearchView) também —
// mas ao apertar Enter a tela de RESULTADOS continuava listando o pausado,
// contando ele em "Encontramos N resultados" e ainda oferecendo como chip
// uma categoria que só o pausado tinha (tocar nela: um resultado pausado).
//
// Quem vê: o catálogo que `useProducts` carrega para a dona da loja vem da
// vista `vw_produtos_admin`, que traz pausados — a vista pública
// (`vw_produtos_public`) já filtra `ativo = true`. Ou seja, é a dona
// conferindo a própria loja que vê o que a cliente não veria, e a busca
// passa a discordar da vitrine sobre o que está à venda.
//
// POR QUE O ProductCard É DUBLÊ: o que está em dúvida é QUAL lista a tela
// calcula, não como um card é desenhado. O dublê só expõe o id recebido.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// limpar-tudo-limpa-de-verdade.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(p: Partial<Product> & Pick<Product, "id">): Product {
  return {
    name: p.id,
    description: "",
    price: 100,
    images: [],
    category: "Vestidos",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...p,
  };
}

let catalogo: Product[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="resultado">{product.id}</span>
  ),
}));
// Painel "Refinar Busca" fechado: o Radix real pede APIs que o jsdom não tem
// (ver limpar-tudo-limpa-de-verdade.test.tsx). Os chips de categoria medidos
// aqui ficam FORA do painel, na fileira de filtros rápidos.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — produto pausado não aparece nos resultados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderizarBusca() {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
    return hospedeiro;
  }

  const idsNaTela = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-testid="resultado"]')).map(
      (el) => el.textContent,
    );
  const chips = (host: HTMLElement) =>
    Array.from(host.querySelectorAll("button")).map((b) => b.textContent);

  it("lista só o ativo, conta só o ativo e não oferece a categoria que só o pausado tinha", async () => {
    catalogo = [
      produto({ id: "vestido-ativo", category: "Vestidos" }),
      produto({ id: "bolsa-pausada", category: "Bolsas", isActive: false }),
    ];
    const host = await renderizarBusca();

    expect(idsNaTela(host)).toEqual(["vestido-ativo"]);
    expect(host.textContent).toContain("Encontramos 1 resultados");
    expect(chips(host)).toContain("Vestidos");
    expect(chips(host)).not.toContain("Bolsas");
  });

  it("controle: com os dois ativos, os dois aparecem — o filtro é o `isActive`, não a categoria", async () => {
    catalogo = [
      produto({ id: "vestido-ativo", category: "Vestidos" }),
      produto({ id: "bolsa-ativa", category: "Bolsas" }),
    ];
    const host = await renderizarBusca();

    expect(idsNaTela(host).sort()).toEqual(["bolsa-ativa", "vestido-ativo"]);
    expect(host.textContent).toContain("Encontramos 2 resultados");
    expect(chips(host)).toContain("Bolsas");
  });
});
