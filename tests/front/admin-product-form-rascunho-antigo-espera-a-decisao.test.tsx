// @vitest-environment jsdom
//
// Reabrir um produto que tem rascunho antigo NÃO pode perdê-lo em silêncio.
//
// O defeito: o aviso "Rascunho não salvo encontrado" sumia em 10 s, e o
// salvamento automático (1 s depois da primeira edição) gravava o formulário
// por cima do rascunho antigo — fotos já enviadas e variações digitadas se
// perdiam sem que ela tivesse escolhido nada.
//
// Agora: enquanto o rascunho antigo está à espera de decisão (nem Restaurar nem
// Descartar), o salvamento automático não grava, e o aviso fica na tela até ela
// decidir. Decidiu (ou saiu da tela, ou salvou e o rascunho acabou), tudo volta
// a ser como era. O formato do rascunho não muda.
//
// Este arquivo SUBSTITUI a regra do "achado que bloqueou a #99" (digitar com o
// aviso aberto gravava por cima): aquele achado temia a bandeira presa para
// sempre com o aviso de 10 s que sumia sem decisão. Com o aviso que não some, a
// decisão está sempre ao alcance e a bandeira sempre cai (decidir, sair, salvar).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastDismiss = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
    warning: vi.fn(),
    dismiss: toastDismiss,
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TITULO = "Rascunho não salvo encontrado para este produto";
const CHAVE = "ikcous_product_form_draft_edit_prod-edit-1:lojista-1";

const produtoDoBanco = {
  id: "prod-edit-1",
  name: "Produto Existente",
  description: "Descrição existente",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

// Fotos já enviadas e variação digitada: o que se perdia.
const rascunhoAntigo = JSON.stringify({
  name: "Produto com rascunho antigo",
  images: ["https://loja.test/storage/v1/object/public/products/a.jpg"],
});

function digitarInput(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const opcoesDoAviso = () => {
  const chamada = toastInfo.mock.calls.find((c) => c[0] === TITULO);
  if (!chamada) throw new Error("O aviso de rascunho não apareceu.");
  return chamada[1] as {
    action: { onClick: () => void };
    cancel: { onClick: () => void };
    duration: number;
    dismissible?: boolean;
    id?: string;
  };
};

const botaoPorTexto = (texto: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Ações do produto"] button',
    ),
  ].find((b) => b.textContent?.includes(texto));

describe("AdminProductFormView — rascunho antigo espera a decisão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoDoBanco);
    updateProduct.mockImplementation(
      async (_id: string, updates: Record<string, unknown>) => ({
        ...produtoDoBanco,
        ...updates,
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    armazem.set(CHAVE, rascunhoAntigo);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
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

  async function abrirProduto() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          productId="prod-edit-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function digitarNome(nome: string) {
    await act(async () => {
      digitarInput("product-name", nome);
      // Debounce de 200 ms do campo.
      await vi.advanceTimersByTimeAsync(200);
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("o aviso fica até ela decidir: sem tempo, sem deslizar para fechar, com id para ser retirado", async () => {
    await abrirProduto();

    const opcoes = opcoesDoAviso();
    expect(opcoes.duration).toBe(Number.POSITIVE_INFINITY);
    expect(opcoes.dismissible).toBe(false);
    expect(typeof opcoes.id).toBe("string");
    expect(opcoes.action).toBeDefined();
    expect(opcoes.cancel).toBeDefined();
  });

  it("digitar ANTES de decidir não grava por cima do rascunho antigo (nem depois de muito tempo)", async () => {
    await abrirProduto();
    expect(armazem.get(CHAVE)).toBe(rascunhoAntigo);

    await digitarNome("Nome novo digitado");
    await passar(5000);

    expect(armazem.get(CHAVE)).toBe(rascunhoAntigo);

    await digitarNome("Outro nome ainda");
    await passar(60_000);

    expect(armazem.get(CHAVE)).toBe(rascunhoAntigo);
  });

  it("Descartar: o rascunho antigo sai e o que ela digitou antes de decidir passa a ser guardado", async () => {
    await abrirProduto();
    await digitarNome("Digitado antes de decidir");
    expect(armazem.get(CHAVE)).toBe(rascunhoAntigo);

    await act(async () => {
      opcoesDoAviso().cancel.onClick();
    });
    expect(armazem.get(CHAVE)).toBeUndefined();

    await passar(1000);
    const guardado = armazem.get(CHAVE);
    expect(guardado).toBeDefined();
    expect(JSON.parse(guardado!).name).toBe("Digitado antes de decidir");
  });

  it("Restaurar: o formulário vira o rascunho e o salvamento automático volta a gravar", async () => {
    await abrirProduto();

    await act(async () => {
      opcoesDoAviso().action.onClick();
    });
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Produto com rascunho antigo");

    await digitarNome("Editado depois de restaurar");
    await passar(1000);

    const guardado = armazem.get(CHAVE);
    expect(guardado).toBeDefined();
    expect(JSON.parse(guardado!).name).toBe("Editado depois de restaurar");
  });

  it("sair da tela sem decidir retira o aviso (senão ele ficaria solto em outra tela) e guarda o rascunho antigo", async () => {
    await abrirProduto();
    const { id } = opcoesDoAviso();
    expect(toastDismiss).not.toHaveBeenCalledWith(id);

    await act(async () => {
      raiz.unmount();
    });

    expect(toastDismiss).toHaveBeenCalledWith(id);
    expect(armazem.get(CHAVE)).toBe(rascunhoAntigo);

    // Recria a raiz para o afterEach não desmontar duas vezes.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("salvar o produto com o rascunho à espera: o rascunho some, o aviso é retirado e o produto salvo", async () => {
    await abrirProduto();
    const { id } = opcoesDoAviso();
    await digitarNome("Nome salvo de verdade");

    const botao = botaoPorTexto("Salvar alterações");
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await passar(2000);

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(armazem.has(CHAVE)).toBe(false);
    expect(toastDismiss).toHaveBeenCalledWith(id);
  });

  it("rascunho igual ao que já está no banco não vira pergunta: sai sozinho e o salvamento automático segue livre", async () => {
    armazem.set(CHAVE, JSON.stringify({ name: produtoDoBanco.name }));
    await abrirProduto();

    expect(toastInfo).not.toHaveBeenCalledWith(TITULO, expect.anything());
    expect(armazem.has(CHAVE)).toBe(false);

    await digitarNome("Editado sem rascunho antigo");
    await passar(1000);

    expect(JSON.parse(armazem.get(CHAVE) ?? "{}").name).toBe(
      "Editado sem rascunho antigo",
    );
  });
});
