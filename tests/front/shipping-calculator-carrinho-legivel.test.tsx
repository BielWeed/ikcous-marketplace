// @vitest-environment jsdom
//
// O frete do CARRINHO (sem `modoResumo`) ainda tinha o desenho velho: "GRÁTIS"
// em verde-500 sobre branco (~2,5:1), textos de apoio de 9–10 px em cinza-400 e
// o "Tentar de novo" com 40 px de altura. O checkout (`modoResumo`) já tinha sido
// corrigido (verde-700, 11 px, zinc-600); aqui o carrinho passa a ler igual.
// O cálculo do frete não muda — só classes. O checkout continua com o dele
// (`shipping-calculator-checkout-limpo` e `-modo-resumo` seguem de guarda).
//
// Mesmo harness de shipping-calculator-checkout-limpo.test.tsx.
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
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const PRODUTO: Product = {
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
const CARRINHO: CartItem[] = [{ product: PRODUTO, quantity: 1 }];

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
const LOCAL_GRATIS: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: "Rua Exemplo, 100 — Centro",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — carrinho legível (baixa visão e dedo grosso)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

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

  async function montar(modoResumo: boolean | undefined) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function Pai() {
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      useEffect(() => {}, [selecionada]);
      return (
        <ShippingCalculator
          cart={CARRINHO}
          selectedOption={selecionada}
          onSelectOption={setSelecionada}
          cepDestino="38500000"
          cepDaSelecao={cepDaSelecao}
          onCepValidated={setCepDaSelecao}
          destino={{ apelido: "Casa", resumo: "Rua A, 10 — Centro" }}
          modoResumo={modoResumo}
        />
      );
    }
    await act(async () => {
      raiz.render(<Pai />);
    });
    await drenar();
  }

  const cartoes = () =>
    [...hospedeiro.querySelectorAll("button[aria-pressed]")] as HTMLElement[];
  const botaoDe = (nome: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    ) as HTMLButtonElement | undefined;

  it("'Grátis' (retirada e entrega local) usa verde escuro AA, não o verde-500 de ~2,5:1", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [RETIRADA, LOCAL_GRATIS, PAC],
        cotacaoIncompleta: false,
      },
      error: null,
    });
    await montar(undefined);
    const gratis = [...hospedeiro.querySelectorAll("span")].filter(
      (s) => s.textContent?.trim().toLowerCase() === "grátis",
    );
    // Retirada ("Grátis") e entrega local ("GRÁTIS") aparecem as duas.
    expect(gratis.length).toBeGreaterThanOrEqual(2);
    for (const marca of gratis) {
      expect(marca.className).toContain("text-emerald-700");
      expect(marca.className).not.toContain("text-emerald-500");
    }
  });

  it("textos de apoio dos cartões têm 11 px e nenhum cinza-400 (nada de 9 ou 10 px)", async () => {
    invoke.mockResolvedValue({
      data: {
        options: [RETIRADA, LOCAL_GRATIS, PAC],
        cotacaoIncompleta: false,
      },
      error: null,
    });
    await montar(undefined);
    expect(cartoes().length).toBeGreaterThanOrEqual(2);
    for (const cartao of cartoes()) {
      expect(cartao.innerHTML).not.toContain("text-[9px]");
      expect(cartao.innerHTML).not.toContain("text-[10px]");
      expect(cartao.innerHTML).not.toContain("text-zinc-400");
    }
    // O endereço da retirada é o apoio de 10 px do desenho velho.
    const retire = [...hospedeiro.querySelectorAll("span")].find((s) =>
      s.textContent?.includes("Retire em:"),
    );
    expect(retire?.className).toContain("text-[11px]");
  });

  it("'Tentar de novo' no carrinho tem 44 px (min-h-11)", async () => {
    invoke.mockRejectedValue(new Error("Falha ao cotar frete."));
    await montar(undefined);
    expect(botaoDe("Tentar de novo")?.className).toContain("min-h-11");
    expect(botaoDe("Tentar de novo")?.className).not.toContain("min-h-10");
  });
});
