// @vitest-environment jsdom
//
// RETIRADA NA LOJA × APP ANTIGO NO AR (bloqueio da revisão, 22/09/2026).
//
// O PWA atualiza por "prompt": a 1.5.2 continua aberta ao lado da 1.5.3, e
// as duas dividem o MESMO localStorage (mesma origem). Dois caminhos levavam
// a retirada até a auto-seleção da 1.5.2 (que escolhe a mais barata — a
// retirada custa R$ 0):
//   1. a REDE: a edge só oferece a retirada a quem manda
//      `aceitaRetirada: true` — a 1.5.3 manda; a 1.5.2 não;
//   2. o CACHE DO NAVEGADOR: se a 1.5.3 gravasse store-pickup em
//      `ikcous_shipping_cache_<CEP>`, a 1.5.2 leria o envelope e escolheria
//      a retirada SEM chamar a edge. A 1.5.3 passa a usar SÓ a chave
//      `ikcous_shipping_cache_v2_<CEP>` (a 1.5.2 nunca a lê; o logout limpa
//      pelo prefixo), com o CONTEXTO da loja no envelope: provedor,
//      transportadoras, retirada ligada e endereço. Contexto diferente,
//      ausente ou envelope legado = recotar. Resposta em voo de contexto
//      antigo morre no lacre.
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";
const OUTRO_ENDERECO_FICTICIO = "Avenida Inventada, 200 — Bairro Teste";
const CEP = "38500000";
const CHAVE_ANTIGA = `ikcous_shipping_cache_${CEP}`;
const CHAVE_V2 = `ikcous_shipping_cache_v2_${CEP}`;

const LOJA_COM_RETIRADA: Partial<StoreConfig> = {
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
// Mesma forma de `cartSignature` do componente.
const ASSINATURA = "prod-1::1";

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};
function retirada(endereco = ENDERECO_FICTICIO): ShippingOption {
  return {
    id: "store-pickup",
    name: "Retirar na loja",
    price: 0,
    deliveryDays: 0,
    provider: "pickup",
    pickupAddress: endereco,
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — sinal aceitaRetirada e cache v2 com o contexto da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const pai = { selecionada: null as ShippingOption | null };

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
    loja.config = { ...LOJA_COM_RETIRADA };
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [LOCAL, retirada()], cotacaoIncompleta: false },
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
  });

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  // O contexto do frete chega pelo MESMO Provider que o StoreProvider usa
  // (o fio StoreProvider → contexto está provado em
  // contexto-do-frete-vem-do-store-provider.test.tsx). `versao` só força a
  // repintura depois de o teste trocar `loja.config`.
  // Componente ESTÁVEL entre pinturas (definido uma vez): repintar com `v`
  // novo re-renderiza o MESMO componente — o estado (a escolha da cliente)
  // sobrevive e é o efeito de contexto que tem de recotar, não um remonte.
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

  function envelopeLegado(opcoes: ShippingOption[]) {
    return JSON.stringify({
      assinatura: ASSINATURA,
      gravadoEm: Date.now(),
      opcoes,
    });
  }

  it("a cotação manda aceitaRetirada: true (o sinal do app que entende a retirada)", async () => {
    await pintar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toMatchObject({
      cep: CEP,
      aceitaRetirada: true,
    });
  });

  it("grava SÓ na chave v2, com o contexto; a chave antiga (lida pela 1.5.2) nunca recebe store-pickup", async () => {
    await pintar();
    expect(armazem.has(CHAVE_ANTIGA)).toBe(false);
    const v2 = JSON.parse(armazem.get(CHAVE_V2) ?? "null");
    expect(typeof v2?.contexto).toBe("string");
    expect(v2.opcoes.map((o: ShippingOption) => o.id)).toEqual([
      "local-delivery",
      "store-pickup",
    ]);
    // Nenhuma chave que não seja v2 carrega a retirada.
    for (const [chave, valor] of armazem) {
      if (chave.startsWith("ikcous_shipping_cache_")) {
        expect(chave.startsWith("ikcous_shipping_cache_v2_")).toBe(true);
      } else {
        expect(valor.includes("store-pickup")).toBe(false);
      }
    }
  });

  it("duas versões no mesmo storage: o envelope da 1.5.2 (chave antiga) é IGNORADO pela 1.5.3", async () => {
    // A 1.5.2, aberta em outra aba, gravou a cotação dela (sem retirada).
    armazem.set(CHAVE_ANTIGA, envelopeLegado([{ ...LOCAL, price: 999 }]));
    await pintar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(pai.selecionada?.price).toBe(10);
    // E a 1.5.3 não tocou no que é da 1.5.2.
    expect(JSON.parse(armazem.get(CHAVE_ANTIGA) ?? "{}").opcoes[0].price).toBe(
      999,
    );
  });

  it("envelope na chave v2 SEM contexto (ou de contexto diferente) é recusado e recota", async () => {
    armazem.set(CHAVE_V2, envelopeLegado([{ ...LOCAL, price: 999 }]));
    await pintar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(pai.selecionada?.price).toBe(10);
  });

  it("mesmo contexto: a remontagem serve do cache v2 (controle — sem ele os de baixo não provam nada)", async () => {
    await pintar();
    expect(invoke).toHaveBeenCalledTimes(1);
    await remontar();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<StoreConfig>]>([
    ["provedor", { shippingProvider: "frenet" }],
    // Release 1.5.4: loja que troca Melhor Envio -> SuperFrete não pode
    // servir a cotação velha do navegador (os ids nem existem no novo).
    ["provedor ME -> SuperFrete", { shippingProvider: "superfrete" }],
    ["retirada desligada", { enabledShippingMethods: ["sedex", "pac"] }],
    ["endereço da loja", { storeAddress: OUTRO_ENDERECO_FICTICIO }],
  ])(
    "contexto mudou (%s): o cache v2 não serve mais e a tela recota sozinha",
    async (_nome, mudanca) => {
      await pintar(0);
      expect(invoke).toHaveBeenCalledTimes(1);

      loja.config = { ...LOJA_COM_RETIRADA, ...mudanca };
      await pintar(1);
      expect(invoke).toHaveBeenCalledTimes(2);

      // E a remontagem com o contexto novo acha o cache NOVO.
      await remontar();
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it("endereço trocou: a retirada escolhida volta com o endereço NOVO (a nota do pedido não leva o velho)", async () => {
    await pintar(0);
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Retirar na loja"),
    );
    await act(async () => {
      botao?.click();
    });
    expect(pai.selecionada?.pickupAddress).toBe(ENDERECO_FICTICIO);

    invoke.mockResolvedValue({
      data: {
        options: [LOCAL, retirada(OUTRO_ENDERECO_FICTICIO)],
        cotacaoIncompleta: false,
      },
      error: null,
    });
    loja.config = {
      ...LOJA_COM_RETIRADA,
      storeAddress: OUTRO_ENDERECO_FICTICIO,
    };
    await pintar(1);

    expect(pai.selecionada?.id).toBe("store-pickup");
    expect(pai.selecionada?.pickupAddress).toBe(OUTRO_ENDERECO_FICTICIO);
  });

  it("resposta EM VOO do contexto antigo é descartada (nem tela, nem cache)", async () => {
    let resolverAntiga: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolverAntiga = r;
        }),
    );
    await pintar(0);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Contexto muda com a cotação antiga ainda em voo.
    invoke.mockResolvedValue({
      data: { options: [LOCAL], cotacaoIncompleta: false },
      error: null,
    });
    loja.config = { ...LOJA_COM_RETIRADA, enabledShippingMethods: ["sedex"] };
    await pintar(1);
    expect(invoke).toHaveBeenCalledTimes(2);

    // A antiga responde por último, com a retirada.
    await act(async () => {
      resolverAntiga({
        data: { options: [LOCAL, retirada()], cotacaoIncompleta: false },
        error: null,
      });
    });
    await drenar();

    expect(
      [...hospedeiro.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Retirar na loja"),
      ),
    ).toBe(false);
    expect(armazem.get(CHAVE_V2)?.includes("store-pickup")).toBe(false);
  });
});
