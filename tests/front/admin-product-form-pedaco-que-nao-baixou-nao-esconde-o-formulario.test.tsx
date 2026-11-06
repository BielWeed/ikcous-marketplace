// @vitest-environment jsdom
//
// O lojista está editando um produto (mudou o nome) e toca em "Nova categoria".
// O arquivo daquela folha não baixa (a aba ficou aberta e saiu versão nova).
// Antes, o erro subia e a tela inteira do formulário sumia, com a edição junto.
// Agora só a folha mostra um aviso curto: o formulário continua montado com o
// que foi digitado, "Tentar de novo" pede o arquivo outra vez e "Fechar" tira
// o aviso do caminho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({ ok: false }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn(),
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
    loading: vi.fn(() => "toast-1"),
  },
}));
// O arquivo da folha: pedir o módulo falha enquanto o servidor não responde
// (o acesso ao export mora num getter porque o vitest guarda o resultado da
// fábrica entre os testes).
vi.mock("@/components/admin/products/FolhaDeNovaCategoria", async () => {
  const { createElement } = await import("react");
  const Folha = () =>
    createElement("button", { type: "button" }, "Criar categoria");
  return {
    get FolhaDeNovaCategoria() {
      if (!servidor.ok) {
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://x/assets/FolhaDeNovaCategoria-abc.js",
        );
      }
      return Folha;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

describe("formulário de produto — folha que não baixou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    servidor.ok = false;
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  async function assentar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  async function abrirEFalhar() {
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
    const campo = document.getElementById("product-name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "Vestido Floral");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    await act(async () => {
      botaoPorTexto("Nova categoria")?.click();
    });
    await assentar();
  }

  it("só a folha mostra aviso: o formulário e o nome digitado continuam na tela", async () => {
    await abrirEFalhar();

    const campo = document.getElementById("product-name") as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.value).toBe("Vestido Floral");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Esta parte não abriu",
    );
    expect(botaoPorTexto("Tentar de novo")).toBeDefined();
  });

  it("'Tentar de novo' com o arquivo de volta abre a folha, sem perder a edição", async () => {
    await abrirEFalhar();

    servidor.ok = true;
    await act(async () => {
      botaoPorTexto("Tentar de novo")?.click();
    });
    await assentar();

    expect(botaoPorTexto("Criar categoria")).toBeDefined();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Vestido Floral");
  });

  it("'Fechar' tira o aviso e o formulário segue intacto", async () => {
    await abrirEFalhar();

    await act(async () => {
      botaoPorTexto("Fechar")?.click();
    });
    await assentar();

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Vestido Floral");
  });
});
