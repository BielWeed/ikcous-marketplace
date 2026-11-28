// @vitest-environment jsdom
//
// A troca do VALOR de uma opção vendida ("M" -> "GG") guarda a antiga desligada
// e cria a nova (PR #2072). Três bordas dessa troca:
//  1. o salvar GRAVOU mas a resposta se perdeu; o segundo salvar é recusado pela
//     versão e a tela junta com o banco. A junção tem de reconhecer a troca já
//     feita (a antiga é "M" desligada; o "GG" do banco É a nova), senão o
//     terceiro salvar refaz a troca e grava mais um "GG" com o estoque copiado;
//  2. o banco guardou a antiga e a releitura falhou: a tela trava o salvar
//     (salvar de novo regravaria a linha antiga com o valor novo);
//  3. voltar atrás: desfazer antes de salvar volta ao original; depois de salvo,
//     o "M" desligado guardado não vira um "Essa combinação já existe." sem
//     saída — a tela oferece religá-lo.
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

const GRADE_GRAVADA = [
  variacao("v1", "Tamanho", "P", { stockIncrement: 4, sku: "CAM-P" }),
  variacao("v2", "Tamanho", "M", {
    stockIncrement: 7,
    priceOverride: 62.5,
    sku: "CAM-M",
    codigoBarras: "7890000000002",
  }),
  variacao("v3", "Tamanho", "G", { stockIncrement: 9, sku: "CAM-G" }),
];

/** O banco depois da troca M -> GG com o M vendido. */
const GRADE_DEPOIS_DA_TROCA = [
  GRADE_GRAVADA[0],
  variacao("v2", "Tamanho", "M", {
    stockIncrement: 7,
    priceOverride: 62.5,
    active: false,
  }),
  GRADE_GRAVADA[2],
  variacao("v9", "Tamanho", "GG", {
    stockIncrement: 7,
    priceOverride: 62.5,
    sku: "CAM-M",
    codigoBarras: "7890000000002",
  }),
];

const produto = (variants: Variacao[], updatedAt = "2026-11-28T10:00:00Z") => ({
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
  updatedAt,
  variants,
});

const FRASE =
  'O "M" já foi vendido, então guardamos ele desligado para os pedidos antigos e criamos o "GG" como opção nova. Confira o estoque das duas linhas.';

describe("AdminProductFormView — bordas da troca de valor de uma opção vendida", () => {
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
    mocks.fetchProduct.mockResolvedValue(produto(variants));
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

  async function trocarValor(de: string, para: string) {
    await editar(de);
    await digitarCampo("variant-value", para);
    await clicar("Salvar variação");
    if (botaoComTexto("Trocar o nome")) await clicar("Trocar o nome");
  }

  async function salvarProduto() {
    await act(async () => {
      botaoComTexto("Salvar alterações")?.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const chamada = (n: number) =>
    mocks.salvarProdutoComGrade.mock.calls.at(n)?.[2] as
      | {
          variantes: Array<Record<string, unknown> & { id: string }>;
          apagar: string[];
        }
      | undefined;

  const quantos = (rotulo: string) =>
    document.querySelectorAll(`[aria-label="${rotulo}"]`).length;

  const errosCom = (trecho: string) =>
    mocks.toastError.mock.calls.filter(([t]) => String(t).includes(trecho));

  it("1. resposta perdida + salvar de novo recusado pela versão: a tela mostra o M desligado e UM GG, e o terceiro salvar não refaz a troca", async () => {
    mocks.salvarProdutoComGrade
      // O banco gravou a troca, mas a resposta não voltou a tempo.
      .mockRejectedValueOnce(new Error("sem resposta"))
      // O segundo salvar chega com a versão velha: o banco recusa.
      .mockRejectedValueOnce(
        Object.assign(new Error("O produto mudou enquanto você editava."), {
          produtoAtual: produto(GRADE_DEPOIS_DA_TROCA, "2026-11-28T10:05:00Z"),
        }),
      );
    await montar(GRADE_GRAVADA);

    await trocarValor("M", "GG");
    await salvarProduto();
    await salvarProduto();

    // Como no banco: o M guardado desligado e um GG só (o novo).
    expect(quantos("Religar variação M")).toBe(1);
    expect(quantos("Editar variação GG")).toBe(1);
    expect(quantos("Religar variação GG")).toBe(0);
    expect(mocks.toastWarning).toHaveBeenCalledWith(FRASE, expect.anything());

    await salvarProduto();
    const terceira = chamada(2);
    expect(terceira).toBeDefined();
    expect(terceira?.apagar).toEqual([]);
    expect(terceira?.variantes.filter((v) => v.id.startsWith("temp-"))).toEqual(
      [],
    );
    expect(terceira?.variantes.some((v) => v.id === "v2")).toBe(false);
  });

  it("2. troca guardada pelo banco e a releitura falha: avisa para recarregar e um segundo Salvar não grava de novo", async () => {
    mocks.salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: ["v2"],
    });
    await montar(GRADE_GRAVADA);
    mocks.fetchProduct.mockRejectedValue(new Error("sem rede"));

    await trocarValor("M", "GG");
    await salvarProduto();

    expect(errosCom("Recarregue a tela antes de salvar de novo")).toHaveLength(
      1,
    );

    await salvarProduto();
    expect(mocks.salvarProdutoComGrade).toHaveBeenCalledTimes(1);
  });

  it("3a. desfazer a troca ANTES de salvar volta ao original: nada para apagar, nenhuma opção nova", async () => {
    await montar(GRADE_GRAVADA);

    await trocarValor("M", "GG");
    await trocarValor("GG", "M");

    expect(errosCom("Essa combinação já existe")).toEqual([]);
    expect(quantos("Editar variação M")).toBe(1);
    expect(quantos("Editar variação GG")).toBe(0);

    await salvarProduto();
    const mandado = chamada(0);
    expect(mandado?.apagar ?? []).toEqual([]);
    expect(
      (mandado?.variantes ?? []).filter(
        (v) => v.id.startsWith("temp-") || v.value === "GG",
      ),
    ).toEqual([]);
  });

  it("3b. voltar o GG para M DEPOIS de salvo: em vez de travar, oferece religar o M guardado", async () => {
    await montar(GRADE_DEPOIS_DA_TROCA);

    await editar("GG");
    await digitarCampo("variant-value", "M");
    await clicar("Salvar variação");

    expect(errosCom("Essa combinação já existe")).toEqual([]);
    const [aviso] = errosCom("guardado desligado");
    expect(aviso?.[0]).toBe('O "M" está guardado desligado nesta lista.');
    // Nada mudou ainda: o GG segue GG e o M segue desligado.
    expect(quantos("Religar variação M")).toBe(1);
    expect(quantos("Editar variação GG")).toBe(1);

    const acao = (
      aviso?.[1] as { action?: { label: string; onClick: () => void } }
    )?.action;
    expect(acao?.label).toBe("Religar");
    await act(async () => {
      acao?.onClick();
    });
    // A janela da variação sai com animação.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // O M original (o dos pedidos) volta ligado; o GG fica para ela decidir.
    expect(quantos("Desligar variação M")).toBe(1);
    expect(quantos("Religar variação M")).toBe(0);
    expect(quantos("Editar variação GG")).toBe(1);
    expect(document.getElementById("titulo-da-variacao")).toBeNull();
  });

  it("3d. o Religar de um aviso antigo não fecha OUTRA variação aberta depois (nem perde o que ela digitou)", async () => {
    await montar(GRADE_DEPOIS_DA_TROCA);

    await editar("GG");
    await digitarCampo("variant-value", "M");
    await clicar("Salvar variação");
    const [aviso] = errosCom("guardado desligado");
    const acao = (
      aviso?.[1] as { action?: { label: string; onClick: () => void } }
    )?.action;
    expect(acao?.label).toBe("Religar");

    // Dentro dos 10 s do aviso: fecha esta janela e abre a do P.
    await clicar("Cancelar");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await editar("P");
    await digitarCampo("variant-value", "PP");

    await act(async () => {
      acao?.onClick();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    // O M guardado volta ligado (é o que o botão diz)...
    expect(quantos("Desligar variação M")).toBe(1);
    // ...e a janela do P segue aberta, com o que ela digitou.
    expect(document.getElementById("titulo-da-variacao")).not.toBeNull();
    expect(
      (document.getElementById("variant-value") as HTMLInputElement | null)
        ?.value,
    ).toBe("PP");
  });

  it("3c. BORDA: um M LIGADO continua travando com 'Essa combinação já existe.' (nunca duas opções M à venda)", async () => {
    await montar(GRADE_GRAVADA);

    await editar("G");
    await digitarCampo("variant-value", "M");
    await clicar("Salvar variação");

    expect(errosCom("Essa combinação já existe")).toHaveLength(1);
    expect(errosCom("guardado desligado")).toEqual([]);
  });
});
