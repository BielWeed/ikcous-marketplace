// @vitest-environment jsdom
//
// A trava de UM grupo de variação por produto, exercitada na tela de verdade.
// A regra e o porquê medido estão em `src/utils/um-grupo-de-variacao.ts`; o
// teste da regra pura está em `um-grupo-de-variacao.test.ts`. O que ESTE
// arquivo prova é que o formulário liga na regra: que o segundo grupo é
// recusado no clique real do botão, que a opção do mesmo grupo continua
// passando, e que as sugestões param de convidar para o estado proibido.
//
// Mesmo padrão de admin-product-form-draft-e-duplo-clique.test.tsx: sem
// @testing-library/react (não instalado), createRoot + act do React puro, e os
// hooks de dados mockados.
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

/** Falha alto se o botão não existe: clique que não acontece deixa um
 *  `not.toHaveBeenCalled()` passar por vacuidade -- foi o que este arquivo
 *  fez na primeira rodada, com o formulário de variante dentro de um portal. */
function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminProductFormView — um tipo de variação por produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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

  /** Abre "Nova Variante", preenche atributo/valor e clica em efetivar. */
  async function cadastrarVariante(atributo: string, valor: string) {
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    await act(async () => {
      digitar("variant-name", atributo);
      digitar("variant-value", valor);
      // Flush do debounce (200ms) do LocalBufferedInput.
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });
  }

  /** As variantes que a lista da tela mostra, como "Atributo: Valor". */
  function variantesNaTela(): string[] {
    return [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
  }

  it("aceita a PRIMEIRA variante e outra opção do MESMO tipo", async () => {
    await montar();

    await cadastrarVariante("Cor", "Rosa");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Rosa"]);

    await cadastrarVariante("Cor", "Azul");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Rosa", "Cor: Azul"]);
  });

  it("RECUSA um segundo tipo, e a variante não entra na lista", async () => {
    await montar();

    await cadastrarVariante("Cor", "Rosa");
    const antes = variantesNaTela();
    expect(antes).toEqual(["Cor: Rosa"]);

    await cadastrarVariante("Tamanho", "P");

    expect(toastError).toHaveBeenCalledTimes(1);
    const [titulo, opcoes] = toastError.mock.calls[0] as [
      string,
      { description?: string },
    ];
    // A mensagem tem de dizer QUAL tipo já está em uso e como sair do impasse:
    // aviso que não diz o que fazer é o mesmo defeito que a tela do produto já
    // corrigiu uma vez no toast de variação.
    expect(titulo).toContain("Cor");
    expect(opcoes.description).toMatch(/Rosa P/);

    expect(variantesNaTela()).toEqual(antes);
  });

  it("recusa o segundo tipo mesmo escrito com outra caixa", async () => {
    await montar();

    await cadastrarVariante("Cor", "Rosa");
    await cadastrarVariante("TAMANHO", "P");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(variantesNaTela()).toEqual(["Cor: Rosa"]);
  });

  it("trata 'cor' e 'Cor' como o MESMO tipo, e deixa passar", async () => {
    await montar();

    await cadastrarVariante("Cor", "Rosa");
    await cadastrarVariante("  cor  ", "Azul");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Rosa", "cor: Azul"]);
  });

  it("para de sugerir um tipo novo depois que o produto já tem um", async () => {
    await montar();

    const sugestoesVisiveis = () =>
      [...document.body.querySelectorAll("button")]
        .map((b) => b.textContent?.trim())
        .filter((t) => t === "Cor" || t === "Tamanho" || t === "Voltagem");

    // Antes da primeira variante, as sugestões ajudam.
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    expect(sugestoesVisiveis()).toContain("Tamanho");

    await act(async () => {
      clicarObrigatorio("Cancelar");
    });

    await cadastrarVariante("Cor", "Rosa");

    // Depois dela, sugerir "Tamanho" seria convidar para o que a trava recusa.
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    const depois = sugestoesVisiveis();
    expect(depois).toContain("Cor");
    expect(depois).not.toContain("Tamanho");
    expect(depois).not.toContain("Voltagem");
  });
});

describe("AdminProductFormView — produto legado que já tem dois tipos", () => {
  // Não dá para chegar neste estado pela tela (a trava impede), mas um produto
  // gravado antes dela pode estar assim -- e nesse caso o número de estoque que
  // a tela mostra está somado errado. Avisar é melhor que somar em silêncio.
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
      id: "p-legado",
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
          productId="p-legado"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const variante = (id: string, name: string, value: string) => ({
    id,
    productId: "p-legado",
    name,
    value,
    stockIncrement: 3,
    active: true,
  });

  it("AVISA que o estoque está somado errado quando há dois tipos", async () => {
    await montarProduto([
      variante("v1", "Cor", "Rosa"),
      variante("v2", "Tamanho", "P"),
    ]);

    const texto = document.body.textContent?.replace(/\s+/g, " ") ?? "";
    expect(texto).toContain("tipos de variação demais");
    // O aviso precisa dizer a CONSEQUÊNCIA, não só que está errado.
    expect(texto).toMatch(/recebe dois P/);
  });

  it("NÃO avisa quando o produto tem um tipo só", async () => {
    await montarProduto([
      variante("v1", "Cor", "Rosa"),
      variante("v2", "Cor", "Azul"),
    ]);

    const texto = document.body.textContent?.replace(/\s+/g, " ") ?? "";
    expect(texto).not.toContain("tipos de variação demais");
  });
});
