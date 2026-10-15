// @vitest-environment jsdom
//
// A lojista cria a variação (ex.: GG) com "Preço diferente nesta variação" e
// depois APAGA o campo para voltar ao preço do produto. O campo de moeda
// nunca ficava vazio — apagar o "0,05" com backspace dava "0,00" — e "0,00"
// é texto, não vazio: a variação era gravada com preço próprio ZERO. O
// servidor cobra `COALESCE(price_override, preco_venda)` (zero não é vazio) e
// a loja vendia o GG por R$ 0,00, com a tela da lojista dizendo "Salvo".
//
// Decisão: preço zero NÃO é aceito como preço próprio novo (o Preço de Venda
// do produto também precisa ser maior que zero). Zero digitado = campo vazio =
// a variação segue o preço do produto. A variação que JÁ está salva com zero
// aparece como "R$ 0,00" na lista (sem esconder) e só deixa de ser zero se a
// lojista apagar o campo.
//
// Mesmo padrão dos testes irmãos: createRoot + act, hooks de dados mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
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

/** O chip de preço próprio de cada variação da lista, na ordem da tela
 *  (`null` = a variação não tem preço próprio, segue o do produto). */
const precosNaLista = (): Array<string | null> =>
  [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (nome) => {
      const linha = nome.closest("div.min-w-0");
      const chip = linha?.querySelector(
        '[data-testid="preco-proprio-da-variacao"]',
      );
      return chip
        ? (chip.textContent?.replace(/\s+/g, " ").trim() ?? "")
        : null;
    },
  );

describe("AdminProductFormView — preço próprio da variação nunca vira zero sem querer", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProduct.mockResolvedValue(undefined);
    mocks.upsertVariants.mockResolvedValue(undefined);
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

  async function montar(variants: unknown[] = []) {
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

  const variacao = (id: string, valor: string, priceOverride?: number) => ({
    id,
    productId: "p-1",
    name: "Tamanho",
    value: valor,
    stockIncrement: 3,
    active: true,
    ...(priceOverride === undefined ? {} : { priceOverride }),
  });

  async function abrirNovaVariacao(valor: string) {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    await digitarCampo("variant-name", "Tamanho");
    await digitarCampo("variant-value", valor);
  }

  /** O botão do modal da variação: "Salvar variação" (nova) ou "Salvar"
   *  (edição). Na edição há outro "Salvar" (o do produto, no topo): o do modal
   *  é o ÚLTIMO na ordem da página. */
  async function salvarVariacao() {
    const botoes = [...document.querySelectorAll("button")].filter((b) => {
      const texto = b.textContent?.trim();
      return texto === "Salvar" || texto === "Salvar variação";
    });
    const botao = botoes.at(-1);
    if (!botao) throw new Error("O botão do modal não está na tela.");
    await act(async () => {
      botao.click();
    });
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

  it("apagar o preço próprio com backspace deixa o campo VAZIO e a variação segue o preço do produto", async () => {
    await montar();
    await abrirNovaVariacao("GG");

    await digitarCampo("variant-price", "0,05");
    expect(valorDoCampo("variant-price")).toBe("0,05");
    // Backspace sobre "0,05": o navegador entrega "0,0".
    await digitarCampo("variant-price", "0,0");
    expect(valorDoCampo("variant-price")).toBe("");

    await salvarVariacao();
    expect(precosNaLista()).toEqual([null]);
  });

  it("digitar 0 de propósito também não grava preço zero", async () => {
    await montar();
    await abrirNovaVariacao("GG");

    await digitarCampo("variant-price", "0");
    expect(valorDoCampo("variant-price")).toBe("");

    await salvarVariacao();
    expect(precosNaLista()).toEqual([null]);
  });

  it("o preço próprio digitado de verdade continua sendo gravado e aparece na lista", async () => {
    await montar();
    await abrirNovaVariacao("GG");

    await digitarCampo("variant-price", "4990");
    expect(valorDoCampo("variant-price")).toBe("49,90");

    await salvarVariacao();
    expect(precosNaLista()).toEqual(["R$ 49,90"]);
  });

  it("variação que JÁ está salva com preço zero aparece como R$ 0,00 na lista (não é escondida)", async () => {
    await montar([variacao("v1", "GG", 0), variacao("v2", "P")]);

    const [gg, p] = precosNaLista();
    expect(gg).toContain("R$ 0,00");
    expect(p).toBeNull();
  });

  it("abrir a variação salva com zero mostra 0,00 no campo; salvar sem mexer NÃO muda o dado", async () => {
    await montar([variacao("v1", "GG", 0)]);
    await editar("GG");
    expect(valorDoCampo("variant-price")).toBe("0,00");

    await salvarVariacao();
    expect(precosNaLista()[0]).toContain("R$ 0,00");
  });

  it("variação salva com zero: apagar o campo é o jeito de voltar ao preço do produto", async () => {
    await montar([variacao("v1", "GG", 0)]);
    await editar("GG");

    await digitarCampo("variant-price", "0,0");
    expect(valorDoCampo("variant-price")).toBe("");
    await salvarVariacao();

    expect(precosNaLista()).toEqual([null]);
  });

  it("variação salva com zero pode ganhar um preço de verdade", async () => {
    await montar([variacao("v1", "GG", 0)]);
    await editar("GG");

    await digitarCampo("variant-price", "5500");
    await salvarVariacao();

    expect(precosNaLista()).toEqual(["R$ 55,00"]);
  });

  it("o que vai para o banco: variação sem preço próprio sai sem priceOverride, nunca 0", async () => {
    await montar([variacao("v1", "GG", 80)]);
    await editar("GG");
    await digitarCampo("variant-price", "0,0");
    await salvarVariacao();

    const salvar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement | undefined;
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mocks.upsertVariants).toHaveBeenCalledTimes(1);
    const enviadas = mocks.upsertVariants.mock.calls[0]?.[1] as Array<{
      value: string;
      priceOverride?: number;
    }>;
    const gg = enviadas.find((v) => v.value === "GG");
    expect(gg).toBeDefined();
    expect(gg?.priceOverride).toBeUndefined();
  });
});
