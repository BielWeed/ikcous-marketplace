// @vitest-environment jsdom
//
// A guarda `!loading` que impedia duas cotações de correrem ao mesmo tempo
// saiu do efeito de recotação (ShippingCalculator.tsx) na correção da
// FRETE-020 — tirá-la era necessário: com ela de volta, uma mudança de
// carrinho enquanto a cotação anterior ainda está em voo é simplesmente
// IGNORADA (a assinatura muda, mas o efeito nunca dispara de novo porque
// `loading` continua `true`), e a quantidade nova nunca é cotada.
//
// Mas tirar a guarda sem nada no lugar abre uma SEGUNDA porta para o mesmo
// estrago (preço errado no pedido, diferença sai do bolso da lojista): com
// duas cotações em voo, nada garante que a mais NOVA responda por último.
// Se a transportadora demorar mais na cotação antiga, ela pode sobrescrever
// a cotação atual quando finalmente responder — e o preço errado fica preso
// na tela até a próxima mudança de carrinho.
//
// Cenário aqui (medido pela revisão que bloqueou o diff original):
//   t=0     carrinho vai para 2un  -> cotação A dispara em t=700, demora 4s
//   t=2200  carrinho vai para 3un  -> cotação B dispara em t=2900, responde em t=3400
//   t=4700  A responde e, sem lacre, SOBRESCREVE B -> tela fica com o preço de 2un
//
// A correção é um lacre de sequência (`reqRef` em ShippingCalculator.tsx):
// cada cotação tira um número, e só quem tem o número mais recente pode
// escrever o resultado. Ver também shipping-calculator-recota-por-quantidade.test.tsx
// (a suíte que cobre o defeito que a guarda `!loading` resolvia) e
// shipping-calculator-sem-preco-inventado.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
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

describe("ShippingCalculator — a cotação mais NOVA vence, mesmo se a mais VELHA responder por último", () => {
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
    invoke.mockReset();
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

  async function montar(cart: CartItem[]) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          subtotal={100}
          freeShippingMin={0}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
        />,
      );
    });
  }

  async function rerender(cart: CartItem[]) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          subtotal={100}
          freeShippingMin={0}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
        />,
      );
    });
  }

  /** preço = 10 * quantidade; a cotação de 2 unidades demora 4s, a de 3 demora 500ms. */
  function cotacaoComLatencia() {
    invoke.mockImplementation((_nome: string, opts: any) => {
      const quantidade = opts.body.cart[0].quantity as number;
      const atraso = quantidade === 2 ? 4000 : 500;
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
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
            }),
          atraso,
        ),
      );
    });
  }

  it("o frete que fica na tela é o do carrinho ATUAL (3 unidades), não o da cotação antiga (2 unidades)", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [
          { id: "melhorenvio-pac", name: "PAC", price: 10, deliveryDays: 7 },
        ],
      },
      error: null,
    });
    await montar(carrinhoComQuantidade(1));

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "69000000");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    cotacaoComLatencia();

    // t=0: carrinho vai para 2 unidades.
    await rerender(carrinhoComQuantidade(2));
    // t=700: dispara a cotação A (2 unidades, 4s de latência).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(invoke).toHaveBeenCalledTimes(2);

    // t=2200: 1,5s depois, carrinho vai para 3 unidades.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await rerender(carrinhoComQuantidade(3));
    // t=2900: dispara a cotação B (3 unidades, 500ms) -> responde em t=3400.
    // A cotação A (2 unidades) só responde em t=4700.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(invoke).toHaveBeenCalledTimes(3);

    // Deixa as duas responderem — A (mais velha) responde por último.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const ultimaSelecionada = selecionadas[selecionadas.length - 1] as
      | { price: number }
      | null
      | undefined;
    expect(hospedeiro.textContent).toContain("30,00");
    expect(ultimaSelecionada?.price).toBe(30);
  });
});
