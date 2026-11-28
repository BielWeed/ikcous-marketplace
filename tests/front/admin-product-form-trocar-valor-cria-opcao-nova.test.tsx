// @vitest-environment jsdom
//
// Decisão de produto (27/11/2026): trocar o VALOR de uma opção que já existe
// ("M" -> "GG") não renomeia a linha. O salvar manda a antiga para apagar E,
// ao mesmo tempo, desligada e sem códigos; e a nova sem id, com os códigos, o
// estoque e o preço da linha. O banco apaga primeiro: a antiga sem venda some;
// a vendida é recusada (volta em `recusadas`) e fica guardada desligada. Nesse
// caso a tela diz isso com uma frase própria, não com o "não consegui excluir".
// Só corrigir a grafia ("M" -> "m") segue editando a mesma linha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  salvarProdutoComGrade: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
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
    warning: mocks.toastWarning,
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

type Variacao = {
  id: string;
  productId: string;
  name: string;
  value: string;
  stockIncrement: number;
  priceOverride?: number;
  sku?: string;
  codigoBarras?: string;
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
  variacao("v1", "Tamanho", "P", {
    stockIncrement: 4,
    priceOverride: 61.5,
    sku: "CAM-P",
  }),
  variacao("v2", "Tamanho", "M", {
    stockIncrement: 7,
    priceOverride: 62.5,
    sku: "CAM-M",
    codigoBarras: "7890000000002",
  }),
  variacao("v3", "Tamanho", "G", {
    stockIncrement: 9,
    priceOverride: 63.5,
    sku: "CAM-G",
  }),
];

describe("AdminProductFormView — trocar o valor de uma opção gravada cria opção nova", () => {
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

  /** Salva a janela da variação e, se aparecer o aviso de troca, diz "sim". */
  async function salvarVariacaoComSim(conferirAviso = false) {
    await clicar("Salvar variação");
    if (conferirAviso) {
      const aviso = document.querySelector('[role="alertdialog"]');
      expect(
        [...(aviso?.querySelectorAll("span") ?? [])].map((el) =>
          el.textContent?.trim(),
        ),
      ).toContain(
        "Os pedidos já feitos continuam mostrando, no painel e na conta da cliente, o nome anterior.",
      );
    }
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

  const naoExcluiu = () =>
    mocks.toastError.mock.calls.some(([t]) =>
      String(t).includes("não consegui excluir"),
    );

  const FRASE =
    'O "M" já foi vendido, então guardamos ele desligado para os pedidos antigos e criamos o "GG" como opção nova. Confira o estoque das duas linhas.';

  it("troca de verdade com a antiga VENDIDA: apaga + desliga sem códigos a antiga, cria a nova com os códigos, e diz o que fez", async () => {
    mocks.salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: ["v2"],
    });
    await montar(GRADE_GRAVADA);

    await editar("M");
    await digitarCampo("variant-value", "GG");
    await salvarVariacaoComSim();
    await salvarProduto();

    const mandado = enviado();
    expect(mandado?.apagar).toEqual(["v2"]);
    expect(mandado?.variantes).toHaveLength(2);
    const [antiga, nova] = mandado?.variantes ?? [];
    // A antiga, ANTES da nova: desligada, sem SKU nem código de barras, com o
    // valor antigo e sem mexer no estoque dela.
    expect(antiga).toMatchObject({ id: "v2", value: "M", active: false });
    expect(antiga.sku).toBeUndefined();
    expect(antiga.codigoBarras).toBeUndefined();
    expect(antiga).not.toHaveProperty("stockIncrement");
    // A nova: sem id de banco (temp-), herdando códigos, estoque e preço.
    expect(nova.id).toMatch(/^temp-/);
    expect(nova).toMatchObject({
      name: "Tamanho",
      value: "GG",
      sku: "CAM-M",
      codigoBarras: "7890000000002",
      stockIncrement: 7,
      priceOverride: 62.5,
      active: true,
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith(FRASE, expect.anything());
    expect(naoExcluiu()).toBe(false);
  });

  it("troca de verdade com a antiga NUNCA vendida: o banco a apaga e a frase não aparece", async () => {
    await montar(GRADE_GRAVADA);

    await editar("M");
    await digitarCampo("variant-value", "GG");
    await salvarVariacaoComSim();
    await salvarProduto();

    const mandado = enviado();
    expect(mandado?.apagar).toEqual(["v2"]);
    expect(mandado?.variantes.map((v) => v.value)).toEqual(["M", "GG"]);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(naoExcluiu()).toBe(false);
  });

  it("só correção de grafia (M -> m): a mesma linha, o mesmo id, nada para apagar", async () => {
    await montar(GRADE_GRAVADA);

    await editar("M");
    await digitarCampo("variant-value", "m");
    await salvarVariacaoComSim();
    await salvarProduto();

    const mandado = enviado();
    expect(mandado?.apagar).toEqual([]);
    expect(mandado?.variantes).toHaveLength(1);
    expect(mandado?.variantes[0]).toMatchObject({
      id: "v2",
      value: "m",
      sku: "CAM-M",
      codigoBarras: "7890000000002",
      active: true,
    });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("BORDA: troca guardada E exclusão recusada no mesmo salvar — cada uma com a sua frase, e o 'não consegui excluir' só cita a excluída", async () => {
    mocks.salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: ["v2", "v1"],
    });
    await montar(GRADE_GRAVADA);

    await editar("M");
    await digitarCampo("variant-value", "GG");
    await salvarVariacaoComSim();
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Excluir variação P"]',
        ) as HTMLButtonElement
      ).click();
    });
    await clicar("Excluir Variante");
    await salvarProduto();

    expect(enviado()?.apagar).toEqual(["v1", "v2"]);
    expect(mocks.toastWarning).toHaveBeenCalledWith(FRASE, expect.anything());
    const recusas = mocks.toastError.mock.calls
      .map(([t]) => String(t))
      .filter((t) => t.includes("não consegui excluir"));
    expect(recusas).toHaveLength(1);
    expect(recusas[0]).toContain("Tamanho: P");
    expect(recusas[0]).not.toContain("Tamanho: M");
  });

  it("ordem: a antiga vai antes da nova mesmo com outra linha mexida no meio", async () => {
    await montar(GRADE_GRAVADA);

    // Mexer no P (só o preço) e trocar o G por XG.
    await editar("P");
    await digitarCampo("variant-sku", "CAM-PP");
    await salvarVariacaoComSim();
    await editar("G");
    await digitarCampo("variant-value", "XG");
    await salvarVariacaoComSim();
    await salvarProduto();

    const ordem = (enviado()?.variantes ?? []).map((v) =>
      v.id.startsWith("temp-") ? `nova:${v.value}` : `${v.id}:${v.value}`,
    );
    expect(ordem).toEqual(["v3:G", "v1:P", "nova:XG"]);
    expect(enviado()?.apagar).toEqual(["v3"]);
  });
});
