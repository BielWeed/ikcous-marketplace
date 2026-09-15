// @vitest-environment jsdom
//
// A2 da peça 21 — o modal "Nova variante em grade" na tela de verdade:
// escolher valores por atributo (chips + digitar), gerar o cartesiano,
// "aplicar para todas" e edição por linha, SKU base com sufixo automático,
// efetivar pela persistência de sempre (a lista do formulário →
// `upsertVariants` no salvar do produto), colisão de SKU RECUSADA sem
// sucesso falso, Voltar/Cancelar sem gravar nada, e a trava de um grupo
// mantendo o diagnóstico (sem conversão de legado).
//
// Mesmo padrão de admin-product-form-variante-composta.test.tsx: sem
// @testing-library/react, createRoot + act do React puro, hooks de dados
// mockados, e o debounce (200ms) do LocalBufferedInput esperado a cada
// digitação. O modal de grade usa LocalBufferedInput, então TODO gesto de
// digitação precisa do flush antes do próximo passo.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const upsertVariants = vi.fn().mockResolvedValue(undefined);
const updateProduct = vi.fn().mockResolvedValue(undefined);
const addProduct = vi.fn().mockResolvedValue(undefined);
// A lista da loja alimenta a checagem de SKU (UNIQUE global da tabela).
let produtosDaLoja: Array<Record<string, unknown>> = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
    products: produtosDaLoja,
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

/** Botão só-ícone: o nome mora no aria-label, não no textContent. */
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

function valorDoCampo(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el?.value ?? "";
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

describe("AdminProductFormView — modal Nova variante em grade (produto novo)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    produtosDaLoja = [];
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

  it("cria 6 combinações de uma vez: valores digitados, aplicar-para-todas, SKU com sufixo", async () => {
    await montar();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });

    // Passo 1 — Cor: Amarela, Verde × Tamanho: PP, P, M (digitados; produto
    // novo não tem valores usados ainda, então nenhum chip de "já usado").
    await digitarCampo("grade-nome-0", "Cor");
    await digitarCampo("grade-valor-0", "Amarela");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await digitarCampo("grade-valor-0", "Verde");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarCampo("grade-nome-1", "Tamanho");
    await digitarCampo("grade-valor-1", "PP");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await digitarCampo("grade-valor-1", "P");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await digitarCampo("grade-valor-1", "M");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });

    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });

    // Passo 2 — 6 novas, as 0 existentes não são tocadas, e sem SKU base
    // as linhas nascem honestamente "sem SKU".
    expect(linhasDaGrade()).toEqual([
      "Amarela / PP",
      "Amarela / P",
      "Amarela / M",
      "Verde / PP",
      "Verde / P",
      "Verde / M",
    ]);
    expect(
      document.querySelector('[data-testid="contador-da-grade"]')?.textContent,
    ).toContain("Só as 6 novas");
    expect(
      document.querySelector('[data-testid="sku-da-linha"]')?.textContent,
    ).toContain("sem SKU");

    // SKU base → sufixo automático por valor, visível linha a linha.
    await digitarCampo("grade-sku-base", "blu");
    const skus = [
      ...document.querySelectorAll('[data-testid="sku-da-linha"]'),
    ].map((el) => el.textContent?.trim());
    expect(skus).toEqual([
      "BLU-AMA-PP",
      "BLU-AMA-P",
      "BLU-AMA-M",
      "BLU-VER-PP",
      "BLU-VER-P",
      "BLU-VER-M",
    ]);

    // Aplicar para todas: estoque 10 e preço 99,90 em TODAS as linhas.
    await digitarCampo("grade-aplicar-estoque", "10");
    await digitarCampo("grade-aplicar-preco", "99,90");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });
    expect(valorDoCampo("grade-linha-estoque-0")).toBe("10");
    expect(valorDoCampo("grade-linha-preco-0")).toBe("99,90");
    expect(valorDoCampo("grade-linha-estoque-5")).toBe("10");
    expect(valorDoCampo("grade-linha-preco-5")).toBe("99,90");

    // Ajuste fino em UMA linha (a Verde / M vale 109,90): edição individual
    // depois do lote, o caso "a G custa mais" do dono.
    await digitarCampo("grade-linha-preco-5", "109,90");
    expect(valorDoCampo("grade-linha-preco-5")).toBe("109,90");
    expect(valorDoCampo("grade-linha-preco-4")).toBe("99,90");

    await act(async () => {
      clicarObrigatorio("Efetivar 6 variantes");
    });

    expect(toastError).not.toHaveBeenCalled();
    // As 6 linhas estão na lista do produto — linhas comuns, no formato da
    // peça 19, que o salvar grava pelo upsertVariants de sempre.
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Amarela / PP",
      "Cor / Tamanho: Amarela / P",
      "Cor / Tamanho: Amarela / M",
      "Cor / Tamanho: Verde / PP",
      "Cor / Tamanho: Verde / P",
      "Cor / Tamanho: Verde / M",
    ]);
  });

  it("Voltar e Cancelar não gravam nada — nem parcialmente", async () => {
    await montar();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-nome-0", "Cor");
    await digitarCampo("grade-valor-0", "Azul");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(linhasDaGrade()).toHaveLength(1);

    // Voltar para o passo 1 e cancelar: NADA entra na lista.
    await act(async () => {
      clicarObrigatorio("← Voltar");
    });
    await act(async () => {
      clicarObrigatorio("Cancelar");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([]);
    // Reabrir começa limpo — o estado da tentativa anterior não vaza.
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    expect(valorDoCampo("grade-nome-0")).toBe("");
    expect(valorDoCampo("grade-valor-0")).toBe("");
  });

  it("RECUSA valor com / na digitação, antes de gerar qualquer linha", async () => {
    await montar();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-nome-0", "Cor");
    await digitarCampo("grade-valor-0", "Preto/Branco");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('"/"');
    // O valor recusado não virou chip selecionado.
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(toastError.mock.calls[1]?.[0] ?? "").toContain(
      "ao menos um valor",
    );
  });
});

describe("AdminProductFormView — grade gravando pelo upsertVariants (produto existente)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  const produtoBase = {
    id: "prod-1",
    name: "Blusa de Tricô",
    description: "Blusa quente de tricô",
    price: 89.9,
    costPrice: 40,
    originalPrice: null,
    stock: 3,
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
    variants: [
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
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    upsertVariants.mockResolvedValue(undefined);
    updateProduct.mockResolvedValue(undefined);
    produtosDaLoja = [];
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

  async function montarEmEdicao(
    // `unknown[]`: variantes falsas dos testes não precisam do tipo inteiro.
    variantes: unknown[] = produtoBase.variants,
  ) {
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

  /** Completar a grade existente com Amarela / P e efetivar. */
  async function adicionarAmarelaP() {
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    // Os atributos da grade do produto voltam preenchidos — é o modo
    // "Completar Grade", sem redigir Cor nem Tamanho.
    expect(valorDoCampo("grade-nome-0")).toBe("Cor");
    expect(valorDoCampo("grade-nome-1")).toBe("Tamanho");
    await digitarCampo("grade-valor-0", "Amarela");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await digitarCampo("grade-valor-1", "P");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(linhasDaGrade()).toEqual(["Amarela / P"]);
    // Aplicar para todas: a linha nova nasce com o estoque do lote.
    await digitarCampo("grade-aplicar-estoque", "5");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });
    await digitarCampo("grade-sku-base", "blu");
    await act(async () => {
      clicarObrigatorio("Efetivar 1 variante");
    });
  }

  it("payload do upsertVariants: nova linha com preço/estoque/SKU certos e a existente intacta", async () => {
    await montarEmEdicao();
    await adicionarAmarelaP();

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho: Branca / PP",
      "Cor / Tamanho: Amarela / P",
    ]);

    await act(async () => {
      clicarObrigatorio("Salvar");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    const [idNoUpsert, lote] = upsertVariants.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(idNoUpsert).toBe("prod-1");
    expect(lote).toHaveLength(2);

    const existente = lote.find((v) => v.value === "Branca / PP");
    // A linha que JÁ existia não mudou: mesmo id, mesmo SKU, mesmo estoque.
    expect(existente).toMatchObject({
      id: "v1",
      sku: "BLU-BRC-PP",
      stockIncrement: 3,
      active: true,
    });

    const nova = lote.find((v) => v.value === "Amarela / P");
    expect(nova).toMatchObject({
      name: "Cor / Tamanho",
      sku: "BLU-AMA-P",
      stockIncrement: 5,
      // Sem preço aplicado = undefined aqui e NULL no banco: usa o preço
      // padrão do produto, o mesmo contrato do modal unitário.
      priceOverride: undefined,
      active: true,
    });
    expect(String(nova?.id)).toMatch(/^temp-/);
  });

  it("colisão de SKU com linha existente RECUSA o efetivar — sem sucesso falso", async () => {    await montarEmEdicao([
      {
        id: "v1",
        productId: "prod-1",
        name: "Cor / Tamanho",
        value: "Branca / P",
        sku: "BLU-AMA-P",
        stockIncrement: 2,
        priceOverride: undefined,
        active: true,
        imageUrl: undefined,
      },
    ]);

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-valor-0", "Amarela");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await digitarCampo("grade-valor-1", "P");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    // BLU + AMA + P colide com o SKU que a linha já gravada usa.
    await digitarCampo("grade-sku-base", "blu");

    await act(async () => {
      clicarObrigatorio("Efetivar 1 variante");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('O SKU "BLU-AMA-P"');
    // Nada entrou na lista e o modal continua aberto no passo 2 para o
    // lojista corrigir o SKU base — a falha não vira "criado com sucesso".
    expect(variantesNaTela()).toEqual(["Cor / Tamanho: Branca / P"]);
    expect(botaoPorTexto(document.body, "Efetivar 1 variante")).toBeDefined();
  });

  it("colisão de SKU com OUTRO produto da loja também recusa (a UNIQUE é global)", async () => {
    // A linha que ocupa o SKU mora em OUTRO produto — a checagem só olhando
    // este produto deixaria passar e o banco derrubaria o lote no salvar.
    produtosDaLoja = [
      {
        id: "prod-2",
        variants: [{ id: "x1", sku: "BLU-AMA-P" }],
      },
    ];

    await montarEmEdicao();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-valor-0", "Amarela");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await digitarCampo("grade-valor-1", "P");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    await digitarCampo("grade-sku-base", "blu");

    await act(async () => {
      clicarObrigatorio("Efetivar 1 variante");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('O SKU "BLU-AMA-P"');
    expect(variantesNaTela()).toEqual(["Cor / Tamanho: Branca / PP"]);
  });

  it("trava de um grupo: grade com atributo novo em produto legado recebe diagnóstico e NÃO converte", async () => {
    await montarEmEdicao([
      {
        id: "v9",
        productId: "prod-1",
        name: "Cor",
        value: "Branca",
        sku: undefined,
        stockIncrement: 4,
        priceOverride: undefined,
        active: true,
        imageUrl: undefined,
      },
    ]);

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    // O grupo legado "Cor" abre pronto — completar o MESMO grupo é permitido.
    expect(valorDoCampo("grade-nome-0")).toBe("Cor");
    // A grade desta tentativa: Cor {Branca — o chip já usado} × Tamanho {P}.
    await act(async () => {
      clicarChipObrigatorio("Branca");
    });
    // Mas misturar com Tamanho viraria o segundo grupo que mente no estoque.
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarCampo("grade-nome-1", "Tamanho");
    await digitarCampo("grade-valor-1", "P");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 2");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(
      'Este produto já usa "Cor"',
    );
    // Ficou no passo 1 — nada foi gerado nem convertido.
    expect(botaoPorTexto(document.body, "Gerar grade")).toBeDefined();
    expect(linhasDaGrade()).toEqual([]);
  });

  it("produto legado de um grupo aceita a grade do MESMO grupo (Cor: Preta entra, Branca fica)", async () => {
    await montarEmEdicao([
      {
        id: "v9",
        productId: "prod-1",
        name: "Cor",
        value: "Branca",
        sku: undefined,
        stockIncrement: 4,
        priceOverride: undefined,
        active: true,
        imageUrl: undefined,
      },
    ]);

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    expect(valorDoCampo("grade-nome-0")).toBe("Cor");
    // O grupo é o mesmo: digitar "Preta" (valor novo) e gerar é permitido —
    // a grade alimenta o grupo que o produto já tem em vez de inventar outro.
    await digitarCampo("grade-valor-0", "Preta");
    await act(async () => {
      clicarPorRotulo("Adicionar valor do atributo 1");
    });
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    await act(async () => {
      clicarObrigatorio("Efetivar 1 variante");
    });

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Branca", "Cor: Preta"]);
  });
});
