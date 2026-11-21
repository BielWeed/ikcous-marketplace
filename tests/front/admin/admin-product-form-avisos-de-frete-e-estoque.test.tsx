// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ fetchProduct }),
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

describe("AdminProductFormView — avisos de frete e estoque", () => {
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
      variants?: ReturnType<typeof variacao>[];
    } = {},
  ) {
    fetchProduct.mockResolvedValue({ ...produto, variants: [], ...campos });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={produto.id}
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
      "Este produto não aparece na loja. Ao ligar “Aparece na loja”, ele poderá ser vendido sem escolha de variação.",
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
