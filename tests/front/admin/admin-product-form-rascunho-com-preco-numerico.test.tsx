// @vitest-environment jsdom
import {
  chaveDoRascunhoDoProduto,
  serializarRascunhoDoProduto,
} from "@/lib/rascunho-do-produto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ fetchProduct: vi.fn(), updateProduct: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

it("reabre um rascunho de produto novo com preço numérico sem avisar sobre mudança de preço", async () => {
  const userId = "lojista-1";
  const chave = chaveDoRascunhoDoProduto(userId);
  if (!chave) throw new Error("sem chave de rascunho");
  const armazem = new Map([
    [
      chave,
      serializarRascunhoDoProduto({
        name: "Vestido do rascunho",
        category: "Geral",
        price: 14.9,
        costPrice: 20,
      }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      armazem.set(k, v);
    },
    removeItem: (k: string) => {
      armazem.delete(k);
    },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);

  try {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId={userId}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });

    expect(
      hospedeiro.querySelector<HTMLInputElement>("#product-name")?.value,
    ).toBe("Vestido do rascunho");
    const avisos = [...hospedeiro.querySelectorAll('[role="status"]')].map(
      (el) => el.textContent,
    );
    expect(avisos).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Confira:")]),
    );
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  }
});
