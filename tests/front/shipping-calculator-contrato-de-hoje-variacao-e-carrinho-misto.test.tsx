// @vitest-environment jsdom
//
// TRÊS LINHAS DO ShippingCalculator QUE NENHUM TESTE PRENDIA (achadas por
// leitura: estragar a linha não derrubava teste algum).
//
// 1. `contratoCliente: 3` no pedido de cotação. É o sinal que a edge exige
//    (`CONTRATO_QUE_ENTENDE_ENTREGA_NO_MESMO_DIA`, entrega-propria.ts) para
//    mandar `deliveryDays: 0` na Entrega Local: sem ele a edge reescreve o 0
//    como 1 ("até 1 dia útil") mesmo com a entrega da lojista configurada
//    para hoje. Os testes de prazo respondem com um dublê que IGNORA o pedido,
//    então "contrato 2" passava calado.
// 2. O preço da VARIAÇÃO escolhida (`v.id === item.variantId`) é o que entra
//    no subtotal do "frete grátis acima de R$ X" — não o do produto-base.
// 3. O preset "por produto" (`freeShippingMin = -1`) libera o frete quando
//    UM item do carrinho está marcado (`cart.some`), não quando TODOS estão.
//
// Montagem: ShippingCalculator REAL; só a rede (`functions.invoke`) e os
// contextos são dublês — mesmo molde de
// `shipping-calculator-entrega-propria-prazo-em-dias.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const { invoke, estado } = vi.hoisted(() => ({
  invoke: vi.fn(),
  // Mutável por teste: os mocks (içados) leem este objeto.
  estado: { freeShippingMin: 0 },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { freeShippingMin: estado.freeShippingMin },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Entrega local com taxa cheia R$ 10: é a modalidade que a regra LOCAL
// (`free_shipping_min`) governa — só o cálculo do front a zera.
const ENTREGA_LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays: 0,
  provider: "local",
};

function produto(sobre: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Blusa",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  } as Product;
}

function variante(id: string, productId: string, priceOverride: number) {
  return {
    id,
    productId,
    name: "Tamanho",
    value: id,
    stockIncrement: 0,
    priceOverride,
    active: true,
  };
}

describe("ShippingCalculator: contrato de hoje, preço da variação e carrinho misto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    invoke.mockReset();
    estado.freeShippingMin = 0;
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar(carrinho: CartItem[]) {
    invoke.mockResolvedValue({
      data: { options: [ENTREGA_LOCAL] },
      error: null,
    });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino="38500000"
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("o pedido de cotação declara contratoCliente 3: sem ele a edge troca o 'mesmo dia' por 1 dia", async () => {
    await montar([{ product: produto(), quantity: 1 }]);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [nomeDaFuncao, pedido] = invoke.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(nomeDaFuncao).toBe("calculate-shipping");
    // Número exato (3), nunca texto nem outro contrato: o servidor compara
    // `typeof === 'number' && >= 3`.
    expect(pedido.body.contratoCliente).toBe(3);
  });

  it("frete grátis acima de R$ 100: variação de R$ 80 num produto-base de R$ 120 NÃO é grátis", async () => {
    estado.freeShippingMin = 100;
    const p = produto({
      id: "p1",
      price: 120,
      variants: [
        variante("v-escolhida", "p1", 80),
        variante("v-outra", "p1", 150),
      ],
    });
    const texto = await montar([
      { product: p, quantity: 1, variantId: "v-escolhida" },
    ]);

    // Subtotal = 80 (preço da variação escolhida) < 100: taxa cheia.
    expect(texto).toContain("10,00");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("frete grátis acima de R$ 100: variação de R$ 120 num produto-base de R$ 80 É grátis", async () => {
    estado.freeShippingMin = 100;
    const p = produto({
      id: "p1",
      price: 80,
      variants: [
        variante("v-escolhida", "p1", 120),
        variante("v-outra", "p1", 60),
      ],
    });
    const texto = await montar([
      { product: p, quantity: 1, variantId: "v-escolhida" },
    ]);

    // Subtotal = 120 (preço da variação escolhida) >= 100: grátis.
    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("10,00");
  });

  // As duas de cima deixam a variação escolhida em PRIMEIRO lugar da lista, então
  // pegar "a primeira variação" no lugar da escolhida passaria calado. Aqui a
  // escolhida é a SEGUNDA, e a primeira tem preço que decidiria o contrário.
  it("frete grátis acima de R$ 100: escolhida é a SEGUNDA variação (R$ 80); a primeira (R$ 150) não vale — NÃO é grátis", async () => {
    estado.freeShippingMin = 100;
    const p = produto({
      id: "p1",
      price: 120,
      variants: [
        variante("v-primeira", "p1", 150),
        variante("v-escolhida", "p1", 80),
      ],
    });
    const texto = await montar([
      { product: p, quantity: 1, variantId: "v-escolhida" },
    ]);

    // Subtotal = 80 (a escolhida) < 100: taxa cheia.
    expect(texto).toContain("10,00");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("frete grátis acima de R$ 100: escolhida é a SEGUNDA variação (R$ 120); a primeira (R$ 60) não vale — É grátis", async () => {
    estado.freeShippingMin = 100;
    const p = produto({
      id: "p1",
      price: 80,
      variants: [
        variante("v-primeira", "p1", 60),
        variante("v-escolhida", "p1", 120),
      ],
    });
    const texto = await montar([
      { product: p, quantity: 1, variantId: "v-escolhida" },
    ]);

    // Subtotal = 120 (a escolhida) >= 100: grátis.
    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("10,00");
  });

  it("por produto, carrinho MISTO: um item marcado basta para o cartão sair grátis", async () => {
    // Sentinela -1 = preset "por_produto" (gratuidade LIGADA).
    estado.freeShippingMin = -1;
    const texto = await montar([
      {
        product: produto({ id: "p1", freeShipping: true }),
        quantity: 1,
      },
      {
        product: produto({ id: "p2", name: "Saia", freeShipping: false }),
        quantity: 1,
      },
    ]);

    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("10,00");
  });

  it("por produto, carrinho sem NENHUM item marcado: taxa cheia (controle do preset ligado)", async () => {
    estado.freeShippingMin = -1;
    const texto = await montar([
      { product: produto({ id: "p1" }), quantity: 1 },
      { product: produto({ id: "p2", name: "Saia" }), quantity: 1 },
    ]);

    expect(texto).toContain("10,00");
    expect(texto).not.toContain("GRÁTIS");
  });
});
