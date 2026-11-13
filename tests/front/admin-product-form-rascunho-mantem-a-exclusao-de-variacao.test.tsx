// @vitest-environment jsdom
//
// "Restaurar rascunho" NÃO pode desfazer a exclusão de uma variação.
//
// O defeito (estoque e venda): produto com variações A, B e C. A lojista exclui
// a C e sai sem salvar (a lista de exclusões é só memória da tela e não entra no
// rascunho). Ao voltar, "Restaurar" traz o formulário [A, B] e "Salvar" mandava
// `p_apagar` VAZIO: a C seguia ativa e à venda, e o estoque gravado era a soma
// sem ela. Provado aqui no fluxo real (rascunho no localStorage → toast →
// Restaurar → Salvar → o que chega em `salvarProdutoComGrade`):
//  - a exclusão dela vai em `apagar`, e o estoque do produto é a soma do que
//    fica;
//  - variação criada em OUTRO aparelho depois do rascunho (D) volta ao
//    formulário, entra na soma e NUNCA é apagada;
//  - rascunho sem base (antigo) e variação que o banco já não tem: nada apagado.
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

const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const variacao = (id: string, valor: string, estoque: number) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: true,
});

const A = variacao("va", "A", 1);
const B = variacao("vb", "B", 2);
const C = variacao("vc", "C", 3);
const D = variacao("vd", "D", 4);

const somaDoEstoque = (variants: Array<{ stockIncrement: number }>) =>
  variants.reduce((s, v) => s + v.stockIncrement, 0);

/** O produto como o banco o devolve HOJE. */
const produtoDoBanco = (variants: Array<{ stockIncrement: number }>) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: somaDoEstoque(variants),
  sold: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

/** O formulário como a tela o guarda (todos os campos, em texto). */
const campos = (extra: Record<string, unknown> = {}) => ({
  name: "Camiseta",
  description: "Algodão",
  price: "50",
  costPrice: "",
  originalPrice: "",
  stock: "6",
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

describe("AdminProductFormView — restaurar rascunho mantém a exclusão de variação", () => {
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
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
    const botao = botaoPorTexto("Salvar alterações");
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const argumentosDaRpc = () =>
    salvarProdutoComGrade.mock.calls[0]?.[2] as
      | {
          apagar: string[];
          variantes: Array<{ id: string }>;
        }
      | undefined;
  const remendoDaRpc = () =>
    salvarProdutoComGrade.mock.calls[0]?.[1] as Record<string, unknown>;

  it("exclui a C, sai sem salvar, restaura e salva: a C vai em `apagar` e o estoque é a soma de A+B", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B, C]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "3",
          variants: [A, B],
          baseDoRascunho: campos({ variants: [A, B, C] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    expect(argumentosDaRpc()?.apagar).toEqual(["vc"]);
    expect(remendoDaRpc().name).toBe("Camiseta de algodão");
    // O estoque gravado é o do que FICA (1 + 2), nunca o de A+B+C com a C apagada.
    expect(remendoDaRpc().stock).toBe(3);
  });

  it("variação D criada em outro aparelho: volta ao formulário, entra na soma e NÃO é apagada", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B, C, D]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "3",
          variants: [A, B],
          baseDoRascunho: campos({ variants: [A, B, C] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(argumentosDaRpc()?.apagar).toEqual(["vc"]);
    expect(argumentosDaRpc()?.apagar).not.toContain("vd");
    // A soma do que fica: A (1) + B (2) + D (4).
    expect(remendoDaRpc().stock).toBe(7);
    // A lojista é avisada de que o produto mudou depois do rascunho.
    const avisos = vi
      .mocked(toast.info)
      .mock.calls.map(([, o]) =>
        String((o as { description?: string })?.description ?? ""),
      );
    expect(avisos.some((d) => d.includes("foi alterado depois"))).toBe(true);
  });

  it("não diz Salvo nem apaga o rascunho quando a edição não foi guardada", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([]));
    armazem.set(CHAVE_EDICAO, JSON.stringify(campos({ name: "Nome editado" })));
    await montar();
    await restaurar();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await salvar();

    expect(updateProduct).toHaveBeenCalledOnce();
    expect(hospedeiro.textContent).not.toContain("Salvo · voltando à lista");
    expect(armazem.has(CHAVE_EDICAO)).toBe(true);
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
  });

  it("restaurar usa a combinação já criada no banco sem somar o estoque da nova repetida", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, D]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Nome editado",
          variants: [
            A,
            variacao("temp-local", " d ", 3),
            variacao("temp-outra", "E", 2),
          ],
          baseDoRascunho: campos({ variants: [A] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    const linhas = argumentosDaRpc()?.variantes ?? [];
    expect(linhas.map((v) => v.id)).toEqual(["temp-outra"]);
    expect(remendoDaRpc().stock).toBe(7);
    expect(toast.warning).toHaveBeenCalledWith(
      "Outro aparelho já criou essa combinação; mantivemos a dele, confira o estoque.",
    );
  });

  it("avisa ao restaurar mesmo quando a combinação repetida era a única edição", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, D]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          variants: [A, variacao("temp-local", "D", 3)],
          baseDoRascunho: campos({ variants: [A] }),
        }),
      ),
    );
    await montar();
    await restaurar();

    expect(toast.warning).toHaveBeenCalledWith(
      "Outro aparelho já criou essa combinação; mantivemos a dele, confira o estoque.",
    );
    expect(
      hospedeiro.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ).toHaveLength(2);
  });

  it("recarregar conflito usa a combinação do banco sem duplicar a nova local", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Nome editado",
          variants: [
            A,
            variacao("temp-local", " d ", 3),
            variacao("temp-outra", "E", 2),
          ],
          baseDoRascunho: campos({ variants: [A] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    salvarProdutoComGrade.mockRejectedValueOnce({
      produtoAtual: produtoDoBanco([A, D]),
    });
    await salvar();
    await salvar();

    const linhas = salvarProdutoComGrade.mock.calls[1]?.[2].variantes;
    expect(linhas.map((v: { id: string }) => v.id)).toEqual(["temp-outra"]);
    expect(salvarProdutoComGrade.mock.calls[1]?.[1].stock).toBe(7);
    expect(toast.warning).toHaveBeenCalledWith(
      "Outro aparelho já criou essa combinação; mantivemos a dele, confira o estoque.",
    );
  });

  it("a C excluída foi LIGADA com 10 peças em outro aparelho: não é apagada, volta ao formulário com aviso", async () => {
    // O defeito: a C estava desligada e sem estoque quando ela a excluiu
    // (rascunho [A,B], base [A,B,C]). Outro aparelho a ligou com 10 peças. O
    // "Salvar" conferia a versão da ABERTURA (que já inclui a mudança), não
    // via conflito e apagava a C com o estoque novo, sem ela ver.
    const CdaBase = { ...C, active: false, stockIncrement: 0 };
    const CdeHoje = { ...C, active: true, stockIncrement: 10 };
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B, CdeHoje]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "3",
          variants: [A, B],
          baseDoRascunho: campos({ variants: [A, B, CdaBase] }),
        }),
      ),
    );
    await montar();
    await restaurar();

    expect(toast.warning).toHaveBeenCalledWith(
      "A variação Cor C foi alterada em outro aparelho e voltou para a lista; revise antes de excluir.",
    );
    expect(
      hospedeiro.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ).toHaveLength(3);

    await salvar();

    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    expect(argumentosDaRpc()?.apagar).toEqual([]);
    // A soma do que fica (A 1 + B 2 + C de hoje 10 = 13) é o que o banco já
    // tem: o estoque não viaja, e a C não é regravada.
    expect(remendoDaRpc().stock).toBeUndefined();
    expect(argumentosDaRpc()?.variantes).toEqual([]);
  });

  it("limite: duas alteradas em outro aparelho voltam, a que ninguém mexeu continua excluída, aviso no plural", async () => {
    const CmudouDeNome = { ...C, value: "C2" };
    const DligadaDepois = { ...D, stockIncrement: 9 };
    fetchProduct.mockResolvedValue(
      produtoDoBanco([A, CmudouDeNome, DligadaDepois, B]),
    );
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "1",
          variants: [A],
          baseDoRascunho: campos({ variants: [A, B, C, D] }),
        }),
      ),
    );
    await montar();
    await restaurar();

    expect(toast.warning).toHaveBeenCalledWith(
      "As variações Cor C2 e Cor D foram alteradas em outro aparelho e voltaram para a lista; revise antes de excluir.",
    );
    await salvar();

    // Só a B (que ninguém mexeu) segue a decisão dela.
    expect(argumentosDaRpc()?.apagar).toEqual(["vb"]);
    // A (1) + C de hoje (3) + D de hoje (9).
    expect(remendoDaRpc().stock).toBe(13);
  });

  it("limite: variação excluída que ninguém mexeu continua indo em `apagar` e não avisa", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B, C]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          variants: [A, B],
          baseDoRascunho: campos({ variants: [A, B, C] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(argumentosDaRpc()?.apagar).toEqual(["vc"]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("limite: rascunho sem base (antigo) não apaga nada ao salvar", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B, C]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "3",
          variants: [A, B],
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    const apagar = argumentosDaRpc()?.apagar ?? [];
    expect(apagar).toEqual([]);
  });

  it("limite: a variação da base que o banco já não tem não vira exclusão", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([A, B]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          stock: "3",
          variants: [A, B],
          baseDoRascunho: campos({ variants: [A, B, C] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    const apagar = argumentosDaRpc()?.apagar ?? [];
    expect(apagar).toEqual([]);
  });
});
