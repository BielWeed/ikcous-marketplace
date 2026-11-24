// @vitest-environment jsdom
//
// A linha do carrinho com variação: o PREÇO é o da variação escolhida, o LIMITE
// de quantidade é o estoque da variação (já descontado o que as outras linhas
// do mesmo produto levam) e remover/mudar a quantidade usa a CHAVE da linha
// (`idA~idB` com duas escolhas), nunca só o primeiro id.
//
// Mutações medidas (cada uma deixava todos os testes de tela anteriores
// verdes): a linha mostrar o preço base em vez do da variação; o desconto ser
// calculado contra o preço base; o "+" usar o estoque do produto em vez do da
// variação; o estoque da linha não descontar as outras linhas do produto (ou
// descontar a própria linha); remover/mudar quantidade pela primeira variação
// só (duas linhas "Azul-P" e "Azul-M" cairiam na mesma); a contagem de
// itens contar linhas em vez de unidades; o texto de uma linha antiga sem
// `variantNames` perder o nome do grupo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ProductVariant } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function variacao(
  id: string,
  name: string,
  estoque: number,
  extra: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    productId: "prod-camiseta",
    name,
    value: id,
    stockIncrement: estoque,
    active: true,
    ...extra,
  };
}

function camiseta(extra: Partial<Product> = {}): Product {
  return {
    id: "prod-camiseta",
    name: "Camiseta",
    description: "",
    price: 50,
    images: [],
    category: "Roupas",
    stock: 99,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(
  cart: CartItem[],
  acoes: {
    onUpdateQuantity?: (id: string, qty: number, chave?: string) => void;
    onRemove?: (id: string, chave?: string) => void;
  } = {},
) {
  const { CartItemsList } = await import(
    "@/components/ui/custom/CartItemsList"
  );
  await act(async () => {
    raiz.render(
      <CartItemsList
        cart={cart}
        removingId={null}
        onUpdateQuantity={acoes.onUpdateQuantity ?? (() => {})}
        onRemove={acoes.onRemove ?? (() => {})}
        handleClearCart={() => {}}
      />,
    );
  });
}

const texto = () => (hospedeiro.textContent ?? "").replace(/\s/g, " ");

describe("CartItemsList: preço da linha com variação", () => {
  it("mostra o preço da variação escolhida, não o do produto", async () => {
    const produto = camiseta({
      variants: [variacao("v-azul", "Cor", 5, { priceOverride: 80 })],
    });
    await montar([{ product: produto, quantity: 1, variantId: "v-azul" }]);
    expect(texto()).toContain("R$ 80,00");
    expect(texto()).not.toContain("R$ 50,00");
  });

  it("o desconto é contra o preço da variação: variação mais cara que o 'De' não anuncia desconto", async () => {
    // Preço base 50, "de 70", mas a variação custa 90: não há desconto algum.
    const produto = camiseta({
      originalPrice: 70,
      variants: [variacao("v-azul", "Cor", 5, { priceOverride: 90 })],
    });
    await montar([{ product: produto, quantity: 1, variantId: "v-azul" }]);
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
    expect(texto()).not.toContain("Preço original");
  });

  it("a contagem do topo soma as unidades, não as linhas", async () => {
    const produto = camiseta({
      variants: [variacao("v-a", "Cor", 9), variacao("v-b", "Cor", 9)],
    });
    await montar([
      { product: produto, quantity: 3, variantId: "v-a" },
      { product: produto, quantity: 2, variantId: "v-b" },
    ]);
    expect(texto()).toContain("5 Itens Adicionados");
  });
});

describe("CartItemsList: texto da variação quando a linha não guardou o nome", () => {
  it("carrinho antigo sem `variantNames` lê o par completo da variação (grupo: opção)", async () => {
    const produto = camiseta({ variants: [variacao("v-azul", "Cor", 5)] });
    await montar([{ product: produto, quantity: 1, variantId: "v-azul" }]);
    const rotulo = hospedeiro.querySelector(
      '[data-testid="cart-item-variacao"]',
    );
    expect(rotulo?.textContent).toBe("Cor: v-azul");
  });
});

describe("CartItemsList: limite de quantidade da linha", () => {
  it("o '+' trava no estoque da VARIAÇÃO, mesmo com muito estoque no produto", async () => {
    const produto = camiseta({
      stock: 99,
      variants: [variacao("v-azul", "Cor", 5)],
    });
    await montar([{ product: produto, quantity: 5, variantId: "v-azul" }]);
    const mais = hospedeiro.querySelector(
      'button[aria-label="Aumentar quantidade"]',
    );
    expect(mais?.getAttribute("aria-disabled")).toBe("true");
    expect(texto()).toContain("Máximo disponível: 5");
  });

  it("uma linha com a MESMA variação em outra linha do produto divide o estoque", async () => {
    // Azul tem 5: a linha "Azul + P" leva 3, então a linha "Azul + M" só
    // pode levar mais 2 (o servidor baixa as duas contra o mesmo azul).
    const produto = camiseta({
      variants: [
        variacao("v-azul", "Cor", 5),
        variacao("v-p", "Tamanho", 50),
        variacao("v-m", "Tamanho", 50),
      ],
    });
    await montar([
      {
        product: produto,
        quantity: 3,
        variantId: "v-azul",
        outrasVariantIds: ["v-p"],
      },
      {
        product: produto,
        quantity: 1,
        variantId: "v-azul",
        outrasVariantIds: ["v-m"],
      },
    ]);
    const frases = texto().match(/Só \d+ restantes?/g);
    // A linha "Azul + M" tem 5 - 3 = 2; a "Azul + P" tem 5 - 1 = 4 (sem aviso).
    expect(frases).toEqual(["Só 2 restantes"]);
  });
});

describe("CartItemsList: remover e mudar a quantidade pela chave da linha", () => {
  const produto = camiseta({
    variants: [variacao("v-azul", "Cor", 5), variacao("v-p", "Tamanho", 50)],
  });
  const linhaComDuasEscolhas: CartItem = {
    product: produto,
    quantity: 1,
    variantId: "v-azul",
    outrasVariantIds: ["v-p"],
  };

  it("remover leva a chave composta, não só o primeiro id", async () => {
    const onRemove = vi.fn();
    await montar([linhaComDuasEscolhas], { onRemove });
    const remover = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Remover "]',
    );
    await act(async () => remover?.click());
    expect(onRemove).toHaveBeenCalledWith("prod-camiseta", "v-azul~v-p");
  });

  it("mudar a quantidade leva a chave composta", async () => {
    const onUpdateQuantity = vi.fn();
    await montar([linhaComDuasEscolhas], { onUpdateQuantity });
    const mais = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Aumentar quantidade"]',
    );
    await act(async () => mais?.click());
    expect(onUpdateQuantity).toHaveBeenCalledWith(
      "prod-camiseta",
      2,
      "v-azul~v-p",
    );
  });

  it("com uma escolha só a chave é o próprio id", async () => {
    const onRemove = vi.fn();
    const simples = camiseta({ variants: [variacao("v-azul", "Cor", 5)] });
    await montar([{ product: simples, quantity: 1, variantId: "v-azul" }], {
      onRemove,
    });
    await act(async () =>
      hospedeiro
        .querySelector<HTMLButtonElement>('button[aria-label^="Remover "]')
        ?.click(),
    );
    expect(onRemove).toHaveBeenCalledWith("prod-camiseta", "v-azul");
  });

  it("sem variação nenhuma chave vai (undefined)", async () => {
    const onRemove = vi.fn();
    await montar([{ product: camiseta(), quantity: 1 }], { onRemove });
    await act(async () =>
      hospedeiro
        .querySelector<HTMLButtonElement>('button[aria-label^="Remover "]')
        ?.click(),
    );
    expect(onRemove).toHaveBeenCalledWith("prod-camiseta", undefined);
  });
});
