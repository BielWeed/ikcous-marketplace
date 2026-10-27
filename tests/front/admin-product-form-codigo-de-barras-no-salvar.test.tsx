// @vitest-environment jsdom
//
// Ao SALVAR, o formulário confere os códigos de barras no banco. Antes: uma
// consulta por variação, uma depois da outra, sem prazo (um produto com muitas
// variações esperava a fila inteira, e uma rede travada deixava o "Salvando…"
// preso para sempre) e até as variações que ela nem mexeu eram conferidas de
// novo. Agora: só os códigos NOVOS ou TROCADOS, todos ao mesmo tempo, com prazo;
// estourar o prazo vale como "não consegui conferir" (aviso, não bloqueia).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const salvarProdutoComGrade = vi.fn();
const addProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
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

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcDoSupabase } }));

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

const livre = {
  data: {
    encontrado: false,
    origem: null,
    codigo: "",
    produto: null,
    variante: null,
    preco: null,
    estoque: null,
    variacoes: [],
  },
  error: null,
};

const ocupadoPor = (nome: string) => ({
  data: {
    encontrado: true,
    origem: "produto",
    codigo: "x",
    produto: {
      id: "outro-produto",
      nome,
      ativo: true,
      preco_venda: 1,
      estoque: 1,
      imagem: null,
      codigo_barras: "x",
      tem_variantes: false,
    },
    variante: null,
    preco: 1,
    estoque: 1,
    variacoes: [],
  },
  error: null,
});

const variacao = (id: string, valor: string, codigoBarras: string) => ({
  id,
  productId: "p-1",
  name: "Tamanho",
  value: valor,
  stockIncrement: 3,
  active: true,
  codigoBarras,
});

const produtoDoBanco = (variants: unknown[]) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  costPrice: 20,
  stock: 9,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminProductFormView — conferência dos códigos de barras ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcDoSupabase.mockReset();
    rpcDoSupabase.mockResolvedValue(livre);
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
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
    vi.useRealTimers();
  });

  async function abrir(variants: unknown[]) {
    fetchProduct.mockResolvedValue(produtoDoBanco(variants));
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-1"
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

  /** Abre a variação `valor`, digita o código e confirma na janela. */
  async function darCodigo(valor: string, codigo: string) {
    await act(async () => {
      (
        document.querySelector(
          `[aria-label="Editar variação ${valor}"]`,
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      digitar("variant-codigo-barras", codigo);
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Salvar variação")
        ?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
  }

  /** Muda o nome do produto (só para o Salvar valer) e clica em Salvar. */
  async function mexerEClicarSalvar(esperar: (ms: number) => Promise<unknown>) {
    await act(async () => {
      digitar("product-name", "Camiseta nova");
      await esperar(300);
    });
    const barra = document.querySelector<HTMLElement>(
      '[aria-label="Ações do produto"]',
    );
    const salvar = barra
      ? [...barra.querySelectorAll("button")].find((b) =>
          b.textContent?.trim().startsWith("Salvar"),
        )
      : undefined;
    if (!salvar) throw new Error("Botão Salvar não está na tela.");
    await act(async () => {
      salvar.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  const esperaReal = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const codigosConsultados = () =>
    rpcDoSupabase.mock.calls.map(
      (c) => (c[1] as { p_codigo: string }).p_codigo,
    );

  it("variações que já estavam salvas e não mudaram NÃO são consultadas de novo", async () => {
    await abrir([
      variacao("v1", "P", "7890000000001"),
      variacao("v2", "M", "7890000000002"),
      variacao("v3", "G", "7890000000003"),
    ]);
    await mexerEClicarSalvar(esperaReal);
    await act(async () => {
      await esperaReal(50);
    });

    expect(rpcDoSupabase).not.toHaveBeenCalled();
    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
  });

  it("só o código TROCADO é consultado", async () => {
    await abrir([
      variacao("v1", "P", "7890000000001"),
      variacao("v2", "M", "7890000000002"),
    ]);
    await darCodigo("M", "7890000000099");
    rpcDoSupabase.mockClear();

    await mexerEClicarSalvar(esperaReal);
    await act(async () => {
      await esperaReal(50);
    });

    expect(codigosConsultados()).toEqual(["7890000000099"]);
    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
  });

  it("os códigos a conferir saem TODOS ao mesmo tempo, sem esperar um terminar para pedir o próximo", async () => {
    await abrir([
      variacao("v1", "P", ""),
      variacao("v2", "M", ""),
      variacao("v3", "G", ""),
    ]);
    await darCodigo("P", "7890000000011");
    await darCodigo("M", "7890000000012");
    await darCodigo("G", "7890000000013");
    rpcDoSupabase.mockReset();
    // Nenhuma resposta chega: se fosse em fila, só a 1ª consulta teria saído.
    rpcDoSupabase.mockImplementation(() => new Promise(() => undefined));

    await mexerEClicarSalvar(esperaReal);
    await act(async () => {
      // A importação do cliente é assíncrona: dá um instante para as 3 saírem.
      await esperaReal(100);
    });

    expect(codigosConsultados().sort()).toEqual([
      "7890000000011",
      "7890000000012",
      "7890000000013",
    ]);
    expect(salvarProdutoComGrade).not.toHaveBeenCalled();
  });

  it("se a consulta nunca responde, o prazo acaba, avisa 'não consegui conferir' e o salvar segue", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await abrir([variacao("v1", "P", "")]);
    await darCodigo("P", "7890000000021");
    rpcDoSupabase.mockReset();
    rpcDoSupabase.mockImplementation(() => new Promise(() => undefined));

    vi.useFakeTimers();
    await mexerEClicarSalvar((ms) => vi.advanceTimersByTimeAsync(ms));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(rpcDoSupabase).toHaveBeenCalledTimes(1);
    expect(salvarProdutoComGrade).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });

    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a primeira recusa, na ordem da tela, é a que aparece, e nada é gravado", async () => {
    await abrir([variacao("v1", "P", ""), variacao("v2", "M", "")]);
    await darCodigo("P", "7890000000031");
    await darCodigo("M", "7890000000032");
    rpcDoSupabase.mockReset();
    rpcDoSupabase.mockImplementation(async (_nome: string, args: unknown) => {
      const codigo = (args as { p_codigo: string }).p_codigo;
      // A resposta da primeira variação (P) chega DEPOIS da da segunda (M).
      if (codigo === "7890000000031") {
        await esperaReal(120);
        return ocupadoPor("Camiseta Azul");
      }
      return ocupadoPor("Camiseta Verde");
    });

    await mexerEClicarSalvar(esperaReal);
    await act(async () => {
      await esperaReal(300);
    });

    expect(toastError).toHaveBeenCalledWith(
      "Este código já está em Camiseta Azul",
    );
    expect(salvarProdutoComGrade).not.toHaveBeenCalled();
  });
});
