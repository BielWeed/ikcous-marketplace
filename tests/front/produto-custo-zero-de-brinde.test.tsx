// @vitest-environment jsdom
//
// Formulário de produto: o painel diz que custo R$ 0,00 (brinde) é permitido,
// mas o campo apagava qualquer zero e o produto saía "sem custo". Aqui:
//   - digitar 0 (ou 000) num produto sem custo e salvar grava custo 0;
//   - apagar o custo tecla por tecla até sobrar zero continua deixando o campo
//     vazio e salvando SEM custo (null), nunca 0.
//
// Montagem real (react-dom/client + jsdom), molde de produto-textos-avisos-e-botoes.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
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

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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
      id="product-category"
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
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
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

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null as number | null,
  originalPrice: null,
  stock: 3,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  codigoBarras: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `inputType` imita o navegador de verdade (digitar = insertText, Backspace = deleteContentBackward). */
async function digitarCampo(id: string, valor: string, inputType?: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  if (!el) throw new Error(`campo #${id} ausente`);
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(
      inputType === undefined
        ? new Event("input", { bubbles: true })
        : new InputEvent("input", { bubbles: true, inputType }),
    );
    await esperar(300);
  });
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const campoDeCusto = () =>
  document.getElementById("product-cost-price") as HTMLInputElement;

describe("AdminProductFormView — custo R$ 0,00 (brinde) vale", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
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

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          productId={productId}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    if (productId) {
      await act(async () => {
        await esperar(0);
        await esperar(0);
        await esperar(0);
      });
    }
  }

  async function salvarEdicao() {
    await act(async () => {
      botaoPorTexto("Salvar alterações")?.click();
      await esperar(100);
    });
  }

  it("produto sem custo: digitar 0 mostra 0,00 e salvar manda costPrice 0", async () => {
    fetchProduct.mockResolvedValue({ ...produtoDoBanco, costPrice: null });
    await montar("prod-1");
    expect(campoDeCusto().value).toBe("");
    await digitarCampo("product-cost-price", "0", "insertText");
    expect(campoDeCusto().value).toBe("0,00");
    await salvarEdicao();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ costPrice: 0 });
  });

  it("produto sem custo: digitar 000 também manda costPrice 0", async () => {
    fetchProduct.mockResolvedValue({ ...produtoDoBanco, costPrice: null });
    await montar("prod-1");
    await digitarCampo("product-cost-price", "0", "insertText");
    await digitarCampo("product-cost-price", "0,000", "insertText");
    await digitarCampo("product-cost-price", "0,0000", "insertText");
    expect(campoDeCusto().value).toBe("0,00");
    await salvarEdicao();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ costPrice: 0 });
  });

  it("produto novo: digitar 0 no custo e publicar manda costPrice 0", async () => {
    await montar();
    await digitarCampo("product-name", "Brinde", "insertText");
    await digitarCampo("product-description", "Descrição", "insertText");
    await digitarCampo("product-sale-price", "1000", "insertText");
    await digitarCampo("product-stock", "5", "insertText");
    await act(async () => {
      escolherCategoriaDoProduto("Geral");
      await esperar(50);
    });
    await digitarCampo("product-cost-price", "0", "insertText");
    await act(async () => {
      botaoPorTexto("Publicar")?.click();
      await esperar(100);
    });
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0].costPrice).toBe(0);
  });

  it("apagar o custo com Backspace, tecla por tecla, deixa vazio e salva SEM custo (null), não 0", async () => {
    fetchProduct.mockResolvedValue({ ...produtoDoBanco, costPrice: 12.5 });
    await montar("prod-1");
    expect(campoDeCusto().value).toBe("12,50");
    await digitarCampo("product-cost-price", "12,5", "deleteContentBackward");
    expect(campoDeCusto().value).toBe("1,25");
    await digitarCampo("product-cost-price", "1,2", "deleteContentBackward");
    expect(campoDeCusto().value).toBe("0,12");
    await digitarCampo("product-cost-price", "0,1", "deleteContentBackward");
    expect(campoDeCusto().value).toBe("0,01");
    await digitarCampo("product-cost-price", "0,0", "deleteContentBackward");
    expect(campoDeCusto().value).toBe("");
    await salvarEdicao();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ costPrice: null });
  });

  it("produto que já tinha custo 0 abre mostrando 0,00 e apagar o campo tira o custo", async () => {
    fetchProduct.mockResolvedValue({ ...produtoDoBanco, costPrice: 0 });
    await montar("prod-1");
    expect(campoDeCusto().value).toBe("0,00");
    await digitarCampo("product-cost-price", "0,0", "deleteContentBackward");
    expect(campoDeCusto().value).toBe("");
    await salvarEdicao();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ costPrice: null });
  });
});
