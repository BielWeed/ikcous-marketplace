// @vitest-environment jsdom
//
// A edita um produto, mexe num código de barras e toca em Salvar. Enquanto o
// banco confere o código (rede lenta), outra aba entra na conta B (também
// admin) e esta aba troca de conta. Quando a conferência termina, o formulário
// ANTIGO seguia e gravava com a sessão ATUAL — a de B —, em nome de uma edição
// que A começou. Agora o formulário guarda quem iniciou o salvar e, depois da
// espera, só grava se a conta viva ainda é a mesma; senão avisa e não grava.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const salvarProdutoComGrade = vi.fn();
const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();
const toastError = vi.fn();

// A conta que o painel enxerga AGORA (muda no meio do teste). O hook real a
// expõe por `idDaContaViva` (coberto em use-products-conta-viva-...).
const sessao = vi.hoisted(() => ({
  user: { id: "conta-a" } as { id: string } | null,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    idDaContaViva: () => sessao.user?.id,
    addProduct,
    updateProduct,
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

const produtoDoBanco = {
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
  variants: [
    {
      id: "v1",
      productId: "p-1",
      name: "Tamanho",
      value: "P",
      stockIncrement: 3,
      active: true,
      codigoBarras: "",
    },
  ],
};

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AdminProductFormView — a conta muda enquanto o código de barras é conferido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let liberarConferencia: (resposta: unknown) => void;

  async function renderizar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="conta-a"
          productId="p-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    sessao.user = { id: "conta-a" };
    rpcDoSupabase.mockReset();
    salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    updateProduct.mockResolvedValue(undefined);
    fetchProduct.mockResolvedValue(produtoDoBanco);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await renderizar();
    await act(async () => {
      await esperar(50);
    });
    // Dá um código novo à variação P (a conferência no banco só vale para
    // código novo ou trocado).
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Editar variação P"]',
        ) as HTMLButtonElement
      ).click();
    });
    rpcDoSupabase.mockResolvedValue(livre);
    await act(async () => {
      digitar("variant-codigo-barras", "7890000000001");
      await esperar(300);
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Salvar variação")
        ?.click();
    });
    await act(async () => {
      await esperar(400);
    });
    // Daqui em diante a conferência fica PENDURADA até o teste liberar.
    rpcDoSupabase.mockReset();
    rpcDoSupabase.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberarConferencia = resolve;
        }),
    );
    toastError.mockClear();
    salvarProdutoComGrade.mockClear();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Muda o nome (só para o Salvar valer) e toca em Salvar: a conferência fica em voo. */
  async function salvarComAConferenciaEmVoo() {
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
      await esperar(100);
    });
    expect(rpcDoSupabase).toHaveBeenCalledTimes(1);
  }

  async function terminarAConferencia() {
    await act(async () => {
      liberarConferencia(livre);
      await esperar(100);
    });
  }

  it("a conta troca para B durante a conferência: NADA é gravado e o aviso diz o porquê", async () => {
    await salvarComAConferenciaEmVoo();

    sessao.user = { id: "conta-b" };
    await terminarAConferencia();

    expect(salvarProdutoComGrade).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
    expect(addProduct).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    const frase = String(toastError.mock.calls[0][0]);
    expect(frase).toMatch(/conta/i);
    expect(frase).toMatch(/nada foi (salvo|gravado)/i);
  });

  it("a conta sai (logout) durante a conferência: também não grava", async () => {
    await salvarComAConferenciaEmVoo();

    sessao.user = null;
    await terminarAConferencia();

    expect(salvarProdutoComGrade).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
    expect(addProduct).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("depois do aviso o botão Salvar volta a funcionar (a trava não fica presa)", async () => {
    await salvarComAConferenciaEmVoo();
    sessao.user = { id: "conta-b" };
    await terminarAConferencia();
    expect(salvarProdutoComGrade).not.toHaveBeenCalled();

    // Já na conta B, quem abre e salva de novo grava normalmente.
    rpcDoSupabase.mockReset();
    rpcDoSupabase.mockResolvedValue(livre);
    toastError.mockClear();
    const barra = document.querySelector<HTMLElement>(
      '[aria-label="Ações do produto"]',
    );
    const salvar = [...(barra?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.trim().startsWith("Salvar"),
    );
    expect(salvar).toBeDefined();
    expect(salvar?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      salvar?.click();
      await esperar(100);
    });
    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
  });

  it("controle: a mesma conta do começo ao fim grava normalmente e não avisa nada", async () => {
    await salvarComAConferenciaEmVoo();

    // O painel reage a algo (nova renderização) mas a conta é a mesma.
    await renderizar();
    await terminarAConferencia();

    expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });
});
