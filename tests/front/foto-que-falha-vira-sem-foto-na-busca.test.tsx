import type { Product } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      {
        id: "vestido",
        name: "Vestido",
        description: "",
        price: 100,
        images: ["https://loja.example/vestido.jpg"],
        category: "Vestidos",
        stock: 5,
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: "",
      } satisfies Product,
    ],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ loadingProducts: false, catalogoErro: false }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("SearchBar troca foto que falha por Sem foto", async () => {
  const { SearchBar } = await import("@/components/ui/custom/SearchBar");
  const hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () =>
      raiz.render(<SearchBar value="vestido" onChange={() => {}} />),
    );
    await act(async () => {
      hospedeiro.querySelector("input")!.focus();
    });
    const foto = hospedeiro.querySelector("img")!;
    expect(foto).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Sem foto");
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain("Sem foto");
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});
