// @vitest-environment jsdom
//
// Salvar o produto NÃO pode devolver o estoque que a tela leu ao abrir.
//
// O defeito (estoque = dinheiro): o formulário mandava SEMPRE o estoque (e o
// contador `sold`, e o estoque de cada variação) que leu quando a lojista
// abriu a edição, mesmo que ela tivesse mexido só no preço. Se um cliente
// reservou uma peça no meio tempo (banco: 5 -> 4), o salvar gravava 5 por
// cima: a peça reservada "voltava" para a prateleira. Se o PIX vence, a
// reserva devolve 1 (5 -> 6, peça que não existe); se paga, a loja vende
// peça que não tem.
//
// A regra provada aqui, a mesma que a tela já usa com peso e medidas: o campo
// só vai quando a lojista MEXEU nele.
//  - produto sem variação: `stock` só vai se mudou; `sold` nunca vai na edição;
//  - variação já existente: `stockIncrement` só vai se a lojista mudou o
//    número DAQUELA variação; as outras seguem sem a chave;
//  - produto com variações: o estoque do produto é a soma das ligadas — só vai
//    quando a lojista mexeu nas variações (número ou liga/desliga);
//  - a REPOSIÇÃO digitada continua gravando (os testes "continua gravando").
//
// Mesmo padrão de admin-product-form-desligar-e-religar-variacao-na-linha.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
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
  ativa = true,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: ativa,
});

describe("AdminProductFormView — salvar não devolve o estoque que a tela leu ao abrir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(undefined);
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

  async function montarProduto(
    variants: unknown[] = [],
    estoqueDoProduto = 5,
    vendidos = 12,
  ) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: estoqueDoProduto,
      sold: vendidos,
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

  const remendoEnviado = () =>
    (salvarProdutoComGrade.mock.calls[0]?.[1] ??
      updateProduct.mock.calls[0]?.[1]) as Record<string, unknown>;

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

  it("mexer só no preço NÃO manda o estoque nem o contador de vendidos", async () => {
    await montarProduto([]);

    await digitarCampo("product-sale-price", "60,00");
    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    const remendo = remendoEnviado();
    expect(remendo.price).toBe(60);
    // Se o estoque (ou o vendido) for junto, o banco recebe o número velho da
    // tela por cima do que a venda acabou de descontar.
    expect(remendo).not.toHaveProperty("stock");
    expect(remendo).not.toHaveProperty("sold");
  });

  it("a REPOSIÇÃO digitada pela lojista continua gravando o estoque novo", async () => {
    await montarProduto([]);

    await digitarCampo("product-stock", "20");
    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(remendoEnviado().stock).toBe(20);
    // O vendido nunca é da lojista: segue de fora mesmo com o estoque indo.
    expect(remendoEnviado()).not.toHaveProperty("sold");
  });

  it("digitar o estoque e voltar ao número de antes não conta como mexer", async () => {
    await montarProduto([]);

    await digitarCampo("product-stock", "9");
    await digitarCampo("product-stock", "5");
    await digitarCampo("product-sale-price", "60,00");
    await salvar();

    expect(remendoEnviado()).not.toHaveProperty("stock");
  });

  it("zerar o estoque de propósito (0) é mexer: o zero grava", async () => {
    await montarProduto([]);

    await digitarCampo("product-stock", "0");
    await salvar();

    expect(remendoEnviado().stock).toBe(0);
  });

  it("variações: mexer só no preço do produto não manda o estoque de NENHUMA variação nem o do produto", async () => {
    await montarProduto(
      [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
      5,
    );

    await digitarCampo("product-sale-price", "60,00");
    await salvar();

    expect(remendoEnviado()).not.toHaveProperty("stock");
    const enviadas = variacoesEnviadas();
    expect(enviadas.map((v) => v.id)).toEqual(["v1", "v2"]);
    for (const v of enviadas) {
      expect(v).not.toHaveProperty("stockIncrement");
    }
    // Mas o resto do cadastro da variação segue indo (o upsert é por linha
    // inteira): nome, valor e ligada.
    expect(enviadas[0]).toMatchObject({ name: "Cor", value: "Rosa" });
    expect(enviadas[0].active).toBe(true);
  });

  it("variações: o estoque do produto gravado no banco diferente da soma NÃO é regravado só porque a tela somou", async () => {
    // O banco guarda 7 no produto, mas as variações ligadas somam 5 (a tela
    // mostra a soma e trava o campo). A lojista não tocou em nada disso.
    await montarProduto(
      [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
      7,
    );

    await digitarCampo("product-sale-price", "60,00");
    await salvar();

    expect(remendoEnviado()).not.toHaveProperty("stock");
  });

  it("variações: a lojista muda o estoque de UMA variação — só ela leva o número, e o produto leva a nova soma", async () => {
    await montarProduto(
      [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
      5,
    );

    await abrirVariacaoParaEditar("Rosa");
    await digitarCampo("variant-stock", "10");
    await act(async () => {
      // A confirmação da variação se distingue da gravação do produto.
      const salvarDoModal = [...document.querySelectorAll("button")]
        .filter((b) => b.textContent?.trim() === "Salvar variação")
        .at(-1) as HTMLButtonElement;
      salvarDoModal.click();
    });
    await salvar();

    const enviadas = variacoesEnviadas();
    const rosa = enviadas.find((v) => v.id === "v1");
    const azul = enviadas.find((v) => v.id === "v2");
    expect(rosa?.stockIncrement).toBe(10);
    expect(azul).not.toHaveProperty("stockIncrement");
    expect(remendoEnviado().stock).toBe(12);
  });

  it("variações: desligar uma é mexer no estoque do produto (a soma muda) e grava a nova soma", async () => {
    await montarProduto(
      [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
      5,
    );

    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Desligar variação Rosa"]',
        ) as HTMLButtonElement
      ).click();
    });
    await salvar();

    expect(remendoEnviado().stock).toBe(2);
    // O número da variação desligada não mudou: não vai.
    for (const v of variacoesEnviadas()) {
      expect(v).not.toHaveProperty("stockIncrement");
    }
  });

  it("variação NOVA (ainda sem id do banco) sempre leva o estoque que a lojista digitou", async () => {
    await montarProduto([variacao("v1", "Rosa", 3)], 3);

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
    await act(async () => {
      const confirmar = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Salvar variação"),
      ) as HTMLButtonElement;
      confirmar.click();
    });
    await salvar();

    const nova = variacoesEnviadas().find((v) => v.id.startsWith("temp-"));
    expect(nova?.stockIncrement).toBe(4);
    const rosa = variacoesEnviadas().find((v) => v.id === "v1");
    expect(rosa).not.toHaveProperty("stockIncrement");
    expect(remendoEnviado().stock).toBe(7);
  });
});
