// @vitest-environment jsdom
//
// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026) × o cache de frete do
// navegador.
//
// A cotação fica no localStorage por até 2 h, carimbada com o contexto da
// loja. Se a lojista passa a "Só retiro" (ou muda o prazo) e o carimbo não
// mudasse, a cliente que já tinha cotado veria a "Entrega Local" que a loja
// desligou — e a auto-seleção escolheria a mais barata dela SEM chamar a
// edge. Aqui a calculadora real roda contra o mesmo andaime de
// shipping-calculator-cache-v2-contexto-da-loja.test.tsx, e o envelope é
// gravado pela própria calculadora (nada montado à mão): o que muda de um
// momento para o outro é só a config da loja.
import { type ReactElement, act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextoDoFreteDaLoja,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";

const { invoke, loja } = vi.hoisted(() => ({
  invoke: vi.fn(),
  loja: { config: {} as Partial<StoreConfig> },
}));

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

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";
const CEP = "38500000";
const REVISAO_FIXA_DO_TESTE = "rev-fixa-do-teste";

const ENTREGO_E_RETIRO: Partial<StoreConfig> = {
  shippingProvider: "melhor_envio",
  enabledShippingMethods: ["sedex", "pac", "store-pickup"],
  storeAddress: ENDERECO_FICTICIO,
};

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
const CARRINHO: CartItem[] = [{ product: produto(), quantity: 1 }];

function entregaLocal(dias: number): ShippingOption {
  return {
    id: "local-delivery",
    name: "Entrega Local",
    price: 10,
    deliveryDays: dias,
    provider: "local",
  };
}
const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: ENDERECO_FICTICIO,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — o cache v2 acompanha o modo e o prazo da entrega própria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const pai = { selecionada: null as ShippingOption | null };
  // O que a edge responde, por config: o dublê imita a regra de verdade
  // (entrega própria desligada = só a retirada; prazo vem da config).
  function responderComoAEdge() {
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: REVISAO_FIXA_DO_TESTE },
          error: null,
        });
      }
      const ligada = loja.config.localDeliveryEnabled !== false;
      const dias = loja.config.localDeliveryDays ?? 1;
      return Promise.resolve({
        data: {
          options: ligada ? [entregaLocal(dias), RETIRADA] : [RETIRADA],
          cotacaoIncompleta: false,
          revisaoConfig: REVISAO_FIXA_DO_TESTE,
        },
        error: null,
      });
    });
  }

  beforeEach(() => {
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
    loja.config = { ...ENTREGO_E_RETIRO };
    invoke.mockReset();
    responderComoAEdge();
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
  });

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  let Pai: ((props: { v: number }) => ReactElement) | null = null;
  async function pintar(versao = 0) {
    if (!Pai) {
      const { ShippingCalculator } = await import(
        "@/components/ui/custom/ShippingCalculator"
      );
      Pai = function PaiEstavel({ v }: { v: number }) {
        const [selecionada, setSelecionada] = useState<ShippingOption | null>(
          null,
        );
        const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
        useEffect(() => {
          pai.selecionada = selecionada;
        }, [selecionada]);
        return (
          <ContextoDoFreteDaLoja.Provider
            value={contextoDaLojaParaFrete(loja.config)}
          >
            <div data-v={v}>
              <ShippingCalculator
                cart={CARRINHO}
                selectedOption={selecionada}
                onSelectOption={setSelecionada}
                cepDestino={CEP}
                cepDaSelecao={cepDaSelecao}
                onCepValidated={setCepDaSelecao}
              />
            </div>
          </ContextoDoFreteDaLoja.Provider>
        );
      };
    }
    const Componente = Pai;
    await act(async () => {
      raiz.render(<Componente v={versao} />);
    });
    await drenar();
  }

  async function remontar() {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await pintar();
  }

  const cotacoes = () =>
    invoke.mock.calls.filter(
      ([, opts]) => opts?.body?.action !== "revisao_config_frete",
    ).length;
  const textoDaTela = () => hospedeiro.textContent ?? "";

  it("CONTROLE: mesma config, remontar serve do cache (sem uma 2ª cotação) — sem isto os de baixo não provam nada", async () => {
    await pintar();
    expect(cotacoes()).toBe(1);
    expect(pai.selecionada?.id).toBe("local-delivery");
    await remontar();
    expect(cotacoes()).toBe(1);
    expect(pai.selecionada?.id).toBe("local-delivery");
  });

  it("CONTROLE: os padrões ditos explicitamente (entrega ligada, 1 dia) NÃO recotam — o deploy não invalida o cache de ninguém", async () => {
    await pintar(0);
    expect(cotacoes()).toBe(1);
    loja.config = {
      ...ENTREGO_E_RETIRO,
      localDeliveryEnabled: true,
      localDeliveryDays: 1,
    };
    await pintar(1);
    expect(cotacoes()).toBe(1);
    await remontar();
    expect(cotacoes()).toBe(1);
  });

  it("a cliente já tinha cotado COM entrega própria; a loja passou a SÓ RETIRO: a 'Entrega Local' do cache não volta e não é escolhida sozinha", async () => {
    await pintar();
    expect(pai.selecionada?.id).toBe("local-delivery");
    expect(textoDaTela()).toContain("Entrega Local");

    loja.config = { ...ENTREGO_E_RETIRO, localDeliveryEnabled: false };
    await remontar();

    // Recotou (a edge disse: só a retirada)...
    expect(cotacoes()).toBe(2);
    // ...a "Entrega Local" velha não está na tela...
    expect(textoDaTela()).not.toContain("Entrega Local");
    expect(textoDaTela()).toContain("Retirar na loja");
    // ...e NADA foi escolhido sozinho: a retirada é sempre escolha da cliente.
    expect(pai.selecionada).toBeNull();
  });

  it.each<[string, Partial<StoreConfig>]>([
    ["só retiro (entrega própria desligada)", { localDeliveryEnabled: false }],
    ["prazo de 3 dias", { localDeliveryDays: 3 }],
    ["prazo de 0 dia (mesmo dia)", { localDeliveryDays: 0 }],
  ])(
    "a lojista mudou para %s com a tela aberta: o cache não serve mais e a tela recota sozinha",
    async (_nome, mudanca) => {
      await pintar(0);
      expect(cotacoes()).toBe(1);

      loja.config = { ...ENTREGO_E_RETIRO, ...mudanca };
      await pintar(1);
      expect(cotacoes()).toBe(2);

      // E a remontagem com a config nova acha o cache NOVO, sem 3ª cotação.
      await remontar();
      expect(cotacoes()).toBe(2);
    },
  );

  it("o prazo novo chega à tela: depois de mudar de 1 para 3 dias, o que está na lista é o que a edge cotou com 3 (não o 1 do cache)", async () => {
    await pintar();
    expect(pai.selecionada?.deliveryDays).toBe(1);

    loja.config = { ...ENTREGO_E_RETIRO, localDeliveryDays: 3 };
    await remontar();

    expect(cotacoes()).toBe(2);
    expect(pai.selecionada?.deliveryDays).toBe(3);
  });
});
