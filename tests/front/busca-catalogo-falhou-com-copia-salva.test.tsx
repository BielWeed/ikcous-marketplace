// @vitest-environment jsdom

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
let catalogoErro = false;
const fetchProducts = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    catalogoErro,
    loadingProducts: false,
    fetchProducts,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
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

describe("SearchView — falha com cópia salva", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    catalogoErro = false;
    fetchProducts.mockReset();
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

  async function renderizarBusca(initialQuery: string) {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          initialQuery={initialQuery}
          onNavigate={() => {}}
          onBack={() => {}}
        />,
      );
    });
    return hospedeiro;
  }

  const idsNaTela = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-testid="resultado"]')).map(
      (el) => el.textContent,
    );

  it("avisa da falha em vez de anunciar zero resultados e permite tentar de novo", async () => {
    catalogo = [produto({ id: "vestido" })];
    catalogoErro = true;
    const host = await renderizarBusca("bolsa");

    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toContain(
      "Pode haver produtos novos que ainda não aparecem",
    );
    expect(host.textContent).not.toContain("Ué, nenhum resultado?");
    expect(host.textContent).not.toContain("Nenhum resultado para essa busca.");
    const tentar = Array.from(host.querySelectorAll("button")).find(
      (botao) => botao.textContent === "Tentar de novo",
    );
    expect(tentar).toBeDefined();
    await act(async () => {
      tentar?.click();
    });
    expect(fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("mantém a mensagem de nenhum resultado quando o catálogo está atualizado", async () => {
    catalogo = [produto({ id: "vestido" })];
    const host = await renderizarBusca("bolsa");

    expect(host.textContent).toContain("Ué, nenhum resultado?");
    expect(host.textContent).toContain(
      "Não encontramos o que você buscou com esses filtros.",
    );
    expect(host.textContent).toContain("Nenhum resultado para essa busca.");
    expect(host.textContent).not.toContain("Tentar de novo");
  });

  it("mantém os resultados que encontrou na cópia salva", async () => {
    catalogo = [
      produto({ id: "vestido" }),
      produto({ id: "bolsa", category: "Bolsas" }),
    ];
    catalogoErro = true;
    const host = await renderizarBusca("vestido");

    expect(idsNaTela(host)).toEqual(["vestido"]);
    expect(host.textContent).toContain("Encontramos 1 resultado");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("não anuncia loja vazia quando só há pausados na cópia e a carga falhou", async () => {
    catalogo = [produto({ id: "vestido", isActive: false })];
    catalogoErro = true;
    const host = await renderizarBusca("");

    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toContain(
      "Tentar de novo",
    );
    expect(host.textContent).not.toContain("A loja ainda não tem produtos");
  });
});
