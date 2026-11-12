// @vitest-environment jsdom
//
// Defeito: o texto de dica (placeholder) do campo de busca ("O que você deseja
// hoje?") e do campo de avaliação ("Conte-nos os detalhes...") era
// `placeholder:text-zinc-400` sobre `bg-zinc-50`: ~2,46:1, abaixo do mínimo AA
// (4,5:1). Placeholder também conta, porque é a única instrução do campo vazio.
//
// O teste calcula a razão WCAG a partir das classes que o componente de fato
// renderiza (contraste-das-classes.ts), contra o fundo real do campo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corDaClasse, razao } from "./contraste-das-classes";

import type { Product } from "@/types";
import type { ReactNode } from "react";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] as Product[] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
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
  ProductCard: () => null,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: vi.fn() }),
}));

const AA = 4.5;

describe("placeholders da busca e da avaliação (contraste AA)", () => {
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

  // O campo desenha a própria cor de fundo (`bg-zinc-50`): a razão é medida
  // contra ela, que é o que fica atrás do texto de dica.
  function razaoDoPlaceholder(campo: Element) {
    const fundo = corDaClasse(campo.className, "bg", [255, 255, 255]);
    const dica = corDaClasse(campo.className, "placeholder:text", fundo);
    return razao(dica, fundo);
  }

  it("busca: 'O que você deseja hoje?' passa de 4,5:1 sobre o fundo do campo", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
    const campo = hospedeiro.querySelector("#search-input") as HTMLElement;
    expect(campo?.getAttribute("placeholder")).toBe("O que você deseja hoje?");
    expect(razaoDoPlaceholder(campo), campo.className).toBeGreaterThanOrEqual(
      AA,
    );
  });

  it("avaliação: o placeholder do comentário passa de 4,5:1 sobre o fundo do campo", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" />);
    });
    const campo = hospedeiro.querySelector("textarea") as HTMLElement;
    expect(campo?.getAttribute("placeholder")).toContain(
      "Conte-nos os detalhes",
    );
    expect(razaoDoPlaceholder(campo), campo.className).toBeGreaterThanOrEqual(
      AA,
    );
  });
});
