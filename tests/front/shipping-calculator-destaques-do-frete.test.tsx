// @vitest-environment jsdom
//
// DESTAQUES NA TELA (release 1.5.7) — CONTRATO-1.5.7.md §6, R1-7, R2-4.
//
// Com vários provedores ligados a lista de frete cresce; o pedido do dono
// foi mostrar só DUAS opções em destaque (mais barata, mais rápida) e o
// resto atrás de "+ Ver outras opções", sem esconder a escolha da cliente
// quando a lista está recolhida. `destaquesDoFrete` (testado à parte em
// destaques-do-frete.test.ts) decide QUEM são os destaques; aqui se prova
// o que a TELA faz com o resultado dela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, ShippingOption } from "@/types";

const invoke = vi.fn();
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
const LOGGI: ShippingOption = {
  id: "frenet-LOGGI-EXP",
  name: "Loggi — Express",
  price: 15,
  deliveryDays: 1,
  provider: "frenet",
  transportadora: "Loggi",
  servico: "Express",
  provedorRotulo: "Frenet",
};
const NO_MESMO_DIA: ShippingOption = {
  id: "frenet-HOJE",
  name: "Loggi — Hoje",
  price: 30,
  deliveryDays: 0,
  provider: "frenet",
  transportadora: "Loggi",
  servico: "Hoje",
  provedorRotulo: "Frenet",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — destaques na tela (release 1.5.7)", () => {
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
    vi.unstubAllGlobals();
  });

  async function montar(options: ShippingOption[]) {
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({ data: { revisaoConfig: null }, error: null });
      }
      return Promise.resolve({ data: { options }, error: null });
    });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino="69000000"
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  function botaoDe(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
  }

  it("duas opções distintas: as DUAS aparecem, cada uma com o selo certo, sem '+ Ver outras'", async () => {
    await montar([PAC, SEDEX]);

    const cartaoPac = botaoDe("Entrega econômica");
    const cartaoSedex = botaoDe("Entrega expressa");
    expect(cartaoPac?.textContent).toContain("Mais barata");
    expect(cartaoPac?.textContent).not.toContain("Mais rápida");
    expect(cartaoSedex?.textContent).toContain("Mais rápida");
    expect(cartaoSedex?.textContent).not.toContain("Mais barata");
    // Só as duas: nada para expandir.
    expect(botaoDe("Ver outras opções")).toBeUndefined();
  });

  // Pedido do dono (23/09/2026): nada de repetir transportadora/serviço
  // entre título e subtítulo — o subtítulo só aparece quando acrescenta
  // (Correios · PAC atrás de "Entrega econômica") e o "via <Provedor>" é
  // selo à parte, com o logo do agregador.
  it("com transportadora: o 'via Provedor' aparece SEMPRE; o subtítulo só quando acrescenta", async () => {
    await montar([PAC, SEDEX, LOGGI]);
    // A Loggi vence os dois destaques; PAC e SEDEX ficam em "outras".
    await act(async () => {
      botaoDe("Ver outras opções")?.click();
    });
    const cartaoPac = botaoDe("Entrega econômica");
    expect(cartaoPac?.textContent).toContain("Correios · PAC");
    expect(cartaoPac?.textContent).toContain("via Melhor Envio");
    expect(cartaoPac?.textContent).not.toContain("Correios — PAC");
    const cartaoLoggi = botaoDe("Loggi Express");
    expect(cartaoLoggi?.textContent).toContain("via Frenet");
    // "Loggi" aparece UMA vez no texto do cartão (o logo tem alt, não texto).
    expect(cartaoLoggi?.textContent?.match(/Loggi/g)).toHaveLength(1);
    expect(
      cartaoLoggi?.querySelector('img[alt="Loggi"]'),
      "logo oficial da transportadora",
    ).not.toBeNull();
  });

  it("três opções: os dois destaques aparecem; a terceira fica atrás de '+ Ver outras opções'", async () => {
    const meioTermo: ShippingOption = {
      id: "melhor-envio-3",
      name: "Correios — Meio",
      price: 40,
      deliveryDays: 5,
      provider: "melhor_envio",
      transportadora: "Correios",
      servico: "Meio",
      provedorRotulo: "Melhor Envio",
    };
    await montar([PAC, SEDEX, meioTermo]);

    expect(botaoDe("Entrega econômica")).toBeDefined();
    expect(botaoDe("Entrega expressa")).toBeDefined();
    expect(botaoDe("Correios Meio")).toBeUndefined();
    const toggle = botaoDe("Ver outras opções");
    expect(toggle).toBeDefined();

    await act(async () => {
      toggle?.click();
    });
    expect(botaoDe("Correios Meio")).toBeDefined();
    expect(botaoDe("Ver menos opções")).toBeDefined();
  });

  it("Loggi mais barata E mais rápida: UM cartão com os dois selos; o SEDEX vai para 'outras'", async () => {
    await montar([LOGGI, SEDEX, PAC]);

    const cartaoLoggi = botaoDe("Loggi Express");
    expect(cartaoLoggi?.textContent).toContain("Mais barata");
    expect(cartaoLoggi?.textContent).toContain("Mais rápida");
    // Um cartão só para a Loggi — não dois.
    expect(
      [...hospedeiro.querySelectorAll("button")].filter((b) =>
        b.textContent?.includes("Loggi Express"),
      ),
    ).toHaveLength(1);
    // O SEDEX (não vencedor) foi para "outras": não aparece antes de expandir.
    expect(botaoDe("Entrega expressa")).toBeUndefined();
    await act(async () => {
      botaoDe("Ver outras opções")?.click();
    });
    expect(botaoDe("Entrega expressa")).toBeDefined();
  });

  it("prazo 0: 'Entrega no mesmo dia', nunca 'em até 0 dia útil'", async () => {
    await montar([NO_MESMO_DIA, SEDEX]);
    const cartao = botaoDe("Loggi Hoje");
    expect(cartao?.textContent).toContain("Entrega no mesmo dia");
    expect(cartao?.textContent).not.toMatch(/até 0 dia/);
  });

  it("recolher a lista não esconde a opção escolhida, mesmo estando em 'outras'", async () => {
    const meioTermo: ShippingOption = {
      id: "melhor-envio-3",
      name: "Correios — Meio",
      price: 40,
      deliveryDays: 5,
      provider: "melhor_envio",
      transportadora: "Correios",
      servico: "Meio",
      provedorRotulo: "Melhor Envio",
    };

    let selecionada: ShippingOption | null = null;
    invoke.mockImplementation((_nome: string, opts: any) => {
      if (opts?.body?.action === "revisao_config_frete") {
        return Promise.resolve({ data: { revisaoConfig: null }, error: null });
      }
      return Promise.resolve({
        data: { options: [PAC, SEDEX, meioTermo] },
        error: null,
      });
    });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    async function pintar() {
      await act(async () => {
        raiz.render(
          <ShippingCalculator
            cart={carrinho}
            selectedOption={selecionada}
            onSelectOption={(opt) => {
              selecionada = opt;
            }}
            cepDestino="69000000"
          />,
        );
      });
      await act(async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
    }
    await pintar();

    // Expande e escolhe a que estava escondida ("Correios Meio", em "outras").
    await act(async () => {
      botaoDe("Ver outras opções")?.click();
    });
    await act(async () => {
      botaoDe("Correios Meio")?.click();
    });
    await pintar();
    expect(selecionada as ShippingOption | null).toMatchObject({
      id: "melhor-envio-3",
    });

    // Recolhe de novo: a escolhida continua visível e marcada.
    await act(async () => {
      botaoDe("Ver menos opções")?.click();
    });
    const cartaoEscolhido = botaoDe("Correios Meio");
    expect(cartaoEscolhido).toBeDefined();
    expect(cartaoEscolhido?.getAttribute("aria-pressed")).toBe("true");
    // E o botão volta a oferecer "Ver outras opções" (ainda recolhido).
    expect(botaoDe("Ver outras opções")).toBeDefined();
  });
});
