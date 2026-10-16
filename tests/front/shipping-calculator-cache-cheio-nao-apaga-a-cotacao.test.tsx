// @vitest-environment jsdom
//
// DISCO CHEIO NÃO APAGA A COTAÇÃO (revisão da 1.5.33, 16/10/2026).
//
// A gravação do cache de frete (`localStorage.setItem`) ficava DENTRO do `try`
// da cotação: com o armazenamento cheio (QuotaExceededError) ou bloqueado, o
// `catch` apagava as opções recém-calculadas e mostrava erro — o cliente não
// conseguia escolher o frete e o Finalizar travava, embora a edge tivesse
// respondido certo. O cache é só um atalho: não gravar não pode custar a
// cotação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextoDoFreteDaLoja,
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
// FRETE V3 (T3, 23/09/2026): ShippingCalculator deixou de ler `freteGratis`
// do CartContext (a cópia global morreu — cada cartão calcula o preço
// FINAL da própria modalidade) e passou a ler `config` de `useStore()`
// diretamente, mesmo padrão de CartReminder/FreeShippingBlock.
// `freeShippingMin: 0` = preset "desligado" -- os ids destes cenários não
// dependem da regra local (nacional nunca a usa; local, quando aparece,
// não é o alvo do teste).
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
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
/** R1-2: revisão fixa usada nos dois lados (ação e envelope) nos testes
 * abaixo que dependem do cache ainda servir. */
const REVISAO_FIXA_DO_TESTE = "rev-fixa-do-teste";

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

const MINI_NOVO: ShippingOption = {
  id: "superfrete-17",
  name: "Entrega econômica",
  price: 19.01,
  deliveryDays: 11,
  provider: "superfrete",
};

describe("ShippingCalculator com o armazenamento do navegador cheio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionada: ShippingOption | null;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError",
        );
      },
      removeItem: () => {},
    });
    invoke.mockReset();
    invoke.mockImplementation(() =>
      Promise.resolve({
        data: {
          options: [MINI_NOVO],
          cotacaoIncompleta: false,
          revisaoConfig: REVISAO_FIXA_DO_TESTE,
        },
        error: null,
      }),
    );
    selecionada = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  it("a cotação segue valendo: opção escolhida, sem erro na tela", async () => {
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

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(selecionada?.id).toBe("superfrete-17");
    expect(selecionada?.price).toBe(19.01);
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(hospedeiro.textContent).toContain("19,01");
  });
});
