// @vitest-environment jsdom
//
// Variações em DOBRO na vitrine depois que a rede fica sem resposta ao salvar a
// grade de um produto NOVO.
//
// O defeito: a lojista cria um produto com P, M e G (sem SKU e sem código de
// barras). O produto grava; as variações também gravam no banco, mas a resposta
// passa do prazo e a tela leva para a edição um rascunho marcado
// `variacoesPendentes`, SEM produto-base (`baseDoRascunho`). Na edição, o
// Salvar dizia "As variações ainda não foram salvas" (mentira: estavam) e
// mandava restaurar. Restaurar tirava da tela as P/M/G do banco sem pô-las na
// fila de exclusão e trazia as P/M/G do rascunho como NOVAS (`temp-…`); Salvar
// as inseria de novo. Cada tamanho aparecia duas vezes, cada um com estoque
// próprio: dava para vender o dobro (o banco só barra SKU/código repetido, não
// combinação repetida).
//
// Provado aqui no fluxo real (rascunho no localStorage → toast → Restaurar →
// Salvar → o que chega em `salvarProdutoComGrade`):
//  - grade que já estava no banco: restaurar fica com as do banco, salvar não
//    insere nenhuma `temp-…`, e a tela não diz "ainda não foram salvas";
//  - grade que entra no banco DEPOIS de a edição abrir (a resposta atrasou):
//    o salvar relê o banco antes de gravar e não insere a repetida;
//  - controle: grade que de fato não entrou é gravada normalmente;
//  - limites: releitura que falha não grava nada; só a combinação que falta
//    vai para o banco.
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
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const tamanho = (id: string, valor: string, estoque: number) => ({
  id,
  productId: id.startsWith("temp-") ? "" : "p-1",
  name: "Tamanho",
  value: valor,
  stockIncrement: estoque,
  active: true,
});

// O que o banco gravou (ids de verdade) e o que o rascunho guardou (`temp-…`).
const P = tamanho("vp", "P", 1);
const M = tamanho("vm", "M", 2);
const G = tamanho("vg", "G", 3);
const tempP = tamanho("temp-p", "P", 1);
const tempM = tamanho("temp-m", "M", 2);
const tempG = tamanho("temp-g", "G", 3);

const produtoDoBanco = (variants: Array<{ stockIncrement: number }>) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: variants.reduce((s, v) => s + v.stockIncrement, 0),
  sold: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  updatedAt: "2026-11-27T10:00:00.000Z",
  variants,
});

/**
 * O rascunho como o cadastro o leva para a edição quando a grade fica sem
 * resposta: o formulário de "Novo produto" + `variacoesPendentes`, SEM base.
 */
const rascunhoDoCadastro = (variants: unknown[] = [tempP, tempM, tempG]) =>
  JSON.stringify({
    name: "Camiseta",
    description: "Algodão",
    price: "50",
    costPrice: "",
    originalPrice: "",
    stock: "6",
    estoqueMinimo: "",
    category: "Geral",
    images: [],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: "",
    metaDescription: "",
    sku: "",
    codigoBarras: "",
    variants,
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    variacoesPendentes: true,
    salvoEm: Date.now(),
  });

describe("AdminProductFormView — grade pendente do cadastro não duplica variação", () => {
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

  const ofertaDoRascunho = () =>
    vi
      .mocked(toast.info)
      .mock.calls.find(([titulo]) =>
        String(titulo).includes("Rascunho não salvo"),
      );

  async function restaurar() {
    const chamada = ofertaDoRascunho();
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

  /** Toda variação que algum salvar mandou ao banco. */
  const variantesMandadas = () =>
    salvarProdutoComGrade.mock.calls.flatMap(
      ([, , grade]) =>
        (grade as { variantes: Array<{ id: string }> }).variantes,
    );
  const novasMandadas = () =>
    variantesMandadas()
      .map((v) => v.id)
      .filter((id) => id.startsWith("temp-"));
  const linhasNaTela = () =>
    hospedeiro.querySelectorAll('[data-testid="variante-cadastrada"]').length;
  const errosDitos = () =>
    vi.mocked(toast.error).mock.calls.map(([m]) => String(m));
  const avisosDitos = () =>
    [
      ...vi.mocked(toast.warning).mock.calls,
      ...vi.mocked(toast.info).mock.calls,
      ...vi.mocked(toast.success).mock.calls,
    ].map(([m]) => String(m));

  it("a grade JÁ estava no banco: restaurar e salvar não insere P/M/G de novo nem apaga as do banco", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([P, M, G]));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();
    await restaurar();

    // Na tela, uma linha por tamanho: as do banco.
    expect(linhasNaTela()).toBe(3);
    await salvar();

    expect(novasMandadas()).toEqual([]);
    expect(
      salvarProdutoComGrade.mock.calls.flatMap(
        ([, , grade]) => (grade as { apagar: string[] }).apagar,
      ),
    ).toEqual([]);
    expect(deleteVariants).not.toHaveBeenCalled();
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("a grade JÁ estava no banco: a tela não diz que as variações 'ainda não foram salvas'", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([P, M, G]));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();

    // A oferta diz a verdade: as variações estão na loja.
    const descricao = String(
      (ofertaDoRascunho()?.[1] as { description?: string } | undefined)
        ?.description ?? "",
    );
    expect(descricao).toContain("já estão salvas");
    expect(descricao).not.toContain("foi alterado depois");

    // Salvar sem restaurar não é travado com a frase falsa.
    await salvar();
    expect(errosDitos().some((m) => m.includes("ainda não foram salvas"))).toBe(
      false,
    );
    expect(novasMandadas()).toEqual([]);

    // E restaurar avisa que ficaram as da loja, sem culpar "outro aparelho".
    await restaurar();
    expect(avisosDitos().some((m) => m.includes("já estavam salvas"))).toBe(
      true,
    );
    expect(avisosDitos().some((m) => m.includes("Outro aparelho"))).toBe(false);
  });

  it("a grade entrou no banco DEPOIS de a edição abrir: o salvar relê o banco e não insere a repetida", async () => {
    // Ao abrir, o INSERT atrasado ainda não tinha gravado; ao salvar, já.
    fetchProduct
      .mockResolvedValueOnce(produtoDoBanco([]))
      .mockResolvedValue(produtoDoBanco([P, M, G]));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();
    await restaurar();
    expect(linhasNaTela()).toBe(3);

    await salvar();

    expect(novasMandadas()).toEqual([]);
    expect(avisosDitos().some((m) => m.includes("já estavam salvas"))).toBe(
      true,
    );
    // A tela passa a mostrar as do banco, uma por tamanho.
    expect(linhasNaTela()).toBe(3);

    // Salvar de novo continua sem repetir.
    await salvar();
    expect(novasMandadas()).toEqual([]);
  });

  it("controle: a grade de fato NÃO entrou: a tela diz que não foi salva e o salvar grava P/M/G uma vez", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([]));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();

    // Sem restaurar, a trava de antes continua (aqui ela diz a verdade).
    await salvar();
    expect(errosDitos().some((m) => m.includes("ainda não foram salvas"))).toBe(
      true,
    );
    expect(salvarProdutoComGrade).not.toHaveBeenCalled();

    await restaurar();
    await salvar();

    expect(novasMandadas().sort()).toEqual(["temp-g", "temp-m", "temp-p"]);
  });

  it("limite: a releitura antes de gravar falha: nada é gravado e a tela diz que não conseguiu conferir", async () => {
    fetchProduct
      .mockResolvedValueOnce(produtoDoBanco([]))
      .mockRejectedValue(new Error("rede caiu"));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();
    await restaurar();
    await salvar();

    expect(salvarProdutoComGrade).not.toHaveBeenCalled();
    expect(upsertVariants).not.toHaveBeenCalled();
    expect(errosDitos().some((m) => m.includes("Nada foi salvo"))).toBe(true);
    // O botão solta para ela tentar de novo.
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
  });

  it("limite: só a P está no banco: restaurar fica com a P de lá e o salvar grava só M e G", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([P]));
    armazem.set(CHAVE_EDICAO, rascunhoDoCadastro());
    await montar();
    // M e G ainda faltam: a oferta não diz que "já estão salvas".
    expect(
      String(
        (ofertaDoRascunho()?.[1] as { description?: string } | undefined)
          ?.description ?? "",
      ),
    ).not.toContain("já estão salvas");
    await restaurar();
    expect(linhasNaTela()).toBe(3);

    await salvar();

    expect(novasMandadas().sort()).toEqual(["temp-g", "temp-m"]);
  });
});
