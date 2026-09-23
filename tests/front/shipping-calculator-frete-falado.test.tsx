// @vitest-environment jsdom
//
// Laudo de acessibilidade 05/09 — onda 1, itens do FRETE (A1 ALTA, M1, M2),
// provados no DOM de verdade (o contrato de fonte vive em
// acess-onda1-0509-contrato.test.tsx; aqui o que se prova é o que o leitor
// de tela efetivamente recebe):
//
//   A1 — escolher PAC/SEDEX não era anunciado: o "selecionado" era só
//        borda/fundo colorido. Agora a opção carrega `aria-pressed` — quem
//        não vê SABE qual frete vai pagar antes de confirmar.
//   M1 — erro do frete aparecia em pixels, em silêncio. Agora `role="alert"`.
//   M2 — o campo de CEP se explicava só pelo placeholder. Frete automático
//        (22/09/2026): o campo saiu; a REGIÃO do frete tem nome próprio e o
//        destino (apelido + endereço) é texto lido.
//
// Mesmo molde de shipping-calculator-sem-preco-inventado.test.tsx (mocks
// secos; jsdom sem localStorage utilizável → dublê em Map).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// FRETE V2: a regra de grátis tem fonte única no CartContext — mock seco,
// nenhum cenário aqui é grátis.
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

describe("ShippingCalculator — frete falado (laudo 05/09: A1, M1, M2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
  });

  async function montar(selectedOption: ShippingOption | null = null) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={selectedOption}
          onSelectOption={() => {}}
          cepDestino={cepDestinoAtual}
          destino={{
            apelido: "Casa",
            resumo: "Rua das Flores, 10 — Centro, Manaus/AM · CEP 69000-000",
          }}
        />,
      );
    });
    return hospedeiro;
  }

  const cepDestinoAtual = "69000000";

  async function escoar() {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  it("M2 — a região do frete tem nome próprio e o destino é texto lido (apelido + endereço)", async () => {
    invoke.mockResolvedValue({ data: { options: [] }, error: null });
    await montar();
    await escoar();
    const regiao = hospedeiro.querySelector(
      'section[aria-label="Entrega e frete"]',
    );
    expect(regiao).not.toBeNull();
    expect(regiao?.textContent ?? "").toContain("Entrega para Casa");
    expect(regiao?.textContent ?? "").toContain("CEP 69000-000");
    // Não sobrou campo de CEP para digitar.
    expect(hospedeiro.querySelector("input")).toBeNull();
  });

  it("M1 — cotação que falha: erro com role=alert (falado na hora) e 'Tentar de novo' fora do alerta, que recota", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "Edge Function retornou 500" },
    });
    await montar();
    await escoar();

    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.textContent ?? "").toContain("Não foi possível calcular");
    // O botão não entra no que é anunciado como alerta.
    expect(alerta?.textContent ?? "").not.toContain("Tentar de novo");
    const tentar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    expect(tentar).toBeDefined();

    invoke.mockResolvedValueOnce({
      data: {
        options: [
          { id: "melhorenvio-pac", name: "PAC", price: 41.9, deliveryDays: 7 },
        ],
      },
      error: null,
    });
    await act(async () => {
      tentar?.click();
    });
    await escoar();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("41,90");
  });

  it("A1 — opção selecionada carrega aria-pressed=true; a outra, false", async () => {
    // O componente é CONTROLADO: quem guarda a seleção é o pai (CartView).
    // Captura-se a auto-seleção e re-renderiza com ela — o mesmo ciclo que
    // acontece na loja de verdade. (Holder de objeto: o estreitamento de
    // fluxo do TS não atravessa closures de `let`.)
    const selecao: { atual: ShippingOption | null } = { atual: null };
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    const montarCom = (sel: ShippingOption | null) => {
      act(() => {
        raiz.render(
          <ShippingCalculator
            cart={carrinho}
            selectedOption={sel}
            onSelectOption={(opt) => {
              selecao.atual = opt;
            }}
            cepDestino="69000000"
          />,
        );
      });
    };

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
          {
            id: "melhorenvio-sedex",
            name: "SEDEX",
            price: 62.0,
            deliveryDays: 2,
            provider: "melhor_envio",
          },
        ],
      },
      error: null,
    });

    // Frete automático (22/09/2026): o endereço já é o destino — montar cota.
    montarCom(null);
    await escoar();

    // A auto-seleção pega a mais BARATA (PAC); o pai a guarda e devolve
    // como prop — é esse ciclo que faz o botão anunciar o estado.
    expect(selecao.atual?.id).toBe("melhorenvio-pac");
    montarCom(selecao.atual);

    const botoesOpcao = Array.from(
      hospedeiro.querySelectorAll("button[type='button']"),
    );
    expect(
      botoesOpcao.length,
      "as duas opções de frete deveriam estar no DOM",
    ).toBeGreaterThanOrEqual(2);

    const pac = botoesOpcao.find((b) => b.textContent?.includes("PAC"));
    const sedex = botoesOpcao.find((b) => b.textContent?.includes("SEDEX"));
    expect(pac?.getAttribute("aria-pressed")).toBe("true");
    expect(sedex?.getAttribute("aria-pressed")).toBe("false");
  });
});
