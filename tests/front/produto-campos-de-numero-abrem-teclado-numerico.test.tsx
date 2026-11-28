// @vitest-environment jsdom
//
// No celular, os campos de número do cadastro de produto abrem o teclado de
// números: estoque (do produto e da variação) só dígitos ("numeric"); peso e
// medidas aceitam vírgula ("decimal"). Sem `inputMode`, o iPhone abria o
// teclado de letras nesses campos. O molde é o "Avisar quando o estoque chegar
// a" (`product-estoque-minimo`). A grade (LinhasDaGrade) tem o teste no
// arquivo dela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const modoDoTeclado = (id: string) => {
  const campo = document.getElementById(id);
  if (!campo) throw new Error(`Campo "${id}" não está na tela.`);
  return campo.getAttribute("inputmode");
};

describe("cadastro de produto — campos de número abrem o teclado numérico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  it("estoque do produto: só dígitos", async () => {
    await montar();
    expect(modoDoTeclado("product-stock")).toBe("numeric");
  });

  it.each([
    "product-weight",
    "product-width",
    "product-height",
    "product-length",
  ])("%s aceita vírgula: teclado decimal", async (id) => {
    await montar();
    expect(modoDoTeclado(id)).toBe("decimal");
  });

  it("estoque da variação: só dígitos", async () => {
    await montar();
    const novo = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "+ Novo",
    );
    if (!novo) throw new Error('Botão "+ Novo" não está na tela.');
    await act(async () => {
      novo.click();
    });
    expect(modoDoTeclado("variant-stock")).toBe("numeric");
  });
});
