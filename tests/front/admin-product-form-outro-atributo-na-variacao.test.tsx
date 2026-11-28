// @vitest-environment jsdom
//
// A janela "Nova variação"/"Editar variação" troca o "+ Outra coisa que muda"
// pela explicação (`explicacaoDeOutroTipoDeVariacao`) SÓ quando as OUTRAS
// opções do produto já usam um tipo de UM atributo. Três bordas que a caça de
// mutantes achou sem guarda (lote 585):
//   (a) produto com variação COMPOSTA ("Cor / Tamanho"): o botão continua;
//   (b) editar a ÚNICA variação: ela mesma não conta como "outra";
//   (c) produto com variação já salva: a explicação fala da opção vendida.
//
// Mesmo molde de admin-product-form-um-grupo-de-variacao.test.tsx: createRoot +
// act do React puro e os hooks de dados mockados. Ids e nomes inventados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
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

const BOTAO_OUTRO_ATRIBUTO = "+ Outra coisa que muda";

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** Falha alto se o elemento não existe: clique que não acontece deixaria a
 *  janela fechada e o "botão some" passaria por vacuidade. */
function clicarObrigatorio(el: Element | null | undefined, rotulo: string) {
  if (!el) throw new Error(`"${rotulo}" não está na tela.`);
  (el as HTMLElement).click();
}

const explicacao = () =>
  document.body.querySelector('[data-testid="outro-tipo-de-variacao"]')
    ?.textContent ?? "";

const variante = (id: string, name: string, value: string) => ({
  id,
  productId: "p-1",
  name,
  value,
  stockIncrement: 3,
  active: true,
});

describe("AdminProductFormView — o botão de outro atributo na janela da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarProduto(variants: unknown[]) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "",
      price: 50,
      stock: 10,
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

  async function abrirNovaVariacao() {
    await act(async () => {
      clicarObrigatorio(botaoPorTexto("+ Novo"), "+ Novo");
    });
    expect(document.body.textContent).toContain("Nova variação");
  }

  it("(a) produto com variações COMPOSTAS (Cor / Tamanho): 'Nova variação' mantém o botão de outro atributo, sem explicação", async () => {
    await montarProduto([
      variante("v1", "Cor / Tamanho", "Rosa / P"),
      variante("v2", "Cor / Tamanho", "Rosa / M"),
    ]);
    await abrirNovaVariacao();

    expect(botaoPorTexto(BOTAO_OUTRO_ATRIBUTO)).toBeDefined();
    expect(explicacao()).toBe("");
  });

  it("(b) editar a ÚNICA variação do produto: o botão aparece (ela mesma não conta como 'outra')", async () => {
    await montarProduto([variante("v1", "Tamanho", "P")]);
    await act(async () => {
      clicarObrigatorio(
        document.body.querySelector('[aria-label="Editar variação P"]'),
        "Editar variação P",
      );
    });
    expect(document.body.textContent).toContain("Editar variação");

    expect(botaoPorTexto(BOTAO_OUTRO_ATRIBUTO)).toBeDefined();
    expect(explicacao()).toBe("");
  });

  it("(c) produto com variação já salva: a explicação diz que a opção vendida não sai e o caminho é produto novo", async () => {
    await montarProduto([
      variante("v1", "Tamanho", "P"),
      variante("v2", "Tamanho", "M"),
    ]);
    await abrirNovaVariacao();

    expect(botaoPorTexto(BOTAO_OUTRO_ATRIBUTO)).toBeUndefined();
    expect(explicacao()).toContain(
      "Opção que já foi vendida não pode ser excluída: nesse caso, crie um produto novo.",
    );
  });
});
