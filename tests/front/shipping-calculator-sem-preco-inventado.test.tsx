// @vitest-environment jsdom
//
// A calculadora de frete não inventa preço quando a cotação falha.
//
// Até 18/08/2026, se a `calculate-shipping` falhasse (ou o aparelho estivesse
// sem rede), o `catch` deste componente montava uma opção própria:
//
//     { id: "flat-fee-fallback-ui", name: "Entrega Padrão (Fallback)",
//       price: 15, ... }
//
// e ainda chamava `onSelectOption(fallbackOption)`. Dois estragos de uma vez:
//
//   1. R$ 15 para qualquer destino do Brasil. Uma peça de Monte Carmelo para
//      Manaus saía por R$ 15 e a diferença ficava com a lojista.
//   2. Pior que o número: essa opção SOBRESCREVE a taxa que a própria lojista
//      configurou no painel. O `shippingFee` do CartContext só cai para
//      `config.shippingFee` quando NÃO há opção selecionada (CartContext.tsx,
//      memo de `shippingFee`). Ao auto-selecionar a opção inventada, o app
//      trocava o número dela por um número nosso — e o pedido registrava
//      "Entrega Padrão (Fallback)" como se fosse uma cotação.
//
// Com a correção, falha de cotação não produz opção nenhuma: o erro aparece na
// tela e o carrinho volta a aplicar a taxa configurada pela loja.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

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

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
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
    },
    quantity: 1,
  },
];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — cotação que falha não vira preço inventado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável — mesmo dublê em
    // Map usado em admin-orders-payment-filter.test.tsx. O componente lê a
    // chave `ikcous_last_shipping_cep` já no initializer do useState.
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
  });

  async function montarECotar(cepDigitado: string) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
        />,
      );
    });

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
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("a âncora: com cotação boa, a opção real é oferecida e selecionada", async () => {
    // Sem esta prova, o teste seguinte passaria mesmo com o formulário quebrado
    // e nenhuma cotação sendo disparada.
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

    await montarECotar("69000000");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionadas).toHaveLength(1);
    expect((selecionadas[0] as { price: number }).price).toBe(41.9);
  });

  it("cotação que falha não inventa opção nem sobrescreve a taxa da loja", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function retornou 500" },
    });

    await montarECotar("69000000");

    // Nenhuma OPÇÃO selecionada — é isso que devolve o controle do frete para o
    // `config.shippingFee` da lojista, no memo do CartContext.
    //
    // `null` é esperado e necessário: limpar a seleção anterior impede que uma
    // cotação de outro CEP continue valendo para este destino. O que não pode
    // aparecer aqui é objeto de opção nenhum.
    expect(selecionadas.filter((o) => o !== null)).toEqual([]);
    // E nenhum "R$ 15,00" fabricado por nós na tela.
    expect(hospedeiro.textContent ?? "").not.toContain("Fallback");
    expect(hospedeiro.textContent ?? "").not.toContain("R$ 15,00");
  });
});
