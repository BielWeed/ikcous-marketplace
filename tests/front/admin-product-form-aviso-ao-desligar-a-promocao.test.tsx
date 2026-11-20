// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi
      .fn()
      .mockResolvedValue({ produto: undefined, recusadas: [] }),
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
describe("AdminProductFormView — aviso ao desligar a promoção", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function montarProduto(
    originalPrice: number | null,
    variants: unknown[] = [],
  ) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 80,
      originalPrice,
      stock: 10,
      category: "Geral",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants,
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

  const interruptor = () =>
    document.getElementById("product-promo-active") as HTMLInputElement;

  async function alternarPromocao() {
    await act(async () => interruptor().click());
  }

  const aviso = () =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Desligar a promoção só tira o preço riscado."),
    );

  it("mostra o preço que permanece e o preço de antes ao desligar", async () => {
    await montarProduto(100);
    expect(interruptor().checked).toBe(true);
    expect(aviso()).toBeUndefined();

    await alternarPromocao();

    const texto = aviso()?.textContent?.replace(/\s+/g, " ");
    expect(texto).toContain("O preço de venda continua R$ 80,00.");
    expect(texto).toContain("ponha R$ 100,00 no preço de venda.");
  });

  it("some ao restaurar o preço de antes", async () => {
    await montarProduto(100);
    await alternarPromocao();
    expect(aviso()).toBeDefined();

    await act(async () => {
      const campo = document.getElementById(
        "product-sale-price",
      ) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "10000");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      expect(campo.value).toBe("100,00");
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(aviso()).toBeUndefined();
  });

  it("não mostra preço zerado como o preço que continua valendo", async () => {
    await montarProduto(100);
    await alternarPromocao();
    expect(aviso()).toBeDefined();

    await act(async () => {
      const campo = document.getElementById(
        "product-sale-price",
      ) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "0");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(aviso()).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("continua R$ 0,00");
  });

  it("some ao religar a promoção", async () => {
    await montarProduto(100);
    await alternarPromocao();
    expect(aviso()).toBeDefined();

    await alternarPromocao();

    expect(interruptor().checked).toBe(true);
    expect(aviso()).toBeUndefined();
  });

  it("não avisa se o produto abriu sem promoção", async () => {
    await montarProduto(null);
    expect(interruptor().checked).toBe(false);
    expect(aviso()).toBeUndefined();

    await alternarPromocao();
    expect(interruptor().checked).toBe(true);
    expect(aviso()).toBeUndefined();

    await alternarPromocao();
    expect(interruptor().checked).toBe(false);
    expect(aviso()).toBeUndefined();
  });

  it("lembra de conferir opções que têm preço próprio", async () => {
    await montarProduto(100, [
      {
        id: "v-1",
        productId: "p-1",
        name: "Tamanho",
        value: "Mini",
        stockIncrement: 5,
        priceOverride: 70,
        active: true,
      },
    ]);

    await alternarPromocao();

    expect(aviso()?.textContent).toContain("confira o preço de cada opção");
  });
});
