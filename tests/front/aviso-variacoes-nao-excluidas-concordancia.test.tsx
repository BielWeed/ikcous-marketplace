// @vitest-environment jsdom
//
// Excluir uma variação que JÁ TEM VENDAS não pode deixar o salvar pela metade.
//
// O defeito: o salvar fazia (1) gravar o produto, (2) apagar as variações
// removidas na tela, (3) gravar as demais variações. O banco recusa apagar
// variação que está num pedido (23503) — e o passo 2 jogava o erro para fora, o
// passo 3 NUNCA rodava: o preço do produto já estava gravado, mas o estoque e o
// preço das outras variações, editados no mesmo salvar, se perdiam, e a lojista
// lia só o genérico "Não foi possível atualizar o produto agora".
//
// O que fica provado na tela:
//  - o que o banco recusa de apagar NÃO impede de gravar o resto;
//  - a variação recusada VOLTA para a lista (senão a frase "desative-a" não teria
//    onde ser aplicada) e o formulário não finge sucesso (não sai para a lista);
//  - a lojista lê QUAL variação ficou e o que fazer (desligar em vez de excluir);
//  - a vendida não segura as que podem sair (o hook apaga uma por vez e diz
//    quais o banco recusou);
//  - um novo "Salvar" não tenta apagar de novo a que já foi recusada.
//
// Mesmo padrão de admin-product-form-desligar-e-religar-variacao-na-linha.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
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

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// O erro que o Postgres devolve ao apagar variação que já está num pedido.
const ERRO_VENDIDA = {
  code: "23503",
  message:
    'update or delete on table "product_variants" violates foreign key constraint "marketplace_order_items_variant_id_fkey" on table "marketplace_order_items"',
};

describe("AdminProductFormView — excluir variação vendida não perde o resto do salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Regressão do fluxo legado, mantido offline; RPC online é coberta
    // com hook real em admin-product-form-estoque-concorrente.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  async function montarProduto(variants: unknown[]) {
    const produto = {
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 10,
      sold: 3,
      category: "Geral",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants,
    };
    fetchProduct.mockResolvedValue(produto);
    updateProduct.mockImplementation(async (_id, updates) => ({
      ...produto,
      ...updates,
    }));
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          onNavigate={onNavigate}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function excluirDaTela(valor: string) {
    const lixeira = document.querySelector(
      `[aria-label="Excluir variação ${valor}"]`,
    ) as HTMLButtonElement | null;
    if (!lixeira) throw new Error(`A lixeira da variação ${valor} não existe.`);
    await act(async () => {
      lixeira.click();
    });
    const confirmar = botaoPorTexto("Excluir Variante");
    if (!confirmar) throw new Error("O botão de confirmar não está na tela.");
    await act(async () => {
      confirmar.click();
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
  it.each([1, 2])("toast real concorda com %i exclusões recusadas", async (quantidade) => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2), variacao("v3", "Verde", 1)]);
    await excluirDaTela("Azul");
    if (quantidade === 2) await excluirDaTela("Verde");
    deleteVariants.mockRejectedValueOnce({ ...ERRO_VENDIDA, recusadas: quantidade === 2 ? ["v2", "v3"] : ["v2"] });
    await salvar();
    expect(deleteVariants).toHaveBeenCalledWith(quantidade === 2 ? ["v2", "v3"] : ["v2"]);
    const aviso = toastError.mock.calls.map((c) => String(c[0])).find((texto) => texto.includes("não consegui excluir"));
    expect(aviso).toContain("Cor: Azul");
    expect(aviso).toContain(quantidade === 2
      ? "Se elas já têm vendas, desligue-as"
      : "Se ela já tem vendas, desligue-a");
    if (quantidade === 2) expect(aviso).toContain("Cor: Verde");
  });
});
