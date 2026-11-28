// @vitest-environment jsdom
//
// "Descartar" do aviso de rascunho antigo do produto, com o Sonner DE VERDADE.
//
// O defeito (revisão do PR #2050): no Sonner 2.0.8 o botão `cancel` do aviso
// sai sem fazer nada quando o aviso não é `dismissible`. O aviso do rascunho
// antigo nascia com `dismissible: false` + `duration: Infinity`: tocar
// "Descartar" não apagava o rascunho nem fechava o aviso, e o salvamento
// automático ficava travado esperando uma decisão que o botão não registrava.
// Os testes com o `toast` dublado chamavam o `onClick` direto e não viam isso.
// (Harness do admin-product-form-rascunho-antigo-espera-a-decisao, sem o
// dublê do `sonner`.)
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";

const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous_product_form_draft_edit_prod-edit-1:lojista-1";

const produtoDoBanco = {
  id: "prod-edit-1",
  name: "Produto Existente",
  description: "Descrição existente",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

const rascunhoAntigo = JSON.stringify({ name: "Produto com rascunho antigo" });

describe("AdminProductFormView — Descartar o rascunho antigo no Sonner real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoDoBanco);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    armazem.set(CHAVE, rascunhoAntigo);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    // jsdom não traz matchMedia; o Sonner e o next-themes perguntam por ele.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function abrirProduto() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <>
          <AdminProductFormView
            userId="lojista-1"
            productId="prod-edit-1"
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />
          <Toaster />
        </>,
      );
    });
    for (let i = 0; i < 3; i++) await passar(0);
    await passar(100);
  }

  const botaoDoAviso = (rotulo: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-sonner-toast] button",
      ),
    ].find((b) => b.textContent?.trim() === rotulo);

  it("o aviso não fecha por gesto (arrastar mataria o salvamento automático)", async () => {
    await abrirProduto();
    const aviso = document.querySelector("[data-sonner-toast]");
    expect(aviso).not.toBeNull();
    expect(aviso?.getAttribute("data-dismissible")).toBe("false");
  });

  it("tocar Descartar apaga o rascunho antigo", async () => {
    await abrirProduto();
    const descartar = botaoDoAviso("Descartar");
    expect(descartar).toBeDefined();

    await act(async () => {
      descartar?.click();
    });
    await passar(100);

    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("controle: tocar Restaurar põe o rascunho no formulário", async () => {
    await abrirProduto();
    const restaurar = botaoDoAviso("Restaurar");
    expect(restaurar).toBeDefined();

    await act(async () => {
      restaurar?.click();
    });
    await passar(100);

    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Produto com rascunho antigo");
  });
});
