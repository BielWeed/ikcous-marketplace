// @vitest-environment jsdom
//
// O cache de frete do NAVEGADOR (`ikcous_shipping_cache_<CEP>`) era indexado
// só pelo CEP: sem identidade do carrinho e sem prazo de validade. Ele é lido
// ANTES de qualquer chamada à edge function, e num acerto o componente já
// SELECIONA a opção — ou seja, o preço que vai para o pedido pode nunca ter
// sido cotado para o carrinho que a cliente tem agora.
//
// A invalidação por mudança de carrinho que já existia (o `removeItem` do
// efeito de debounce) apaga UMA chave: a do CEP que está no campo naquele
// instante. Toda entrada de OUTRO CEP sobrevive com o carrinho antigo dentro.
//
// Por que isso é urgente antes do `cart_hash` entrar no WHERE da RPC: hoje a
// lista velha é servida e o pedido passa. Depois da trava, o banco recusa no
// último clique — e quem paga é a cliente honesta, que só voltou a um CEP que
// já tinha consultado.
//
// A validade é 2 h porque é o mesmo prazo que a própria edge function usa para
// considerar uma cotação recente (`twoHoursAgo`, supabase/functions/
// calculate-shipping/index.ts). Acima disso ela recalcularia de qualquer jeito;
// servir do navegador seria fabricar um frescor que o servidor não daria.
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

const DUAS_HORAS_MS = 2 * 60 * 60 * 1000;

describe("ShippingCalculator — o cache do navegador não serve cotação de outro carrinho nem cotação vencida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
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
    // Preço = 10 * quantidade do carrinho efetivamente enviado à função.
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
          subtotal={100}
          freeShippingMin={0}
          selectedOption={null}
          onSelectOption={() => {}}
        />,
      );
    });
  }

  async function digitarCep(valor: string) {
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function enviar() {
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("voltar a um CEP já consultado com o carrinho MUDADO recota, não serve o preço antigo", async () => {
    await pintar(carrinhoComQuantidade(1));

    // Duas consultas com o carrinho de 1 unidade: duas entradas no cache.
    await digitarCep("69000000");
    await enviar();
    expect(invoke).toHaveBeenCalledTimes(1);

    await digitarCep("70000000");
    await enviar();
    expect(invoke).toHaveBeenCalledTimes(2);

    // O carrinho vai para 3 unidades. A invalidação existente apaga só a
    // chave do CEP que está no campo AGORA (70000-000); a de 69000-000
    // continua no disco, com o preço de 1 unidade dentro.
    await pintar(carrinhoComQuantidade(3));

    // A cliente volta para o primeiro CEP e pede o cálculo.
    await digitarCep("69000000");
    await enviar();

    // Sem identidade de carrinho no cache isto é um ACERTO e a tela mostra
    // R$ 10,00 — preço de 1 unidade para um carrinho de 3, que a RPC vai
    // recusar quando a trava do `cart_hash` entrar.
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls[2][1].body.cart[0].quantity).toBe(3);
    expect(hospedeiro.textContent).toContain("30,00");
    expect(hospedeiro.textContent).not.toContain("10,00");
  });

  it("cotação guardada há mais de 2 h não é servida", async () => {
    await pintar(carrinhoComQuantidade(1));
    await digitarCep("69000000");
    await enviar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Mesmo carrinho, mesmo CEP, um dia depois. `setSystemTime` move só o
    // relógio: nenhum timer pendente dispara, então a única coisa que pode
    // mudar o número de chamadas é a validade do cache.
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    await enviar();

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("dentro das 2 h, com o mesmo carrinho, o cache continua servindo", async () => {
    await pintar(carrinhoComQuantidade(1));
    await digitarCep("69000000");
    await enviar();
    expect(invoke).toHaveBeenCalledTimes(1);

    // Um minuto antes de vencer: ainda é acerto. Sem esta asserção, apagar o
    // cache inteiro passaria pelos dois testes acima.
    vi.setSystemTime(new Date(Date.now() + DUAS_HORAS_MS - 60_000));
    await enviar();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("10,00");
  });

  it("entrada no formato antigo (lista crua, sem carrinho e sem data) é tratada como ausência", async () => {
    // O que já está no navegador das clientes hoje. Não pode ser servida
    // — não há como saber de qual carrinho veio nem quando foi gravada — e
    // também não pode quebrar a tela.
    armazem.set(
      "ikcous_shipping_cache_69000000",
      JSON.stringify([
        { id: "melhorenvio-pac", name: "PAC", price: 999, deliveryDays: 7 },
      ]),
    );

    await pintar(carrinhoComQuantidade(1));
    await digitarCep("69000000");
    await enviar();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("10,00");
    expect(hospedeiro.textContent).not.toContain("999");
  });
});
