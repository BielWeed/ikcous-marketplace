// @vitest-environment jsdom
//
// "Não consegui salvar o produto" (cliente pagante, 03/10/2026). Duas coisas
// da tela do produto deixavam a lojista sem saber o que fazer:
//
//  1. O botão PUBLICAR ficava cinza (disabled) sem dizer por quê. Os campos
//     com "*" existem, mas quem preenche tudo menos a categoria só vê um
//     botão que não responde.
//  2. A tela aceitava o MESMO SKU em duas variações do mesmo produto. O SKU
//     da variação é único na loja inteira (product_variants_sku_key) — o
//     erro só aparecia na hora de gravar, já sem dizer qual SKU.
//
// Mesmo padrão de admin-product-form-um-grupo-de-variacao.test.tsx: sem
// @testing-library/react, createRoot + act do React puro, hooks de dados
// mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn(),
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

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const esperarDebounce = () => new Promise((r) => setTimeout(r, 300));

describe("AdminProductFormView — variação e botão Publicar dizem o que está errado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  async function cadastrarVariante(
    atributo: string,
    valor: string,
    sku?: string,
  ) {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    await act(async () => {
      digitar("variant-name", atributo);
      digitar("variant-value", valor);
      if (sku !== undefined) digitar("variant-sku", sku);
      await esperarDebounce();
    });
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });
  }

  function variantesNaTela(): string[] {
    return [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
  }

  function motivoDoBloqueio(): string | null {
    const el = document.querySelector('[data-testid="motivo-do-bloqueio"]');
    return el ? (el.textContent?.replace(/\s+/g, " ").trim() ?? "") : null;
  }

  async function preencher(campos: {
    nome?: string;
    descricao?: string;
    preco?: string;
    estoque?: string;
    categoria?: string;
  }) {
    await act(async () => {
      if (campos.nome !== undefined) digitar("product-name", campos.nome);
      if (campos.descricao !== undefined)
        digitarTextarea("product-description", campos.descricao);
      if (campos.preco !== undefined)
        digitar("product-sale-price", campos.preco);
      if (campos.estoque !== undefined)
        digitar("product-stock", campos.estoque);
      if (campos.categoria !== undefined) selecionarCategoria(campos.categoria);
      await esperarDebounce();
    });
  }

  describe("SKU repetido entre as variações do mesmo produto", () => {
    it("RECUSA o segundo SKU igual, diz qual é, e a variação não entra na lista", async () => {
      await montar();

      await cadastrarVariante("Cor", "Rosa", "CAM-01");
      expect(toastError).not.toHaveBeenCalled();

      await cadastrarVariante("Cor", "Azul", "CAM-01");

      expect(toastError).toHaveBeenCalledTimes(1);
      const [frase] = toastError.mock.calls[0] as [string];
      expect(frase).toContain("CAM-01");
      expect(frase).toMatch(/outra varia/i);
      expect(variantesNaTela()).toEqual(["Cor: Rosa"]);
    });

    it("compara o SKU como ele será gravado (maiúsculo, sem espaço)", async () => {
      await montar();

      await cadastrarVariante("Cor", "Rosa", "cam 01");
      await cadastrarVariante("Cor", "Azul", "CAM-01");

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(variantesNaTela()).toEqual(["Cor: Rosa"]);
    });

    it("duas variações SEM SKU continuam passando (SKU é opcional)", async () => {
      await montar();

      await cadastrarVariante("Cor", "Rosa");
      await cadastrarVariante("Cor", "Azul");

      expect(toastError).not.toHaveBeenCalled();
      expect(variantesNaTela()).toEqual(["Cor: Rosa", "Cor: Azul"]);
    });

    it("SKUs diferentes passam", async () => {
      await montar();

      await cadastrarVariante("Cor", "Rosa", "CAM-ROSA");
      await cadastrarVariante("Cor", "Azul", "CAM-AZUL");

      expect(toastError).not.toHaveBeenCalled();
      expect(variantesNaTela()).toEqual(["Cor: Rosa", "Cor: Azul"]);
    });
  });

  describe("o que impede o Publicar", () => {
    it("formulário vazio: diz o que falta, e o botão segue desligado", async () => {
      await montar();

      const botao = botaoPorTexto(document.body, "Publicar")!;
      expect(botao.disabled).toBe(true);

      const motivo = motivoDoBloqueio();
      expect(motivo).not.toBeNull();
      expect(motivo).toMatch(/nome/i);
      expect(motivo).toMatch(/descri/i);
      expect(motivo).toMatch(/categoria/i);
      expect(motivo).toMatch(/pre[cç]o/i);
    });

    it("só falta a categoria e a descrição: o aviso cita só essas duas", async () => {
      await montar();
      await preencher({ nome: "Camiseta", preco: "5000", estoque: "3" });

      const motivo = motivoDoBloqueio();
      expect(motivo).not.toBeNull();
      expect(motivo).toMatch(/descri/i);
      expect(motivo).toMatch(/categoria/i);
      expect(motivo).not.toMatch(/nome/i);
      expect(motivo).not.toMatch(/pre[cç]o/i);
      expect(motivo).not.toMatch(/estoque/i);
    });

    it("tudo preenchido: o aviso some e o botão liga", async () => {
      await montar();
      await preencher({
        nome: "Camiseta",
        descricao: "Algodão",
        preco: "5000",
        estoque: "3",
        categoria: "Geral",
      });

      expect(motivoDoBloqueio()).toBeNull();
      expect(botaoPorTexto(document.body, "Publicar")!.disabled).toBe(false);
    });

    it("novo produto com variação: Publicar entrega a grade inteira ao cadastro", async () => {
      await montar();
      await preencher({
        nome: "Camiseta",
        descricao: "Algodão",
        preco: "5000",
        categoria: "Geral",
      });
      await cadastrarVariante("Tamanho", "P", "CAM-P");
      await cadastrarVariante("Tamanho", "M");

      await act(async () => {
        botaoPorTexto(document.body, "Publicar")!.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(addProduct).toHaveBeenCalledTimes(1);
      const [dados] = addProduct.mock.calls[0] as [any];
      expect(dados.variants).toHaveLength(2);
      // SKU vazio vai como ausente (o hook grava NULL) -- nunca "".
      expect(dados.variants.map((v: any) => v.sku)).toEqual([
        "CAM-P",
        undefined,
      ]);
    });
  });
});
