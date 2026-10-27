// @vitest-environment jsdom
//
// Criar categoria de dentro do formulário de produto: sem duplo toque, sem erro
// genérico quando o nome só difere em maiúscula/acento (o banco tem nome único e
// slug único), e com a palavra 'categoria' em vez de 'setor'.
import { act } from "react";
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

const addCategory = vi.fn();
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "cat-1", name: "Geral", slug: "geral" },
      { id: "cat-2", name: "Vestuário", slug: "vestuario" },
    ],
    addCategory,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(() => "toast-1"),
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

describe("AdminProductFormView — criar categoria de dentro do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    addCategory.mockResolvedValue({ id: "cat-novo" });
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

  async function abrirNovaCategoria() {
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
    // Pelo caminho da lojista: toca no campo e depois em "Nova categoria".
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    await act(async () => {
      botaoPorTexto("Nova categoria")?.click();
    });
    // A folha é baixada sob demanda (import dinâmico): espera ela chegar (até
    // ~3 s, para não falhar com a máquina carregada).
    for (let i = 0; i < 60 && !botaoPorTexto("Criar categoria"); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
  }

  const botaoCriar = () => botaoPorTexto("Criar categoria");

  it("o modal fala 'categoria', não 'setor'", async () => {
    await abrirNovaCategoria();

    expect(document.body.textContent).toContain("Nova categoria");
    expect(botaoCriar()).toBeDefined();
    expect(document.body.textContent).not.toContain("Criar Setor");
    expect(document.body.textContent).not.toContain("Setor / Categoria");
  });

  it("nome que só difere em maiúscula ou acento avisa qual categoria já existe e não tenta criar", async () => {
    await abrirNovaCategoria();
    await digitarCampo("cat-name", "VESTUARIO");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(addCategory).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toBe(
      "Já existe uma categoria parecida: Vestuário",
    );
    // A folha continua aberta com o que ela digitou, para corrigir.
    expect(botaoCriar()).toBeDefined();
  });

  it("nome realmente novo cria uma vez e escolhe a categoria nova", async () => {
    await abrirNovaCategoria();
    await digitarCampo("cat-name", "Calçados");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(addCategory.mock.calls[0][0]).toMatchObject({ name: "Calçados" });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("duplo toque rápido em 'Criar categoria' cria UMA vez só, e o botão fica desligado enquanto cria", async () => {
    let terminar: (v: unknown) => void = () => {};
    addCategory.mockReturnValue(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    await abrirNovaCategoria();
    await digitarCampo("cat-name", "Calçados");

    await act(async () => {
      botaoCriar()?.click();
      botaoCriar()?.click();
    });

    expect(addCategory).toHaveBeenCalledTimes(1);
    expect(botaoCriar()?.disabled).toBe(true);

    await act(async () => {
      terminar({ id: "cat-novo" });
    });
    expect(addCategory).toHaveBeenCalledTimes(1);
  });

  it("se a criação falhar, o botão volta a funcionar para tentar de novo", async () => {
    addCategory.mockRejectedValueOnce(new Error("sem rede"));
    await abrirNovaCategoria();
    await digitarCampo("cat-name", "Calçados");
    await act(async () => {
      botaoCriar()?.click();
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(botaoCriar()?.disabled).toBe(false);
    await act(async () => {
      botaoCriar()?.click();
    });
    expect(addCategory).toHaveBeenCalledTimes(2);
  });
});
