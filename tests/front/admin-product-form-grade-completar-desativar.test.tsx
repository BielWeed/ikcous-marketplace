// @vitest-environment jsdom
//
// A3 da peça 21 — completar a grade, reaproveitar valores e desativar:
//
//  1. Completar a grade do produto cria SÓ as linhas novas e preserva os
//     dados das existentes (id, SKU, estoque) — o teste do GG do estudo.
//  2. Os valores JÁ USADOS no produto voltam prontos como chips ("já usado")
//     — o pedido literal do dono: "fica salvo o valor".
//  3. Desativar linha é `active = false` COM aviso, preservando id — nunca
//     DELETE; reativar devolve sem cerimônia. Linha já inativa continua
//     contando como existente para a grade (nada de recriar nem reativar
//     por trás do lojista).
//
// Mesmo padrão dos testes de form do admin: createRoot + act, hooks
// mockados, debounce do LocalBufferedInput esperado a cada digitação.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const upsertVariants = vi.fn().mockResolvedValue(undefined);
const updateProduct = vi.fn().mockResolvedValue(undefined);
const deleteVariants = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    upsertVariants,
    deleteVariants,
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
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
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

function clicarPorRotulo(rotulo: string) {
  const botao = document.body.querySelector(
    `[aria-label="${rotulo}"]`,
  ) as HTMLButtonElement | null;
  if (!botao) throw new Error(`Botão "${rotulo}" não está na tela.`);
  botao.click();
}

/** Chip por valor EXATO — includes("P") pegaria "PP" também. */
function clicarChipObrigatorio(valor: string) {
  const chip = [...document.body.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "")
      .replace("já usado", "")
      .trim()
      .toLocaleLowerCase()
      .startsWith(valor.toLocaleLowerCase()),
  );
  if (!chip) throw new Error(`Chip "${valor}" não está na tela.`);
  (chip as HTMLButtonElement).click();
}

function chipsNaTela(): string[] {
  return [...document.body.querySelectorAll("button[aria-pressed]")]
    .map((b) => (b.textContent ?? "").replace("já usado", "").trim());
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

function variantesNaTela(): string[] {
  return [
    ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
  ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

function linhasDaGrade(): string[] {
  return [
    ...document.querySelectorAll('[data-testid="linha-da-grade"]'),
  ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

const gradeDoProduto = [
  {
    id: "v1",
    productId: "prod-1",
    name: "Cor / Tamanho",
    value: "Branca / PP",
    sku: "BLU-BRC-PP",
    stockIncrement: 3,
    priceOverride: undefined,
    active: true,
    imageUrl: undefined,
  },
  {
    id: "v2",
    productId: "prod-1",
    name: "Cor / Tamanho",
    value: "Branca / P",
    sku: "BLU-BRC-P",
    stockIncrement: 10,
    priceOverride: undefined,
    active: true,
    imageUrl: undefined,
  },
];

const produtoBase = {
  id: "prod-1",
  name: "Blusa de Tricô",
  description: "Blusa quente de tricô",
  price: 89.9,
  costPrice: 40,
  originalPrice: null,
  stock: 13,
  category: "cat-1",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
  variants: gradeDoProduto,
};

describe("AdminProductFormView — completar grade, chips e desativar (A3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(undefined);
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

  async function montarEmEdicao(variantes = gradeDoProduto) {
    fetchProduct.mockResolvedValue({ ...produtoBase, variants: variantes });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("o teste do GG: acrescentar GG cria SÓ a linha nova, com os dados anteriores intactos", async () => {
    await montarEmEdicao();

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });

    // Os valores já usados aparecem PRONTOS como chips marcados — o
    // reaproveitamento que o dono pediu, sem redigir nada.
    expect(chipsNaTela()).toEqual(["Branca", "PP", "P"]);
    await act(async () => {
      clicarChipObrigatorio("Branca");
    });
    await digitarCampo("grade-valor-1", "GG");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });

    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(linhasDaGrade()).toEqual(["Branca / GG"]);
    expect(
      document.querySelector('[data-testid="contador-da-grade"]')?.textContent,
    ).toContain("Só as 1 novas — as 2 existentes não são tocadas");

    await act(async () => {
      clicarObrigatorio("Efetivar 1 variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Branca / PP",
      "Cor / Tamanho: Branca / P",
      "Cor / Tamanho: Branca / GG",
    ]);

    // E o salvar prova a preservação: 3 linhas no lote, as duas antigas com
    // o MESMO id, SKU e estoque de antes — só a GG é nova.
    await act(async () => {
      clicarObrigatorio("Salvar");
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    const lote = upsertVariants.mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(lote).toHaveLength(3);
    expect(lote.find((v) => v.value === "Branca / PP")).toMatchObject({
      id: "v1",
      sku: "BLU-BRC-PP",
      stockIncrement: 3,
      active: true,
    });
    expect(lote.find((v) => v.value === "Branca / P")).toMatchObject({
      id: "v2",
      sku: "BLU-BRC-P",
      stockIncrement: 10,
      active: true,
    });
    expect(lote.find((v) => v.value === "Branca / GG")).toMatchObject({
      stockIncrement: 0,
      sku: undefined,
    });
  });

  it("desativar com aviso grava active=false preservando id, sem DELETE; reativar devolve", async () => {
    await montarEmEdicao();

    // Aviso: o toque na linha abre o diálogo, e CANCELAR não muda nada.
    await act(async () => {
      clicarPorRotulo("Desativar Branca / PP");
    });
    expect(document.body.textContent).toContain("Desativar Branca / PP?");
    await act(async () => {
      clicarObrigatorio("Cancelar");
    });
    expect(
      document.body.querySelector('[aria-label="Desativar Branca / PP"]'),
    ).not.toBeNull();

    // Agora desativa de verdade.
    await act(async () => {
      clicarPorRotulo("Desativar Branca / PP");
    });
    await act(async () => {
      clicarObrigatorio("Desativar");
    });

    // A linha continua na lista, com o rótulo virado para reativar — não
    // sumiu, não apagou.
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Branca / PP",
      "Cor / Tamanho: Branca / P",
    ]);
    expect(
      document.body.querySelector('[aria-label="Reativar Branca / PP"]'),
    ).not.toBeNull();

    // Salvar prova o contrato no payload: a linha desativada é UPDATE de
    // active=false com o MESMO id — deleteVariants não é chamado nunca.
    await act(async () => {
      clicarObrigatorio("Salvar");
    });
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    const lote = upsertVariants.mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(lote).toHaveLength(2);
    expect(lote.find((v) => v.value === "Branca / PP")).toMatchObject({
      id: "v1",
      active: false,
      stockIncrement: 3,
    });
    expect(deleteVariants).not.toHaveBeenCalled();

    // Reativar é o caminho de volta, sem diálogo: o rótulo da linha vira.
    await act(async () => {
      clicarPorRotulo("Reativar Branca / PP");
    });
    expect(
      document.body.querySelector('[aria-label="Desativar Branca / PP"]'),
    ).not.toBeNull();
  });

  it("linha já INATIVA continua existindo: a grade não recria nem reativa por trás do lojista", async () => {
    await montarEmEdicao([
      gradeDoProduto[0],
      { ...gradeDoProduto[1], active: false },
    ]);

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    // Os chips vêm das linhas ATIVAS e INATIVAS — a inativa ainda é valor
    // usado do produto.
    expect(chipsNaTela()).toEqual(["Branca", "PP", "P"]);
    await act(async () => {
      clicarChipObrigatorio("Branca");
    });
    await act(async () => {
      clicarChipObrigatorio("P");
    });

    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });

    // "Branca / P" já existe (mesmo inativa) — nada a criar, nada reativado.
    expect(toastInfo).toHaveBeenCalledWith(
      "Essas combinações já existem — nada a criar.",
    );
    expect(linhasDaGrade()).toEqual([]);
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Branca / PP",
      "Cor / Tamanho: Branca / P",
    ]);
    // A linha inativa segue inativa, com o selo de offline na lista.
    expect(
      document.body.querySelector('[aria-label="Reativar Branca / P"]'),
    ).not.toBeNull();
  });
});
