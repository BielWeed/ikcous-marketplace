// @vitest-environment jsdom
//
// PAINEL SIMPLES, H1 — o formulário de produto mostra o BÁSICO primeiro.
//
//   a. Fotos, Nome, Descrição (obrigatória), Preço de venda, Estoque e
//      Categoria ficam à vista; "Variações", "Peso e medidas", "Custo e lucro"
//      e "Avançado" são SecaoRecolhivel FECHADAS mas MONTADAS (`hidden`):
//      nada desmonta, então o que se digita lá dentro não se perde.
//   b. Erro de validação dentro de seção fechada abre a seção; e submeter com
//      erro põe o foco no primeiro campo com erro (abrindo a seção que a
//      lojista tinha fechado de novo).
//   c. Produto com variações abre "Variações" já expandida.
//
// Montagem real (react-dom/client + jsdom), mesmo molde dos outros testes do
// formulário (LocalBufferedInput tem debounce de 200 ms).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();
const configDaLoja = { shippingCoverage: "national" as "national" | "local" };

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
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
  useStore: () => ({ config: configDaLoja }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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
      id="product-category"
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
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
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

const SECOES = ["Variações", "Peso e medidas", "Custo e lucro", "Avançado"];

const produtoDoBanco = {
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
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

const variacao = {
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
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function secao(titulo: string): HTMLElement {
  const el = document.querySelector(`section[aria-label="${titulo}"]`);
  if (!el) throw new Error(`seção "${titulo}" ausente`);
  return el as HTMLElement;
}

function botaoDaSecao(titulo: string): HTMLButtonElement {
  return secao(titulo).querySelector("button") as HTMLButtonElement;
}

function estaAberta(titulo: string): boolean {
  return botaoDaSecao(titulo).getAttribute("aria-expanded") === "true";
}

function painelDaSecao(titulo: string): HTMLElement {
  const id = botaoDaSecao(titulo).getAttribute("aria-controls") ?? "";
  return document.getElementById(id) as HTMLElement;
}

/** À vista = sem nenhum ancestral com o atributo `hidden`. */
function aVista(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) throw new Error(`campo #${id} ausente`);
  return el.closest("[hidden]") === null;
}

function campo(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

async function clicar(el: HTMLElement | null | undefined) {
  await act(async () => {
    el?.click();
  });
}

function submeter() {
  const form = document.querySelector("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("AdminProductFormView — o básico primeiro (H1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    configDaLoja.shippingCoverage = "national";
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
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
        await esperar(0);
        await esperar(0);
        await esperar(0);
      });
    }
  }

  async function preencherOBasico() {
    await act(async () => {
      digitar("product-name", "Produto Teste");
      digitar("product-description", "Descrição de teste");
      digitar("product-sale-price", "1000");
      digitar("product-stock", "5");
      const categoria = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(categoria, "Geral");
      categoria.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar(300);
    });
  }

  describe("a. o que fica à vista e o que fica recolhido", () => {
    it("Fotos, Nome, Descrição, Preço, Estoque e Categoria à vista; as quatro seções fechadas", async () => {
      await montar();

      expect(document.body.textContent).toContain("Fotos do Produto");
      for (const id of [
        "product-name",
        "product-description",
        "product-sale-price",
        "product-stock",
        "product-category",
      ]) {
        expect(aVista(id), `#${id} deveria estar à vista`).toBe(true);
      }
      for (const titulo of SECOES) {
        expect(estaAberta(titulo), `"${titulo}" deveria nascer fechada`).toBe(
          false,
        );
        expect(painelDaSecao(titulo).hidden).toBe(true);
      }
    });

    it("as seções fechadas continuam MONTADAS, com os campos dentro", async () => {
      await montar();

      const dentro: Record<string, string[]> = {
        Variações: ["abrir-grade"],
        "Peso e medidas": [
          "product-weight",
          "product-width",
          "product-height",
          "product-length",
        ],
        "Custo e lucro": ["product-cost-price", "product-promo-active"],
        Avançado: ["product-sku", "product-codigo-barras"],
      };
      for (const [titulo, ids] of Object.entries(dentro)) {
        const painel = painelDaSecao(titulo);
        for (const id of ids) {
          const el =
            document.getElementById(id) ??
            document.querySelector(`[data-testid="${id}"]`);
          expect(el, `#${id} deveria estar montado`).not.toBeNull();
          expect(
            painel.contains(el),
            `#${id} deveria estar em "${titulo}"`,
          ).toBe(true);
        }
      }
    });

    it("o Preço de venda mora no básico, fora de qualquer seção recolhível", async () => {
      await montar();
      const preco = document.getElementById("product-sale-price");
      expect(preco?.closest("section[aria-label]")).toBeNull();
      expect(
        document
          .getElementById("product-cost-price")
          ?.closest('section[aria-label="Custo e lucro"]'),
      ).not.toBeNull();
    });

    it("com entrega local não existe a seção 'Peso e medidas' (como já era)", async () => {
      configDaLoja.shippingCoverage = "local";
      await montar();
      expect(
        document.querySelector('section[aria-label="Peso e medidas"]'),
      ).toBeNull();
      expect(document.getElementById("product-weight")).toBeNull();
    });

    it("abrir mostra os campos; digitar o peso com a seção fechada e reabrir mantém o valor", async () => {
      await montar();
      const peso = campo("product-weight");

      await digitarCampo("product-weight", "0.5");
      expect(aVista("product-weight")).toBe(false);

      await clicar(botaoDaSecao("Peso e medidas"));
      expect(estaAberta("Peso e medidas")).toBe(true);
      expect(aVista("product-weight")).toBe(true);
      expect(campo("product-weight")).toBe(peso);
      expect(campo("product-weight").value).toBe("0.5");

      await clicar(botaoDaSecao("Peso e medidas"));
      await clicar(botaoDaSecao("Peso e medidas"));
      expect(campo("product-weight")).toBe(peso);
      expect(campo("product-weight").value).toBe("0.5");
    });

    it("o que foi digitado em seção fechada vai no payload do Publicar", async () => {
      await montar();
      await preencherOBasico();
      await digitarCampo("product-sku", "ab 1");
      await digitarCampo("product-weight", "0.5");
      await digitarCampo("product-cost-price", "400");

      const publicar = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Publicar"),
      ) as HTMLButtonElement;
      expect(publicar.disabled).toBe(false);
      await act(async () => {
        publicar.click();
        await esperar(50);
      });

      expect(addProduct).toHaveBeenCalledTimes(1);
      expect(addProduct.mock.calls[0][0]).toMatchObject({
        name: "Produto Teste",
        description: "Descrição de teste",
        price: 10,
        stock: 5,
        category: "Geral",
        sku: "AB-1",
        costPrice: 4,
        weightKg: 0.5,
        codigoBarras: null,
        originalPrice: null,
      });
    });
  });

  describe("b. erro em seção fechada abre e foca", () => {
    function guardarRascunho(campos: Record<string, unknown>) {
      armazem.set(
        "ikcous_product_form_draft",
        JSON.stringify({
          name: "Produto Teste",
          description: "Descrição de teste",
          price: "10.00",
          stock: "5",
          category: "Geral",
          ...campos,
        }),
      );
    }

    it("erro que nasce com a seção fechada a abre sozinho; as outras seguem fechadas", async () => {
      guardarRascunho({ sku: "A!", costPrice: "-5" });
      await montar();
      await act(async () => {
        await esperar(50);
      });

      expect(estaAberta("Avançado")).toBe(true);
      expect(estaAberta("Custo e lucro")).toBe(true);
      expect(estaAberta("Peso e medidas")).toBe(false);
      expect(estaAberta("Variações")).toBe(false);
    });

    it("o AVISO de custo maior que o preço não força a seção aberta (não bloqueia)", async () => {
      guardarRascunho({ costPrice: "20.00" });
      await montar();
      await act(async () => {
        await esperar(50);
      });

      expect(document.body.textContent).toContain("Aviso: Preço de custo");
      expect(estaAberta("Custo e lucro")).toBe(false);
    });

    it("submeter com código interno inválido reabre 'Avançado' e foca o campo; nada é gravado", async () => {
      await montar();
      await preencherOBasico();
      await clicar(botaoDaSecao("Avançado"));
      await digitarCampo("product-sku", "AB!");
      expect(document.body.textContent).toContain(
        "O código interno deve conter apenas letras, números e hífens.",
      );

      // A lojista fecha a seção com o erro lá dentro.
      await clicar(botaoDaSecao("Avançado"));
      expect(estaAberta("Avançado")).toBe(false);

      await act(async () => {
        submeter();
        await esperar(100);
      });

      expect(estaAberta("Avançado")).toBe(true);
      expect(document.activeElement).toBe(campo("product-sku"));
      expect(addProduct).not.toHaveBeenCalled();
    });

    it("submeter com custo inválido reabre 'Custo e lucro' e foca o custo", async () => {
      guardarRascunho({ costPrice: "-5" });
      await montar();
      await act(async () => {
        await esperar(50);
      });
      expect(document.body.textContent).toContain(
        "Preço de custo não pode ser negativo.",
      );

      await clicar(botaoDaSecao("Custo e lucro"));
      expect(estaAberta("Custo e lucro")).toBe(false);

      await act(async () => {
        submeter();
        await esperar(100);
      });

      expect(estaAberta("Custo e lucro")).toBe(true);
      expect(document.activeElement).toBe(campo("product-cost-price"));
      expect(addProduct).not.toHaveBeenCalled();
    });

    it("erro num campo do básico foca o campo do básico (não abre seção alguma)", async () => {
      guardarRascunho({ price: "0" });
      await montar();
      await act(async () => {
        await esperar(50);
      });

      await act(async () => {
        submeter();
        await esperar(100);
      });

      expect(document.activeElement).toBe(campo("product-sale-price"));
      for (const titulo of SECOES) expect(estaAberta(titulo)).toBe(false);
      expect(addProduct).not.toHaveBeenCalled();
    });
  });

  describe("c. produto com variações abre 'Variações'", () => {
    it("editar produto COM variações: 'Variações' já expandida, e continua fechável", async () => {
      fetchProduct.mockResolvedValue({
        ...produtoDoBanco,
        variants: [variacao],
      });
      await montar("prod-1");

      expect(estaAberta("Variações")).toBe(true);
      expect(
        document
          .querySelector('[data-testid="abrir-grade"]')
          ?.closest("[hidden]"),
      ).toBeNull();
      expect(estaAberta("Peso e medidas")).toBe(false);

      await clicar(botaoDaSecao("Variações"));
      expect(estaAberta("Variações")).toBe(false);

      // Mexer em outro campo não reabre a seção que a lojista fechou.
      await digitarCampo("product-name", "Camiseta nova");
      expect(estaAberta("Variações")).toBe(false);
    });

    it("editar produto SEM variações: 'Variações' fechada", async () => {
      await montar("prod-1");
      expect(estaAberta("Variações")).toBe(false);
    });

    it("produto novo: 'Variações' fechada", async () => {
      await montar();
      expect(estaAberta("Variações")).toBe(false);
    });
  });
});
