// @vitest-environment jsdom
//
// O guia inline "Como usar as Variações" ensinava que o campo de estoque da
// variante era um ACRÉSCIMO ao estoque do produto ("se o produto tem 10 e a
// variante G tem mais 5, use o incremento correto") -- o oposto da regra
// real, que o próprio rótulo do campo (linha ~1887, "Estoque físico real
// para esta variação específica") e o efeito de sincronia (:876-888,
// `stock = soma das variantes ATIVAS`, com o campo do produto travado por
// `disabled={hasActiveVariants}`) já seguem. A ajuda geral do formulário
// (modal "Guia de Cadastro e Ajuda") tinha o mesmo problema do outro lado:
// prometia que "o SKU cadastrado é único na loja" quando quem tem UNIQUE de
// verdade é o SKU da VARIAÇÃO (`product_variants_sku_key`), não o código do
// produto (`produtos.codigo`, sem constraint nenhuma -- confirmado na
// baseline do schema).
//
// Mesmo padrão de admin-product-form-um-grupo-de-variacao.test.tsx: sem
// @testing-library/react (não instalado), createRoot + act do React puro.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
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

function botaoPorTitulo(titulo: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("title") === titulo,
  ) as HTMLButtonElement | undefined;
}

/** Falha alto se o botão não existe, em vez de deixar o clique não acontecer
 *  e o assert seguinte passar por vacuidade. */
function clicarObrigatorio(titulo: string) {
  const botao = botaoPorTitulo(titulo);
  if (!botao) throw new Error(`Botão "${titulo}" não está na tela.`);
  botao.click();
}

function textoDaTela() {
  return document.body.textContent?.replace(/\s+/g, " ") ?? "";
}

describe("AdminProductFormView — guia diz a regra real do estoque de variação", () => {
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  it("o guia de variações NÃO ensina 'incremento' como acréscimo ao estoque do produto", async () => {
    await montar();

    await act(async () => {
      clicarObrigatorio("Ajuda / Guia de Variações");
    });

    const texto = textoDaTela();
    // A frase antiga ("tem mais 5, use o incremento correto de estoque")
    // descrevia um ACRÉSCIMO ao estoque do produto -- o oposto do que a
    // tela faz de verdade (substitui pela soma das ativas e trava o campo).
    expect(texto).not.toMatch(/tem mais \d+ unidade/i);
    expect(texto).not.toMatch(/incremento correto de estoque/i);
  });

  it("o guia de variações ensina que, com variação ativa, o estoque do produto vira a SOMA e o campo trava", async () => {
    await montar();

    await act(async () => {
      clicarObrigatorio("Ajuda / Guia de Variações");
    });

    const texto = textoDaTela();
    expect(texto).toMatch(/soma/i);
    expect(texto).toMatch(/trav/i); // "trava"/"travado"/"travar"
  });

  it("a ajuda geral (modal) NÃO promete que o SKU do produto é único na loja", async () => {
    await montar();

    await act(async () => {
      clicarObrigatorio("Guia de Cadastro e Ajuda");
    });

    const texto = textoDaTela();
    // produtos.codigo não tem UNIQUE na baseline do schema -- só
    // product_variants.sku tem (`product_variants_sku_key`).
    expect(texto).not.toMatch(/SKU cadastrado é único na loja/i);
  });

  it("a ajuda geral (modal) diz que é o SKU da VARIAÇÃO que é único, não o do produto", async () => {
    await montar();

    await act(async () => {
      clicarObrigatorio("Guia de Cadastro e Ajuda");
    });

    const texto = textoDaTela();
    expect(texto).toMatch(/varia[cç][aã]o[^.]*[uú]nic/i);
  });
});
