// @vitest-environment jsdom
//
// O campo de moeda aceita qualquer quantidade de dígitos, e o formulário só
// conferia "maior que zero". Um valor enorme (um código de barras digitado no
// campo errado, um zero a mais) só falhava no BANCO (a coluna guarda até
// R$ 99.999.999,99), com um aviso que não dizia qual campo. Agora cada campo de
// dinheiro tem o teto de R$ 9.999.999,99: passou, o campo diz qual é e o quanto
// pode, e o Salvar fica desligado -- sem apagar o que a lojista digitou.
//
// Produto antigo que já está acima do teto (cadastrado antes desta regra) e
// que ela não mexeu nesse campo segue editável: só o valor NOVO esbarra no teto.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";
import { BOTAO_GERAR_GRADE, casaOTexto } from "./helpers/gerar-grade";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  updateProduct: vi.fn(),
  salvarProdutoComGrade: vi
    .fn()
    .mockResolvedValue({ produto: undefined, recusadas: [] }),
  upsertVariants: vi.fn(),
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
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
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
    // O campo só entrega o valor ao formulário depois de uma pausa.
    await new Promise((r) => setTimeout(r, 300));
  });
}

const valorDoCampo = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

const textoDe = (id: string): string =>
  document.getElementById(id)?.textContent ?? "";

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

// Dez dígitos na máscara de moeda = R$ 10.000.000,00 (um centavo acima do teto
// de R$ 9.999.999,99 está a partir de R$ 10.000.000,00); nove noves = no teto.
const ACIMA_DO_TETO = "1000000000";
const NO_TETO = "999999999";

describe("AdminProductFormView — teto de R$ 9.999.999,99 nos campos de dinheiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProduct.mockResolvedValue({ id: "p-1" });
    mocks.upsertVariants.mockResolvedValue(undefined);
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

  async function montar(produto: Record<string, unknown> = {}) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      costPrice: null,
      originalPrice: null,
      stock: 5,
      sold: 0,
      category: "Geral",
      images: ["https://exemplo.test/camiseta.jpg"],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [] as unknown[],
      ...produto,
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

  const salvar = async () => {
    await act(async () => {
      botaoPorTexto("Salvar alterações")?.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  };

  describe("preço de venda", () => {
    it("acima do teto: a mensagem diz o campo e o teto, o Salvar desliga e o que ela digitou fica", async () => {
      await montar();
      await digitarCampo("product-sale-price", ACIMA_DO_TETO);

      expect(textoDe("product-price-error")).toBe(
        "O preço de venda passa do máximo de R$ 9.999.999,99. Use um valor menor.",
      );
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
      expect(valorDoCampo("product-sale-price")).toBe("10.000.000,00");
      await salvar();
      expect(mocks.updateProduct).not.toHaveBeenCalled();
    });

    it("exatamente no teto: grava como antes", async () => {
      await montar();
      await digitarCampo("product-sale-price", NO_TETO);

      expect(document.getElementById("product-price-error")).toBeNull();
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
      await salvar();
      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      expect(mocks.updateProduct.mock.calls[0][1]).toHaveProperty(
        "price",
        9999999.99,
      );
    });

    it("corrigir o valor para baixo do teto libera o Salvar", async () => {
      await montar();
      await digitarCampo("product-sale-price", ACIMA_DO_TETO);
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);

      await digitarCampo("product-sale-price", "9000");
      expect(document.getElementById("product-price-error")).toBeNull();
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
    });
  });

  describe("custo e preço de antes (De)", () => {
    it("custo acima do teto diz que é o custo e bloqueia", async () => {
      await montar();
      await digitarCampo("product-cost-price", ACIMA_DO_TETO);

      expect(textoDe("product-cost-error")).toBe(
        "O preço de custo passa do máximo de R$ 9.999.999,99. Use um valor menor.",
      );
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
    });

    it("'De' acima do teto com a promoção ligada diz que é o 'De' e bloqueia", async () => {
      await montar();
      await act(async () => {
        (
          document.getElementById("product-promo-active") as HTMLInputElement
        ).click();
      });
      await digitarCampo("product-original-price", ACIMA_DO_TETO);

      expect(document.body.textContent).toContain(
        'O preço de antes ("De") passa do máximo de R$ 9.999.999,99. Use um valor menor.',
      );
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
    });
  });

  describe("produto que já estava acima do teto antes desta regra", () => {
    it("editar só o nome não é bloqueado e o preço antigo não viaja", async () => {
      await montar({ price: 150000000, costPrice: 120000000 });

      expect(document.getElementById("product-price-error")).toBeNull();
      await digitarCampo("product-name", "Camiseta nova");
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
      await salvar();

      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      const remendo = mocks.updateProduct.mock.calls[0][1];
      expect(remendo).toHaveProperty("name", "Camiseta nova");
      expect(remendo).not.toHaveProperty("price");
      expect(remendo).not.toHaveProperty("costPrice");
    });

    it("mexer no preço e deixar outro valor acima do teto bloqueia", async () => {
      await montar({ price: 150000000 });
      await digitarCampo("product-sale-price", "2000000000");

      expect(textoDe("product-price-error")).toContain(
        "passa do máximo de R$ 9.999.999,99",
      );
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
    });
  });

  describe("preço próprio da variação", () => {
    async function abrirNovaVariacao(valor: string) {
      await act(async () => {
        [...document.body.querySelectorAll("button")]
          .find((b) => b.textContent?.includes("+ Novo"))
          ?.click();
      });
      await escolherAtributo(0, "Tamanho", "variant-name", digitarCampo);
      await digitarCampo("variant-value", valor);
    }

    const salvarVariacao = async () => {
      const botao = [...document.querySelectorAll("button")]
        .filter((b) => b.textContent?.trim() === "Salvar variação")
        .at(-1);
      if (!botao) throw new Error("O botão do modal não está na tela.");
      await act(async () => {
        botao.click();
      });
    };

    const variacoesNaLista = () =>
      document.querySelectorAll('[data-testid="variante-cadastrada"]').length;

    it("acima do teto: avisa qual é o preço, não cria a variação e mantém o digitado", async () => {
      await montar();
      await abrirNovaVariacao("GG");
      await digitarCampo("variant-price", ACIMA_DO_TETO);
      await salvarVariacao();

      expect(mocks.toastError).toHaveBeenCalledWith(
        "O preço desta variação passa do máximo de R$ 9.999.999,99. Use um valor menor.",
      );
      expect(variacoesNaLista()).toBe(0);
      expect(valorDoCampo("variant-price")).toBe("10.000.000,00");
    });

    it("no teto: cria a variação como antes", async () => {
      await montar();
      await abrirNovaVariacao("GG");
      await digitarCampo("variant-price", NO_TETO);
      await salvarVariacao();

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(variacoesNaLista()).toBe(1);
    });

    it("grade com um preço acima do teto: avisa, não cria nenhuma variação e a grade segue aberta", async () => {
      const clicar = async (alvo: string | RegExp) => {
        const botao = [...document.body.querySelectorAll("button")].find((b) =>
          casaOTexto(b.textContent, alvo),
        );
        if (!botao) throw new Error(`Botão "${alvo}" não está na tela.`);
        await act(async () => {
          botao.click();
        });
      };
      await montar();
      await clicar("+ Grade");
      await escolherAtributo(0, "Tamanho", "grade-nome-0", digitarCampo);
      for (const tam of ["P", "M"]) {
        await digitarCampo("grade-valor-0", tam);
        await act(async () => {
          (
            document.querySelector(
              '[aria-label="Adicionar valor do atributo 1"]',
            ) as HTMLButtonElement
          ).click();
        });
      }
      await clicar(BOTAO_GERAR_GRADE);
      await digitarCampo("grade-linha-preco-1", ACIMA_DO_TETO);
      await clicar("Salvar 2 variações");

      expect(mocks.toastError).toHaveBeenCalledWith(
        "O preço de uma variação passa do máximo de R$ 9.999.999,99. Use um valor menor.",
      );
      expect(variacoesNaLista()).toBe(0);
      expect(valorDoCampo("grade-linha-preco-1")).toBe("10.000.000,00");
    });

    it("variação antiga acima do teto, reaberta e salva sem mexer no preço, segue valendo", async () => {
      await montar({
        variants: [
          {
            id: "v-1",
            productId: "p-1",
            name: "Tamanho",
            value: "M",
            stockIncrement: 3,
            active: true,
            priceOverride: 150000000,
          },
        ],
      });
      await act(async () => {
        (
          document.querySelector(
            '[aria-label="Editar variação M"]',
          ) as HTMLButtonElement
        ).click();
      });
      const botoes = [...document.querySelectorAll("button")].filter(
        (b) => b.textContent?.trim() === "Salvar",
      );
      await act(async () => {
        botoes.at(-1)?.click();
      });

      expect(mocks.toastError).not.toHaveBeenCalled();
    });
  });
});
