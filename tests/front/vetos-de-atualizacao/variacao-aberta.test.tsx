// @vitest-environment jsdom
//
// A lojista abre um produto salvo, abre a janela "variação", digita preço ou
// quantidade e NÃO toca em "Salvar variação". Se uma atualização do app estiver
// pronta e a aba for ocultada (troca de app no celular), o instalador só lê o
// "sujo" que o formulário informa ao pai (`onSetDirty`): com o sujo olhando só o
// formulário principal, a página recarregava e o que estava na janela sumia.
//
// O que este arquivo prova, na tela de verdade:
//  - janela de variação nova com algo digitado: formulário sujo;
//  - janela aberta e intocada (nova ou de edição): continua limpo, para a
//    janela só olhada não pedir "Alterações não salvas" à toa;
//  - editar uma variação já gravada e mudar um campo: sujo;
//  - fechar a janela (Cancelar) tira o sujo da janela;
//  - o formulário principal mexido continua sujo, com a janela fechada ou aberta.
//
// Mesmo padrão de produto.test.tsx (esta pasta): createRoot + act do React puro,
// hooks mockados, o `onSetDirty` lido pela última chamada.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { casaOTexto } from "../helpers/gerar-grade";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
    products: [],
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

function clicarObrigatorio(texto: string | RegExp) {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    casaOTexto(b.textContent, texto),
  ) as HTMLButtonElement | undefined;
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

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

const rosa = {
  id: "v1",
  productId: "p-1",
  name: "Cor",
  value: "Rosa",
  stockIncrement: 3,
  active: true,
};

describe("AdminProductFormView — janela de variação aberta conta como trabalho não salvo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSetDirty = vi.fn<(dirty: boolean) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
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

  const sujo = () => onSetDirty.mock.calls.at(-1)?.[0];

  async function montar(variants: unknown[]) {
    mocks.fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 3,
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
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function abrirNovaVariacao() {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
  }

  async function abrirEdicao() {
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Editar variação Rosa"]',
        ) as HTMLButtonElement
      ).click();
    });
  }

  async function cancelar() {
    await act(async () => {
      clicarObrigatorio("Cancelar");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
  }

  it("produto recém-aberto, nada mexido: limpo", async () => {
    await montar([]);
    expect(sujo()).toBe(false);
  });

  it("janela de variação nova com quantidade digitada e sem salvar: sujo", async () => {
    await montar([]);
    await abrirNovaVariacao();
    await digitarCampo("variant-stock", "8");
    expect(document.getElementById("variant-stock")).not.toBeNull();
    expect(sujo()).toBe(true);
  });

  it("janela de variação nova aberta e intocada: continua limpo", async () => {
    await montar([]);
    await abrirNovaVariacao();
    expect(document.getElementById("variant-stock")).not.toBeNull();
    expect(sujo()).toBe(false);
  });

  it("janela de edição aberta e intocada: limpo; mudar um campo: sujo", async () => {
    await montar([rosa]);
    await abrirEdicao();
    expect(document.getElementById("variant-stock")).not.toBeNull();
    expect(sujo()).toBe(false);

    await digitarCampo("variant-stock", "9");
    expect(sujo()).toBe(true);
  });

  it("fechar a janela (Cancelar) tira o sujo da janela", async () => {
    await montar([]);
    await abrirNovaVariacao();
    await digitarCampo("variant-stock", "8");
    expect(sujo()).toBe(true);

    await cancelar();

    expect(document.getElementById("variant-stock")).toBeNull();
    expect(sujo()).toBe(false);
  });

  it("controle: formulário principal mexido segue sujo, com a janela fechada e aberta", async () => {
    await montar([]);
    await digitarCampo("product-stock", "5");
    expect(sujo()).toBe(true);

    await abrirNovaVariacao();
    expect(document.getElementById("variant-stock")).not.toBeNull();
    expect(sujo()).toBe(true);

    await cancelar();
    expect(sujo()).toBe(true);
  });
});
