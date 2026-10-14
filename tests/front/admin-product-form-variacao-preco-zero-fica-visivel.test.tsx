// @vitest-environment jsdom
//
// Defeito medido: em "Preço diferente nesta variação", o 0 é gravado como
// `priceOverride: 0` de propósito (brinde), e o banco usa
// `COALESCE(price_override, preco_venda)` — então 0 vira o preço de verdade e
// a variação é vendida de graça. Mas:
//   - a linha da variação mostrava um "0" solto (`{0 && ...}` devolve 0) em vez
//     de "R$ 0,00";
//   - o formulário não avisava o que o 0 faz.
//
// Contrato provado aqui:
//   1. A linha da variação com preço 0 mostra "R$ 0,00"; sem preço próprio
//      (null/undefined) não mostra nada de preço.
//   2. No formulário da variação, com o preço 0 digitado, aparece o aviso
//      "Com R$ 0,00 esta variação será vendida de graça…". Com outro valor, ou
//      campo vazio, não aparece.
//   3. O aviso NÃO bloqueia: salvar a variação com 0 continua funcionando e
//      grava 0 (a linha passa a mostrar "R$ 0,00").
//
// Mesmo padrão de admin-product-form-variante-aponta-imagem.test.tsx.
import { act } from "react";
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

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({ src, alt }: { src: string; alt?: string }) => (
    <img src={src} alt={alt ?? ""} />
  ),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const AVISO = /Com R\$\s0,00 esta variação será vendida de graça/;

const botaoPorTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** O campo de preço só entrega o valor depois de uma pausa (200 ms). */
async function digitarPreco(valor: string) {
  await act(async () => {
    digitar("variant-price", valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

const variacao = (valor: string, priceOverride?: number | null) => ({
  id: `v-${valor}`,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: 1,
  active: true,
  priceOverride,
});

/** O texto da linha (cartão) da variação cujo valor é `valor`. */
function linhaDaVariacao(valor: string): string {
  const nome = [
    ...document.body.querySelectorAll('[data-testid="variante-cadastrada"]'),
  ].find((el) => el.textContent?.includes(valor));
  const linha = nome?.closest(".group");
  if (!linha) throw new Error(`A linha da variação ${valor} não existe.`);
  return linha.textContent ?? "";
}

describe("AdminProductFormView — preço 0 da variação fica visível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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

  async function montarProduto(variants: unknown[] = []) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 10,
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

  async function abrirNovaVariacao() {
    await act(async () => {
      botaoPorTexto("+ Novo")?.click();
    });
  }

  describe("a linha da variação", () => {
    it("preço próprio 0: mostra 'R$ 0,00', não um '0' solto", async () => {
      await montarProduto([variacao("Brinde", 0)]);

      const texto = linhaDaVariacao("Brinde");
      expect(texto).toMatch(/R\$\s0,00/);
      // O defeito: `{0 && ...}` desenhava só o algarismo depois de "1 UND".
      expect(texto).not.toMatch(/UND0/);
    });

    it("preço próprio 49,9: continua mostrando o preço, agora em reais com vírgula", async () => {
      await montarProduto([variacao("Premium", 49.9)]);

      expect(linhaDaVariacao("Premium")).toMatch(/R\$\s49,90/);
    });

    it("sem preço próprio (nulo ou ausente): não mostra preço nenhum", async () => {
      await montarProduto([variacao("Normal", null), variacao("Comum")]);

      for (const valor of ["Normal", "Comum"]) {
        const texto = linhaDaVariacao(valor);
        expect(texto).not.toContain("R$");
        expect(texto.endsWith("1 UND")).toBe(true);
      }
    });
  });

  describe("o aviso no formulário da variação", () => {
    it("com 0 digitado: avisa que a variação sai de graça e diz como usar o preço do produto", async () => {
      await montarProduto();
      await abrirNovaVariacao();
      expect(document.body.textContent).not.toMatch(AVISO);

      await digitarPreco("0");

      expect(document.body.textContent).toMatch(AVISO);
      expect(document.body.textContent).toContain(
        "Para usar o preço do produto, deixe o campo vazio.",
      );
    });

    it("com outro valor, ou campo vazio: não avisa", async () => {
      await montarProduto();
      await abrirNovaVariacao();

      await digitarPreco("5");
      expect(document.body.textContent).not.toMatch(AVISO);

      await digitarPreco("0");
      expect(document.body.textContent).toMatch(AVISO);

      await digitarPreco("");
      expect(document.body.textContent).not.toMatch(AVISO);
    });

    it("não bloqueia: salvar a variação com 0 grava 0 e a linha mostra 'R$ 0,00'", async () => {
      await montarProduto();
      await abrirNovaVariacao();
      await act(async () => {
        digitar("variant-name", "Cor");
        digitar("variant-value", "Brinde");
        await new Promise((r) => setTimeout(r, 300));
      });
      await digitarPreco("0");

      await act(async () => {
        botaoPorTexto("Salvar variação")?.click();
      });

      expect(linhaDaVariacao("Brinde")).toMatch(/R\$\s0,00/);
    });
  });
});
