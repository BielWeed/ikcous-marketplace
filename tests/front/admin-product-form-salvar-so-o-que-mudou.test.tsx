// @vitest-environment jsdom
//
// Editar um produto manda SÓ o que a lojista mudou.
//
// O defeito (preço = dinheiro): o formulário mandava SEMPRE o produto inteiro
// (nome, descrição, preço, custo, preço original, "ativo", fotos, categoria...)
// com os valores de quando a tela abriu. Duas pessoas (ou dois aparelhos)
// editando o mesmo produto: quem salvava por último DESFAZIA em silêncio o
// preço, o "ativo" ou as fotos do outro, e a tela dizia "Produto atualizado!".
//
// A regra provada aqui, a mesma que a tela já usava com estoque e medidas:
//  - campo que a lojista não mudou em relação ao que a tela leu NÃO viaja;
//  - campo que ela LIMPOU continua indo como `null` (limpar de verdade);
//  - a comparação é pelo VALOR, não pelo texto ("50" e "50,00" são o mesmo);
//  - variação que ela não mexeu não é regravada (o banco regrava a linha
//    inteira, então a única forma de não desfazer o preço próprio dela é não
//    mandá-la); variação nova e variação mexida vão inteiras;
//  - produto NOVO manda tudo;
//  - se um salvar anterior desta tela gravou o produto e terminou pela metade,
//    o seguinte manda tudo de novo (voltar um campo ao valor de abertura não
//    pode ser confundido com "não mexi" quando o banco já tem o outro valor).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const addProduct = vi.fn();
const updateProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
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

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  precoProprio?: number,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  priceOverride: precoProprio,
  active: true,
});

const PRODUTO_DO_BANCO = {
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  costPrice: 20,
  originalPrice: 70,
  stock: 5,
  sold: 12,
  category: "Geral",
  images: ["https://exemplo.test/camiseta.jpg"],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "Camiseta boa",
  metaDescription: "Descrição para busca",
  sku: "CAM-1",
};

describe("AdminProductFormView — editar manda só o que a lojista mudou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    updateProduct.mockResolvedValue({ id: "p-1" });
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(undefined);
    addProduct.mockResolvedValue({ id: "novo-1" });
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

  async function montarProduto(variants: unknown[] = []) {
    fetchProduct.mockResolvedValue({ ...PRODUTO_DO_BANCO, variants });
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

  async function salvar() {
    const botao = botaoPorTexto("Salvar");
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /** O remendo do N-ésimo salvar, sem a lista de variações (que o banco ignora). */
  const remendo = (n = 0) => {
    const chamada = (salvarProdutoComGrade.mock.calls[n]?.[1] ??
      updateProduct.mock.calls[n]?.[1]) as Record<string, unknown>;
    const { variants: _ignorada, ...resto } = chamada;
    return resto;
  };

  const variacoesEnviadas = () =>
    (salvarProdutoComGrade.mock.calls[0]?.[2].variantes ?? []) as Array<
      Record<string, unknown> & { id: string }
    >;

  async function abrirVariacaoParaEditar(valor: string) {
    const linha = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes(valor));
    const caneta = linha
      ?.closest("div.group")
      ?.querySelector("button") as HTMLButtonElement | null;
    if (!caneta) throw new Error(`A linha da variação ${valor} não existe.`);
    await act(async () => {
      caneta.click();
    });
  }

  async function confirmarVariacao() {
    await act(async () => {
      const salvarDoModal = [...document.querySelectorAll("button")]
        .filter((b) => b.textContent?.trim() === "Salvar variação")
        .at(-1) as HTMLButtonElement;
      salvarDoModal.click();
    });
  }

  it("(a) mudar só a descrição NÃO manda preço, ativo, fotos, nome nem o resto", async () => {
    await montarProduto([]);

    await digitarCampo("product-description", "Algodão pima");
    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(remendo()).toEqual({ description: "Algodão pima" });
  });

  it("(b) mudar o preço manda SÓ o preço", async () => {
    await montarProduto([]);

    await digitarCampo("product-sale-price", "60,00");
    await salvar();

    expect(remendo()).toEqual({ price: 60 });
  });

  it("digitar outro preço e voltar ao de antes (escrito de outro jeito) não conta como mexer", async () => {
    await montarProduto([]);

    await digitarCampo("product-sale-price", "60,00");
    await digitarCampo("product-sale-price", "50,00");
    await digitarCampo("product-description", "Algodão pima");
    await salvar();

    // "50" (o que o banco devolveu) e "50,00" (o que ela digitou) são o mesmo
    // valor: o preço fica de fora e não desfaz o de ninguém.
    expect(remendo()).toEqual({ description: "Algodão pima" });
  });

  it("(c) desligar a promoção continua mandando o preço original como null (limpa de verdade)", async () => {
    await montarProduto([]);

    await act(async () => {
      (
        document.getElementById("product-promo-active") as HTMLInputElement
      ).click();
    });
    await salvar();

    const enviado = remendo();
    expect(enviado).toHaveProperty("originalPrice", null);
    // ...e só isso: o preço de venda não vai junto.
    expect(Object.keys(enviado)).toEqual(["originalPrice"]);
  });

  it("apagar o custo continua mandando null (limpa de verdade)", async () => {
    await montarProduto([]);

    await digitarCampo("product-cost-price", "");
    await salvar();

    expect(remendo()).toEqual({ costPrice: null });
  });

  it("escolher a mesma categoria de antes não conta; só o nome novo vai", async () => {
    await montarProduto([]);
    await act(async () => {
      const el = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(el, "Geral");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await digitarCampo("product-name", "Camiseta Pima");
    await salvar();

    // Categoria escolhida igual à de antes não vai; o nome novo vai.
    expect(remendo()).toEqual({ name: "Camiseta Pima" });
  });

  it("(d) variações: mudar só o nome de uma NÃO reenvia as outras (nem o preço próprio delas)", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 3, 55),
      variacao("v2", "Azul", 2, 65),
    ]);

    await abrirVariacaoParaEditar("Rosa");
    await digitarCampo("variant-value", "Rosa choque");
    await confirmarVariacao();
    await salvar();

    const enviadas = variacoesEnviadas();
    expect(enviadas.map((v) => v.id)).toEqual(["v1"]);
    expect(enviadas[0]).toMatchObject({ value: "Rosa choque" });
    // A que ela não mexeu não viaja: o preço próprio da Azul (65) fica como
    // está no banco, mesmo que outra pessoa o tenha mudado enquanto isso.
    expect(enviadas.some((v) => v.id === "v2")).toBe(false);
  });

  it("variações: mexer só no produto manda ZERO variações", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 3, 55),
      variacao("v2", "Azul", 2),
    ]);

    await digitarCampo("product-description", "Algodão pima");
    await salvar();

    expect(variacoesEnviadas()).toEqual([]);
    expect(remendo()).toEqual({ description: "Algodão pima" });
  });

  it("variação NOVA sempre vai, e a que já existia sem mexer continua de fora", async () => {
    await montarProduto([variacao("v1", "Rosa", 3)]);

    await act(async () => {
      const novo = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("+ Novo"),
      ) as HTMLButtonElement | undefined;
      if (!novo) throw new Error("O botão de variação nova não está na tela.");
      novo.click();
    });
    await digitarCampo("variant-name", "Cor");
    await digitarCampo("variant-value", "Verde");
    await digitarCampo("variant-stock", "4");
    await confirmarVariacao();
    await salvar();

    const enviadas = variacoesEnviadas();
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].id.startsWith("temp-")).toBe(true);
  });

  it("(e) produto NOVO manda tudo (nada para comparar)", async () => {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      digitar("product-name", "Produto Teste");
      digitar("product-description", "Descrição de teste");
      digitar("product-sale-price", "1000");
      digitar("product-stock", "5");
      const el = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(el, "Geral");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    const publicar = botaoPorTexto("Publicar");
    await act(async () => {
      publicar?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    const enviado = addProduct.mock.calls[0][0] as Record<string, unknown>;
    for (const chave of [
      "name",
      "description",
      "price",
      "costPrice",
      "originalPrice",
      "category",
      "images",
      "freeShipping",
      "isBestseller",
      "isActive",
      "metaTitle",
      "metaDescription",
      "sku",
      "codigoBarras",
      "stock",
      "sold",
    ]) {
      expect(enviado).toHaveProperty(chave);
    }
  });

  it("salvar sem ter mudado nada não chama o banco com um remendo vazio", async () => {
    await montarProduto([]);

    await salvar();

    // Um UPDATE sem coluna nenhuma não é um pedido válido: a tela nem tenta.
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("se um salvar anterior gravou o produto e terminou pela metade, o seguinte manda tudo de novo", async () => {
    // Caminho antigo (sem a gravação única): produto e grade em requisições
    // separadas. O produto grava, a grade falha.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    upsertVariants.mockRejectedValueOnce(new Error("rede caiu na grade"));
    await montarProduto([variacao("v1", "Rosa", 3)]);

    await digitarCampo("product-sale-price", "60,00");
    await abrirVariacaoParaEditar("Rosa");
    await digitarCampo("variant-value", "Rosa choque");
    await confirmarVariacao();
    await salvar();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(remendo(0)).toEqual({ price: 60 });

    // Ela volta o preço ao valor de abertura (50) e tenta de novo. O banco já
    // tem 60: se o 50 ficasse de fora como "não mexi", a volta seria perdida.
    await digitarCampo("product-sale-price", "50,00");
    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(2);
    expect(remendo(1)).toHaveProperty("price", 50);
  });
});
