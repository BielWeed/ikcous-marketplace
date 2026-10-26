// @vitest-environment jsdom
//
// Galeria de categorias do formulário de produto: só aparecem as categorias que
// estão à mostra na loja (as escondidas saem da escolha), com o ícone que a
// lojista salvou. Um produto que JÁ tem uma categoria escondida continua com o
// nome dela no campo — editar o preço não pode apagar a categoria dele.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoriaMostradaNoCampo } from "./helpers/escolher-categoria-do-produto";

const fetchProduct = vi.fn();
const rpcMock = vi.fn();
const { categoriasDoBanco } = vi.hoisted(() => ({
  categoriasDoBanco: {
    lista: [] as Array<{
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      icone?: string | null;
      iconeForma?: string | null;
    }>,
  },
}));

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
    categories: categoriasDoBanco.lista,
    isLoading: false,
    addCategory: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
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

const cartoes = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button[aria-pressed]',
    ),
  ].map((b) => (b.textContent ?? "").trim());

describe("AdminProductFormView — a galeria só oferece categorias à mostra na loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sem rede")));
    categoriasDoBanco.lista = [
      { id: "c1", name: "Geral", slug: "geral", isActive: true },
      { id: "c2", name: "Outlet", slug: "outlet", isActive: false },
      {
        id: "c3",
        name: "Xpto",
        slug: "xpto",
        isActive: true,
        icone: "pet",
      },
      {
        id: "c4",
        name: "Yzw",
        slug: "yzw",
        isActive: true,
        iconeForma: "M3 3h8l10 10",
      },
    ];
    rpcMock.mockResolvedValue({ data: [], error: null });
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 5,
      sold: 0,
      category: "Outlet",
      images: ["https://cdn.exemplo.com/products/foto.jpg"],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("produto cuja categoria foi escondida: o campo mostra o nome, e a folha não oferece a escondida", async () => {
    await montar();
    expect(categoriaMostradaNoCampo()).toBe("Outlet");
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    expect(cartoes()).toEqual(["Geral", "Xpto", "Yzw"]);
    // nenhum cartão aparece marcado: a categoria do produto não está na lista
    expect(
      document.querySelector('[role="dialog"] [aria-pressed="true"]'),
    ).toBeNull();
  });

  it("cada cartão leva o ícone que a lojista salvou (chave ou forma)", async () => {
    await montar();
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    const icone = (nome: string) =>
      [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')]
        .find((b) => (b.textContent ?? "").trim() === nome)
        ?.querySelector("svg")
        ?.getAttribute("data-icone");
    expect(icone("Xpto")).toBe("pet");
    expect(icone("Yzw")).toBe("forma");
  });
});
