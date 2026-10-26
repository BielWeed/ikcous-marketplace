// @vitest-environment jsdom
//
// O passo 1 da grade ("Nova variação em grade") agora deixa ESCOLHER: toca a
// peça Cor e toca as bolinhas (ou os tamanhos), em vez de digitar "Cor" e cada
// valor. O que a grade entrega ao formulário não mudou — nome e valor em texto.
//
// As bordas provadas aqui, na tela de verdade:
//   1. tocar bolinhas e digitar uma cor que já existe na paleta (em outra
//      caixa) NÃO cria o mesmo valor duas vezes;
//   2. trocar de Cor para Tamanho limpa o que estava escolhido (nunca sai
//      "Tamanho: Azul");
//   3. produto que já tem "Espacial Grey" (fora da paleta) mostra o valor como
//      chip "já usado" e ele continua entrando na grade;
//   4. tamanhos viram peças de toque e a grade sai com os nomes certos;
//   5. a grade completa "Cor / Tamanho" gerada por toque tem as combinações.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atributoMarcado,
  botaoDoAtributo,
} from "./helpers/atributo-da-variacao";

const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
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

function clicarTexto(texto: string) {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

const porRotulo = (rotulo: string) =>
  document.body.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`);

async function tocar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) throw new Error(`Campo "${id}" não está na tela.`);
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}

const linhasDaGrade = () =>
  [...document.querySelectorAll('[data-testid="linha-da-grade"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const selecionadas = () =>
  [...document.querySelectorAll('[aria-label^="Tirar "]')].map((b) =>
    (b.getAttribute("aria-label") ?? "").replace("Tirar ", ""),
  );

const fotosDoProduto = (variants: unknown[]) => ({
  id: "prod-1",
  name: "Blusa",
  description: "Blusa",
  price: 89.9,
  costPrice: 40,
  originalPrice: null,
  stock: 0,
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
  variants,
});

describe("AdminProductFormView — grade: escolher em vez de digitar", () => {
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

  async function abrirGrade(variants: unknown[] = []) {
    fetchProduct.mockResolvedValue(fotosDoProduto(variants));
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
    await act(async () => {
      clicarTexto("+ Grade");
    });
  }

  it("tocar as bolinhas escolhe as cores; o digitado grava como foi digitado, e o mesmo texto (em outra caixa) NÃO duplica", async () => {
    await abrirGrade();
    await tocar(botaoDoAtributo(0, "Cor"));

    // Digitado em minúscula, ANTES de tocar nada: grava exatamente o digitado
    // (texto digitado nunca é trocado) e a bolinha da mesma cor fica marcada.
    await digitarCampo("grade-valor-0", "azul marinho");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    expect(selecionadas()).toEqual(["azul marinho"]);
    expect(porRotulo("Azul marinho")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await digitarCampo("grade-valor-0", "lilas");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    expect(selecionadas()).toEqual(["azul marinho", "lilas"]);

    await tocar(porRotulo("Preto"));
    await digitarCampo("grade-valor-0", "AZUL MARINHO");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    expect(selecionadas()).toEqual(["azul marinho", "lilas", "Preto"]);

    // Uma cor fora da paleta entra como valor livre, uma vez só.
    await digitarCampo("grade-valor-0", "Sálvia");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    await digitarCampo("grade-valor-0", "sálvia");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    expect(selecionadas()).toEqual([
      "azul marinho",
      "lilas",
      "Preto",
      "Sálvia",
    ]);
  });

  it("tocar a bolinha marcada de novo a tira da grade", async () => {
    await abrirGrade();
    await tocar(botaoDoAtributo(0, "Cor"));
    await tocar(porRotulo("Rosa"));
    await tocar(porRotulo("Rosa"));
    expect(selecionadas()).toEqual([]);
    expect(porRotulo("Rosa")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("trocar de Cor para Tamanho limpa o que estava escolhido: nunca sai 'Tamanho: Azul'", async () => {
    await abrirGrade();
    await tocar(botaoDoAtributo(0, "Cor"));
    await tocar(porRotulo("Azul"));
    await digitarCampo("grade-valor-0", "Sálvia");
    expect(selecionadas()).toEqual(["Azul"]);

    await tocar(botaoDoAtributo(0, "Tamanho"));
    expect(atributoMarcado(0)).toBe("Tamanho");
    expect(selecionadas()).toEqual([]);
    expect(
      (document.getElementById("grade-valor-0") as HTMLInputElement).value,
    ).toBe("");

    // Sem nenhum valor a grade não gera: o aviso de sempre.
    await act(async () => {
      clicarTexto("Gerar grade");
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(linhasDaGrade()).toEqual([]);
  });

  it("monta Cor × Tamanho só tocando, e a grade sai com os nomes que o lojista vê", async () => {
    await abrirGrade();
    await tocar(botaoDoAtributo(0, "Cor"));
    await tocar(porRotulo("Preto"));
    await tocar(porRotulo("Rosa"));
    await act(async () => {
      clicarTexto("+ Atributo");
    });
    await tocar(botaoDoAtributo(1, "Tamanho"));
    await tocar(botaoDoAtributo(1, "P"));
    await tocar(botaoDoAtributo(1, "M"));

    await act(async () => {
      clicarTexto("Gerar grade");
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(linhasDaGrade()).toEqual([
      "Preto / P",
      "Preto / M",
      "Rosa / P",
      "Rosa / M",
    ]);
  });

  it("valor já usado fora da paleta (Espacial Grey) aparece como chip 'já usado' e entra na grade", async () => {
    await abrirGrade([
      {
        id: "v1",
        productId: "prod-1",
        name: "Cor",
        value: "Espacial Grey",
        stockIncrement: 2,
        active: true,
      },
    ]);
    expect(atributoMarcado(0)).toBe("Cor");
    const chips = [
      ...document.querySelectorAll('[data-testid="chip-do-produto"]'),
    ].map((c) => c.textContent?.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(["Espacial Grey já usado"]);

    await tocar(
      document.querySelector('[data-testid="chip-do-produto"]') as Element,
    );
    await tocar(porRotulo("Rosa"));
    await act(async () => {
      clicarTexto("Gerar grade");
    });
    expect(toastError).not.toHaveBeenCalled();
    // O Espacial Grey já existe: só a Rosa é combinação nova.
    expect(linhasDaGrade()).toEqual(["Rosa"]);
  });

  it("produto que já tem a cor 'azul' (minúscula): tocar a bolinha Azul escolhe 'azul', nunca um segundo 'Azul'; o digitado não é trocado", async () => {
    await abrirGrade([
      {
        id: "v1",
        productId: "prod-1",
        name: "Cor",
        value: "azul",
        stockIncrement: 2,
        active: true,
      },
    ]);
    await tocar(porRotulo("Azul"));
    expect(selecionadas()).toEqual(["azul"]);
    // Tocar de novo tira.
    await tocar(porRotulo("Azul"));
    expect(selecionadas()).toEqual([]);
    // Digitado grava como foi digitado (a dedupe é a de sempre, por caixa).
    await digitarCampo("grade-valor-0", "AZUL");
    await tocar(porRotulo("Adicionar valor do atributo 1"));
    expect(selecionadas()).toEqual(["AZUL"]);
    const chips = [
      ...document.querySelectorAll('[data-testid="chip-do-produto"]'),
    ].map((c) => c.textContent?.replace(/\s+/g, " ").trim());
    expect(chips).toEqual(["azul"]);
  });

  it("produto que grava 'cor' minúsculo: a grade abre com a peça Cor marcada e o nome do grupo continua 'cor'", async () => {
    await abrirGrade([
      {
        id: "v1",
        productId: "prod-1",
        name: "cor",
        value: "Rosa",
        stockIncrement: 2,
        active: true,
      },
    ]);
    expect(atributoMarcado(0)).toBe("Cor");
    await tocar(porRotulo("Preto"));
    await act(async () => {
      clicarTexto("Gerar grade");
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(linhasDaGrade()).toEqual(["Preto"]);
  });

  it("produto que já usa Cor não oferece a peça Tamanho (a trava de um grupo recusaria)", async () => {
    await abrirGrade([
      {
        id: "v1",
        productId: "prod-1",
        name: "Cor",
        value: "Preto",
        stockIncrement: 2,
        active: true,
      },
    ]);
    const pecas = [
      ...document.querySelectorAll(
        '[data-testid="atributo-0"] [role="group"] button',
      ),
    ].map((b) => b.textContent?.trim());
    expect(pecas).toEqual(["Cor", "Outro"]);
  });
});
