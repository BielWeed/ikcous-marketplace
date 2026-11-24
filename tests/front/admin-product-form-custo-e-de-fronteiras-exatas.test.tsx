// @vitest-environment jsdom
//
// Fronteiras exatas das contas de preço do formulário de produto, que os testes
// de tela só cobriam de um lado:
//  - custo IGUAL ao preço de venda já é prejuízo (lucro zero): aparece o aviso
//    âmbar, mas o aviso NÃO bloqueia o Salvar; custo um centavo abaixo não avisa;
//  - custo R$ 0,00 é custo válido (brinde, produto sem custo): sem erro, sem aviso;
//  - preço de antes ("De") IGUAL ao preço de venda não é promoção (erro e Salvar
//    desligado); um centavo acima já é promoção;
//  - preço de venda R$ 0,00 diz a frase certa e desliga o Salvar.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  updateProduct: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: mocks.updateProduct,
    salvarProdutoComGrade: vi
      .fn()
      .mockResolvedValue({ produto: undefined, recusadas: [] }),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) throw new Error(`Campo "${id}" não está na tela.`);
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // O campo só entrega o valor ao formulário depois de uma pausa.
    await new Promise((r) => setTimeout(r, 300));
  });
}

const textoDe = (id: string): string | null =>
  document.getElementById(id)?.textContent ?? null;

const botaoSalvar = () =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Salvar alterações",
  ) as HTMLButtonElement | undefined;

// O preço do produto montado é R$ 50,00; na máscara de moeda, "5000" = 50,00.
const PRECO = "5000";
const UM_CENTAVO_ABAIXO = "4999";
const UM_CENTAVO_ACIMA = "5001";
const ERRO_DO_DE = 'Preço de antes ("De") deve ser maior que o preço de venda.';

describe("AdminProductFormView — fronteiras exatas de custo, preço de antes e preço zero", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProduct.mockResolvedValue({ id: "p-1" });
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
    vi.restoreAllMocks();
  });

  async function montar() {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      costPrice: null,
      originalPrice: null,
      stock: 5,
      sold: 0,
      category: "Geral",
      images: ["https://exemplo.test/camiseta.jpg"],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [] as unknown[],
    });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  describe("custo", () => {
    it("custo IGUAL ao preço avisa do prejuízo, mas não trava o Salvar", async () => {
      await montar();
      await digitarCampo("product-cost-price", PRECO);

      expect(textoDe("product-cost-error")).toBe(
        "Aviso: Preço de custo é maior ou igual ao preço de venda (prejuízo!).",
      );
      expect(botaoSalvar()?.disabled).toBe(false);
    });

    it("custo um centavo ABAIXO do preço não avisa nada", async () => {
      await montar();
      await digitarCampo("product-cost-price", UM_CENTAVO_ABAIXO);

      expect(document.getElementById("product-cost-error")).toBeNull();
      expect(botaoSalvar()?.disabled).toBe(false);
    });

    it("custo um centavo ACIMA do preço também avisa, sem travar", async () => {
      await montar();
      await digitarCampo("product-cost-price", UM_CENTAVO_ACIMA);

      expect(textoDe("product-cost-error")).toContain("Aviso:");
      expect(botaoSalvar()?.disabled).toBe(false);
    });

    it("custo R$ 0,00 é custo válido: sem erro, sem aviso", async () => {
      await montar();
      await digitarCampo("product-cost-price", "0");

      expect(document.getElementById("product-cost-error")).toBeNull();
      expect(botaoSalvar()?.disabled).toBe(false);
    });
  });

  describe("preço de antes (De)", () => {
    async function ligarAPromocao() {
      await act(async () => {
        (
          document.getElementById("product-promo-active") as HTMLInputElement
        ).click();
      });
    }

    it("'De' IGUAL ao preço de venda não é promoção: erro e Salvar desligado", async () => {
      await montar();
      await ligarAPromocao();
      await digitarCampo("product-original-price", PRECO);

      expect(document.body.textContent).toContain(ERRO_DO_DE);
      expect(botaoSalvar()?.disabled).toBe(true);
    });

    it("'De' um centavo ACIMA do preço já é promoção: sem erro e Salvar liberado", async () => {
      await montar();
      await ligarAPromocao();
      await digitarCampo("product-original-price", UM_CENTAVO_ACIMA);

      expect(document.body.textContent).not.toContain(ERRO_DO_DE);
      expect(botaoSalvar()?.disabled).toBe(false);
    });

    it("'De' um centavo ABAIXO do preço: erro e Salvar desligado", async () => {
      await montar();
      await ligarAPromocao();
      await digitarCampo("product-original-price", UM_CENTAVO_ABAIXO);

      expect(document.body.textContent).toContain(ERRO_DO_DE);
      expect(botaoSalvar()?.disabled).toBe(true);
    });
  });

  describe("preço de venda zero", () => {
    it("R$ 0,00 no preço de venda: diz que tem de ser maior que zero e desliga o Salvar", async () => {
      await montar();
      await digitarCampo("product-sale-price", "0");

      expect(textoDe("product-price-error")).toBe(
        "Preço de venda deve ser maior que zero.",
      );
      expect(botaoSalvar()?.disabled).toBe(true);
      await act(async () => {
        botaoSalvar()?.click();
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(mocks.updateProduct).not.toHaveBeenCalled();
    });
  });
});
