// @vitest-environment jsdom
//
// O teto de 60 variações por produto (o mesmo da grade) vale também para o
// botão "+ Novo" do formulário: sem isso o lojista chegava ao 61º por cliques
// avulsos, e só a grade respeitava o limite. A frase do teto e o limite moram
// em `src/utils/grade-de-combinacoes.ts`; aqui se prova na tela de verdade:
//
//  - com 60 variações, "+ Novo" NÃO abre o modal e o toast diz o limite;
//  - com 59, "+ Novo" ainda abre (o limite é 60, não 59);
//  - produto antigo já ACIMA do teto também é barrado, sem apagar nada;
//  - o botão de editar uma variação existente segue abrindo (o teto é para
//    criar, não para mexer no que já existe).
//
// Mesmo padrão de admin-product-form-variante-composta.test.tsx.
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

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

const variacoes = (quantas: number) =>
  Array.from({ length: quantas }, (_, i) => ({
    id: `v-${i + 1}`,
    productId: "p-1",
    name: "Tamanho",
    value: `T${i + 1}`,
    stockIncrement: 1,
    active: true,
  }));

describe("AdminProductFormView — teto de variações no botão + Novo", () => {
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

  const modalAberto = () => document.getElementById("variant-name") !== null;
  const quantasNaTela = () =>
    document.querySelectorAll('[data-testid="variante-cadastrada"]').length;

  it("com 60 variações, + Novo NÃO abre o modal e o toast diz o limite", async () => {
    await montarProduto(variacoes(60));
    expect(quantasNaTela()).toBe(60);

    await act(async () => {
      clicarObrigatorio("+ Novo");
    });

    expect(modalAberto()).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [frase] = toastError.mock.calls[0] as [string];
    expect(frase).toContain("60");
    expect(quantasNaTela()).toBe(60);
  });

  it("com 59 variações, + Novo ainda abre (o teto é 60, não 59)", async () => {
    await montarProduto(variacoes(59));

    await act(async () => {
      clicarObrigatorio("+ Novo");
    });

    expect(modalAberto()).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("produto antigo já ACIMA do teto também é barrado, e nada é apagado", async () => {
    await montarProduto(variacoes(64));

    await act(async () => {
      clicarObrigatorio("+ Novo");
    });

    expect(modalAberto()).toBe(false);
    const [frase] = toastError.mock.calls[0] as [string];
    expect(frase).toContain("64");
    expect(quantasNaTela()).toBe(64);
  });

  it("editar uma variação que já existe segue abrindo mesmo com 60", async () => {
    await montarProduto(variacoes(60));

    const rotulo = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes("T1"));
    const caneta = rotulo?.closest("div.group")?.querySelector("button");
    expect(caneta).toBeTruthy();
    await act(async () => {
      (caneta as HTMLButtonElement).click();
    });

    expect(modalAberto()).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });
});
