// @vitest-environment jsdom
//
// "NOVO PRODUTO" E "EDITAR PRODUTO" ABREM COM O ARMAZENAMENTO BLOQUEADO
// (caça, r438-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites" e política de
// empresa fazem o próprio ACESSO a `localStorage` lançar SecurityError.
// `lerRascunhoVigenteDoProduto` lia a chave do rascunho fora de qualquer try,
// em dois efeitos de montagem do formulário: a exceção derrubava a tela
// inteira ("Algo deu errado") e a lojista não cadastrava nem editava produto.
// E, no Publicar, a limpeza do rascunho (`removeItem`) rodava DEPOIS de o
// produto já estar no banco: lançava, caía no `catch` do salvar e a tela
// dizia que não salvou — com o produto criado, a lojista publicava de novo e
// criava a cópia.
//
// Regra: rascunho indisponível = "sem rascunho"; a limpeza do rascunho nunca
// transforma um salvamento que deu certo em erro.
//
// Harness copiado de admin-product-form-draft-e-duplo-clique.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const addProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct: vi.fn(),
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
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function acoesDoProduto(): HTMLElement {
  const barra = document.querySelector<HTMLElement>(
    '[aria-label="Ações do produto"]',
  );
  if (!barra) throw new Error("Barra de ações do produto ausente");
  return barra;
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarInput(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
function bloquearOAcesso(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

describe("AdminProductFormView — abre e salva com o armazenamento bloqueado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let desbloquear: (() => void) | null;
  let errosSoltos: unknown[];
  const aoErroSolto = (erro: unknown) => {
    errosSoltos.push(erro);
  };
  const aoErroDaJanela = (evento: ErrorEvent) => {
    evento.preventDefault();
    errosSoltos.push(evento.error);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 3,
      sold: 0,
      category: "Geral",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    armazem = new Map();
    errosSoltos = [];
    process.on("uncaughtException", aoErroSolto);
    window.addEventListener("error", aoErroDaJanela);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    desbloquear = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    process.off("uncaughtException", aoErroSolto);
    window.removeEventListener("error", aoErroDaJanela);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    desbloquear?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirNovo() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function preencherFormularioValido() {
    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarTextarea("product-description", "Descrição de teste");
      digitarInput("product-sale-price", "1000");
      digitarInput("product-stock", "5");
      escolherCategoriaDoProduto("Geral");
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it("Novo produto: com o armazenamento bloqueado a tela abre, sem rascunho", async () => {
    desbloquear = bloquearOAcesso();

    await abrirNovo();

    expect(document.getElementById("product-name")).not.toBeNull();
    expect(errosSoltos).toEqual([]);
  });

  it("Editar produto: com o armazenamento bloqueado a tela abre com o produto do banco", async () => {
    desbloquear = bloquearOAcesso();
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          productId="p-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const nome = document.getElementById("product-name") as HTMLInputElement;
    expect(nome).not.toBeNull();
    expect(nome.value).toBe("Camiseta");
    expect(errosSoltos).toEqual([]);
  });

  it("Publicar com o armazenamento bloqueado: o produto foi criado e a tela diz Salvo, não erro", async () => {
    await abrirNovo();
    await preencherFormularioValido();
    desbloquear = bloquearOAcesso();

    const botao = localizarBotaoPorTexto(acoesDoProduto(), "Publicar");
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(botao?.textContent).toContain("Salvo");
    // A janela de "Salvo" termina na ida para a lista: o erro na limpeza do
    // rascunho abortava o salvar ANTES de agendar esta navegação (a tela ficava
    // parada em "Salvo" e o "há alterações não salvas" nunca saía).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-products", undefined, true);
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    expect(errosSoltos).toEqual([]);
  });

  it("controle: com armazenamento normal o rascunho vigente ainda é oferecido ao abrir", async () => {
    armazem.set(
      "ikcous_product_form_draft_edit_p-1:lojista-1",
      JSON.stringify({ name: "Camiseta rascunho", salvoEm: Date.now() }),
    );
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="lojista-1"
          productId="p-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(toastInfo).toHaveBeenCalledWith(
      "Rascunho não salvo encontrado para este produto",
      expect.anything(),
    );
  });
});
