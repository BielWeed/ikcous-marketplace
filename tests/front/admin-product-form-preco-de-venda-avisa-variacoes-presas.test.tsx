// @vitest-environment jsdom
//
// O Preço de Venda mudou e alguns tamanhos ficariam presos no preço antigo.
//
// Defeito: o produto custava R$ 89,90 e a lojista pôs 89,90 em "Preço para
// todas" da grade; cada tamanho gravou 89,90 como preço próprio. Ela baixou o
// Preço de Venda para 69,90, salvou, e a loja seguia cobrando 89,90 — nada na
// tela avisava. Decisão do sócio (28/11/2026): sob o Preço de Venda, a tela
// lista os tamanhos com preço próprio IGUAL ao preço antigo e oferece um botão
// que os faz seguir o preço do produto (só no formulário; vale ao salvar). Os
// de preço próprio diferente ganham só uma linha informativa.
//
// O botão grava `priceOverride: null` (nunca `undefined`): o caminho de
// gravação de uma variação pula a chave `undefined` e o preço antigo
// sobreviveria (laudo 0109).
//
// Mesmo padrão dos testes irmãos (admin-product-form-grade-preco): createRoot +
// act, hooks de dados mockados, debounce do LocalBufferedInput esperado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateProduct: vi.fn(),
  salvarProdutoComGrade: vi
    .fn()
    .mockResolvedValue({ produto: undefined, recusadas: [] }),
  upsertVariants: vi.fn(),
  fetchProduct: vi.fn(),
  rpc: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

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

/** Texto do elemento com espaços (inclusive o inseparável do "R$") normais. */
const textoDe = (testid: string): string | null => {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  return el ? (el.textContent?.replace(/\s+/g, " ").trim() ?? "") : null;
};

const botaoDoAviso = () =>
  document.querySelector(
    '[data-testid="seguir-o-preco-do-produto"]',
  ) as HTMLButtonElement | null;

const tamanho = (id: string, value: string, priceOverride?: number) => ({
  id,
  productId: "prod-1",
  name: "Tamanho",
  value,
  sku: "",
  stockIncrement: 3,
  priceOverride,
  active: true,
  imageUrl: undefined,
});

const produtoCom = (variants: unknown[]) => ({
  id: "prod-1",
  name: "Blusa de Tricô",
  description: "Blusa quente de tricô",
  price: 89.9,
  costPrice: 40,
  originalPrice: null,
  stock: 12,
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

describe("AdminProductFormView — baixar o Preço de Venda avisa dos tamanhos presos no preço antigo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mocks.updateProduct.mockResolvedValue({ id: "prod-1" });
    mocks.upsertVariants.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
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

  async function montar(variants: unknown[]) {
    mocks.fetchProduct.mockResolvedValue(produtoCom(variants));
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

  const presos = () => [
    tamanho("v-p", "P", 89.9),
    tamanho("v-m", "M", 89.9),
    tamanho("v-g", "G", 89.9),
  ];

  it("sem mudar o preço, não há aviso", async () => {
    await montar(presos());
    expect(valorDoCampo("product-sale-price")).toBe("89,90");
    expect(textoDe("aviso-variacoes-nao-seguem-o-preco")).toBeNull();
  });

  it("baixar para 69,90 lista P, M e G pelo nome, com o preço antigo e o novo, e oferece o botão", async () => {
    await montar(presos());
    await digitarCampo("product-sale-price", "69,90");
    expect(valorDoCampo("product-sale-price")).toBe("69,90");

    const aviso = textoDe("aviso-variacoes-nao-seguem-o-preco") ?? "";
    expect(aviso).toContain(
      "P, M e G estão com preço próprio de R$ 89,90 e não vão mudar para R$ 69,90",
    );
    expect(botaoDoAviso()?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Mudar esses 3 para R$ 69,90",
    );
    // Toque confortável (44 px) no celular.
    expect(botaoDoAviso()?.className).toContain("min-h-11");
  });

  it('o botão faz os três seguirem o produto: mostra "Pronto, salve para valer" e o salvar manda priceOverride null nos três', async () => {
    await montar([...presos(), tamanho("v-gg", "GG", 109.9)]);
    await digitarCampo("product-sale-price", "69,90");

    await act(async () => {
      botaoDoAviso()?.click();
    });
    expect(botaoDoAviso()?.textContent?.trim()).toBe(
      "Pronto, salve para valer",
    );
    const aviso = textoDe("aviso-variacoes-nao-seguem-o-preco") ?? "";
    expect(aviso).not.toContain("não vão mudar");
    // O GG de preço diferente segue só informado.
    expect(aviso).toContain(
      "GG (R$ 109,90) tem preço próprio e continua como está",
    );

    const salvar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar alterações",
    ) as HTMLButtonElement | undefined;
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    expect(mocks.salvarProdutoComGrade.mock.calls[0]?.[1]).toHaveProperty(
      "price",
      69.9,
    );
    const lote = mocks.salvarProdutoComGrade.mock.calls[0]?.[2]
      .variantes as Array<{ value: string; priceOverride?: number | null }>;
    for (const valor of ["P", "M", "G"]) {
      const variacao = lote.find((v) => v.value === valor);
      expect(variacao, valor).toBeDefined();
      // null de verdade: a chave existe e não é undefined.
      expect(variacao).toHaveProperty("priceOverride", null);
    }
    // O GG não foi mexido: nem viaja, e o preço próprio dele fica no banco.
    expect(lote.some((v) => v.value === "GG")).toBe(false);
  });

  it("só tamanhos de preço diferente: aparece só a linha informativa, sem botão", async () => {
    await montar([tamanho("v-gg", "GG", 109.9), tamanho("v-p", "P")]);
    await digitarCampo("product-sale-price", "69,90");

    const aviso = textoDe("aviso-variacoes-nao-seguem-o-preco") ?? "";
    expect(aviso).toContain(
      "GG (R$ 109,90) tem preço próprio e continua como está",
    );
    expect(aviso).not.toContain("não vão mudar");
    expect(botaoDoAviso()).toBeNull();
  });

  it("tamanho desligado ou de preço zero (brinde) não entra no aviso", async () => {
    await montar([
      tamanho("v-p", "P", 89.9),
      { ...tamanho("v-m", "M", 89.9), active: false },
      tamanho("v-b", "BRINDE", 0),
    ]);
    await digitarCampo("product-sale-price", "69,90");

    const aviso = textoDe("aviso-variacoes-nao-seguem-o-preco") ?? "";
    expect(aviso).toContain(
      "P está com preço próprio de R$ 89,90 e não vai mudar para R$ 69,90",
    );
    expect(aviso).not.toContain("M ");
    expect(aviso).not.toContain("BRINDE");
    expect(botaoDoAviso()?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Mudar esse para R$ 69,90",
    );
  });
});
