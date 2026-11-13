// @vitest-environment jsdom
//
// Lacuna de painel (balcão): bipou um código que não está cadastrado, tocou em
// "Cadastrar produto" — o formulário de produto NOVO abria com o campo "Código
// de barras" vazio e a lojista redigitava o número que acabara de ler (e erro
// de digitação = produto com o código errado). Agora o formulário novo abre
// com o código lido já no campo.
//
// O fluxo é provado com os dois componentes de verdade: `CupomDaVenda` (aviso
// "Código não encontrado" + botão) e `AdminProductFormView` (formulário). Quem
// liga um ao outro, no app, é o roteador (`onNavigate`) — aqui o dublê de
// `onNavigate` só registra o toque; o formulário é montado em seguida, como o
// roteador faria. Sem `@testing-library/react`: `createRoot` + `act`, no molde
// de admin-product-form-codigo-de-barras.test.tsx.
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import {
  chaveDoRascunhoDoProduto,
  serializarRascunhoDoProduto,
} from "@/lib/rascunho-do-produto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
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

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USUARIO = "u-teste";

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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoPorTexto(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão ausente: ${texto}`);
  return achado as HTMLButtonElement;
}

function campoDoCodigo(): HTMLInputElement {
  const el = document.getElementById(
    "product-codigo-barras",
  ) as HTMLInputElement | null;
  if (!el) throw new Error("campo ausente: #product-codigo-barras");
  return el;
}

describe("balcão — 'Cadastrar produto' leva o código lido para o formulário novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoDoBanco);
    armazem = new Map();
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
  });

  /** O aviso do balcão para um código lido que o catálogo não conhece. */
  async function bipouCodigoNaoCadastrado(codigo: string) {
    const estado = {
      ...estadoInicialDaVenda(() => "chave-fixa"),
      aviso: { tipo: "nao_cadastrado" as const, codigo },
    };
    await act(async () => {
      raiz.render(
        <CupomDaVenda
          estado={estado}
          despachar={vi.fn()}
          subtotal={0}
          onNavigate={onNavigate}
          feedback={null}
        />,
      );
    });
  }

  async function tocarEmCadastrarProduto() {
    await act(async () => {
      botaoPorTexto(hospedeiro, "Cadastrar produto").click();
      await esperarMicrotarefas();
    });
  }

  /** O roteador desmonta o balcão e abre o formulário de produto. */
  async function abrirFormulario(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId={USUARIO}
          productId={productId}
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
  }

  it("o aviso não diz mais que o código é digitado à mão", async () => {
    await bipouCodigoNaoCadastrado("7891234567890");

    expect(hospedeiro.textContent).not.toContain("manual por enquanto");
    expect(hospedeiro.textContent).toContain("já preenchido");
  });

  it("o formulário novo abre com o código lido no campo 'Código de barras'", async () => {
    await bipouCodigoNaoCadastrado("7891234567890");
    await tocarEmCadastrarProduto();
    expect(onNavigate).toHaveBeenCalledWith("admin-product-form");

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("7891234567890");
  });

  it("o código lido passa pela mesma limpeza do campo (aparar e tirar espaços)", async () => {
    await bipouCodigoNaoCadastrado("  789 1234 567890 ");
    await tocarEmCadastrarProduto();

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("7891234567890");
  });

  it("sem tocar em 'Cadastrar produto' o formulário novo abre com o campo vazio", async () => {
    await bipouCodigoNaoCadastrado("7891234567890");

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("código lido que não cabe no formato do campo deixa o campo vazio", async () => {
    await bipouCodigoNaoCadastrado("12");
    await tocarEmCadastrarProduto();

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("código vazio deixa o campo vazio", async () => {
    await bipouCodigoNaoCadastrado("   ");
    await tocarEmCadastrarProduto();

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("editar um produto existente não recebe o código lido", async () => {
    await bipouCodigoNaoCadastrado("7891234567890");
    await tocarEmCadastrarProduto();

    await abrirFormulario("prod-edit-1");

    expect(campoDoCodigo().value).toBe("");
  });

  it("o código lido vale uma vez só: o próximo formulário novo abre vazio", async () => {
    await bipouCodigoNaoCadastrado("7891234567890");
    await tocarEmCadastrarProduto();
    await abrirFormulario();
    expect(campoDoCodigo().value).toBe("7891234567890");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    // O rascunho que o formulário gravou ao ser mexido não é o assunto aqui.
    armazem.clear();
    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("código lido há muito tempo (toque que não levou a lugar nenhum) não aparece depois", async () => {
    const agora = Date.now();
    await bipouCodigoNaoCadastrado("7891234567890");
    await tocarEmCadastrarProduto();

    vi.spyOn(Date, "now").mockReturnValue(agora + 10 * 60 * 1000);
    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("rascunho de produto já começado não é sobrescrito pelo código lido", async () => {
    const chave = chaveDoRascunhoDoProduto(USUARIO);
    if (!chave) throw new Error("chave do rascunho ausente");
    armazem.set(
      chave,
      serializarRascunhoDoProduto({
        name: "Camiseta do rascunho",
        codigoBarras: "1111222233334",
      }),
    );
    await bipouCodigoNaoCadastrado("7891234567890");
    await tocarEmCadastrarProduto();

    await abrirFormulario();

    expect(campoDoCodigo().value).toBe("1111222233334");
    expect(
      (document.getElementById("product-name") as HTMLInputElement).value,
    ).toBe("Camiseta do rascunho");
  });
});
