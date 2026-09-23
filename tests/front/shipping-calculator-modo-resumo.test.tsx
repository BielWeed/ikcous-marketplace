// @vitest-environment jsdom
//
// MODO RESUMO (checkout compacto, 23/09/2026): prop nova e opcional
// `modoResumo`, usada só pelo CHECKOUT — o carrinho (sem a prop) continua
// mostrando a lista inteira, como sempre. Com `modoResumo` e uma opção
// PRONTA e ESCOLHIDA, a calculadora esconde a lista atrás de um resumo
// (logo/nome + "via" + prazo + preço + botão "Trocar"); qualquer outro
// estado (carregando, erro, vazio, sem destino, sem seleção) mostra o
// corpo INTEIRO — nunca esconde erro nem "Tentar de novo".
//
// Mesmo harness de shipping-calculator-retirada-na-loja.test.tsx:
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

function carrinho(): CartItem[] {
  return [{ product: produto(), quantity: 1 }];
}

const PAC: ShippingOption = {
  id: "melhor-envio-1",
  name: "Entrega econômica",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "PAC",
  provedorRotulo: "Melhor Envio",
};
const SEDEX: ShippingOption = {
  id: "melhor-envio-2",
  name: "Entrega expressa",
  price: 54.88,
  deliveryDays: 4,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "SEDEX",
  provedorRotulo: "Melhor Envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — modoResumo (checkout compacto)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  const pai = {
    selecionada: null as ShippingOption | null,
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
      data: { options: [PAC, SEDEX], cotacaoIncompleta: false },
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

  async function montar(modoResumo?: boolean) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function PaiDeEstadoReal() {
      const [itens] = useState<CartItem[]>(carrinho());
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      const destino: string | null = "38500000";
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      useEffect(() => {
        pai.selecionada = selecionada;
      }, [selecionada]);
      return (
        <ShippingCalculator
          cart={itens}
          selectedOption={selecionada}
          onSelectOption={setSelecionada}
          cepDestino={destino}
          cepDaSelecao={cepDaSelecao}
          onCepValidated={setCepDaSelecao}
          modoResumo={modoResumo}
        />
      );
    }
    await act(async () => {
      raiz.render(<PaiDeEstadoReal />);
    });
    await drenar();
  }

  function botaoDe(nome: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
  }

  it("SEM modoResumo (padrão do carrinho): a lista inteira aparece, mesmo com opção pronta e escolhida", async () => {
    await montar(undefined);
    expect(pai.selecionada?.id).toBe("melhor-envio-1");
    // As DUAS opções estão visíveis — nunca escondidas atrás de "Trocar".
    expect(botaoDe("Entrega econômica")).toBeDefined();
    expect(botaoDe("Trocar")).toBeUndefined();
  });

  it("COM modoResumo e opção pronta/escolhida: mostra resumo (nome+prazo+preço+Trocar), esconde a lista", async () => {
    await montar(true);
    expect(pai.selecionada?.id).toBe("melhor-envio-1");

    // A lista de opções não está mais visível como botões de escolha —
    // só o resumo, com o botão "Trocar".
    const trocar = botaoDe("Trocar");
    expect(trocar).toBeDefined();
    const resumo = hospedeiro.textContent ?? "";
    expect(resumo).toContain("Entrega econômica");
    expect(resumo).toContain("26,41");
    expect(resumo).toContain("Entrega em até 8 dias úteis");
  });

  it("clicar Trocar expande a lista completa de opções", async () => {
    await montar(true);
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    expect(botaoDe("Entrega econômica")).toBeDefined();
    expect(botaoDe("Entrega expressa")).toBeDefined();
  });

  it("escolher outra opção na lista expandida recolhe de volta ao resumo, já com a nova opção", async () => {
    await montar(true);
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    await act(async () => {
      botaoDe("Entrega expressa")?.click();
    });
    expect(pai.selecionada?.id).toBe("melhor-envio-2");
    // Recolheu: a lista não está mais visível, o resumo mostra a NOVA opção.
    expect(botaoDe("Entrega econômica")).toBeUndefined();
    const resumo = hospedeiro.textContent ?? "";
    expect(resumo).toContain("Entrega expressa");
    expect(resumo).toContain("54,88");
  });

  it("modoResumo com cotação em erro: mostra o estado completo (erro + Tentar de novo), nunca some", async () => {
    invoke.mockReset();
    invoke.mockRejectedValue(new Error("Falha ao cotar frete."));
    await montar(true);
    expect(hospedeiro.textContent).toContain("Falha ao cotar frete.");
    expect(botaoDe("Tentar de novo")).toBeDefined();
    expect(botaoDe("Trocar")).toBeUndefined();
  });

  it("modoResumo sem seleção nenhuma (lista vazia): mostra o estado 'A calcular' completo", async () => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [], cotacaoIncompleta: false },
      error: null,
    });
    await montar(true);
    expect(hospedeiro.textContent).toContain("A calcular");
    expect(botaoDe("Trocar")).toBeUndefined();
  });
});
