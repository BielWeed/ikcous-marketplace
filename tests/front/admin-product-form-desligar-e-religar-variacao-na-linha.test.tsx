// @vitest-environment jsdom
//
// Desligar e religar uma variação direto na linha da lista, sem abrir o
// modal. Desligar tira a variação da loja SEM apagá-la (o cadastro, o SKU e o
// estoque dela ficam guardados) e religar a traz de volta — era só pelo modal
// ("Status no Catálogo") ou pela lixeira, que apaga de vez.
//
// O que este arquivo prova na tela de verdade:
//  - o botão da linha desliga a variação e AVISA que ela deixa de aparecer na
//    loja e volta quando religar;
//  - religar volta a contar o estoque dela no produto, sem aviso de bronca;
//  - desligar não apaga: a variação continua na lista, no salvar ela vai com
//    active=false e NENHUMA variação é mandada para exclusão;
//  - desligar a última ligada zera o estoque do produto (a regra da peça 1) e
//    religar uma devolve a soma;
//  - o aviso só fala de "deixa de aparecer" ao DESLIGAR.
//
// Mesmo padrão de admin-product-form-variante-composta.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    upsertVariants,
    deleteVariants,
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

const toastInfo = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe("AdminProductFormView — desligar e religar variação na linha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    deleteVariants.mockResolvedValue(undefined);
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
      description: "Algodão",
      price: 50,
      stock: 7,
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

  /** O botão da linha pelo rótulo acessível ("Desligar variação Rosa"). */
  function botaoDaLinha(acao: "Desligar" | "Religar", valor: string) {
    return document.querySelector(
      `[aria-label="${acao} variação ${valor}"]`,
    ) as HTMLButtonElement | null;
  }

  async function clicar(botao: HTMLButtonElement | null) {
    if (!botao) throw new Error("O botão da linha não está na tela.");
    await act(async () => {
      botao.click();
    });
  }

  const linhasNaTela = () =>
    [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
      (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );

  it("desligar tira a variação da loja e AVISA que ela volta quando religar", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 5, true),
      variacao("v2", "Azul", 2, true),
    ]);

    await clicar(botaoDaLinha("Desligar", "Rosa"));

    expect(toastInfo).toHaveBeenCalledTimes(1);
    const [aviso] = toastInfo.mock.calls[0] as [string];
    expect(aviso).toContain("Rosa");
    expect(aviso).toMatch(/deixa de aparecer na loja/);
    expect(aviso).toMatch(/volta quando (você )?religar/);
    // A linha ficou marcada como desligada e o botão virou "Religar".
    expect(document.body.textContent).toContain("Offline");
    expect(botaoDaLinha("Desligar", "Rosa")).toBeNull();
    expect(botaoDaLinha("Religar", "Rosa")).not.toBeNull();
    // O estoque do produto passa a ser só o da variação que sobrou ligada.
    expect(valorDoCampo("product-stock")).toBe("2");
  });

  it("religar traz a variação de volta, devolve o estoque dela ao produto e não repete o aviso", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 5, true),
      variacao("v2", "Azul", 2, true),
    ]);
    await clicar(botaoDaLinha("Desligar", "Rosa"));
    toastInfo.mockClear();

    await clicar(botaoDaLinha("Religar", "Rosa"));

    expect(toastInfo).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Offline");
    expect(botaoDaLinha("Desligar", "Rosa")).not.toBeNull();
    expect(valorDoCampo("product-stock")).toBe("7");
  });

  it("desligar a ÚLTIMA ligada zera o estoque do produto (e religar devolve)", async () => {
    await montarProduto([variacao("v1", "Rosa", 5, true)]);

    await clicar(botaoDaLinha("Desligar", "Rosa"));
    expect(valorDoCampo("product-stock")).toBe("0");

    await clicar(botaoDaLinha("Religar", "Rosa"));
    expect(valorDoCampo("product-stock")).toBe("5");
  });

  it("desligar NÃO apaga: a variação segue na lista e vai ao salvar com active=false, sem exclusão", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 5, true),
      variacao("v2", "Azul", 2, true),
    ]);
    await clicar(botaoDaLinha("Desligar", "Rosa"));

    expect(linhasNaTela()).toHaveLength(2);

    const salvar = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement | undefined;
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(deleteVariants).not.toHaveBeenCalled();
    expect(upsertVariants).toHaveBeenCalledTimes(1);
    const [, enviadas] = upsertVariants.mock.calls[0] as [
      string,
      Array<{ id: string; active: boolean }>,
    ];
    expect(enviadas.map((v) => [v.id, v.active])).toEqual([
      ["v1", false],
      ["v2", true],
    ]);
  });

  it("variação que já estava desligada ganha o botão Religar, não Desligar", async () => {
    await montarProduto([
      variacao("v1", "Rosa", 5, false),
      variacao("v2", "Azul", 2, true),
    ]);

    expect(botaoDaLinha("Religar", "Rosa")).not.toBeNull();
    expect(botaoDaLinha("Desligar", "Rosa")).toBeNull();
    expect(botaoDaLinha("Desligar", "Azul")).not.toBeNull();
  });
});
