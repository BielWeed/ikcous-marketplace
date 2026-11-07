// @vitest-environment jsdom
//
// A prévia "Na loja o cliente vai ver" lia só o preço base e o "De". A loja lê
// o MENOR preço entre as variações ativas com estoque (`precoDeVitrine`): com
// "Mini" a R$ 30 a vitrine mostra "a partir de R$ 30" e -57%, e com todas as
// variações acima do "De" não mostra promoção nenhuma. A prévia passa a usar a
// mesma função da loja, e avisa quando a promoção não vai aparecer.
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

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  precoProprio?: number,
) => ({
  id,
  productId: "p-1",
  name: "Tamanho",
  value: valor,
  stockIncrement: estoque,
  active: true,
  ...(precoProprio === undefined ? {} : { priceOverride: precoProprio }),
});

describe("AdminProductFormView — prévia da promoção com preço das variações", () => {
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
      originalPrice: 70,
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

  const previa = () =>
    document.querySelector(
      '[data-testid="previa-promocao"]',
    ) as HTMLElement | null;
  const aviso = () =>
    document.querySelector(
      '[data-testid="previa-promocao-sem-efeito"]',
    ) as HTMLElement | null;
  const texto = (el: HTMLElement | null) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();

  it("variação mais barata que o preço base: a prévia mostra 'a partir de' o menor preço e o desconto da loja (-57%)", async () => {
    await montarProduto([
      variacao("v1", "Mini", 5, 30),
      variacao("v2", "Normal", 5),
    ]);
    const caixa = previa();
    expect(caixa).not.toBeNull();
    expect(texto(caixa)).toContain("A partir de");
    expect(texto(caixa)).toContain("30,00");
    expect(texto(caixa)).toContain("70,00");
    expect(texto(caixa)).toContain("-57%");
    expect(texto(caixa)).not.toContain("-29%");
    expect(aviso()).toBeNull();
  });

  it("todas as variações acima do 'De': sem prévia de promoção e com aviso de que a loja não mostra", async () => {
    await montarProduto([variacao("v1", "Kit", 5, 90)]);
    expect(previa()).toBeNull();
    expect(texto(aviso())).toBe(
      "Com os preços das variações, a loja não mostra promoção.",
    );
  });

  it("variação esgotada não puxa o preço: vale o menor entre as que têm estoque", async () => {
    await montarProduto([
      variacao("v1", "Mini", 0, 30),
      variacao("v2", "Normal", 5),
    ]);
    const caixa = previa();
    expect(texto(caixa)).toContain("50,00");
    expect(texto(caixa)).toContain("-29%");
    expect(texto(caixa)).not.toContain("A partir de");
  });

  it("sem variações a prévia é a de sempre e não há aviso", async () => {
    await montarProduto([]);
    expect(texto(previa())).toContain("50,00");
    expect(texto(previa())).toContain("-29%");
    expect(texto(previa())).not.toContain("A partir de");
    expect(aviso()).toBeNull();
  });
});
