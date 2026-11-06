// @vitest-environment jsdom
//
// Quatro acertos no formulário de PRODUTO do painel (lote r39-a):
//
//  1. O código de barras (do produto e da variação) abria só o teclado de
//     números, mas o app aceita código com letras (Code 128 / Code 39).
//  2. Trocar o nome de uma variação JÁ GRAVADA mudava, sem aviso, o que os
//     pedidos já feitos mostram (o pedido lê a variação ao vivo).
//  3. Quando o produto tem um tipo só ("Tamnho"), não havia como corrigir o
//     nome do tipo: cada edição individual criava "um segundo tipo".
//  4. O mesmo código de barras em duas variações só aparecia como erro no
//     campo do PRODUTO — o campo certo é o da variação.
//
// Mesmo padrão de admin-product-form-variacao-repetida.test.tsx: sem
// @testing-library/react, createRoot + act do React puro, hooks mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  toastError: vi.fn(),
}));

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

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(texto);
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

const textoDaTela = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";

/** O diálogo de confirmação ao trocar o nome de uma variação. */
const confirmacaoAberta = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');

describe("AdminProductFormView — código de barras, nome e tipo da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    armazem = new Map();
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

  async function montar(variants?: unknown[]) {
    if (variants) {
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
    }
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={variants ? "p-1" : undefined}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const variacao = (
    id: string,
    nome: string,
    valor: string,
    extras: Record<string, unknown> = {},
  ) => ({
    id,
    productId: "p-1",
    name: nome,
    value: valor,
    stockIncrement: 3,
    active: true,
    ...extras,
  });

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

  async function clicar(texto: string) {
    await act(async () => {
      clicarObrigatorio(texto);
    });
  }

  async function novaVariacao(
    atributo: string,
    valor: string,
    codigoBarras?: string,
  ) {
    await clicar("+ Novo");
    await escolherAtributo(0, atributo, "variant-name", digitar);
    await act(async () => {
      digitar("variant-value", valor);
      if (codigoBarras !== undefined) {
        digitar("variant-codigo-barras", codigoBarras);
      }
      await new Promise((r) => setTimeout(r, 300));
    });
    await salvarVariacao();
  }

  describe("1. teclado do código de barras", () => {
    it("o campo do PRODUTO abre o teclado de letras (aceita Code 128 e Code 39)", async () => {
      await montar();
      const campo = document.getElementById(
        "product-codigo-barras",
      ) as HTMLInputElement;
      expect(campo.getAttribute("inputmode")).toBe("text");
    });

    it("o campo da VARIAÇÃO também", async () => {
      await montar();
      await clicar("+ Novo");
      const campo = document.getElementById(
        "variant-codigo-barras",
      ) as HTMLInputElement;
      expect(campo.getAttribute("inputmode")).toBe("text");
    });

    it("controle: um campo só de números (estoque mínimo) segue com o teclado numérico", async () => {
      await montar();
      const campo = document.getElementById(
        "product-estoque-minimo",
      ) as HTMLInputElement;
      expect(campo.getAttribute("inputmode")).toBe("numeric");
    });
  });

  describe("2. trocar o nome de uma variação que já foi gravada", () => {
    it("pede confirmação clara e NÃO troca antes do sim", async () => {
      await montar([
        variacao("v1", "Tamanho", "P"),
        variacao("v2", "Tamanho", "M"),
      ]);
      await editar("P");
      await digitarCampo("variant-value", "GG");
      await salvarVariacao();

      expect(confirmacaoAberta()).not.toBeNull();
      const texto =
        confirmacaoAberta()?.textContent?.replace(/\s+/g, " ") ?? "";
      expect(texto).toContain("pedidos já feitos");
      expect(texto).toMatch(/crie uma variação nova/i);
      // Ainda é o P: nada mudou enquanto a lojista não confirma.
      expect(naLista()).toEqual(["Tamanho: P", "Tamanho: M"]);
      expect(janelaAberta()).toBe(true);
    });

    it("'Trocar o nome' confirma e a variação passa a ser GG", async () => {
      await montar([
        variacao("v1", "Tamanho", "P"),
        variacao("v2", "Tamanho", "M"),
      ]);
      await editar("P");
      await digitarCampo("variant-value", "GG");
      await salvarVariacao();
      await clicar("Trocar o nome");

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(naLista()).toEqual(["Tamanho: GG", "Tamanho: M"]);
    });

    it("'Não trocar' fecha o aviso, mantém o P e deixa a janela aberta para ela decidir", async () => {
      await montar([
        variacao("v1", "Tamanho", "P"),
        variacao("v2", "Tamanho", "M"),
      ]);
      await editar("P");
      await digitarCampo("variant-value", "GG");
      await salvarVariacao();
      await clicar("Não trocar");

      expect(naLista()).toEqual(["Tamanho: P", "Tamanho: M"]);
      expect(janelaAberta()).toBe(true);
    });

    it("controle: mexer só no preço (nome e valor iguais) salva direto, sem aviso", async () => {
      await montar([
        variacao("v1", "Tamanho", "P"),
        variacao("v2", "Tamanho", "M"),
      ]);
      await editar("P");
      await digitarCampo("variant-price", "4990");
      await salvarVariacao();

      expect(confirmacaoAberta()).toBeNull();
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("controle: variação criada agora (ainda não gravada, não está em pedido) troca sem aviso", async () => {
      await montar();
      await novaVariacao("Cor", "Rosa");
      expect(naLista()).toEqual(["Cor: Rosa"]);

      await editar("Rosa");
      await digitarCampo("variant-value", "Azul");
      await salvarVariacao();

      expect(confirmacaoAberta()).toBeNull();
      expect(naLista()).toEqual(["Cor: Azul"]);
    });
  });

  describe("3. corrigir o nome do tipo quando o produto tem um tipo só", () => {
    it("renomear o tipo numa opção vale para TODAS (inclusive a desligada), e o valor fica", async () => {
      await montar([
        variacao("v1", "Tamnho", "P"),
        variacao("v2", "Tamnho", "M"),
        variacao("v3", "Tamnho", "G", { active: false }),
      ]);
      await editar("P");
      await digitarCampo("variant-name", "Tamanho");
      await salvarVariacao();

      // O aviso diz que o nome vale para todas as opções.
      const texto =
        confirmacaoAberta()?.textContent?.replace(/\s+/g, " ") ?? "";
      expect(texto).toMatch(/todas as opções/i);
      expect(texto).toContain("Tamanho");
      await clicar("Trocar o nome");

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(naLista()).toEqual(["Tamanho: P", "Tamanho: M", "Tamanho: G"]);
    });

    it("depois da correção o produto segue com UM tipo só: um segundo tipo continua recusado", async () => {
      await montar([
        variacao("v1", "Tamnho", "P"),
        variacao("v2", "Tamnho", "M"),
      ]);
      await editar("P");
      await digitarCampo("variant-name", "Tamanho");
      await salvarVariacao();
      await clicar("Trocar o nome");

      await clicar("+ Novo");
      await escolherAtributo(0, "Cor", "variant-name", digitarCampo, {
        viaOutro: true,
      });
      await digitarCampo("variant-value", "Rosa");
      await salvarVariacao();

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(String(mocks.toastError.mock.calls[0][0])).toContain("Tamanho");
      expect(naLista()).toEqual(["Tamanho: P", "Tamanho: M"]);
    });
  });

  describe("4. código de barras repetido entre duas variações", () => {
    it("recusa na hora, nomeia a variação dona e a repetida não entra", async () => {
      await montar();
      await novaVariacao("Tamanho", "P", "7891234567890");
      expect(mocks.toastError).not.toHaveBeenCalled();

      await novaVariacao("Tamanho", "M", "7891234567890");

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      const [frase] = mocks.toastError.mock.calls[0] as [string];
      expect(frase).toContain("7891234567890");
      expect(frase).toContain("Tamanho: P");
      expect(naLista()).toEqual(["Tamanho: P"]);
      // A janela fica aberta para ela corrigir o código.
      expect(janelaAberta()).toBe(true);
      // E o erro NÃO cai no campo do produto.
      expect(textoDaTela()).not.toContain(
        "Este código já está em outra variação deste produto.",
      );
      expect(document.getElementById("product-barcode-error")).toBeNull();
    });

    it("compara o código como ele será gravado (sem espaços)", async () => {
      await montar();
      await novaVariacao("Tamanho", "P", "789 1234 567890");
      await novaVariacao("Tamanho", "M", "7891234567890");

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(naLista()).toEqual(["Tamanho: P"]);
    });

    it("controle: códigos diferentes passam", async () => {
      await montar();
      await novaVariacao("Tamanho", "P", "7891234567890");
      await novaVariacao("Tamanho", "M", "7891234567891");

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(naLista()).toEqual(["Tamanho: P", "Tamanho: M"]);
    });

    it("controle: salvar de novo a PRÓPRIA variação, com o mesmo código, não é repetição", async () => {
      await montar();
      await novaVariacao("Tamanho", "P", "7891234567890");

      await editar("P");
      await digitarCampo("variant-price", "4990");
      await salvarVariacao();

      expect(mocks.toastError).not.toHaveBeenCalled();
    });
  });
});
