// @vitest-environment jsdom
//
// A cliente calcula o frete com 1 unidade (R$ 22), aumenta para 10 e fecha o
// pedido — mas a tela continua dizendo R$ 22. Causa: o efeito que recota o
// frete quando o carrinho muda dependia de `cart.length`, e trocar a
// QUANTIDADE de um item que já está no carrinho não muda o comprimento do
// array. `ShippingCalculator.tsx:145-154` (antes da correção).
//
// A correção troca a dependência por uma assinatura do carrinho (mesma forma
// de `getCartHash` em supabase/functions/calculate-shipping/index.ts:
// `${productId}:${variantId}:${quantity}`, itens ordenados, juntos por
// vírgula) — muda quando produto, variante OU quantidade mudam.
//
// Como não existe debounce nenhum no componente hoje, trocar só a dependência
// criaria uma chamada à transportadora por clique. A correção inclui
// debounce: esta suíte prova as duas metades (recota quando devia + não
// dispara N chamadas numa rajada) porque uma sem a outra é o mesmo defeito
// com outra cara — ou o preço fica velho, ou a lojista paga N cotações por
// um clique só.
//
// Segue o padrão de shipping-calculator-sem-preco-inventado.test.tsx: sem
// @testing-library/react (não instalado neste projeto), createRoot + act do
// React puro, localStorage stubado com um Map de verdade.
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

function produto(overrides: Partial<Product> = {}): Product {
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
    ...overrides,
  };
}

function carrinhoComQuantidade(quantidade: number): CartItem[] {
  return [{ product: produto(), quantity: quantidade }];
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — recota quando a QUANTIDADE muda, sem virar chamada por clique", () => {
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
    invoke.mockResolvedValue({
      data: {
        options: [
          {
            id: "melhorenvio-pac",
            name: "PAC",
            price: 41.9,
            deliveryDays: 7,
            provider: "melhor_envio",
          },
        ],
      },
      error: null,
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

  /** Digita o CEP e envia o formulário — cotação imediata, como hoje. */
  async function cotarPelaPrimeiraVez(cepDigitado: string) {
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, cepDigitado);
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
  }

  async function avancarDebounce(ms = 900) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("âncora: cotação inicial (1 unidade) chama a transportadora uma vez", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionadas).toHaveLength(1);
  });

  it("o DEFEITO: aumentar a QUANTIDADE de 1 para 10 recota o frete", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    // Mesmo produto, mesma variante, SÓ a quantidade muda — cart.length
    // continua 1. É exatamente o caso que a cliente vive: 1 → 10 unidades.
    await rerender(carrinhoComQuantidade(10));
    await avancarDebounce();

    expect(invoke).toHaveBeenCalledTimes(2);
    const corpoDaSegundaChamada = invoke.mock.calls[1][1] as {
      body: { cart: CartItem[] };
    };
    expect(corpoDaSegundaChamada.body.cart[0]?.quantity).toBe(10);
  });

  it("não-regressão: ADICIONAR um item ao carrinho (o que já disparava, via cart.length) continua disparando", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    const segundoProduto = produto({ id: "prod-2", name: "Calça Teste" });
    await rerender([
      ...carrinhoComQuantidade(1),
      { product: segundoProduto, quantity: 1 },
    ]);
    await avancarDebounce();

    expect(invoke).toHaveBeenCalledTimes(2);
    const corpoDaSegundaChamada = invoke.mock.calls[1][1] as {
      body: { cart: CartItem[] };
    };
    expect(corpoDaSegundaChamada.body.cart).toHaveLength(2);
  });

  it("não-regressão: trocar a VARIANTE de um item já no carrinho (length igual) também recota", async () => {
    // Este caso NÃO era coberto pelo código antigo (dependia só de
    // `cart.length`, que troca de variante mantém igual) — mas a assinatura
    // nova cobre, porque a variante entra na chave da mesma forma que
    // `getCartHash` no edge function.
    await montar([{ product: produto(), quantity: 1, variantId: undefined }]);
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    await rerender([{ product: produto(), quantity: 1, variantId: "azul-m" }]);
    await avancarDebounce();

    expect(invoke).toHaveBeenCalledTimes(2);
    const corpoDaSegundaChamada = invoke.mock.calls[1][1] as {
      body: { cart: CartItem[] };
    };
    expect(corpoDaSegundaChamada.body.cart[0]?.variantId).toBe("azul-m");
  });

  it("o DEBOUNCE: uma rajada de mudanças de quantidade (1→2→…→10) vira UMA chamada só", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    // Simula cliques rápidos no "+": cada um troca a prop `cart` antes do
    // debounce da mudança anterior disparar.
    for (let quantidade = 2; quantidade <= 10; quantidade++) {
      await rerender(carrinhoComQuantidade(quantidade));
      // Menos que o debounce inteiro — a rajada continua sem deixar o timer
      // disparar entre um clique e o outro.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }

    // Ainda não passou o debounce completo desde o ÚLTIMO clique.
    expect(invoke).toHaveBeenCalledTimes(1);

    await avancarDebounce();

    // UMA chamada nova (não 9), e ela reflete a quantidade FINAL da rajada.
    expect(invoke).toHaveBeenCalledTimes(2);
    const corpoDaSegundaChamada = invoke.mock.calls[1][1] as {
      body: { cart: CartItem[] };
    };
    expect(corpoDaSegundaChamada.body.cart[0]?.quantity).toBe(10);
  });

  it("não-regressão: trocar o PRODUTO mantendo quantidade e comprimento (sincronização entre abas) também recota", async () => {
    // Achado C da revisão: a suíte inteira, até aqui, só provava que a
    // assinatura reage a `quantity` e a `variantId` — nenhum teste trocava
    // o PRODUTO em si mantendo tudo o resto igual. Uma assinatura sem
    // `product?.id` (só `variantId:quantity`) passaria nos outros 6 testes.
    // Caminho real: `CartContext.syncFromDB` substitui o array inteiro, e
    // trocar o produto A pelo B mantendo quantidade e comprimento é
    // alcançável por sincronização entre abas.
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    const outroProduto = produto({ id: "prod-outro", name: "Calça Teste" });
    await rerender([{ product: outroProduto, quantity: 1 }]);
    await avancarDebounce();

    expect(invoke).toHaveBeenCalledTimes(2);
    const corpoDaSegundaChamada = invoke.mock.calls[1][1] as {
      body: { cart: CartItem[] };
    };
    expect(corpoDaSegundaChamada.body.cart[0]?.product?.id).toBe("prod-outro");
  });

  it("controle negativo: re-renderizar com o MESMO carrinho (conteúdo idêntico, array novo) não dispara nada", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    // Array novo (referência diferente), mesmo produto/variante/quantidade —
    // é o que acontece a cada render do componente pai, sem o carrinho ter
    // mudado de verdade.
    await rerender(carrinhoComQuantidade(1));
    await avancarDebounce();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("cleanup: desmontar antes do debounce disparar cancela o timer — sem chamada fantasma", async () => {
    await montar(carrinhoComQuantidade(1));
    await cotarPelaPrimeiraVez("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);

    await rerender(carrinhoComQuantidade(10));

    // Desmonta ANTES do debounce completar.
    await act(async () => {
      raiz.unmount();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Nenhuma chamada extra depois do desmonte.
    expect(invoke).toHaveBeenCalledTimes(1);

    // Recria a raiz para o `afterEach` não tentar desmontar de novo.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
});
