// @vitest-environment jsdom
//
// Nome ou descrição só com espaços não contam como preenchidos. Antes, o
// formulário dizia "Tudo pronto para publicar" com a descrição em branco (um
// espaço), e na gravação o texto era aparado e o produto ficava SEM descrição,
// mesmo sendo campo obrigatório. Agora o botão, a frase do que falta e o
// contador de essenciais tratam "   " como vazio.
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  if (!el) throw new Error(`campo #${id} ausente`);
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

async function preencherOBasico() {
  await digitarCampo("product-name", "Produto Teste");
  await digitarCampo("product-description", "Descrição de teste");
  await digitarCampo("product-sale-price", "1000");
  await digitarCampo("product-stock", "5");
  await act(async () => {
    escolherCategoriaDoProduto("Geral");
    await esperar(50);
  });
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const textoDaTela = () => document.body.textContent ?? "";

describe("AdminProductFormView — nome e descrição só com espaços", () => {
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

  it("controle: com tudo preenchido de verdade, o Publicar fica ligado e conta 5 de 5", async () => {
    await montar();
    await preencherOBasico();
    expect(botaoPorTexto("Publicar")?.disabled).toBe(false);
    expect(textoDaTela()).toContain("5 de 5 essenciais prontos");
  });

  it("descrição só com espaços: Publicar desligado, 'falta preencher: descrição' e 4 de 5", async () => {
    await montar();
    await preencherOBasico();
    await digitarCampo("product-description", "   ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: descrição");
    expect(textoDaTela()).toContain("4 de 5 essenciais prontos");
    expect(addProduct).not.toHaveBeenCalled();
  });

  it("nome só com espaços: Publicar desligado, 'falta preencher: nome' e 4 de 5", async () => {
    await montar();
    await preencherOBasico();
    await digitarCampo("product-name", "   ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: nome");
    expect(textoDaTela()).toContain("4 de 5 essenciais prontos");
  });

  it("espaço não-quebrável (colado de outro lugar) também conta como vazio", async () => {
    await montar();
    await preencherOBasico();
    await digitarCampo("product-description", "  ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: descrição");
  });

  it("borda: texto com espaços nas pontas continua valendo e é salvo aparado", async () => {
    await montar();
    await preencherOBasico();
    await digitarCampo("product-description", "  com espaços  ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(false);
    await act(async () => {
      botaoPorTexto("Publicar")?.click();
      await esperar(100);
    });
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0]).toMatchObject({
      description: "com espaços",
    });
  });

  it("editando: trocar a descrição existente por um espaço desliga o Salvar", async () => {
    await montar("prod-1");
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
    await digitarCampo("product-description", " ");
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: descrição");
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
