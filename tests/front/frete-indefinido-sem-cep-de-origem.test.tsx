import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
//
// Laudo caça-bugs 31/08 (B1): loja recém-clonada nasce SEM CEP de origem e
// com taxa fixa — e a calculate-shipping recusa cotar QUALQUER coisa sem
// origem (`validarOrigemEFrete` checa a origem ANTES da taxa). O carrinho,
// porém, mostrava "Frete R$ 15,00" como preço real, porque a bandeira
// `freteIndefinido` excluía flat_fee de propósito. O R$ 15 só é preço real
// QUANDO a loja tem origem configurada; sem origem é "a calcular" — e o
// Finalizar fica travado (a loja está fechada para venda até configurar).
//
// Mesmo harness de cart-context-variant-names.test.tsx: provider de
// verdade, contextos vizinhos dublês, config mutável por teste.

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingFee: 15,
    freeShippingMin: 350,
    shippingProvider: "flat_fee" as string,
    originCep: undefined as string | undefined,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Produto sem frete grátis",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

function FreteIndefinidoReader({
  onValor,
}: Readonly<{ onValor: (indefinido: boolean) => void }>) {
  const { freteIndefinido, addToCart } = useCartContext();
  useEffect(() => {
    onValor(freteIndefinido);
  }, [freteIndefinido, onValor]);
  return <button onClick={() => addToCart(produto(), 1)}>adicionar</button>;
}

describe("freteIndefinido — taxa fixa sem CEP de origem também é 'a calcular'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let valor: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Node 25 traz um localStorage experimental proprio que vence o do jsdom
    // e explode no primeiro getItem -- os irmaos (cart-context-*) stubam o
    // global com um armazem em Map. Mesmo padrao.
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    mockConfig.shippingFee = 15;
    mockConfig.freeShippingMin = 350;
    mockConfig.shippingProvider = "flat_fee";
    mockConfig.originCep = undefined;
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

  async function montarEAdicionar() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <FreteIndefinidoReader
            onValor={(v) => {
              valor = v;
            }}
          />
        </CartProvider>,
      );
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("adicionar"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
  }

  it("flat_fee SEM origem -> freteIndefinido TRUE (o R$ 15 era preço mentiroso)", async () => {
    await montarEAdicionar();
    expect(valor).toBe(true);
  });

  it("flat_fee COM origem -> freteIndefinido FALSE (o R$ 15 é preço real)", async () => {
    mockConfig.originCep = "38500-000";
    await montarEAdicionar();
    expect(valor).toBe(false);
  });

  it("provedor de cotação COM origem e sem opção escolhida -> TRUE (comportamento de 30/08, continua)", async () => {
    mockConfig.originCep = "38500-000";
    mockConfig.shippingProvider = "melhor_envio";
    await montarEAdicionar();
    expect(valor).toBe(true);
  });
});
