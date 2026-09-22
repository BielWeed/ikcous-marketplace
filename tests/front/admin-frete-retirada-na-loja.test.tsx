// @vitest-environment jsdom
//
// RETIRADA NA LOJA NO PAINEL (release 1.5.3, 22/09/2026).
//
// A chave `store-pickup` mora em `store_config.enabled_shipping_methods` —
// a MESMA lista em que Ajustes → Transportadoras grava os serviços
// (sedex/pac/jadlog). Duas telas escrevem na mesma coluna, então o risco é
// uma apagar a escolha da outra. O que se prova:
//   1. as funções puras preservam as chaves de transportadora (inclusive
//      com base [] e base ausente, que a edge lê como ["sedex","pac"]);
//   2. Frete → "Permitir retirada na loja": liga/desliga SÓ a chave da
//      retirada, calculada do config ATUAL; salvar outra regra não envia a
//      lista;
//   3. sem endereço da loja a chave NÃO liga e a tela manda cadastrar em
//      Admin → Sobre a Loja;
//   4. Ajustes → Transportadoras preserva `store-pickup` no save, mesmo
//      quando a retirada foi ligada DEPOIS que a seção sincronizou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chavesDeTransportadoraDaLista,
  listaComRetirada,
  retiradaLigadaNaLista,
} from "@/lib/guarda-de-frete";

const updateConfig = vi.fn();

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

type ConfigDeTeste = {
  originCep?: string;
  freeShippingMin?: number;
  shippingProvider?: string;
  localDeliveryFee?: number;
  enabledShippingMethods?: string[];
  storeAddress?: string | null;
};

const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: { atual: {} as ConfigDeTeste },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        const resposta = {
          data: [
            {
              provider: "melhor_envio",
              credentials: { token: "tok-de-teste", sandbox: false },
            },
          ],
          error: null,
        };
        const consulta = (): any =>
          Object.assign(Promise.resolve(resposta), {
            not: () => consulta(),
            neq: () => consulta(),
          });
        return {
          select: () => consulta(),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("listas de métodos — a retirada entra e sai sem tocar nas transportadoras", () => {
  it("liga preservando ordem e chaves; desliga removendo só ela", () => {
    expect(listaComRetirada(["sedex", "jadlog"], true)).toEqual([
      "sedex",
      "jadlog",
      "store-pickup",
    ]);
    expect(listaComRetirada(["store-pickup", "pac"], false)).toEqual(["pac"]);
  });

  it("base [] vira só a retirada (a edge segue lendo 'todas as transportadoras')", () => {
    expect(listaComRetirada([], true)).toEqual(["store-pickup"]);
    expect(listaComRetirada([], false)).toEqual([]);
  });

  it("base ausente/NULL = ['sedex','pac'] (mesma leitura da edge): ligar NÃO vira 'todas'", () => {
    expect(listaComRetirada(undefined, true)).toEqual([
      "sedex",
      "pac",
      "store-pickup",
    ]);
    expect(listaComRetirada(null, true)).toEqual([
      "sedex",
      "pac",
      "store-pickup",
    ]);
    expect(retiradaLigadaNaLista(undefined)).toBe(false);
  });

  it("chave duplicada não se multiplica; comparação exata (sem trim)", () => {
    expect(
      listaComRetirada(["store-pickup", "sedex", "store-pickup"], true),
    ).toEqual(["sedex", "store-pickup"]);
    expect(retiradaLigadaNaLista([" store-pickup"])).toBe(false);
    expect(chavesDeTransportadoraDaLista(["sedex", "store-pickup"])).toEqual([
      "sedex",
    ]);
  });
});

describe("Painel — chave 'Permitir retirada na loja' e a seção de Transportadoras", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function drenar() {
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function renderizarFrete() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active onSetDirty={vi.fn()} />);
    });
    await drenar();
  }

  async function renderizarTransportadoras() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    // Callback NOVO a cada render: a seção é `memo` e o dublê do useStore
    // não é contexto de verdade — sem prop nova, o "config novo que chegou"
    // nunca re-renderizaria (no app, a troca do contexto é que re-renderiza).
    await act(async () => {
      raiz.render(<TransportadorasSection onDirtyMudou={vi.fn()} />);
    });
    await drenar();
  }

  function chaveDaRetirada(): HTMLButtonElement {
    const chave = hospedeiro.querySelector(
      'button[role="switch"][aria-label="Permitir retirada na loja"]',
    ) as HTMLButtonElement | null;
    expect(chave).not.toBeNull();
    return chave as HTMLButtonElement;
  }

  function botao(texto: string): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;
  }

  async function clicar(el: HTMLElement | undefined) {
    expect(el).toBeDefined();
    await act(async () => {
      el?.click();
    });
    await drenar();
  }

  it("ligar grava a lista do config ATUAL + store-pickup (sedex/jadlog intactos)", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "jadlog"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("false");
    expect(hospedeiro.textContent).toContain(ENDERECO_FICTICIO);

    await clicar(chaveDaRetirada());
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    await clicar(botao("Salvar alterações"));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0].enabledShippingMethods).toEqual([
      "sedex",
      "jadlog",
      "store-pickup",
    ]);
  });

  it("desligar tira SÓ a retirada", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["store-pickup", "pac"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    await clicar(chaveDaRetirada());
    await clicar(botao("Salvar alterações"));
    expect(updateConfig.mock.calls[0][0].enabledShippingMethods).toEqual([
      "pac",
    ]);
  });

  it("salvar outra regra de frete NÃO envia a lista de métodos", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    await clicar(
      hospedeiro.querySelector(
        'button[role="switch"][aria-label="Só entregar na cidade"]',
      ) as HTMLButtonElement,
    );
    await clicar(botao("Salvar alterações"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).not.toHaveProperty(
      "enabledShippingMethods",
    );
  });

  it("sem endereço da loja a chave NÃO liga e manda cadastrar em Admin → Sobre a Loja", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac"],
      storeAddress: "   ",
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada());

    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("false");
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("Sobre a Loja");
    // Nada pendente para salvar: a chave não mudou.
    expect(botao("Salvar alterações")).toBeUndefined();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("retirada já ligada e endereço apagado: a tela AVISA que a cliente não vê a opção", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "store-pickup"],
      storeAddress: null,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "não aparece para a cliente",
    );
  });

  it("Transportadoras: salvar preserva store-pickup do config ATUAL (ligada depois da sincronização)", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"],
    };
    await renderizarTransportadoras();
    // A lojista marca jadlog (a seção fica suja)...
    await clicar(botao("jadlog"));
    // ...e, em outra aba, a retirada é ligada: config novo chega, a seção
    // suja NÃO ressincroniza.
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
    };
    await renderizarTransportadoras();

    await clicar(botao("Salvar"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0].enabledShippingMethods).toEqual([
      "sedex",
      "pac",
      "jadlog",
      "store-pickup",
    ]);
  });

  it("Transportadoras: a retirada ligada em Frete não suja esta seção (Salvar continua apagado)", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"],
    };
    await renderizarTransportadoras();
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
    };
    await renderizarTransportadoras();
    expect(botao("Salvar")?.disabled).toBe(true);
  });
});
