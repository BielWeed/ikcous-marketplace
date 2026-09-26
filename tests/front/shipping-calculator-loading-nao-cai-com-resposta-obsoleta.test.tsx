// @vitest-environment jsdom
//
// Quando duas cotações estão em voo ao mesmo tempo e a mais VELHA (obsoleta)
// responde primeiro, ela não pode apagar o `loading` — senão o botão volta a
// "Calcular" e fica clicável enquanto a cotação que importa (a mais nova)
// ainda está esperando a transportadora. O dinheiro não fica errado (o lacre
// de sequência protege isso), mas a tela mente sobre o que está acontecendo.
//
// A armadilha desta suíte: essa asserção só discrimina NO INSTANTE em que a
// resposta obsoleta chega com a mais nova ainda em voo. Se o teste avançasse
// os timers até as duas responderem antes de checar, `loading` já seria
// `false` nos dois lados (com ou sem a guarda) e o teste passaria por acaso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

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

const carrinho: CartItem[] = [{ product: produto(), quantity: 1 }];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — resposta obsoleta não derruba o loading de uma cotação em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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

  it("o 'Calculando frete' (e o status 'cotando' que trava o checkout) continua quando a resposta VELHA chega e a NOVA ainda não", async () => {
    // 1ª chamada (a cotação inicial, ao montar): resolve na hora.
    invoke.mockResolvedValueOnce({
      data: {
        options: [
          { id: "melhorenvio-pac", name: "PAC", price: 10, deliveryDays: 7 },
        ],
      },
      error: null,
    });

    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    // Frete automático (22/09/2026): sem campo de CEP nem botão
    // "Calcular", a cotação imediata sai da TROCA do endereço de entrega
    // (`cepDestino`); o estado de espera é o aviso "Calculando frete e
    // prazo..." e o status reportado ao checkout.
    const status: string[] = [];
    async function entregarEm(cep: string) {
      await act(async () => {
        raiz.render(
          <ShippingCalculator
            cart={carrinho}
            selectedOption={null}
            onSelectOption={() => {}}
            cepDestino={cep}
            onStatusChange={(s) => status.push(s)}
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    const calculando = () =>
      hospedeiro.querySelector('[role="status"]')?.textContent ?? null;

    await entregarEm("69000000");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(status.at(-1)).toBe("pronto");

    // A partir daqui, a 1ª chamada (obsoleta, "A") demora 500ms; a 2ª
    // chamada (a mais nova, "B") demora 3000ms — A responde bem antes de B.
    let chamada = 0;
    invoke.mockImplementation(() => {
      chamada += 1;
      const atraso = chamada === 1 ? 500 : 3000;
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              data: {
                options: [
                  {
                    id: "melhorenvio-pac",
                    name: "PAC",
                    price: 10,
                    deliveryDays: 7,
                  },
                ],
              },
              error: null,
            }),
          atraso,
        ),
      );
    });

    // Duas cotações disparadas em sequência, sem esperar a primeira acabar —
    // o mesmo tipo de sobreposição que o debounce e um envio manual podem
    // produzir juntos.
    await entregarEm("70000000"); // A: meuId=2, responde em +500ms.
    await entregarEm("71000000"); // B: meuId=3, responde em +3000ms — é a MAIS NOVA.
    expect(invoke).toHaveBeenCalledTimes(3);

    // t=500: A (obsoleta) responde. B ainda está em voo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calculando()).toContain("Calculando frete");
    expect(status.at(-1)).toBe("cotando");

    // t=3000: B (a mais nova) responde — só agora o loading pode cair.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(calculando()).toBeNull();
    expect(status.at(-1)).toBe("pronto");
  });
});
