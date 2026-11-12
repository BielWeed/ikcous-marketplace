// @vitest-environment jsdom
//
// A cotação de frete guardada no navegador (2 h) só serve se o carrinho for o
// mesmo, e quem diz isso é a assinatura do carrinho (`cartSignature`). Ela
// tinha produto, variação, quantidade e preço, mas NÃO a marca `freeShipping`
// do produto -- e é essa marca que zera o preço da opção (`precoFinalDaOpcao`).
//
// Cenário: a loja tem frete grátis por produto e entrega local de R$ 12. A
// cliente cota com a camiseta marcada como grátis (opção a R$ 0). A loja
// desmarca o produto sem mexer no preço e a cliente volta ao carrinho dentro
// das 2 h: a assinatura era a mesma, o cache era aceito e a tela mostrava
// GRÁTIS para uma entrega que custa R$ 12 (o servidor recalcula no
// fechamento, então a divergência só aparecia no fim).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

function produto(id: string, freeShipping: boolean): Product {
  return {
    id,
    name: `Camiseta ${id}`,
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping,
    createdAt: new Date(0).toISOString(),
  };
}

function carrinhoCom(...itens: [string, boolean][]): CartItem[] {
  return itens.map(([id, gratis]) => ({
    product: produto(id, gratis),
    quantity: 1,
  }));
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REVISAO_FIXA_DO_TESTE = "rev-fixa-do-teste";

describe("ShippingCalculator -- a marca de frete grátis do produto identifica o carrinho do cache", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let ultimoCarrinho: CartItem[] = [];

  beforeEach(() => {
    ultimoCarrinho = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    invoke.mockReset();
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts.body.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: REVISAO_FIXA_DO_TESTE },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          options: [
            {
              id: "melhorenvio-pac",
              name: "PAC",
              price: 12,
              deliveryDays: 7,
            },
          ],
          revisaoConfig: REVISAO_FIXA_DO_TESTE,
        },
        error: null,
      });
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
    vi.useRealTimers();
  });

  async function pintar(cart: CartItem[], cep: string | null = "69000000") {
    ultimoCarrinho = cart;
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino={cep}
        />,
      );
    });
  }

  async function escoar() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  // Voltar ao carrinho: a calculadora desmonta e monta no MESMO destino.
  async function remontar() {
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await pintar(ultimoCarrinho);
    await escoar();
  }

  it("a loja desmarca o produto (mesmo preço) e a cliente volta ao carrinho: recota, não serve o cache", async () => {
    await pintar(carrinhoCom(["cam-1", true]));
    await escoar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Cadastro relido: mesmo id, mesma quantidade, mesmo preço; só a marca.
    ultimoCarrinho = carrinhoCom(["cam-1", false]);
    await remontar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].body.action).toBeUndefined();
    expect(invoke.mock.calls[1][1].body.cart[0].product.freeShipping).toBe(
      false,
    );
  });

  it("o inverso: a loja MARCA o produto como grátis e a cliente volta ao carrinho: recota", async () => {
    await pintar(carrinhoCom(["cam-1", false]));
    await escoar();
    expect(invoke).toHaveBeenCalledTimes(1);

    ultimoCarrinho = carrinhoCom(["cam-1", true]);
    await remontar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].body.action).toBeUndefined();
    expect(invoke.mock.calls[1][1].body.cart[0].product.freeShipping).toBe(
      true,
    );
  });

  it("um item troca de marca e o outro não (o conjunto continua com um grátis): recota", async () => {
    await pintar(carrinhoCom(["cam-1", true], ["cam-2", false]));
    await escoar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Continua existindo UM item grátis no carrinho, mas é outro item.
    ultimoCarrinho = carrinhoCom(["cam-1", false], ["cam-2", true]);
    await remontar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].body.action).toBeUndefined();
  });

  it("marca igual (carrinho relido sem mudança): continua servindo o cache, sem cotação nova", async () => {
    await pintar(carrinhoCom(["cam-1", true]));
    await escoar();
    expect(invoke).toHaveBeenCalledTimes(1);

    ultimoCarrinho = carrinhoCom(["cam-1", true]);
    await remontar();

    // Só a confirmação da revisão (R1-2); nenhuma cotação de rede nova.
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1]).toEqual({
      body: { action: "revisao_config_frete" },
    });
  });

  it("cotação guardada no formato sem a marca (antes desta correção) não é servida: recota uma vez", async () => {
    armazem.set(
      "ikcous_shipping_cache_v2_69000000",
      JSON.stringify({
        contexto: (
          await import("@/contexts/ContextoDoFreteDaLoja")
        ).contextoDaLojaParaFrete(undefined),
        assinatura: "cam-1::1:100",
        gravadoEm: Date.now(),
        revisaoConfig: REVISAO_FIXA_DO_TESTE,
        opcoes: [
          { id: "melhorenvio-pac", name: "PAC", price: 999, deliveryDays: 7 },
        ],
      }),
    );

    await pintar(carrinhoCom(["cam-1", false]));
    await escoar();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.action).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("999");
  });
});
