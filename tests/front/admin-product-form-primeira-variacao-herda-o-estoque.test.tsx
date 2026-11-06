// @vitest-environment jsdom
//
// A lojista tem um produto de 20 peças e cria a PRIMEIRA variação. Com variação
// ligada o estoque do produto é a soma das variações, e a variação nascia com
// quantidade 0: salvava com estoque 0, o produto virava "Esgotado" na loja e as
// 20 peças só voltavam se ela digitasse a quantidade em cada variação.
//
// O que este arquivo prova, na tela de verdade:
//  - produto com 20 e sem variação: a primeira nasce com 20 e o estoque do
//    produto continua 20 depois de criá-la;
//  - produto que já tem variação ligada: a nova nasce com 0 e a soma não muda;
//  - produto com estoque 0: nasce 0;
//  - só variações desligadas e zeradas e 12 no campo: a nova ligada herda os 12;
//  - desligada que ainda guarda quantidade: a nova NÃO herda (religar somaria em dobro);
//  - grade num produto com estoque e sem variação: aviso com o número (a grade
//    não tem como dividir o estoque); sem estoque, ou com variação já ligada,
//    sem aviso — e a grade é efetivada nos dois casos.
//
// Mesmo padrão de admin-product-form-variacao-repetida.test.tsx: sem
// @testing-library/react, createRoot + act do React puro, hooks mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atributoMarcado,
  escolherAtributo,
} from "./helpers/atributo-da-variacao";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
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
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function clicarObrigatorio(texto: string | RegExp) {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    casaOTexto(b.textContent, texto),
  ) as HTMLButtonElement | undefined;
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
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

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

const valorDoCampo = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

const naLista = (): string[] =>
  [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  ativa: boolean,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: ativa,
});

describe("AdminProductFormView — a primeira variação herda o estoque do produto", () => {
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

  async function montar(estoque: number, variants: unknown[]) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: estoque,
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

  async function abrirNovaVariacao() {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
  }

  async function criarVariacao(valor: string) {
    await escolherAtributo(0, "Cor", "variant-name", digitarCampo);
    await digitarCampo("variant-value", valor);
    const botao = [...document.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() === "Salvar variação")
      .at(-1);
    if (!botao) throw new Error('O botão "Salvar variação" não está na tela.');
    await act(async () => {
      botao.click();
    });
  }

  it("produto com 20 e sem variação: a primeira nasce com 20 e o estoque do produto continua 20", async () => {
    await montar(20, []);
    expect(valorDoCampo("product-stock")).toBe("20");

    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("20");

    await criarVariacao("Rosa");

    expect(naLista()).toEqual(["Cor: Rosa"]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(valorDoCampo("product-stock")).toBe("20");
  });

  it("a lojista pode trocar o número herdado e o produto passa a ser a soma", async () => {
    await montar(20, []);
    await abrirNovaVariacao();
    await digitarCampo("variant-stock", "8");
    await criarVariacao("Rosa");

    expect(valorDoCampo("product-stock")).toBe("8");
  });

  it("produto que já tem variação ligada: a nova nasce com 0 e a soma não muda", async () => {
    await montar(7, [variacao("v1", "Rosa", 7, true)]);

    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("0");

    await criarVariacao("Azul");

    expect(naLista()).toHaveLength(2);
    expect(valorDoCampo("product-stock")).toBe("7");
  });

  it("depois da primeira, a segunda nasce com 0 (não herda de novo)", async () => {
    await montar(20, []);
    await abrirNovaVariacao();
    await criarVariacao("Rosa");
    expect(valorDoCampo("product-stock")).toBe("20");

    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("0");
    await criarVariacao("Azul");

    expect(valorDoCampo("product-stock")).toBe("20");
  });

  it("produto com estoque 0: a primeira nasce com 0", async () => {
    await montar(0, []);

    await abrirNovaVariacao();

    expect(valorDoCampo("variant-stock")).toBe("0");
  });

  it("só variações desligadas e ZERADAS, 12 no campo: a nova ligada herda os 12", async () => {
    await montar(12, [variacao("v1", "Rosa", 0, false)]);
    expect(valorDoCampo("product-stock")).toBe("12");

    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("12");

    await criarVariacao("Azul");

    expect(valorDoCampo("product-stock")).toBe("12");
  });

  it("desligada que ainda guarda 5 e 12 no campo: a nova NÃO herda (religar a Rosa somaria em dobro)", async () => {
    await montar(12, [variacao("v1", "Rosa", 5, false)]);

    await abrirNovaVariacao();

    expect(valorDoCampo("variant-stock")).toBe("0");
  });

  it("cancelar e reabrir depois de mexer no estoque do produto: herda o número de agora", async () => {
    await montar(20, []);
    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("20");
    await act(async () => {
      clicarObrigatorio("Cancelar");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    await digitarCampo("product-stock", "5");
    await abrirNovaVariacao();

    expect(valorDoCampo("variant-stock")).toBe("5");
  });
});

describe("AdminProductFormView — grade num produto que já tem estoque", () => {
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

  async function montar(estoque: number, variants: unknown[]) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: estoque,
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

  /** Gera Cor: Verde e Cor: Azul e efetiva a grade. */
  async function efetivarGradeDeDuasCores() {
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await escolherAtributo(0, "Cor", "grade-nome-0", digitarCampo);
    for (const cor of ["Verde", "Azul"]) {
      await digitarCampo("grade-valor-0", cor);
      await act(async () => {
        (
          document.body.querySelector(
            '[aria-label="Adicionar valor do atributo 1"]',
          ) as HTMLButtonElement
        ).click();
      });
    }
    expect(atributoMarcado(0)).toBe("Cor");
    await act(async () => {
      clicarObrigatorio(BOTAO_GERAR_GRADE);
    });
    await act(async () => {
      clicarObrigatorio("Salvar 2 variações");
    });
  }

  const avisosDeEstoque = () =>
    mocks.toastWarning.mock.calls
      .map((c) => String(c[0]))
      .filter((t) => t.includes("estoque"));

  it("com 20 un e sem variação: avisa com o número e a grade é efetivada mesmo assim", async () => {
    await montar(20, []);

    await efetivarGradeDeDuasCores();

    expect(avisosDeEstoque()).toEqual([
      "Este produto tinha 20 un; agora o estoque é a soma das variações — informe a quantidade de cada uma.",
    ]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Cor: Verde", "Cor: Azul"]);
  });

  it("produto sem estoque: sem aviso", async () => {
    await montar(0, []);

    await efetivarGradeDeDuasCores();

    expect(avisosDeEstoque()).toEqual([]);
    expect(naLista()).toEqual(["Cor: Verde", "Cor: Azul"]);
  });

  it("produto que já tem variação ligada: sem aviso (o estoque já é a soma)", async () => {
    await montar(7, [variacao("v1", "Rosa", 7, true)]);

    await efetivarGradeDeDuasCores();

    expect(avisosDeEstoque()).toEqual([]);
    expect(naLista()).toHaveLength(3);
  });
});
