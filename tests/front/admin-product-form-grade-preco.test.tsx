// @vitest-environment jsdom
//
// O preço digitado na grade de variações vira o Preço de Venda do produto.
//
// Defeito medido pelo dono (leigo), ao testar: ele digitava o preço na grade
// (passo 2, "Aplicar para todas") e o formulário do produto pedia o MESMO preço
// de novo. Decisão aprovada em 09/10/2026 (a regra pura mora em
// `preco-da-grade.test.ts`; aqui é a tela de verdade):
//  (1) produto sem preço: o preço da grade vira o Preço de Venda, as variações
//      ficam Auto (sem preço próprio) e o campo diz "veio da grade";
//  (2) produto que JÁ tem preço: a grade abre com ele de sugestão e o valor
//      digitado vale só para as combinações NOVAS (as antigas não são
//      remarcadas e o preço do produto não muda);
//  (3) preço só em algumas linhas: NÃO chuta — o produto segue pedindo o preço,
//      com a frase "as variações sem preço usam este";
//  (4) todas com preço e produto vazio: o produto recebe o MENOR e as linhas
//      iguais a ele viram Auto.
// A cobrança não muda (servidor: preço da variação, ou o do produto se Auto).
//
// Mesmo padrão dos testes irmãos (admin-product-form-grade-criar): createRoot +
// act, hooks de dados mockados, debounce de 200ms do LocalBufferedInput
// esperado a cada digitação.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  fetchProduct: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  // Produtos da loja inteira: o código interno é único na loja, não no produto.
  loja: { produtos: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
    products: mocks.loja.produtos,
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

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(texto);
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
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

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const valorDoCampo = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

const textoDe = (testid: string): string | null => {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  return el ? (el.textContent?.replace(/\s+/g, " ").trim() ?? "") : null;
};

const botaoPublicar = () => botaoPorTexto("Publicar") as HTMLButtonElement;

describe("AdminProductFormView — o preço da grade vira o Preço de Venda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loja.produtos = [];
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.updateProduct.mockResolvedValue({ id: "prod-1" });
    mocks.upsertVariants.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
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

  async function montarNovo() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  /** Nome, descrição e categoria — tudo menos o preço, que é o que se testa. */
  async function preencherSemPreco() {
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** Abre a grade e gera Cor (Amarela, Verde) × Tamanho (P, M): 4 combinações. */
  async function abrirGradeDe4() {
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await digitarCampo("grade-nome-0", "Cor");
    for (const cor of ["Amarela", "Verde"]) {
      await digitarCampo("grade-valor-0", cor);
      await act(async () => {
        clicarPorRotulo("Adicionar valor do atributo 1");
      });
    }
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await digitarCampo("grade-nome-1", "Tamanho");
    for (const tam of ["P", "M"]) {
      await digitarCampo("grade-valor-1", tam);
      await act(async () => {
        clicarPorRotulo("Adicionar valor do atributo 2");
      });
    }
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
  }

  describe("produto novo, sem preço", () => {
    it("(1) preço aplicado a todas: o campo Preço de Venda já vem preenchido, diz 'veio da grade', e as variações ficam Auto", async () => {
      await montarNovo();
      await abrirGradeDe4();
      expect(valorDoCampo("product-sale-price")).toBe("");

      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(valorDoCampo("product-sale-price")).toBe("60,00");
      expect(textoDe("preco-veio-da-grade")).toContain("veio da grade");
      // O que a lojista vê na lista: nenhuma variação com preço próprio.
      expect(document.body.textContent).not.toContain("R$ 60.00");
    });

    it("(1) o Publicar já fica liberado (o preço não é pedido de novo) e a gravação leva o preço do produto e variações Auto", async () => {
      await montarNovo();
      await preencherSemPreco();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(botaoPublicar().disabled).toBe(false);
      await act(async () => {
        botaoPublicar().click();
      });

      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      const enviado = mocks.addProduct.mock.calls[0]?.[0] as {
        price: number;
        variants: Array<{ priceOverride?: number }>;
      };
      expect(enviado.price).toBe(60);
      expect(enviado.variants).toHaveLength(4);
      for (const variante of enviado.variants) {
        expect(variante.priceOverride).toBeUndefined();
      }
    });

    it("(4) preços diferentes: o produto recebe o MENOR, as linhas iguais viram Auto e a mais cara mantém o preço próprio", async () => {
      await montarNovo();
      await preencherSemPreco();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      // A última (Verde / M) vale mais: ajuste fino depois do lote.
      await digitarCampo("grade-linha-preco-3", "80,00");
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(valorDoCampo("product-sale-price")).toBe("60,00");
      expect(textoDe("preco-veio-da-grade")).toContain("veio da grade");
      expect(document.body.textContent).toContain("R$ 80.00");
      expect(document.body.textContent).not.toContain("R$ 60.00");

      await act(async () => {
        botaoPublicar().click();
      });
      const enviado = mocks.addProduct.mock.calls[0]?.[0] as {
        price: number;
        variants: Array<{ value: string; priceOverride?: number }>;
      };
      expect(enviado.price).toBe(60);
      expect(enviado.variants.map((v) => v.priceOverride)).toEqual([
        undefined,
        undefined,
        undefined,
        80,
      ]);
    });

    it("(3) preço só em UMA linha e 'Aplicar para todas' vazio: NÃO chuta — o produto segue pedindo o preço, com a frase das variações sem preço", async () => {
      await montarNovo();
      await preencherSemPreco();
      await abrirGradeDe4();
      await digitarCampo("grade-linha-preco-1", "70,00");
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(valorDoCampo("product-sale-price")).toBe("");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
      expect(textoDe("preco-das-variacoes-sem-preco")).toContain(
        "variações sem preço usam este",
      );
      // O produto ainda precisa do preço: o Publicar fica desligado e a frase
      // do motivo diz o que falta.
      expect(botaoPublicar().disabled).toBe(true);
      expect(textoDe("motivo-do-bloqueio")).toContain("preço de venda");
      // A linha que tinha preço o mantém.
      expect(document.body.textContent).toContain("R$ 70.00");
    });

    it("preço ZERO na grade não vira Preço de Venda", async () => {
      await montarNovo();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "0,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });

      expect(valorDoCampo("product-sale-price")).toBe("");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
    });

    it("sem preço nenhum na grade: o campo segue vazio e sem a frase 'veio da grade' (o caso de antes não muda)", async () => {
      await montarNovo();
      await abrirGradeDe4();
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });

      expect(valorDoCampo("product-sale-price")).toBe("");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
      expect(textoDe("preco-das-variacoes-sem-preco")).toContain(
        "variações sem preço usam este",
      );
    });

    it("grade recusada (código interno já usado na loja): nada entra — o Preço de Venda continua vazio e sem 'veio da grade'", async () => {
      mocks.loja.produtos = [
        { id: "prod-2", variants: [{ id: "x1", sku: "BLU-AMA-P" }] },
      ];
      await montarNovo();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await digitarCampo("grade-sku-base", "blu");
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError.mock.calls[0]?.[0]).toContain("BLU-AMA-P");
      expect(valorDoCampo("product-sale-price")).toBe("");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
      expect(
        document.querySelectorAll('[data-testid="variante-cadastrada"]'),
      ).toHaveLength(0);
    });

    it("a frase do passo 2 só promete 'vira o dele' quando o campo do produto está vazio de verdade", async () => {
      await montarNovo();
      await abrirGradeDe4();
      expect(textoDe("preco-do-produto-na-grade")).toContain("vira o dele");

      // Preço de Venda "0,00" (inválido, mas NÃO vazio): a regra não escreve por
      // cima, então a frase não pode prometer que o preço da grade vira o dele.
      await act(async () => {
        clicarObrigatorio("← Voltar");
      });
      await act(async () => {
        clicarObrigatorio("Cancelar");
      });
      await digitarCampo("product-sale-price", "0");
      expect(valorDoCampo("product-sale-price")).toBe("0,00");
      await abrirGradeDe4();
      const frase = textoDe("preco-do-produto-na-grade") ?? "";
      expect(frase).not.toContain("vira o dele");
      expect(frase).toContain("só para estas combinações novas");

      // E o que a frase diz é o que acontece: o preço da grade NÃO vai para o produto.
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });
      expect(valorDoCampo("product-sale-price")).toBe("0,00");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
    });

    it("clicar duas vezes em Salvar não aplica o preço (nem as linhas) em dobro", async () => {
      await montarNovo();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        const botao = botaoPorTexto("Salvar 4 variações");
        botao?.click();
        botao?.click();
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(valorDoCampo("product-sale-price")).toBe("60,00");
      expect(
        document.querySelectorAll('[data-testid="variante-cadastrada"]'),
      ).toHaveLength(4);
    });

    it("mudar o preço depois apaga o 'veio da grade'; só sair do campo sem mexer NÃO apaga", async () => {
      await montarNovo();
      await abrirGradeDe4();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 4 variações");
      });
      expect(textoDe("preco-veio-da-grade")).not.toBeNull();

      const campo = document.getElementById(
        "product-sale-price",
      ) as HTMLInputElement;
      await act(async () => {
        campo.focus();
        campo.blur();
        await new Promise((r) => setTimeout(r, 300));
      });
      expect(valorDoCampo("product-sale-price")).toBe("60,00");
      expect(textoDe("preco-veio-da-grade")).not.toBeNull();

      await digitarCampo("product-sale-price", "65,00");
      expect(valorDoCampo("product-sale-price")).toBe("65,00");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
    });
  });

  describe("produto que JÁ tem preço (editando)", () => {
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

    async function montarEmEdicao() {
      mocks.fetchProduct.mockResolvedValue(produtoBase);
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

    async function gerarAmarelaP() {
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
    }

    it("(2) a grade abre com o preço do produto como sugestão (sem preencher nada por conta própria)", async () => {
      await montarEmEdicao();
      await gerarAmarelaP();

      const aplicar = document.getElementById(
        "grade-aplicar-preco",
      ) as HTMLInputElement;
      expect(aplicar.placeholder).toBe("89,90");
      // Sugestão, não valor: nada é digitado pela lojista.
      expect(aplicar.value).toBe("");
      expect(valorDoCampo("grade-linha-preco-0")).toBe("");
      expect(textoDe("preco-do-produto-na-grade")).toContain("89,90");
    });

    it("(2) outro preço digitado na grade vale SÓ para a combinação nova: o produto não muda e a antiga em Auto não é remarcada", async () => {
      await montarEmEdicao();
      await gerarAmarelaP();
      await digitarCampo("grade-aplicar-preco", "60,00");
      await act(async () => {
        clicarObrigatorio("Aplicar para todas");
      });
      await act(async () => {
        clicarObrigatorio("Salvar 1 variação");
      });

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(valorDoCampo("product-sale-price")).toBe("89,90");
      expect(textoDe("preco-veio-da-grade")).toBeNull();

      await act(async () => {
        clicarObrigatorio("Salvar");
      });
      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      expect(
        (mocks.updateProduct.mock.calls[0]?.[1] as { price: number }).price,
      ).toBe(89.9);
      const lote = mocks.upsertVariants.mock.calls[0]?.[1] as Array<{
        value: string;
        priceOverride?: number;
      }>;
      expect(lote.find((v) => v.value === "Branca / PP")?.priceOverride).toBe(
        undefined,
      );
      expect(lote.find((v) => v.value === "Amarela / P")?.priceOverride).toBe(
        60,
      );
    });

    it("(2) sem digitar preço na grade, a nova fica Auto e o produto também não muda", async () => {
      await montarEmEdicao();
      await gerarAmarelaP();
      await act(async () => {
        clicarObrigatorio("Salvar 1 variação");
      });

      expect(valorDoCampo("product-sale-price")).toBe("89,90");
      expect(textoDe("preco-veio-da-grade")).toBeNull();
      expect(textoDe("preco-das-variacoes-sem-preco")).toBeNull();
    });
  });
});
