// @vitest-environment jsdom
//
// CACHE DO NAVEGADOR × CONTRATO DA COTAÇÃO (release 1.5.6).
//
// A 1.5.6 mudou o que a cotação da SuperFrete significa: sem seguro no
// preço e com o Mini Envios disputando a "Entrega econômica". O navegador
// guarda a cotação por até 2 h em `ikcous_shipping_cache_v2_<CEP>`, carimbada
// com o CONTEXTO da loja — e o contexto da 1.5.5 era igual ao da 1.5.6 (mesmo
// provedor, mesmas chaves, mesmo endereço). Sem mudar nada, a tela 1.5.6
// serviria o preço antigo (R$ 25,70 com seguro, sem o Mini) guardado pela
// 1.5.5. O que se prova: o contexto carrega a versão do contrato de cotação,
// o envelope antigo (contexto sem a versão) NÃO é servido e a tela recota;
// o envelope novo é servido (controle); a chave e o prefixo que o logout
// varre não mudam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoCacheDeFrete,
  cotacaoCacheadaQueAindaServe,
} from "@/components/ui/custom/ShippingCalculator";
import {
  ContextoDoFreteDaLoja,
  VERSAO_DO_CONTRATO_DE_COTACAO,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import type { CartItem, Product, ShippingOption, StoreConfig } from "@/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CEP = "01001000";
const LOJA_SF: Partial<StoreConfig> = {
  shippingProvider: "superfrete",
  enabledShippingMethods: ["sedex", "pac"],
  storeAddress: "",
};
/** O contexto EXATO que a 1.5.5 gravava para esta loja (sem versão). */
const CONTEXTO_DA_1_5_5 = '["superfrete",["pac","sedex"],false,""]';

function produto(): Product {
  return {
    id: "prod-tenis-teste",
    name: "Tênis de Teste",
    description: "",
    price: 59.9,
    images: [],
    category: "Calçados",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}
const CARRINHO: CartItem[] = [{ product: produto(), quantity: 1 }];
const ASSINATURA = "prod-tenis-teste::1";

const PAC_ANTIGO_COM_SEGURO: ShippingOption = {
  id: "superfrete-1",
  name: "Entrega econômica",
  price: 25.7,
  deliveryDays: 8,
  provider: "superfrete",
};
const MINI_NOVO: ShippingOption = {
  id: "superfrete-17",
  name: "Entrega econômica",
  price: 19.01,
  deliveryDays: 11,
  provider: "superfrete",
};

describe("cache do navegador carimbado com a versão do contrato de cotação (1.5.6)", () => {
  it("o contexto da loja carrega a versão e deixa de ser o texto da 1.5.5", () => {
    const atual = contextoDaLojaParaFrete(LOJA_SF);
    expect(atual).not.toBe(CONTEXTO_DA_1_5_5);
    expect(atual).toContain(String(VERSAO_DO_CONTRATO_DE_COTACAO));
    // Sem config (calculadora fora do StoreProvider) também leva a versão.
    expect(contextoDaLojaParaFrete(undefined)).toContain(
      String(VERSAO_DO_CONTRATO_DE_COTACAO),
    );
  });

  it("envelope da 1.5.5 (contexto sem a versão) não é servido; o de agora é (controle)", () => {
    const agora = Date.now();
    const envelope = (contexto: string) => ({
      contexto,
      assinatura: ASSINATURA,
      gravadoEm: agora - 60_000,
      opcoes: [PAC_ANTIGO_COM_SEGURO],
    });
    const atual = contextoDaLojaParaFrete(LOJA_SF);
    expect(
      cotacaoCacheadaQueAindaServe(
        envelope(CONTEXTO_DA_1_5_5),
        ASSINATURA,
        agora,
        atual,
      ),
    ).toBeNull();
    expect(
      cotacaoCacheadaQueAindaServe(envelope(atual), ASSINATURA, agora, atual),
    ).toEqual([PAC_ANTIGO_COM_SEGURO]);
  });

  it("a chave e o prefixo que o logout varre NÃO mudam", () => {
    expect(chaveDoCacheDeFrete(CEP)).toBe(`ikcous_shipping_cache_v2_${CEP}`);
    expect(chaveDoCacheDeFrete(CEP).startsWith("ikcous_shipping_cache_")).toBe(
      true,
    );
  });
});

describe("ShippingCalculator com o envelope da 1.5.5 no localStorage", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let selecionada: ShippingOption | null;

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
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [MINI_NOVO], cotacaoIncompleta: false },
      error: null,
    });
    selecionada = null;
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

  async function pintar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ContextoDoFreteDaLoja.Provider
          value={contextoDaLojaParaFrete(LOJA_SF)}
        >
          <ShippingCalculator
            cart={CARRINHO}
            selectedOption={null}
            onSelectOption={(opcao) => {
              selecionada = opcao;
            }}
            cepDestino={CEP}
          />
        </ContextoDoFreteDaLoja.Provider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("o preço guardado pela 1.5.5 NÃO aparece: a tela recota e mostra a cotação nova", async () => {
    armazem.set(
      chaveDoCacheDeFrete(CEP),
      JSON.stringify({
        contexto: CONTEXTO_DA_1_5_5,
        assinatura: ASSINATURA,
        gravadoEm: Date.now() - 60_000,
        opcoes: [PAC_ANTIGO_COM_SEGURO],
      }),
    );
    await pintar();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionada?.id).toBe("superfrete-17");
    expect(selecionada?.price).toBe(19.01);
    expect(hospedeiro.textContent).not.toContain("25,70");
    // O envelope foi regravado com o contexto NOVO.
    const regravado = JSON.parse(armazem.get(chaveDoCacheDeFrete(CEP)) ?? "{}");
    expect(regravado.contexto).toBe(contextoDaLojaParaFrete(LOJA_SF));
  });

  it("controle: envelope gravado com o contexto de agora é servido sem chamar a edge", async () => {
    armazem.set(
      chaveDoCacheDeFrete(CEP),
      JSON.stringify({
        contexto: contextoDaLojaParaFrete(LOJA_SF),
        assinatura: ASSINATURA,
        gravadoEm: Date.now() - 60_000,
        opcoes: [MINI_NOVO],
      }),
    );
    await pintar();
    expect(invoke).not.toHaveBeenCalled();
    expect(selecionada?.id).toBe("superfrete-17");
  });
});
