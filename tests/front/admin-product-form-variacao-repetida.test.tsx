// @vitest-environment jsdom
//
// "Salvar variação" aceitava a MESMA combinação duas vezes (Tamanho GG e de
// novo Tamanho GG) e o estoque da peça dobrava na lista. A grade já recusava a
// repetida; o botão unitário não. Agora a repetida é recusada com um aviso
// claro, e editar a própria variação (ou uma que já veio repetida de antes)
// continua passando.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  updateProduct: vi.fn(),
  salvarProdutoComGrade: vi
    .fn()
    .mockResolvedValue({ produto: undefined, recusadas: [] }),
  upsertVariants: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: mocks.updateProduct,
    salvarProdutoComGrade: mocks.salvarProdutoComGrade,
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
    error: mocks.toastError,
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

const naLista = (): string[] =>
  [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const janelaAberta = () =>
  document.getElementById("titulo-da-variacao") !== null;

/** A janela sai com animação de saída: espera ela sumir (ou o prazo). */
async function esperarJanelaFechar() {
  for (let i = 0; i < 40 && janelaAberta(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
}

describe("AdminProductFormView — a mesma combinação de variação não entra duas vezes", () => {
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

  const variacao = (id: string, valor: string) => ({
    id,
    productId: "p-1",
    name: "Tamanho",
    value: valor,
    stockIncrement: 3,
    active: true,
  });

  async function montar(variants: unknown[]) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 7,
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

  async function novaVariacao(valor: string) {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    await escolherAtributo(0, "Tamanho", "variant-name", digitarCampo);
    await digitarCampo("variant-value", valor);
  }

  async function editar(valor: string) {
    const botao = document.querySelector(
      `[aria-label="Editar variação ${valor}"]`,
    ) as HTMLButtonElement | null;
    if (!botao) throw new Error(`Editar "${valor}" não está na tela.`);
    await act(async () => {
      botao.click();
    });
  }

  /** "Salvar variação" (nova) ou "Salvar" (edição): o do modal é o último. */
  async function salvarVariacao() {
    const botao = [...document.querySelectorAll("button")]
      .filter((b) => {
        const t = b.textContent?.trim();
        return t === "Salvar" || t === "Salvar variação";
      })
      .at(-1);
    if (!botao) throw new Error("O botão do modal não está na tela.");
    await act(async () => {
      botao.click();
    });
  }

  it("recusa a combinação repetida, avisa em português simples e a lista não muda", async () => {
    await montar([variacao("v1", "GG"), variacao("v2", "P")]);
    await novaVariacao("GG");
    await salvarVariacao();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0][0]).toBe(
      "Essa combinação já existe.",
    );
    expect(naLista()).toEqual(["Tamanho: GG", "Tamanho: P"]);
    // A janela fica aberta para a lojista corrigir o valor.
    expect(janelaAberta()).toBe(true);
  });

  it("a caixa da letra não esconde a repetição ('gg' é o GG que já existe)", async () => {
    await montar([variacao("v1", "GG")]);
    await novaVariacao("gg");
    await salvarVariacao();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(naLista()).toEqual(["Tamanho: GG"]);
  });

  it("uma combinação diferente continua entrando", async () => {
    await montar([variacao("v1", "GG")]);
    await novaVariacao("M");
    await salvarVariacao();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Tamanho: GG", "Tamanho: M"]);
  });

  it("editar a própria variação sem trocar a combinação NÃO é repetição", async () => {
    await montar([variacao("v1", "GG"), variacao("v2", "P")]);
    await editar("GG");
    await digitarCampo("variant-price", "4990");
    await salvarVariacao();

    await esperarJanelaFechar();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(janelaAberta()).toBe(false);
  });

  it("trocar a variação para uma combinação que OUTRA já tem é recusado", async () => {
    await montar([variacao("v1", "GG"), variacao("v2", "P")]);
    await editar("P");
    await digitarCampo("variant-value", "GG");
    await salvarVariacao();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0][0]).toBe(
      "Essa combinação já existe.",
    );
    expect(naLista()).toEqual(["Tamanho: GG", "Tamanho: P"]);
  });

  it("produto que JÁ veio com a combinação repetida: editar uma delas sem trocar a combinação ainda salva", async () => {
    await montar([variacao("v1", "GG"), variacao("v2", "GG")]);
    await editar("GG");
    await digitarCampo("variant-price", "4990");
    await salvarVariacao();

    await esperarJanelaFechar();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(janelaAberta()).toBe(false);
  });
});
