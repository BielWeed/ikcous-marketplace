// @vitest-environment jsdom
//
// Desligar a ÚLTIMA variação ligada de um produto: o campo de estoque do
// produto destrava (já não há variação ligada que o some), mas continuava
// mostrando a soma de antes — o lojista via "5 unidades" num produto sem
// nada à venda e salvava esse 5. A regra (zerar UMA vez, na transição) está em
// `src/utils/estoque-das-variacoes.ts`; este arquivo prova na tela de verdade:
//
//  - desligar a última ligada pelo modal zera o campo de estoque do produto;
//  - o que o lojista digitar DEPOIS fica (zera uma vez só, não toda hora);
//  - produto antigo que já abre sem nenhuma variação ligada NÃO é tocado;
//  - desligar uma variação quando sobra outra ligada só refaz a soma.
//
// Mesmo padrão de admin-product-form-variante-composta.test.tsx: sem
// @testing-library/react, createRoot + act do React puro, hooks mockados.
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

/** O "Salvar" do MODAL da variação (o cabeçalho da tela também diz "Salvar"). */
function clicarSalvarDoModalDaVariacao() {
  const modal = document.getElementById("variant-status")?.closest(".fixed");
  const botao = [...(modal?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === "Salvar",
  );
  if (!botao) throw new Error('Botão "Salvar" do modal não está na tela.');
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function valorDoCampo(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  return el.value;
}

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  ativa: boolean,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: ativa,
});

describe("AdminProductFormView — estoque ao desligar a última variação ligada", () => {
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

  async function montarProduto(estoque: number, variants: unknown[]) {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "",
      price: 50,
      stock: estoque,
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

  /** Abre o modal da variação cujo rótulo contém `valor` pela caneta da linha. */
  async function abrirVariacao(valor: string) {
    const rotulo = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes(valor));
    if (!rotulo) throw new Error(`Variação "${valor}" não está na tela.`);
    const caneta = rotulo.closest("div.group")?.querySelector("button");
    if (!caneta) throw new Error("A caneta da linha não está na tela.");
    await act(async () => {
      caneta.click();
    });
  }

  /** Desliga a variação pelo "Aparece na loja?" do modal e salva. */
  async function desligarPeloModal(valor: string) {
    await abrirVariacao(valor);
    await act(async () => {
      document.getElementById("variant-status")?.click();
    });
    await act(async () => {
      clicarSalvarDoModalDaVariacao();
    });
  }

  it("desligar a ÚLTIMA ligada zera o campo de estoque do produto", async () => {
    await montarProduto(5, [
      variacao("v1", "Rosa", 5, true),
      variacao("v2", "Azul", 2, false),
    ]);
    expect(valorDoCampo("product-stock")).toBe("5");

    await desligarPeloModal("Rosa");

    expect(valorDoCampo("product-stock")).toBe("0");
  });

  it("zera UMA vez só: o que o lojista digita depois fica", async () => {
    await montarProduto(5, [variacao("v1", "Rosa", 5, true)]);
    await desligarPeloModal("Rosa");
    expect(valorDoCampo("product-stock")).toBe("0");

    await act(async () => {
      digitar("product-stock", "8");
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(valorDoCampo("product-stock")).toBe("8");

    // Mexer em outra coisa da linha desligada (aqui, o próprio estoque dela)
    // não é "desligar a última": o 8 do lojista segue intacto.
    await abrirVariacao("Rosa");
    await act(async () => {
      digitar("variant-stock", "9");
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      clicarSalvarDoModalDaVariacao();
    });
    expect(valorDoCampo("product-stock")).toBe("8");
  });

  it("produto antigo que já abre SEM variação ligada não é tocado", async () => {
    await montarProduto(12, [
      variacao("v1", "Rosa", 5, false),
      variacao("v2", "Azul", 2, false),
    ]);

    expect(valorDoCampo("product-stock")).toBe("12");
  });

  it("desligar uma variação quando sobra outra ligada só refaz a soma", async () => {
    await montarProduto(7, [
      variacao("v1", "Rosa", 5, true),
      variacao("v2", "Azul", 2, true),
    ]);
    expect(valorDoCampo("product-stock")).toBe("7");

    await desligarPeloModal("Rosa");

    expect(valorDoCampo("product-stock")).toBe("2");
  });
});
