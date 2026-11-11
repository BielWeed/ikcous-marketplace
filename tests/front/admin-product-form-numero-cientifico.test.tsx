// @vitest-environment jsdom
//
// Número em notação científica virava preço/peso errado EM SILÊNCIO.
//
// (1) Preço: com 24 dígitos ou mais na máscara de moeda o `toFixed(2)` devolvia
//     "1e+22"; a limpeza arrancava o "e" e o "+" e lia "122" -> o preço da
//     variação (o que a cobrança usa) saía R$ 122,00, abaixo do teto. Agora o
//     valor é limitado antes de virar texto e o teto de R$ 9.999.999,99 recusa.
// (2) Peso e medidas: `<input type="number">` aceita "1e3". O formulário lia
//     "13" (o "e" era arrancado) enquanto o aviso "talvez seja em gramas" lia
//     1000. O estoque já recusa "1e3"; peso e medidas agora recusam igual, com
//     o campo dizendo o motivo e o Salvar desligado.
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

// 25 noves/uns: 1,1e22 reais, passava de 1e21 e o texto virava expoente.
const GIGANTE = "1".repeat(25);
// 1 e 24 zeros = 1e+22 em reais, lido antes como "122".
const UM_E_VINTE_E_QUATRO_ZEROS = `1${"0".repeat(24)}`;
const MENSAGEM_TETO =
  "O preço desta variação passa do máximo de R$ 9.999.999,99. Use um valor menor.";
const MENSAGEM_TETO_GRADE =
  "O preço de uma variação passa do máximo de R$ 9.999.999,99. Use um valor menor.";
const NUMERO_INVALIDO = "Número inválido";

describe("AdminProductFormView — número em notação científica", () => {
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

  async function montar() {
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

  const clicar = async (alvo: string | RegExp) => {
    const botao = [...document.body.querySelectorAll("button")].find((b) =>
      casaOTexto(b.textContent, alvo),
    );
    if (!botao) throw new Error(`Botão "${alvo}" não está na tela.`);
    await act(async () => {
      botao.click();
    });
  };

  const variacoesNaLista = () =>
    document.querySelectorAll('[data-testid="variante-cadastrada"]').length;

  describe("preço próprio da variação (modal)", () => {
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

    it.each([
      ["25 dígitos 1", GIGANTE],
      ["1 e 24 zeros (o 'e+22' lido como 122)", UM_E_VINTE_E_QUATRO_ZEROS],
      ["400 dígitos (Infinity)", "9".repeat(400)],
    ])(
      "%s: avisa o teto e NÃO cria variação com preço pequeno",
      async (_n, dig) => {
        await montar();
        await abrirNovaVariacao("GG");
        await digitarCampo("variant-price", dig);
        await salvarVariacao();

        expect(mocks.toastError).toHaveBeenCalledWith(MENSAGEM_TETO);
        expect(variacoesNaLista()).toBe(0);
      },
    );

    it("preço comum segue criando a variação (controle)", async () => {
      await montar();
      await abrirNovaVariacao("GG");
      await digitarCampo("variant-price", "8990");
      await salvarVariacao();

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(variacoesNaLista()).toBe(1);
    });
  });

  describe("preço na grade", () => {
    async function abrirGradeDe2() {
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
    }

    it.each([
      ["25 dígitos 1", GIGANTE],
      ["1 e 24 zeros", UM_E_VINTE_E_QUATRO_ZEROS],
    ])(
      "preço de uma linha com %s: avisa o teto, nenhuma variação entra e o texto fica",
      async (_n, dig) => {
        await montar();
        await abrirGradeDe2();
        await digitarCampo("grade-linha-preco-1", dig);
        await clicar("Salvar 2 variações");

        expect(mocks.toastError).toHaveBeenCalledWith(MENSAGEM_TETO_GRADE);
        expect(variacoesNaLista()).toBe(0);
        expect(valorDoCampo("grade-linha-preco-1")).toMatch(/^[\d.]+,\d{2}$/);
      },
    );

    it.each([
      ["25 dígitos 1", GIGANTE],
      ["1 e 24 zeros", UM_E_VINTE_E_QUATRO_ZEROS],
    ])(
      "'Aplicar para todas' com %s: as linhas não ganham preço pequeno e o salvar recusa",
      async (_n, dig) => {
        await montar();
        await abrirGradeDe2();
        await digitarCampo("grade-aplicar-preco", dig);
        await clicar("Aplicar para todas");
        await clicar("Salvar 2 variações");

        expect(mocks.toastError).toHaveBeenCalledWith(MENSAGEM_TETO_GRADE);
        expect(variacoesNaLista()).toBe(0);
      },
    );
  });

  describe("peso e medidas em notação científica", () => {
    it.each([
      ["product-weight", "1e3"],
      ["product-weight", "1E3"],
      ["product-weight", "1e-3"],
      ["product-width", "2e1"],
      ["product-height", "1.5e2"],
      ["product-length", "3e0"],
    ])(
      "%s = %s: o campo recusa, o Salvar desliga e nada é gravado",
      async (id, valor) => {
        await montar();
        await digitarCampo(id, valor);

        expect(textoDe(`${id}-erro`)).toContain(NUMERO_INVALIDO);
        expect(document.getElementById(id)?.getAttribute("aria-invalid")).toBe(
          "true",
        );
        expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
        await salvar();
        expect(mocks.updateProduct).not.toHaveBeenCalled();
      },
    );

    it("peso '1e3' não dispara também o aviso 'mais de 30 kg' (um só diagnóstico)", async () => {
      await montar();
      await digitarCampo("product-weight", "1e3");

      expect(document.getElementById("product-weight-aviso")).toBeNull();
    });

    it("voltar a um número comum tira o erro e libera o Salvar; o payload leva o número digitado", async () => {
      await montar();
      await digitarCampo("product-weight", "1e3");
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);

      await digitarCampo("product-weight", "0.35");
      await digitarCampo("product-width", "20");
      expect(document.getElementById("product-weight-erro")).toBeNull();
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
      await salvar();
      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      const remendo = mocks.updateProduct.mock.calls[0][1];
      expect(remendo).toHaveProperty("weightKg", 0.35);
      expect(remendo).toHaveProperty("widthCm", 20);
    });

    it("peso acima de 30 kg SEM expoente segue avisando 'gramas' (controle)", async () => {
      await montar();
      await digitarCampo("product-weight", "350");

      expect(document.getElementById("product-weight-erro")).toBeNull();
      expect(textoDe("product-weight-aviso")).toContain("mais de 30 kg");
    });
  });
});
