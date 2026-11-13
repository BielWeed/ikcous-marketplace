// @vitest-environment jsdom
//
// Renomear o TIPO ("Cor" -> "Cores") ou o VALOR ("P" -> "Pequeno") de uma
// variação que já existe reaproveita a linha: a variação segue com o mesmo id,
// preço próprio, estoque e código interno, e nenhuma linha duplicada nasce.
//
// Suspeita investigada em 13/11/2026: "renomear deixa as antigas e gera novas
// por cima". O caminho de edição troca a linha pelo id (não gera nada), e o
// caso que sobrava era renomear o tipo E o valor na mesma edição: a conferência
// de "essa combinação já existe" olhava as irmãs ANTES de o tipo ser renomeado
// nelas, e a irmã que já tinha o valor novo virava gêmea da editada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  salvarProdutoComGrade: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn().mockResolvedValue({ id: "p-1" }),
    salvarProdutoComGrade: mocks.salvarProdutoComGrade,
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
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

const botaoComTexto = (texto: string) =>
  [...document.querySelectorAll("button")]
    .filter((b) => b.textContent?.trim() === texto)
    .at(-1) as HTMLButtonElement | undefined;

async function clicar(texto: string) {
  const botao = botaoComTexto(texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  await act(async () => {
    botao.click();
  });
}

const naLista = (): string[] =>
  [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

type Variacao = {
  id: string;
  productId: string;
  name: string;
  value: string;
  stockIncrement: number;
  priceOverride?: number;
  sku?: string;
  active: boolean;
};

const variacao = (
  id: string,
  nome: string,
  valor: string,
  extras: Partial<Variacao> = {},
): Variacao => ({
  id,
  productId: "p-1",
  name: nome,
  value: valor,
  stockIncrement: 3,
  active: true,
  ...extras,
});

/** Três variações já gravadas, cada uma com preço, estoque e código próprios. */
const GRADE_GRAVADA = [
  variacao("v1", "Cor", "P", {
    stockIncrement: 4,
    priceOverride: 61.5,
    sku: "CAM-P",
  }),
  variacao("v2", "Cor", "M", {
    stockIncrement: 7,
    priceOverride: 62.5,
    sku: "CAM-M",
  }),
  variacao("v3", "Cor", "G", {
    stockIncrement: 9,
    priceOverride: 63.5,
    sku: "CAM-G",
  }),
];

describe("AdminProductFormView — renomear tipo ou valor reaproveita a variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
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

  async function montar(variants: Variacao[]) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 20,
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

  async function editar(valor: string) {
    const botao = document.querySelector(
      `[aria-label="Editar variação ${valor}"]`,
    ) as HTMLButtonElement | null;
    if (!botao) throw new Error(`Editar "${valor}" não está na tela.`);
    await act(async () => {
      botao.click();
    });
  }

  /** "Cor" é uma peça do seletor: renomear o tipo passa por "Outro". */
  const renomearTipo = (nome: string) =>
    escolherAtributo(0, nome, "variant-name", digitarCampo, {
      viaOutro: true,
    });

  /** Salva a janela da variação e, se aparecer o aviso de troca, diz "sim". */
  async function salvarVariacaoComSim() {
    await clicar("Salvar variação");
    if (botaoComTexto("Trocar o nome")) await clicar("Trocar o nome");
  }

  async function salvarProduto() {
    await act(async () => {
      botaoComTexto("Salvar alterações")?.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const enviado = () =>
    mocks.salvarProdutoComGrade.mock.calls[0]?.[2] as
      | {
          variantes: Array<Record<string, unknown> & { id: string }>;
          apagar: string[];
        }
      | undefined;

  it("renomear o TIPO numa opção renomeia as três: mesmos ids, preço, estoque e código, nada novo", async () => {
    await montar(GRADE_GRAVADA);

    await editar("P");
    await renomearTipo("Cores");
    // Trocar a peça do tipo limpa o valor: ela o digita de novo.
    await digitarCampo("variant-value", "P");
    await salvarVariacaoComSim();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Cores: P", "Cores: M", "Cores: G"]);

    await salvarProduto();
    const mandado = enviado();
    expect(mandado?.apagar).toEqual([]);
    // As três vão (o nome do tipo mudou em todas), cada uma no id que já tinha
    // e com o preço e o código de antes: nenhuma `temp-`, nenhuma nova.
    expect(mandado?.variantes.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
    expect(
      mandado?.variantes.map((v) => [v.name, v.value, v.priceOverride, v.sku]),
    ).toEqual([
      ["Cores", "P", 61.5, "CAM-P"],
      ["Cores", "M", 62.5, "CAM-M"],
      ["Cores", "G", 63.5, "CAM-G"],
    ]);
    // O estoque que a tela não mexeu NÃO viaja (o banco guarda o dele, que
    // pode ter descido com uma venda): ausente do envio = intacto no banco.
    for (const v of mandado?.variantes ?? []) {
      expect(v).not.toHaveProperty("stockIncrement");
    }
  });

  it("renomear o VALOR (P -> Pequeno) troca só aquela linha, no mesmo id e com o resto intacto", async () => {
    await montar(GRADE_GRAVADA);

    await editar("P");
    await digitarCampo("variant-value", "Pequeno");
    await salvarVariacaoComSim();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Cor: Pequeno", "Cor: M", "Cor: G"]);

    await salvarProduto();
    const mandado = enviado();
    expect(mandado?.apagar).toEqual([]);
    expect(mandado?.variantes).toHaveLength(1);
    expect(mandado?.variantes[0]).toMatchObject({
      id: "v1",
      name: "Cor",
      value: "Pequeno",
      priceOverride: 61.5,
      sku: "CAM-P",
    });
    // O estoque que a tela não mexeu NÃO viaja (o banco guarda o dele, que
    // pode ter descido com uma venda): ausente do envio = intacto no banco.
    expect(mandado?.variantes[0]).not.toHaveProperty("stockIncrement");
  });

  it("controle: salvar o produto sem renomear nada não manda variação nenhuma", async () => {
    await montar(GRADE_GRAVADA);

    await salvarProduto();

    const mandado = enviado();
    // Sem mexer em nada, nem chega a gravar a grade.
    expect(mandado?.variantes ?? []).toEqual([]);
    expect(mandado?.apagar ?? []).toEqual([]);
  });

  it("controle: acrescentar um valor novo faz aparecer só a variação nova", async () => {
    await montar(GRADE_GRAVADA);

    await clicar("+ Novo");
    await escolherAtributo(0, "Cor", "variant-name", digitarCampo);
    await digitarCampo("variant-value", "GG");
    await clicar("Salvar variação");

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Cor: P", "Cor: M", "Cor: G", "Cor: GG"]);

    await salvarProduto();
    const mandado = enviado();
    expect(mandado?.variantes).toHaveLength(1);
    expect(mandado?.variantes[0].id).toMatch(/^temp-/);
    expect(mandado?.variantes[0]).toMatchObject({ value: "GG" });
  });

  it("BORDA: renomear o tipo E o valor juntos, para um valor que a irmã já tem, não cria duas iguais", async () => {
    // Cor/P e Cor/Pequeno. Editar o P trocando para Cores/Pequeno: o tipo novo
    // vale para a irmã também (Cores/Pequeno) — as duas ficariam IDÊNTICAS.
    await montar([
      variacao("v1", "Cor", "P", { stockIncrement: 4, sku: "CAM-P" }),
      variacao("v2", "Cor", "Pequeno", { stockIncrement: 7, sku: "CAM-PQ" }),
    ]);

    await editar("P");
    await renomearTipo("Cores");
    await digitarCampo("variant-value", "Pequeno");
    await salvarVariacaoComSim();

    // Recusa em voz alta e nada muda na lista.
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(String(mocks.toastError.mock.calls[0][0])).toMatch(/já existe/i);
    expect(naLista()).toEqual(["Cor: P", "Cor: Pequeno"]);
  });

  it("controle: renomear tipo e valor juntos para um valor que NINGUÉM tem passa, e as irmãs seguem o tipo novo", async () => {
    await montar([
      variacao("v1", "Cor", "P", { stockIncrement: 4, sku: "CAM-P" }),
      variacao("v2", "Cor", "Pequeno", { stockIncrement: 7, sku: "CAM-PQ" }),
    ]);

    await editar("P");
    await renomearTipo("Cores");
    await digitarCampo("variant-value", "Mini");
    await salvarVariacaoComSim();

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(naLista()).toEqual(["Cores: Mini", "Cores: Pequeno"]);
  });

  it("controle: renomear SÓ o valor para o de uma irmã segue recusado (já era)", async () => {
    await montar([
      variacao("v1", "Cor", "P"),
      variacao("v2", "Cor", "Pequeno"),
    ]);

    await editar("P");
    await digitarCampo("variant-value", "pequeno");
    await salvarVariacaoComSim();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(naLista()).toEqual(["Cor: P", "Cor: Pequeno"]);
  });
});
