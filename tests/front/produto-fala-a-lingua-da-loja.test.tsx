// @vitest-environment jsdom
//
// PAINEL SIMPLES, G3 — o formulário de produto fala a língua da loja.
//
// "SKU", "EAN/UPC/GTIN", "Efetivar Variante", "Sobrescrever R$" e "Status no
// Catálogo" não são palavras da lojista (glossário: src/lib/glossario-do-painel.ts).
// O termo técnico fica só nos DOIS rótulos de campo, entre parênteses, porque as
// mensagens do `useProducts` (fora desta frente) ainda dizem "SKU".
//
// Montagem real (react-dom/client + jsdom), sem @testing-library — o mesmo
// molde dos outros testes do formulário. O que vale aqui é o TEXTO que a
// lojista lê; o payload e a validação têm teste próprio.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JARGAO = /\bSKU\b|\bEAN\b|\bUPC\b|\bGTIN\b/;

const produtoComUmaVariacao = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 3,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  codigoBarras: "",
  variants: [
    {
      id: "v-1",
      productId: "prod-1",
      name: "Cor",
      value: "Azul",
      sku: "AZ-1",
      codigoBarras: "",
      stockIncrement: 3,
      stock: 3,
      priceOverride: null,
      active: true,
      imageUrl: "",
    },
  ],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

function textoDoRotulo(idDoCampo: string): string {
  const rotulo = document.querySelector(`label[for="${idDoCampo}"]`);
  if (!rotulo) throw new Error(`rótulo de #${idDoCampo} ausente`);
  return rotulo.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function botaoComTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.replace(/\s+/g, " ").trim() === texto,
  );
}

describe("AdminProductFormView — rótulos na língua da loja (G3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoComUmaVariacao);
    const armazem = new Map<string, string>();
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

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    if (productId) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  it("os campos do produto dizem 'Código interno (SKU)' e 'Código de barras', sem EAN/UPC/GTIN", async () => {
    await montar();

    expect(textoDoRotulo("product-sku")).toBe("Código interno (SKU)");
    expect(textoDoRotulo("product-codigo-barras")).toBe("Código de barras");

    const sku = document.getElementById("product-sku") as HTMLInputElement;
    const barras = document.getElementById(
      "product-codigo-barras",
    ) as HTMLInputElement;
    expect(sku.placeholder).not.toMatch(JARGAO);
    expect(barras.placeholder).not.toMatch(JARGAO);
    expect(document.body.textContent).not.toContain("Código SKU");
  });

  it("o erro do código interno inválido não fala 'SKU'", async () => {
    await montar();
    const sku = document.getElementById("product-sku") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(sku, "AB!");
      sku.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });

    const erro = [...document.querySelectorAll("span")].find((s) =>
      s.textContent?.startsWith("O código interno"),
    );
    expect(erro?.textContent).toBe(
      "O código interno deve conter apenas letras, números e hífens.",
    );
    expect(document.body.textContent).not.toMatch(/O SKU deve/);
  });

  it("o modal de variação usa 'Aparece na loja?', 'Preço diferente nesta variação' e 'Salvar variação'", async () => {
    await montar();
    await act(async () => {
      botaoComTexto("+ Novo")?.click();
    });

    expect(textoDoRotulo("variant-sku")).toBe("Código interno (SKU)");
    expect(textoDoRotulo("variant-status")).toBe("Aparece na loja?");
    expect(textoDoRotulo("variant-price")).toBe(
      "Preço diferente nesta variação",
    );
    expect(textoDoRotulo("variant-codigo-barras")).toBe("Código de barras");
    expect(botaoComTexto("Salvar variação")).toBeDefined();
    expect(botaoComTexto("Efetivar Variante")).toBeUndefined();

    for (const id of ["variant-sku", "variant-codigo-barras"]) {
      const campo = document.getElementById(id) as HTMLInputElement;
      expect(campo.placeholder).not.toMatch(JARGAO);
    }
    const modal = document.getElementById("variant-sku")?.closest(".fixed");
    expect(modal?.textContent).not.toMatch(
      /Sobrescrever|Status no Cat[áa]logo|Salvar Protocolo/,
    );
  });

  it("editar uma variação mostra o botão 'Salvar' (não 'Salvar Protocolo')", async () => {
    await montar("prod-1");
    const editar = document
      .querySelector('[data-testid="variante-cadastrada"]')
      ?.closest(".group")
      ?.querySelector("button") as HTMLButtonElement | null;
    expect(editar).not.toBeNull();
    await act(async () => {
      editar?.click();
    });

    const modal = document.getElementById("variant-sku")?.closest(".fixed");
    const botoes = [...(modal?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(botoes).toContain("Salvar");
    expect(botoes).not.toContain("Salvar Protocolo");
  });

  it("a grade fala 'Código interno base', 'sem código' e 'Salvar N variações'", async () => {
    await montar();
    await act(async () => {
      (
        document.querySelector(
          '[data-testid="abrir-grade"]',
        ) as HTMLButtonElement
      ).click();
    });

    const digitar = async (id: string, valor: string) => {
      await act(async () => {
        const el = document.getElementById(id) as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(el, valor);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
      });
    };
    await digitar("grade-nome-0", "Cor");
    await digitar("grade-valor-0", "Azul");
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Adicionar valor do atributo 1"]',
        ) as HTMLButtonElement
      ).click();
    });
    await digitar("grade-valor-0", "Verde");
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Adicionar valor do atributo 1"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      botaoComTexto("Gerar grade")?.click();
    });

    expect(textoDoRotulo("grade-sku-base")).toMatch(/^Código interno base/);
    const base = document.getElementById("grade-sku-base") as HTMLInputElement;
    expect(base.placeholder).not.toMatch(JARGAO);
    const previa = document.querySelector('[data-testid="sku-da-linha"]');
    expect(previa?.textContent).toBe("sem código");
    expect(botaoComTexto("Salvar 2 variações")).toBeDefined();
    expect(botaoComTexto("Efetivar 2 variantes")).toBeUndefined();
  });

  it("os guias do formulário e a ajuda geral não falam SKU/EAN/UPC/GTIN", async () => {
    await montar();
    await act(async () => {
      (
        document.querySelector(
          '[title="Ajuda / Guia de Dados do Produto"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        document.querySelector(
          '[title="Guia de Cadastro e Ajuda"]',
        ) as HTMLButtonElement
      ).click();
    });

    const guia = [...document.querySelectorAll("h3")].find((h) =>
      h.textContent?.includes("Guia de Cadastro e Informações"),
    );
    expect(guia).toBeDefined();
    const textoDoGuia = guia?.parentElement?.textContent ?? "";
    expect(textoDoGuia).not.toMatch(JARGAO);
    expect(textoDoGuia).toContain("Código interno");

    const ajuda = [...document.querySelectorAll("h4")].find((h) =>
      h.textContent?.includes("Dicas para um Cadastro de Sucesso"),
    );
    expect(ajuda).toBeDefined();
    const textoDaAjuda = document.body.textContent ?? "";
    expect(textoDaAjuda).toContain("Como cadastrar um produto");
    expect(ajuda?.parentElement?.textContent ?? "").not.toMatch(JARGAO);
  });
});

describe("PhoneSimulator — aba de avaliações na língua da loja", () => {
  it("a aba diz 'Avaliações (15)', não 'Reviews (15)'", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={vi.fn()}
          formData={{
            name: "Produto",
            description: "Descrição",
            price: "100",
            costPrice: "",
            originalPrice: "",
            stock: "1",
            category: "geral",
            images: [],
            freeShipping: false,
            isBestseller: false,
            isActive: true,
            variants: [],
          }}
          previewMode="page"
          setPreviewMode={vi.fn()}
          previewImgIndex={0}
          setPreviewImgIndex={vi.fn()}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={vi.fn()}
          activeDetailTab="description"
          setActiveDetailTab={vi.fn()}
        />,
      );
    });

    const abas = [...document.body.querySelectorAll("button")].map((b) =>
      b.textContent?.trim(),
    );
    expect(abas).toContain("Avaliações (15)");
    expect(abas).not.toContain("Reviews (15)");

    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });
});
