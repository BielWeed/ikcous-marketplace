// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ fetchProduct, updateProduct }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

let config: { shippingCoverage: string; shippingProvider?: string } = {
  shippingCoverage: "national",
};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisoDeFrete =
  "Se o frete for calculado por transportadora, peso em branco ou zero usa 0,3 kg; cada medida em branco ou zero usa 15 cm.";
const avisoDeEstoqueZero = "Com estoque 0, o produto ficará esgotado.";
const avisoDeEstoquePositivo =
  "Com estoque acima de 0, o produto será vendido sem escolha de variação.";

const produto = {
  id: "p-1",
  name: "Camiseta",
  description: "Camiseta lisa",
  price: 50,
  stock: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  weightKg: 0.5,
  widthCm: 12,
  heightCm: 8,
  lengthCm: 20,
};

const variacao = (id: string, value: string, active: boolean) => ({
  id,
  productId: produto.id,
  name: "Cor",
  value,
  stockIncrement: 2,
  active,
});

describe("AdminProductFormView — avisos do formulário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    config = { shippingCoverage: "national" };
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar(
    campos: Partial<typeof produto> & {
      costPrice?: number;
      originalPrice?: number;
      variants?: ReturnType<typeof variacao>[];
    } = {},
    produtoNovo = false,
  ) {
    fetchProduct.mockResolvedValue({ ...produto, variants: [], ...campos });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={produtoNovo ? undefined : produto.id}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    expect(hospedeiro.querySelector("#product-name")).not.toBeNull();
  }

  function status() {
    return [...hospedeiro.querySelectorAll('[role="status"]')].map((el) =>
      el.textContent?.replace(/\s+/g, " ").trim(),
    );
  }

  function digitar(id: string, valor: string) {
    const campo = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
    if (!campo) throw new Error(`Campo "${id}" não está na tela.`);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function digitarPreco(valor: string) {
    await act(async () => {
      digitar("product-sale-price", valor);
      await new Promise((resolver) => setTimeout(resolver, 300));
    });
  }

  function avisosDePrecoNaBarra() {
    return [...hospedeiro.querySelectorAll('.produto-acoes [role="status"]')]
      .map((el) => el.textContent?.replace(/\s+/g, " ").trim())
      .filter((texto) => texto?.startsWith("Confira: o preço"));
  }

  const avisoDeQueda = "Confira: o preço vai cair de R$ 149,90 para R$ 14,90.";

  it("avisa na barra ao editar o preço de 149,90 para 14,90 sem desabilitar Salvar", async () => {
    await montar({ price: 149.9 });
    await digitarPreco("14,90");

    expect(avisosDePrecoNaBarra()).toEqual([avisoDeQueda]);
    expect(
      hospedeiro.querySelector<HTMLButtonElement>(".produto-salvar")?.disabled,
    ).toBe(false);
  });

  it("retira o aviso de queda ao voltar ao preço salvo", async () => {
    await montar({ price: 149.9 });
    await digitarPreco("14,90");
    expect(avisosDePrecoNaBarra()).toEqual([avisoDeQueda]);

    await digitarPreco("149,90");

    expect(avisosDePrecoNaBarra()).toEqual([]);
  });

  it("retira o aviso de queda assim que o novo preço é salvo na mesma tela", async () => {
    await montar({ price: 149.9 });
    updateProduct.mockResolvedValueOnce({
      ...produto,
      price: 14.9,
      variants: [],
    });
    await digitarPreco("14,90");
    expect(avisosDePrecoNaBarra()).toEqual([avisoDeQueda]);

    const salvar =
      hospedeiro.querySelector<HTMLButtonElement>(".produto-salvar");
    await act(async () => salvar?.click());

    expect(salvar?.textContent?.trim()).toBe("Salvo");
    expect(updateProduct).toHaveBeenCalledWith(
      produto.id,
      expect.objectContaining({ price: 14.9 }),
      expect.anything(),
    );
    expect(avisosDePrecoNaBarra()).toEqual([]);
  });

  it.each(["99,90", "74,95", "0,00", ""])(
    "não avisa sobre a queda de 149,90 para %j",
    async (preco) => {
      await montar({ price: 149.9, costPrice: 10 });
      await digitarPreco(preco);

      expect(avisosDePrecoNaBarra()).toEqual([]);
    },
  );

  it("avisa quando o preço digitado fica abaixo do custo mesmo sem cair pela metade", async () => {
    await montar({ price: 149.9, costPrice: 100 });
    await digitarPreco("99,90");

    expect(avisosDePrecoNaBarra()).toEqual([
      "Confira: o preço de venda (R$ 99,90) está abaixo do custo (R$ 100,00).",
    ]);
  });

  it("avisa a queda e o prejuízo separadamente, usando o preço de venda da promoção, não o De", async () => {
    await montar({ price: 149.9, costPrice: 20, originalPrice: 199.9 });
    await digitarPreco("14,90");

    expect(avisosDePrecoNaBarra()).toEqual([
      avisoDeQueda,
      "Confira: o preço de venda (R$ 14,90) está abaixo do custo (R$ 20,00).",
    ]);
  });

  it("não avisa ao digitar o preço de um produto novo", async () => {
    await montar({}, true);
    await digitarPreco("14,90");

    expect(avisosDePrecoNaBarra()).toEqual([]);
  });

  it("avisa só sobre o custo quando o preço carregado é zero", async () => {
    await montar({ price: 0, costPrice: 20 });
    await digitarPreco("14,90");

    expect(avisosDePrecoNaBarra()).toEqual([
      "Confira: o preço de venda (R$ 14,90) está abaixo do custo (R$ 20,00).",
    ]);
  });

  it("não avisa antes de mexer no preço salvo, mesmo que esteja abaixo do custo", async () => {
    await montar({ price: 14.9, costPrice: 20 });

    expect(avisosDePrecoNaBarra()).toEqual([]);
  });

  it("mostra o aviso condicional com peso em branco e sem provedor no cadastro da loja", async () => {
    await montar({ weightKg: undefined });

    expect(status()).toContain(avisoDeFrete);
    const salvar = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Salvar alterações",
    );
    expect(salvar?.disabled).toBe(false);
  });

  it.each(["widthCm", "heightCm", "lengthCm"] as const)(
    "avisa que o frete automático usa o padrão quando %s é zero",
    async (campo) => {
      await montar({ [campo]: 0 });

      expect(status()).toContain(avisoDeFrete);
    },
  );

  it("retira o aviso de frete quando peso e medidas ficam positivos", async () => {
    await montar({ weightKg: undefined });
    expect(status()).toContain(avisoDeFrete);

    await act(async () => {
      digitar("product-weight", "0.5");
      await new Promise((resolver) => setTimeout(resolver, 300));
    });

    expect(status()).not.toContain(avisoDeFrete);
  });

  it("mantém o aviso condicional mesmo se a loja só entrega localmente", async () => {
    config.shippingCoverage = "local";
    await montar({ weightKg: undefined });

    expect(status()).toContain(avisoDeFrete);
  });

  it("mantém o aviso perto do botão, fora da linha de estado que corta o texto", async () => {
    config.shippingProvider = "frenet";
    await montar({ weightKg: undefined });

    const aviso = [
      ...hospedeiro.querySelectorAll('.produto-acoes [role="status"]'),
    ].find((el) => el.textContent?.includes("peso em branco ou zero"));
    expect(aviso).toBeDefined();
    expect(aviso?.closest(".produto-status")).toBeNull();
  });

  it("avisa que o produto ficará esgotado se não há variações ligadas e o estoque é zero", async () => {
    await montar({ variants: [variacao("v1", "Rosa", false)] });

    expect(status()).toContain(avisoDeEstoqueZero);
    expect(status()).not.toContain(avisoDeEstoquePositivo);
  });

  it("troca o aviso ao digitar estoque positivo com todas as variações desligadas", async () => {
    await montar({
      variants: [variacao("v1", "Rosa", false), variacao("v2", "Azul", false)],
    });

    await act(async () => {
      digitar("product-stock", "8");
      await new Promise((resolver) => setTimeout(resolver, 300));
    });

    expect(status()).toContain(avisoDeEstoquePositivo);
    expect(status()).not.toContain(avisoDeEstoqueZero);
    const aviso = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (el) => el.textContent?.includes(avisoDeEstoquePositivo),
    );
    expect(aviso?.closest(".produto-acoes, .produto-status")).toBeNull();
  });

  it("só anuncia venda sem escolha de variação quando o produto aparece na loja", async () => {
    await montar({
      isActive: false,
      stock: 5,
      variants: [variacao("v1", "Rosa", false), variacao("v2", "Azul", false)],
    });

    expect(status()).not.toContain(avisoDeEstoquePositivo);
    expect(status()).toContain(
      "Com “Aparece na loja” desligado, o produto fica oculto ao salvar. Para vendê-lo sem escolha de variação, ligue a opção e salve.",
    );

    const interruptor = hospedeiro.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Aparece na loja"]',
    );
    expect(interruptor?.getAttribute("aria-checked")).toBe("false");
    act(() => interruptor?.click());
    expect(interruptor?.getAttribute("aria-checked")).toBe("true");
    expect(status()).toContain(avisoDeEstoquePositivo);
  });

  it("não avisa sobre estoque sem variação quando alguma está ligada", async () => {
    await montar({
      variants: [variacao("v1", "Rosa", false), variacao("v2", "Azul", true)],
    });

    expect(status()).not.toContain(avisoDeEstoqueZero);
    expect(status()).not.toContain(avisoDeEstoquePositivo);
  });

  it("não avisa sobre estoque sem variação quando o produto não tem variações", async () => {
    await montar();

    expect(status()).not.toContain(avisoDeEstoqueZero);
    expect(status()).not.toContain(avisoDeEstoquePositivo);
  });
});
