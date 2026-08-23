// @vitest-environment jsdom
//
// O timer pendente do debounce de recotação por mudança de carrinho não pode
// cotar (nem VALIDAR) um CEP que a cliente já substituiu. Sequência medida
// pela revisão: em t=0 o carrinho muda (agenda o timer com o CEP ANTIGO na
// closure, para disparar em t=700); em t=300 a cliente corrige o CEP e envia
// na hora (cotação imediata, CEP NOVO); sem cancelamento, o timer da mudança
// de carrinho — que ainda carrega o CEP antigo — dispara em t=700 e, por ter
// sido a chamada mais recente por número de sequência, VENCE o lacre e
// sobrescreve a tela com o preço (e o CEP) do destino errado.
//
// Isso é mais grave do que "preço errado na tela": `onCepValidated` reverte
// o `shippingCep` do `CartContext`, que é o que vai em `destinationCep` →
// `p_destination_cep` no fechamento do pedido (CheckoutView.tsx, useOrders.ts).
// A entrega vai para o CEP novo, mas o pedido é gravado com a cotação do CEP
// antigo — a diferença sai do bolso da lojista.
//
// A correção cancela o timer pendente no início de `calculateShipping`: toda
// cotação manual (ou automática) invalida um debounce que ainda não
// disparou, porque o envio manual já cobre o carrinho e o CEP correntes.
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

describe("ShippingCalculator — cotação manual cancela o debounce pendente do carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];
  let cepsValidados: string[];

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
    // Preço por CEP: 69000-000 (perto) -> 22 ; 01001-000 (longe) -> 99.
    invoke.mockReset();
    invoke.mockImplementation((_nome: string, opts: any) => {
      const cepPedido = opts.body.cep as string;
      const preco = cepPedido === "69000000" ? 22 : 99;
      return Promise.resolve({
        data: {
          options: [
            {
              id: "melhorenvio-pac",
              name: "PAC",
              price: preco,
              deliveryDays: 7,
            },
          ],
        },
        error: null,
      });
    });
    selecionadas = [];
    cepsValidados = [];
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
          onSelectOption={(opt) => selecionadas.push(opt)}
          onCepValidated={(cep) => cepsValidados.push(cep)}
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

  async function enviarFormulario() {
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("o CEP novo enviado manualmente não é desfeito pelo timer que carrega o CEP antigo", async () => {
    await pintar(carrinhoComQuantidade(1));
    await digitarCep("69000000");
    await enviarFormulario();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("22,00");

    // t=0: carrinho muda -> agenda o timer com o CEP ANTIGO (69000-000) na
    // closure, para disparar em t=700.
    await pintar(carrinhoComQuantidade(3));

    // t=300: a cliente corrige o CEP e envia na hora — cotação imediata do
    // CEP NOVO.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await digitarCep("01001000");
    await enviarFormulario();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("99,00");
    expect(cepsValidados.at(-1)).toBe("01001-000");

    // t=700 (e bem além): o timer do carrinho, sem a correção, dispararia
    // aqui com o CEP antigo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Nenhuma chamada nova, nenhuma reversão para o CEP/preço antigo.
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("99,00");
    expect(hospedeiro.textContent).not.toContain("22,00");
    expect(cepsValidados).toEqual(["69000-000", "01001-000"]);
  });
});
