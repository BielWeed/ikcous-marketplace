// @vitest-environment jsdom
//
// Na tela de busca (/search) o botão do teclado do celular não fazia nada: o
// campo não tinha tecla "buscar" nem tratava o Enter, então o teclado ficava
// aberto cobrindo os resultados e a busca só aplicava depois de 300 ms. A barra
// do topo já tratava o Enter. Agora o campo da tela de busca: mostra a tecla
// "buscar" (enterKeyHint), aplica o termo na hora e tira o foco (fecha o
// teclado).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalogo: Product[] = [
  {
    id: "p1",
    name: "Bolsa Preta",
    description: "",
    price: 100,
    images: [],
    category: "Bolsas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
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
    <span>{product.id}</span>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — Enter no campo de busca", () => {
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

  async function abrir(onQueryChange: (q: string) => void) {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          onQueryChange={onQueryChange}
        />,
      );
    });
    return hospedeiro.querySelector("#search-input") as HTMLInputElement;
  }

  async function digitar(campo: HTMLInputElement, texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo.focus();
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("o teclado mostra a tecla 'buscar'", async () => {
    const campo = await abrir(() => {});
    // O jsdom não implementa a propriedade `enterKeyHint`: lê-se o atributo.
    expect(campo.getAttribute("enterkeyhint")).toBe("search");
  });

  it("Enter aplica o termo na hora e tira o foco do campo", async () => {
    const onQueryChange = vi.fn();
    const campo = await abrir(onQueryChange);
    await digitar(campo, "bolsa");
    onQueryChange.mockClear();
    expect(document.activeElement).toBe(campo);

    await act(async () => {
      campo.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    // Sem esperar os 300 ms da digitação.
    expect(onQueryChange).toHaveBeenCalledWith("bolsa");
    expect(document.activeElement).not.toBe(campo);
  });

  it("outra tecla não tira o foco", async () => {
    const campo = await abrir(() => {});
    await digitar(campo, "bolsa");

    await act(async () => {
      campo.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(campo);
  });
});
