// @vitest-environment jsdom
//
// "Restaurar rascunho" NÃO pode devolver o estoque que já foi vendido.
//
// O defeito (estoque = dinheiro): a lojista edita o produto M (estoque 5), sai
// sem salvar, e o rascunho guarda o formulário inteiro — estoque e grade
// inclusos. Dias depois, com 2 peças vendidas (banco: 3), a tela oferece
// "Rascunho não salvo encontrado — Restaurar?". Ela restaura e salva, e o banco
// volta a 5: a loja vende peça que não existe. A trava do salvar
// (`estoqueDoProdutoFoiMexido`) compara com o que a tela leu ao abrir, então o
// 5 restaurado parecia digitação dela.
//
// Provado aqui, no fluxo real da tela (rascunho no localStorage → toast →
// Restaurar → Salvar → o que chega em `updateProduct`/`upsertVariants`):
//  - o estoque do produto e o de cada variação que JÁ existe vêm do banco de
//    hoje; o resto do rascunho (nome...) volta;
//  - variação NOVA no rascunho mantém o estoque digitado;
//  - a lojista é AVISADA de que o estoque não voltou (só quando diferia);
//  - o rascunho tem prazo (7 dias): vencido, é descartado ao abrir;
//  - o salvamento automático grava o carimbo de quando guardou.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    salvarProdutoComGrade,
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

const UM_DIA = 24 * 60 * 60 * 1000;
const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";
const CHAVE_NOVO = "ikcous_product_form_draft:lojista-1";
const AVISO = "O estoque não foi restaurado";

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const campo = (id: string) =>
  document.getElementById(id) as HTMLInputElement | null;

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  ativa = true,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: ativa,
});

/** O produto como o banco o devolve HOJE (depois das vendas). */
const produtoDoBanco = (estoque: number, variants: unknown[] = []) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: estoque,
  sold: 2,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

/** O rascunho como o formulário o guardou (todos os campos, em texto). */
const rascunho = (extra: Record<string, unknown> = {}) => ({
  name: "Camiseta",
  description: "Algodão",
  price: "50",
  costPrice: "",
  originalPrice: "",
  stock: "5",
  estoqueMinimo: "",
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
  weightKg: "",
  widthCm: "",
  heightCm: "",
  lengthCm: "",
  ...extra,
});

describe("AdminProductFormView — restaurar rascunho não devolve estoque vendido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(undefined);
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

  /** `null` abre o formulário de produto NOVO (sem id). */
  async function montar(productId: string | null = "p-1") {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId ?? undefined}
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /** A ação "Restaurar" do toast de rascunho pendente. */
  async function restaurar() {
    const chamada = vi
      .mocked(toast.info)
      .mock.calls.find(([titulo]) =>
        String(titulo).includes("Rascunho não salvo"),
      );
    if (!chamada) throw new Error("O aviso de rascunho não apareceu.");
    const opcoes = chamada[1] as unknown as {
      action: { onClick: () => void };
    };
    await act(async () => {
      opcoes.action.onClick();
    });
  }

  async function salvar() {
    const botao = botaoPorTexto("Salvar");
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  // Online e com grade o salvar vai por UMA chamada (salvarProdutoComGrade); sem grade, pelo updateProduct de sempre.
  const remendoEnviado = () =>
    (salvarProdutoComGrade.mock.calls[0]?.[1] ??
      updateProduct.mock.calls[0]?.[1]) as Record<string, unknown>;
  const variacoesEnviadas = () =>
    (salvarProdutoComGrade.mock.calls[0]?.[2].variantes ?? []) as Array<
      Record<string, unknown> & { id: string }
    >;
  const descricoesDeAviso = () =>
    [
      ...vi.mocked(toast.success).mock.calls,
      ...vi.mocked(toast.info).mock.calls,
    ].map(([, opcoes]) =>
      String((opcoes as { description?: string })?.description ?? ""),
    );

  it("produto sem variação: restaurar + salvar NÃO manda o estoque velho (banco 3, rascunho 5)", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco(3));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(rascunho({ name: "Camiseta de algodão", stock: "5" })),
    );
    await montar();
    await restaurar();

    // O resto do rascunho voltou...
    expect(campo("product-name")?.value).toBe("Camiseta de algodão");
    // ...mas o estoque é o do banco de hoje.
    expect(campo("product-stock")?.value).toBe("3");

    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(remendoEnviado().name).toBe("Camiseta de algodão");
    // Se o estoque for junto, o banco volta a 5 e a loja vende peça que não existe.
    expect(remendoEnviado()).not.toHaveProperty("stock");
  });

  it("produto com variações: o estoque de cada variação existente é o do banco, não o do rascunho", async () => {
    fetchProduct.mockResolvedValue(
      produtoDoBanco(3, [variacao("v1", "Rosa", 1), variacao("v2", "Azul", 2)]),
    );
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        rascunho({
          name: "Camiseta de algodão",
          stock: "5",
          variants: [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(remendoEnviado().name).toBe("Camiseta de algodão");
    expect(remendoEnviado()).not.toHaveProperty("stock");
    const enviadas = variacoesEnviadas();
    expect(enviadas.map((v) => v.id)).toEqual(["v1", "v2"]);
    for (const v of enviadas) {
      expect(v).not.toHaveProperty("stockIncrement");
    }
  });

  it("variação NOVA no rascunho mantém o estoque digitado; a existente segue com o do banco", async () => {
    fetchProduct.mockResolvedValue(
      produtoDoBanco(1, [variacao("v1", "Rosa", 1)]),
    );
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        rascunho({
          stock: "7",
          variants: [
            variacao("v1", "Rosa", 3),
            variacao("temp-123", "Verde", 4),
          ],
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    const enviadas = variacoesEnviadas();
    const nova = enviadas.find((v) => v.id === "temp-123");
    const rosa = enviadas.find((v) => v.id === "v1");
    expect(nova?.stockIncrement).toBe(4);
    expect(rosa).not.toHaveProperty("stockIncrement");
    // O estoque do produto é a soma do que existe HOJE (1) + a nova (4).
    expect(remendoEnviado().stock).toBe(5);
  });

  it("variação que já saiu do banco desde o rascunho não volta com o estoque de antes", async () => {
    fetchProduct.mockResolvedValue(
      produtoDoBanco(1, [variacao("v1", "Rosa", 1)]),
    );
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        rascunho({
          name: "Camiseta de algodão",
          variants: [
            variacao("v1", "Rosa", 1),
            variacao("v-apagada", "Azul", 9),
          ],
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(variacoesEnviadas().map((v) => v.id)).toEqual(["v1"]);
  });

  it("avisa que o estoque não foi restaurado quando o do rascunho era outro", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco(3));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(rascunho({ name: "Camiseta de algodão", stock: "5" })),
    );
    await montar();

    // O aviso já está na pergunta "Restaurar?" e fica depois de restaurar.
    expect(descricoesDeAviso().some((d) => d.includes(AVISO))).toBe(true);
    expect(
      descricoesDeAviso().some((d) =>
        d.includes("continua como está hoje na loja"),
      ),
    ).toBe(true);
    vi.mocked(toast.success).mockClear();
    await restaurar();
    const depois = vi
      .mocked(toast.success)
      .mock.calls.map(([, o]) =>
        String((o as { description?: string })?.description ?? ""),
      );
    expect(depois.some((d) => d.includes(AVISO))).toBe(true);
  });

  it("rascunho que só diferia no estoque não vira pergunta: sem o estoque não sobra nada a restaurar, e ele é limpo", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco(3));
    armazem.set(CHAVE_EDICAO, JSON.stringify(rascunho({ stock: "5" })));
    await montar();

    const perguntas = vi
      .mocked(toast.info)
      .mock.calls.filter(([t]) => String(t).includes("Rascunho não salvo"));
    expect(perguntas).toHaveLength(0);
    expect(armazem.has(CHAVE_EDICAO)).toBe(false);
    expect(campo("product-stock")?.value).toBe("3");
  });

  it("controle: com o mesmo estoque do banco NÃO há aviso de estoque (nada deixou de ser restaurado)", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco(5));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(rascunho({ name: "Camiseta de algodão", stock: "5" })),
    );
    await montar();
    await restaurar();

    expect(descricoesDeAviso().some((d) => d.includes(AVISO))).toBe(false);
    expect(campo("product-name")?.value).toBe("Camiseta de algodão");
  });

  it("controle: quem não restaura e só redigita a descrição não manda estoque (já era assim)", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco(3));
    armazem.set(CHAVE_EDICAO, JSON.stringify(rascunho({ stock: "5" })));
    await montar();

    const desc = campo("product-description");
    expect(desc).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(desc, "Algodão macio");
      desc?.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    await salvar();

    expect(remendoEnviado().description).toBe("Algodão macio");
    expect(remendoEnviado()).not.toHaveProperty("stock");
  });

  describe("prazo de validade do rascunho", () => {
    it("rascunho de 8 dias é descartado ao abrir: sem pergunta e sem a chave", async () => {
      fetchProduct.mockResolvedValue(produtoDoBanco(3));
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(
          rascunho({
            name: "Camiseta de algodão",
            salvoEm: Date.now() - 8 * UM_DIA,
          }),
        ),
      );
      await montar();

      const perguntas = vi
        .mocked(toast.info)
        .mock.calls.filter(([t]) => String(t).includes("Rascunho não salvo"));
      expect(perguntas).toHaveLength(0);
      expect(armazem.has(CHAVE_EDICAO)).toBe(false);
      expect(campo("product-name")?.value).toBe("Camiseta");
    });

    it("controle: rascunho de 6 dias ainda vale e é oferecido", async () => {
      fetchProduct.mockResolvedValue(produtoDoBanco(3));
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(
          rascunho({
            name: "Camiseta de algodão",
            salvoEm: Date.now() - 6 * UM_DIA,
          }),
        ),
      );
      await montar();

      const perguntas = vi
        .mocked(toast.info)
        .mock.calls.filter(([t]) => String(t).includes("Rascunho não salvo"));
      expect(perguntas).toHaveLength(1);
      expect(armazem.has(CHAVE_EDICAO)).toBe(true);
    });

    it("controle: rascunho de antes do prazo existir (sem carimbo) ainda é oferecido", async () => {
      fetchProduct.mockResolvedValue(produtoDoBanco(3));
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(rascunho({ name: "Camiseta de algodão" })),
      );
      await montar();

      const perguntas = vi
        .mocked(toast.info)
        .mock.calls.filter(([t]) => String(t).includes("Rascunho não salvo"));
      expect(perguntas).toHaveLength(1);
    });

    it("produto NOVO: rascunho de 8 dias também é descartado ao abrir", async () => {
      armazem.set(
        CHAVE_NOVO,
        JSON.stringify(
          rascunho({ name: "Produto velho", salvoEm: Date.now() - 8 * UM_DIA }),
        ),
      );
      await montar(null);

      expect(armazem.has(CHAVE_NOVO)).toBe(false);
      expect(campo("product-name")?.value).toBe("");
      expect(
        vi
          .mocked(toast.success)
          .mock.calls.some(([t]) => String(t).includes("Rascunho recuperado")),
      ).toBe(false);
    });

    it("controle: produto NOVO com rascunho de 1 dia é recuperado", async () => {
      armazem.set(
        CHAVE_NOVO,
        JSON.stringify(
          rascunho({ name: "Produto de ontem", salvoEm: Date.now() - UM_DIA }),
        ),
      );
      await montar(null);

      expect(campo("product-name")?.value).toBe("Produto de ontem");
    });

    it("o salvamento automático grava o carimbo de quando guardou", async () => {
      fetchProduct.mockResolvedValue(produtoDoBanco(3));
      await montar();

      const preco = campo("product-sale-price");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )?.set?.call(preco, "60,00");
        preco?.dispatchEvent(new Event("input", { bubbles: true }));
        // O campo entrega o valor depois de uma pausa e o salvamento
        // automático espera 1 s a mais.
        await new Promise((r) => setTimeout(r, 300));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1300));
      });

      const guardado = JSON.parse(armazem.get(CHAVE_EDICAO) ?? "{}");
      expect(typeof guardado.salvoEm).toBe("number");
      expect(Math.abs(Date.now() - guardado.salvoEm)).toBeLessThan(60_000);
    }, 20000);
  });
});
