// @vitest-environment jsdom
//
// Painel do lojista — na lista de variações do produto, o preço próprio da
// variação aparecia com PONTO ("R$ 89.90") enquanto o resto do painel mostra
// dinheiro com vírgula ("R$ 89,90").
//
// O QUE MUDOU: a linha da variação passou a usar `formatCurrency`
// (src/lib/utils.ts), em vez de montar o texto com `Number(x).toFixed(2)`.
//
// Mesmo padrão de admin-product-form-desligar-e-religar-variacao-na-linha.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
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

const variacao = (id: string, valor: string, priceOverride: number | null) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: 3,
  active: true,
  priceOverride,
});

describe("AdminProductFormView — o preço próprio da variação usa vírgula", () => {
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

  async function montarProduto(variants: unknown[]) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 6,
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

  const textoDaLinha = (valor: string) => {
    const nome = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes(valor));
    if (!nome)
      throw new Error(`Linha da variação "${valor}" não está na tela.`);
    return (nome.closest(".group")?.textContent ?? "").replace(/\s+/g, " ");
  };

  it("R$ 89,90 aparece com vírgula, nunca R$ 89.90", async () => {
    await montarProduto([variacao("v1", "Rosa", 89.9)]);

    const texto = textoDaLinha("Rosa");
    expect(texto).toContain("R$ 89,90");
    expect(texto).not.toContain("89.90");
  });

  it("preço inteiro também mostra os centavos (R$ 60,00)", async () => {
    await montarProduto([variacao("v1", "Azul", 60)]);

    const texto = textoDaLinha("Azul");
    expect(texto).toContain("R$ 60,00");
    expect(texto).not.toContain("60.00");
  });

  it("variação sem preço próprio continua sem mostrar preço", async () => {
    await montarProduto([variacao("v1", "Verde", null)]);

    expect(textoDaLinha("Verde")).not.toContain("R$");
  });
});
