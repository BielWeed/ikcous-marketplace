// @vitest-environment jsdom
//
// Lado do FORMULÁRIO do conserto "depois de cadastrar, o produto novo pode não
// aparecer na lista": só um produto NOVO, criado de verdade, deixa o aviso para
// a lista (`src/utils/produto-recem-cadastrado.ts`). Editar um produto que já
// existia não deixa — a lista segue lembrando a página dela.
//
// O lado da LISTA está em admin-products-abre-na-pagina-1-apos-cadastrar.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  fetchProduct: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
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

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const botaoPorTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

describe("AdminProductFormView — só produto NOVO avisa a lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.updateProduct.mockResolvedValue(undefined);
    mocks.upsertVariants.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    // O aviso é de módulo: começa cada teste zerado.
    const { consumirProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
    );
    consumirProdutoNovoCadastrado();
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

  it("cadastrar um produto NOVO deixa o aviso para a lista (uma vez só)", async () => {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    const { consumirProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      digitar("product-sale-price", "5000");
      digitar("product-stock", "3");
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });

    await act(async () => {
      botaoPorTexto("Publicar")?.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mocks.addProduct).toHaveBeenCalledTimes(1);
    expect(consumirProdutoNovoCadastrado()).toBe(true);
    expect(consumirProdutoNovoCadastrado()).toBe(false);
  });

  it("salvar a edição de um produto que já existia NÃO deixa o aviso", async () => {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 5,
      sold: 0,
      category: "Geral",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    const { consumirProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
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
    await act(async () => {
      digitar("product-sale-price", "60,00");
      await new Promise((r) => setTimeout(r, 300));
    });

    await act(async () => {
      botaoPorTexto("Salvar")?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    expect(mocks.addProduct).not.toHaveBeenCalled();
    expect(consumirProdutoNovoCadastrado()).toBe(false);
  });
});
