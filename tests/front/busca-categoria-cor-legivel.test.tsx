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
        images: [],
        category: "Moda Vestidos",
        stock: 5,
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: "",
      },
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

it("a categoria usa a tinta legível, não a cor original da marca", async () => {
  const { SearchBar } = await import("@/components/ui/custom/SearchBar");
  const hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () =>
      raiz.render(<SearchBar value="vestido" onChange={() => {}} />),
    );
    await act(async () => hospedeiro.querySelector("input")!.focus());
    const categoria = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Moda Vestidos",
    );
    expect(categoria).toBeDefined();
    expect(categoria!.classList.contains("text-primary-legivel")).toBe(true);
    expect(categoria!.classList.contains("text-primary")).toBe(false);
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});
