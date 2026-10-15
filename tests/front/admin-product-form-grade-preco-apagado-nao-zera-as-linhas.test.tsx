// @vitest-environment jsdom
//
// Grade de variações, passo 2: o campo "Aplicar para todas" (preço) e o preço
// de cada linha usam a máscara de moeda, que nunca deixa o campo vazio —
// apagar o "0,05" com backspace dá "0,00". Aquele "0,00" passava no botão
// "Aplicar para todas" (`limparNumero(...) || linha.preco`: "0.00" é texto não
// vazio) e zerava TODAS as linhas: a loja passava a vender cada combinação por
// R$ 0,00.
//
// Regra: zero não é preço próprio. O campo apagado fica vazio, o botão só
// aplica preço maior que zero, e a linha sem preço é "Auto" (segue o produto).
//
// Mesmo padrão de admin-product-form-grade-preco: createRoot + act, hooks de
// dados mockados, debounce de 200ms do LocalBufferedInput esperado.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn(),
    products: [],
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

function clicarObrigatorio(texto: string) {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function clicarPorRotulo(rotulo: string) {
  const botao = document.body.querySelector(
    `[aria-label="${rotulo}"]`,
  ) as HTMLButtonElement | null;
  if (!botao) throw new Error(`Botão "${rotulo}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
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

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

const valorDoCampo = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

type Enviado = {
  price: number;
  variants: Array<{ value: string; priceOverride?: number }>;
};

describe("AdminProductFormView — grade: preço apagado não zera as linhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
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

  /** Produto novo COM Preço de Venda (R$ 60,00), para o Publicar liberar. */
  async function montarComPreco() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      const el = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(el, "Geral");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    await digitarCampo("product-sale-price", "6000");
  }

  /** Abre a grade e gera Tamanho (P, M, G): 3 combinações. */
  async function abrirGradeDe3() {
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-nome-0", "Tamanho");
    for (const tam of ["P", "M", "G"]) {
      await digitarCampo("grade-valor-0", tam);
      await act(async () => {
        clicarPorRotulo("Adicionar valor do atributo 1");
      });
    }
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
  }

  async function salvarGradeEPublicar(): Promise<Enviado> {
    await act(async () => {
      clicarObrigatorio("Salvar 3 variações");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const publicar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Publicar"),
    ) as HTMLButtonElement;
    expect(publicar.disabled).toBe(false);
    await act(async () => {
      publicar.click();
    });
    expect(mocks.addProduct).toHaveBeenCalledTimes(1);
    return mocks.addProduct.mock.calls[0]?.[0] as Enviado;
  }

  it('"Aplicar para todas" com o preço apagado (0,05 -> backspace) NÃO zera as linhas: todas ficam Auto', async () => {
    await montarComPreco();
    await abrirGradeDe3();

    await digitarCampo("grade-aplicar-preco", "0,05");
    await digitarCampo("grade-aplicar-preco", "0,0");
    expect(valorDoCampo("grade-aplicar-preco")).toBe("");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });
    for (const i of [0, 1, 2]) {
      expect(valorDoCampo(`grade-linha-preco-${i}`)).toBe("");
    }

    const enviado = await salvarGradeEPublicar();
    expect(enviado.variants).toHaveLength(3);
    for (const variante of enviado.variants) {
      expect(variante.priceOverride).toBeUndefined();
    }
  });

  it("preço apagado numa linha só: aquela linha fica Auto, as outras mantêm o preço", async () => {
    await montarComPreco();
    await abrirGradeDe3();

    await digitarCampo("grade-aplicar-preco", "7000");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });
    expect(valorDoCampo("grade-linha-preco-1")).toBe("70,00");

    // A lojista apaga a linha do M, dígito por dígito, até o zero.
    await digitarCampo("grade-linha-preco-1", "70,0");
    await digitarCampo("grade-linha-preco-1", "7,0");
    await digitarCampo("grade-linha-preco-1", "0,0");
    expect(valorDoCampo("grade-linha-preco-1")).toBe("");

    const enviado = await salvarGradeEPublicar();
    const porValor = new Map(
      enviado.variants.map((v) => [v.value, v.priceOverride]),
    );
    expect(porValor.get("P")).toBe(70);
    expect(porValor.get("M")).toBeUndefined();
    expect(porValor.get("G")).toBe(70);
  });

  it("o preço de verdade continua valendo: aplicar 70,00 grava 70 nas três", async () => {
    await montarComPreco();
    await abrirGradeDe3();

    await digitarCampo("grade-aplicar-preco", "7000");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });

    const enviado = await salvarGradeEPublicar();
    expect(enviado.price).toBe(60);
    expect(enviado.variants.map((v) => v.priceOverride)).toEqual([70, 70, 70]);
  });
});
