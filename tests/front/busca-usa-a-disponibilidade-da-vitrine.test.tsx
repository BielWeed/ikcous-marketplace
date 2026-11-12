// @vitest-environment jsdom
//
// Produto com dois grupos de opção (Cor e Tamanho) em que um grupo inteiro está
// zerado NÃO tem como ser comprado, mesmo que a soma do estoque seja positiva.
// O card da vitrine e a Home já respondem pela regra única `produtoDisponivel`
// (src/lib/vitrine.ts); a busca (caixinha do topo, lista /search e as
// "Sugestões" do estado vazio) ordenava e rotulava pela SOMA (`stock > 0`) e
// discordava: sem a etiqueta "Esgotado" e à frente de produto que tem para
// vender.
import { act, useEffect } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearch } from "@/hooks/useSearch";
import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const opcao = (
  nome: string,
  valor: string,
  estoque: number,
): ProductVariant => ({
  id: `${nome}-${valor}`,
  productId: "p",
  name: nome,
  value: valor,
  stockIncrement: estoque,
  active: true,
});

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

// Cor (Azul 3, Verde 0) + Tamanho (P 0, M 0): a soma é 3, mas o grupo Tamanho
// está inteiro zerado, então ninguém leva o produto.
const esgotadoDeVerdade = (id: string, name: string, createdTime: number) =>
  produto({
    id,
    name,
    createdTime,
    stock: 3,
    variants: [
      opcao("Cor", "Azul", 3),
      opcao("Cor", "Verde", 0),
      opcao("Tamanho", "P", 0),
      opcao("Tamanho", "M", 0),
    ],
  });

const comEstoque = (id: string, name: string, createdTime: number) =>
  produto({ id, name, createdTime, stock: 2 });

let catalogo: Product[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="resultado">{product.id}</span>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("busca: a mesma regra de disponibilidade do card e da Home", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("lista /search (useSearch): o esgotado de verdade vai atrás do que tem para vender, mesmo sendo mais novo", async () => {
    let ultimo: ReturnType<typeof useSearch>;
    function Sonda({ produtos }: { produtos: Product[] }) {
      const retorno = useSearch(produtos);
      useEffect(() => {
        ultimo = retorno;
      });
      return null;
    }
    await act(async () =>
      raiz.render(
        <Sonda
          produtos={[
            esgotadoDeVerdade("esgotado", "Vestido Alfa", 9000),
            comEstoque("disponivel", "Vestido Beta", 1000),
          ]}
        />,
      ),
    );
    expect(ultimo!.filteredProducts.map((p) => p.id)).toEqual([
      "disponivel",
      "esgotado",
    ]);
  });

  it("caixinha do topo: rotula 'Esgotado' e põe o que tem para vender na frente", async () => {
    catalogo = [
      esgotadoDeVerdade("esgotado", "Vestido Alfa", 9000),
      comEstoque("disponivel", "Vestido Beta", 1000),
    ];
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value="vestido" onChange={() => {}} />);
    });
    const campo = host.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const texto = host.textContent ?? "";
    expect(texto.indexOf("Vestido Beta")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("Vestido Beta")).toBeLessThan(
      texto.indexOf("Vestido Alfa"),
    );
    expect(texto.match(/Esgotado/g)).toHaveLength(1);
    expect(texto.indexOf("Esgotado")).toBeGreaterThan(
      texto.indexOf("Vestido Alfa"),
    );
  });

  it("Sugestões do estado vazio: o esgotado de verdade não abre a lista", async () => {
    catalogo = [
      esgotadoDeVerdade("esgotado", "Vestido Alfa", 9000),
      comEstoque("disponivel", "Vestido Beta", 1000),
    ];
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="zzzxyz"
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const ids = Array.from(
      host.querySelectorAll('[data-testid="resultado"]'),
    ).map((el) => el.textContent);
    expect(ids).toEqual(["disponivel", "esgotado"]);
  });
});
