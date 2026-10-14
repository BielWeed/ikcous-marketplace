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
//  - cada variação é apagada sozinha: a vendida não segura as que podem sair;
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
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
    updateProduct.mockResolvedValue(undefined);
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
    fetchProduct.mockResolvedValue({
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
    });
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
    const botao = botaoPorTexto("Salvar");
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const linhasNaTela = () =>
    [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
      (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );

  it("a recusa de apagar NÃO impede de gravar as outras variações: elas são gravadas e a recusada volta para a lista", async () => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)]);
    await excluirDaTela("Azul");
    expect(linhasNaTela()).toHaveLength(1);
    deleteVariants.mockRejectedValueOnce(ERRO_VENDIDA);
    await digitarCampo("product-sale-price", "60,00");

    await salvar();

    expect(deleteVariants).toHaveBeenCalledTimes(1);
    expect(deleteVariants).toHaveBeenCalledWith(["v2"]);
    // O resto do salvar aconteceu: o produto E a variação que ficou.
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    const [, enviadas] = upsertVariants.mock.calls[0] as [
      string,
      Array<{ id: string }>,
    ];
    expect(enviadas.map((v) => v.id)).toEqual(["v1"]);
    // A recusada voltou para a lista (a lojista pode DESLIGAR ali).
    expect(linhasNaTela()).toHaveLength(2);
    expect(document.body.textContent).toContain("Azul");
  });

  it("a lojista lê qual variação ficou e o que fazer; o formulário NÃO sai para a lista como se tivesse dado certo", async () => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)]);
    await excluirDaTela("Azul");
    deleteVariants.mockRejectedValueOnce(ERRO_VENDIDA);

    await salvar();
    await act(async () => {
      // Mais que o 1,5 s da saída automática do caminho feliz.
      await new Promise((r) => setTimeout(r, 1700));
    });

    expect(onNavigate).not.toHaveBeenCalledWith(
      "admin-products",
      undefined,
      true,
    );
    const avisos = toastError.mock.calls.map((c) => String(c[0]));
    const aviso = avisos.find((t) => t.includes("Azul"));
    expect(aviso).toBeDefined();
    expect(aviso).toMatch(/desligue|desative|desligar|desativar/i);
    expect(aviso).toMatch(/salv/i);
  });

  it("cada variação é apagada sozinha: a vendida não segura a que pode sair", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 3),
      variacao("v2", "Azul", 2),
      variacao("v3", "Verde", 1),
    ]);
    await excluirDaTela("Azul");
    await excluirDaTela("Verde");
    deleteVariants.mockImplementation(async (ids: string[]) => {
      if (ids.includes("v2")) throw ERRO_VENDIDA;
      return true;
    });

    await salvar();

    expect(deleteVariants.mock.calls.map((c) => c[0])).toEqual([
      ["v2"],
      ["v3"],
    ]);
    // Só a vendida volta; a Verde foi embora de verdade.
    expect(linhasNaTela().some((l) => l.includes("Azul"))).toBe(true);
    expect(linhasNaTela().some((l) => l.includes("Verde"))).toBe(false);
    expect(upsertVariants).toHaveBeenCalledTimes(1);
  });

  it("um novo Salvar depois da recusa não tenta apagar de novo a que já foi recusada", async () => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)]);
    await excluirDaTela("Azul");
    deleteVariants.mockRejectedValueOnce(ERRO_VENDIDA);
    await salvar();
    expect(deleteVariants).toHaveBeenCalledTimes(1);

    await salvar();

    expect(deleteVariants).toHaveBeenCalledTimes(1);
    expect(upsertVariants).toHaveBeenCalledTimes(2);
  });

  it("caminho feliz intacto: tudo apagado e gravado sai para a lista de produtos", async () => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)]);
    await excluirDaTela("Azul");

    await salvar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });

    expect(deleteVariants).toHaveBeenCalledWith(["v2"]);
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-products", undefined, true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("se o banco falhar por OUTRO motivo ao apagar (ex.: sem rede), o resto também é gravado e a variação volta — nada some em silêncio", async () => {
    await montarProduto([variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)]);
    await excluirDaTela("Azul");
    deleteVariants.mockRejectedValueOnce(new Error("falha qualquer"));

    await salvar();

    expect(upsertVariants).toHaveBeenCalledTimes(1);
    expect(linhasNaTela()).toHaveLength(2);
    expect(onNavigate).not.toHaveBeenCalledWith(
      "admin-products",
      undefined,
      true,
    );
  });
});
