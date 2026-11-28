// @vitest-environment jsdom
//
// Restaurar o RASCUNHO depois de um salvar que trocou o valor de uma opção
// ("M" -> "GG") e cuja resposta se perdeu. O salvar GRAVOU: o banco guardou o
// "M" desligado (já tinha venda) e criou o "GG" como opção nova. O rascunho
// ainda tem a linha do "M" com o valor "GG"; restaurá-la como estava e salvar
// refazia a troca e gravava um segundo "GG" com o estoque copiado. Provado no
// fluxo real: rascunho no localStorage -> Restaurar -> Salvar -> o que chega em
// `salvarProdutoComGrade`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    salvarProdutoComGrade,
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
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  productId: "p-1",
  name: "Tamanho",
  value: valor,
  stockIncrement: estoque,
  active: true,
  ...extra,
});

const P = variacao("v1", "P", 4);
const M = variacao("v2", "M", 7);
const G = variacao("v3", "G", 9);
/** O banco depois da troca gravada: "M" guardado desligado, "GG" novo. */
const M_GUARDADO = variacao("v2", "M", 7, { active: false });
const GG = variacao("v9", "GG", 7);

const somaDoEstoque = (
  variants: Array<{ stockIncrement: number; active: boolean }>,
) => variants.reduce((s, v) => s + (v.active ? v.stockIncrement : 0), 0);

const produtoDoBanco = (
  variants: Array<{ stockIncrement: number; active: boolean }>,
) => ({
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

const campos = (extra: Record<string, unknown> = {}) => ({
  name: "Camiseta",
  description: "Algodão",
  price: "50",
  costPrice: "",
  originalPrice: "",
  stock: "20",
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

describe("AdminProductFormView — rascunho depois de troca de valor já gravada", () => {
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
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar alterações",
    );
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("restaurar e salvar não refaz a troca nem grava um segundo GG", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([P, M_GUARDADO, G, GG]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify(
        campos({
          name: "Camiseta de algodão",
          variants: [P, { ...M, value: "GG" }, G],
          baseDoRascunho: campos({ variants: [P, M, G] }),
        }),
      ),
    );
    await montar();
    await restaurar();
    await salvar();

    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    const [, remendo, grade] = salvarProdutoComGrade.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
      { apagar: string[]; variantes: Array<{ id: string; value: string }> },
    ];
    expect(remendo.name).toBe("Camiseta de algodão");
    // Nada de opção nova: o "GG" do banco já é a nova, e o "M" guardado fica.
    expect(grade.variantes.filter((v) => v.id.startsWith("temp-"))).toEqual([]);
    expect(grade.apagar).toEqual([]);
    // E ela sabe o que aconteceu com o "M".
    expect(
      vi
        .mocked(toast.warning)
        .mock.calls.some(([texto]) =>
          String(texto).includes('O "M" já foi vendido'),
        ),
    ).toBe(true);
  });
});
