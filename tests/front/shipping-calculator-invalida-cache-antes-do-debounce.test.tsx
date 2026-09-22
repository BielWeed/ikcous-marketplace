// @vitest-environment jsdom
//
// A invalidação do cache local (`ikcous_shipping_cache_<CEP>`) por mudança de
// carrinho precisa acontecer SÍNCRONA, assim que o carrinho muda — não dentro
// do `setTimeout` do debounce. Se ela ficasse dentro do timer (a forma da
// primeira rodada desta correção), clicar "Calcular" manualmente DURANTE a
// janela de debounce (até 700ms depois de mudar o carrinho) ainda encontraria
// o cache com a cotação da quantidade ANTERIOR e devolveria esse preço,
// mesmo com a transportadora nunca tendo sido consultada para a quantidade
// nova.
//
// Só a CHAMADA à transportadora continua adiada pelo debounce; a invalidação
// do cache não pode esperar por ela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
// FRETE V2 (onda D-1, 03/09): a regra de grátis do componente tem FONTE ÚNICA
// no CartContext — o componente consome o veredito `freteGratis` do contexto
// (a cópia antiga da regra, com item incondicional + trava Boolean(user),
// morreu). Mock seco: nenhum cenário destes arquivos é grátis.
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

function carrinhoComQuantidade(quantidade: number): CartItem[] {
  return [{ product: produto(), quantity: quantidade }];
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — invalida o cache do CEP assim que o carrinho muda, sem esperar o debounce", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
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
    // Preço = 10 * quantidade do carrinho enviado.
    invoke.mockReset();
    invoke.mockImplementation((_nome: string, opts: any) => {
      const quantidade = opts.body.cart[0].quantity as number;
      return Promise.resolve({
        data: {
          options: [
            {
              id: "melhorenvio-pac",
              name: "PAC",
              price: quantidade * 10,
              deliveryDays: 7,
            },
          ],
        },
        error: null,
      });
    });
    selecionadas = [];
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

  async function pintar(cart: CartItem[]) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
          cepDestino="69000000"
        />,
      );
    });
  }

  // Frete automático (22/09/2026): não há mais "Calcular". A cotação
  // imediata DENTRO da janela de debounce, hoje, é a calculadora montar de
  // novo no mesmo destino — a cliente muda a quantidade e toca em "Finalizar
  // Compra" logo em seguida (o checkout monta a própria calculadora, que cota
  // na montagem e consulta o cache ANTES da transportadora).
  async function remontarDentroDaJanela(cart: CartItem[]) {
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await pintar(cart);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("cotar DENTRO da janela de debounce cota a quantidade NOVA, não a do cache antigo", async () => {
    await pintar(carrinhoComQuantidade(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("10,00");

    // Carrinho vai de 1 para 3 unidades — agenda o debounce (700ms) e, se a
    // invalidação for síncrona, já apaga o cache do CEP 69000-000.
    await pintar(carrinhoComQuantidade(3));

    // Dentro da janela (200ms < 700ms), a calculadora monta de novo e cota.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await remontarDentroDaJanela(carrinhoComQuantidade(3));

    // Cache já estava invalidado: cache MISS, chamada real com quantity=3.
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("30,00");
    expect(hospedeiro.textContent).not.toContain("10,00");
  });
});
