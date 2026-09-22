// @vitest-environment jsdom
//
// RETIRADA NA LOJA (release 1.5.3, 22/09/2026) na calculadora de frete.
//
// O que a cliente vê e o que o app NÃO faz por ela:
//   1. A opção aparece como "Retirar na loja", "Grátis", com o endereço REAL
//      da loja ("Retire em: …") e o aviso neutro "Aguarde a confirmação da
//      loja para retirar" — nunca "Entrega em até 0 dia útil" (prazo
//      inventado).
//   2. A retirada custa R$ 0 e NUNCA é auto-selecionada (a local é); só a
//      cliente a escolhe. Escolhida, ela SOBREVIVE à recotação do mesmo
//      destino (mudou a quantidade no carrinho).
//   3. Trocar para endereço FORA da área derruba a retirada e recota (a
//      transportadora mais barata do destino novo entra).
//   4. Sobrou só a retirada na resposta: nada fica escolhido (null) — nunca
//      a escolha antiga com preço de outra cotação.
//
// Mesmo padrão de shipping-calculator-selecao-fresca-mesmo-id.test.tsx:
// createRoot + act, pai com useState de verdade, localStorage num Map.
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 50,
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

function carrinho(quantity = 1): CartItem[] {
  return [{ product: produto(), quantity }];
}

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: ENDERECO_FICTICIO,
};
const SEDEX: ShippingOption = {
  id: "melhor-envio-2",
  name: "Entrega expressa",
  price: 54.88,
  deliveryDays: 4,
  provider: "melhor_envio",
};
const PAC: ShippingOption = {
  id: "melhor-envio-1",
  name: "Entrega econômica",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — retirada na loja é escolha EXPLÍCITA da cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  const pai = {
    selecionada: null as ShippingOption | null,
    alterarCarrinho: (_itens: CartItem[]) => {},
    alterarDestino: (_cep: string | null) => {},
  };

  beforeEach(() => {
    vi.useFakeTimers();
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
    invoke.mockResolvedValue({
      data: { options: [LOCAL, RETIRADA], cotacaoIncompleta: false },
      error: null,
    });
    pai.selecionada = null;
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

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function PaiDeEstadoReal() {
      const [itens, setItens] = useState<CartItem[]>(carrinho());
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      const [destino, setDestino] = useState<string | null>(null);
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      useEffect(() => {
        pai.selecionada = selecionada;
        pai.alterarCarrinho = setItens;
        pai.alterarDestino = setDestino;
      }, [selecionada]);
      return (
        <ShippingCalculator
          cart={itens}
          selectedOption={selecionada}
          onSelectOption={setSelecionada}
          cepDestino={destino}
          cepDaSelecao={cepDaSelecao}
          onCepValidated={setCepDaSelecao}
        />
      );
    }
    await act(async () => {
      raiz.render(<PaiDeEstadoReal />);
    });
  }

  async function irPara(cep: string) {
    await act(async () => {
      pai.alterarDestino(cep);
    });
    await drenar();
  }

  function botaoDe(nome: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
  }

  it("mostra 'Retirar na loja', Grátis, o endereço REAL e o aviso neutro — sem prazo inventado", async () => {
    await montar();
    await irPara("38500000");
    const botao = botaoDe("Retirar na loja");
    expect(botao).toBeDefined();
    const texto = botao?.textContent ?? "";
    expect(texto).toContain("Grátis");
    expect(texto).toContain(`Retire em: ${ENDERECO_FICTICIO}`);
    expect(texto).toContain("Aguarde a confirmação da loja para retirar");
    expect(texto).not.toMatch(/Entrega em até/);
    expect(texto).not.toMatch(/dia útil|dias úteis/);
    // A entrega local continua com o prazo e o preço de sempre.
    const local = botaoDe("Entrega Local")?.textContent ?? "";
    expect(local).toContain("Entrega em até 1 dia útil");
    expect(local).toContain("10,00");
  });

  it("R$ 0 NÃO é auto-selecionada: a local é; a retirada só com o clique", async () => {
    await montar();
    await irPara("38500000");
    expect(pai.selecionada?.id).toBe("local-delivery");
    expect(botaoDe("Retirar na loja")?.getAttribute("aria-pressed")).toBe(
      "false",
    );

    await act(async () => {
      botaoDe("Retirar na loja")?.click();
    });
    expect(pai.selecionada?.id).toBe("store-pickup");
    expect(pai.selecionada?.price).toBe(0);
    expect(pai.selecionada?.pickupAddress).toBe(ENDERECO_FICTICIO);
  });

  it("escolhida pela cliente, a retirada SOBREVIVE à recotação do mesmo destino (quantidade mudou)", async () => {
    await montar();
    await irPara("38500000");
    await act(async () => {
      botaoDe("Retirar na loja")?.click();
    });
    expect(pai.selecionada?.id).toBe("store-pickup");

    const fresca = { ...RETIRADA };
    invoke.mockResolvedValue({
      data: { options: [LOCAL, fresca], cotacaoIncompleta: false },
      error: null,
    });
    await act(async () => {
      pai.alterarCarrinho(carrinho(2));
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await drenar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(pai.selecionada).toBe(fresca);
  });

  it("trocar para endereço FORA da área derruba a retirada e recota (a transportadora mais barata entra)", async () => {
    await montar();
    await irPara("38500000");
    await act(async () => {
      botaoDe("Retirar na loja")?.click();
    });
    expect(pai.selecionada?.id).toBe("store-pickup");

    invoke.mockResolvedValue({
      data: { options: [SEDEX, PAC], cotacaoIncompleta: false },
      error: null,
    });
    await irPara("01001000");

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(pai.selecionada?.id).toBe("melhor-envio-1");
    expect(botaoDe("Retirar na loja")).toBeUndefined();
  });

  it("resposta com SÓ a retirada: nada fica escolhido — nem a escolha antiga com preço de outra cotação", async () => {
    await montar();
    await irPara("38500000");
    expect(pai.selecionada?.id).toBe("local-delivery");

    invoke.mockResolvedValue({
      data: { options: [RETIRADA], cotacaoIncompleta: false },
      error: null,
    });
    await act(async () => {
      pai.alterarCarrinho(carrinho(3));
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await drenar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(pai.selecionada).toBeNull();
    expect(botaoDe("Retirar na loja")).toBeDefined();
  });
});
