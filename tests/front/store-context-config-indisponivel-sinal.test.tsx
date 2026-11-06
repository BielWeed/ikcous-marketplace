// @vitest-environment jsdom
//
// A leitura da configuracao da loja FALHOU e nao ha copia no aparelho: o
// contexto segue de pe (`isLoaded` vira true -- o teste da rede fraca prende
// isso), mas a configuracao na tela e a DE FABRICA (sem nome, logo, endereco,
// WhatsApp, CEP). Quem so olhava `isLoaded` lia isso como "a lojista nao
// preencheu nada" e o Inicio, Ajustes e Minha loja afirmavam "falta" tudo.
//
// O sinal ACRESCENTADO `configIndisponivel` separa as duas coisas: verdadeiro
// so quando a leitura falhou SEM cobertura (nem copia do aparelho, nem resposta
// do servidor); volta a falso assim que chega a copia do aparelho, a resposta
// de verdade ou o "ainda nao ha linha" (PGRST116, que e resposta).
//
// Render de verdade do StoreProvider, mesmo molde de
// store-context-config-tenta-de-novo-na-rede-fraca.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  config: { data: null as unknown, error: null as unknown },
  consultas: 0,
  configSalva: null as unknown,
  // Quando preenchida, a leitura da copia do aparelho SO termina depois dela
  // (a copia chega DEPOIS da falha da rede).
  esperaCopia: null as Promise<void> | null,
  // Ouvintes que o motor de tempo real registrou (o catch-up e o evento ao
  // vivo de store_config passam por eles).
  ouvintes: [] as Array<(evento: unknown) => void>,
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => ({
      getById: vi.fn().mockImplementation(async () => {
        if (rede.esperaCopia) await rede.esperaCopia;
        return rede.configSalva;
      }),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn((cb: (evento: unknown) => void) => {
      rede.ouvintes.push(cb);
      return () => {};
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(resultado: () => unknown) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado());
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "v_store_config") {
        return construtorEncadeavel(() => {
          rede.consultas += 1;
          return rede.config;
        });
      }
      return construtorEncadeavel(() => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FALHA_DE_REDE = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};
const SEM_LINHA = {
  message: "JSON object requested, multiple (or no) rows returned",
  details: "",
  hint: "",
  code: "PGRST116",
};
const CONFIG_DA_LOJA = {
  data: { store_name: "Loja Teste", shipping_fee: 12 },
  error: null,
};

type Retrato = {
  isLoaded: boolean;
  configIndisponivel: boolean | undefined;
  nomeDaLoja: string | null | undefined;
  refresh: ReturnType<typeof useStore>["refresh"];
};

describe("StoreContext — sinal configIndisponivel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: Retrato | null };

  function Espiao() {
    const { config, isLoaded, configIndisponivel, refresh } = useStore();
    useEffect(() => {
      retrato.atual = {
        isLoaded,
        configIndisponivel,
        nomeDaLoja: config.storeName,
        refresh,
      };
    });
    return null;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Espiao />
        </StoreProvider>,
      );
    });
    await avancar(50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.config = { data: null, error: FALHA_DE_REDE };
    rede.consultas = 0;
    rede.configSalva = null;
    rede.esperaCopia = null;
    rede.ouvintes = [];
    retrato = { atual: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leitura falhou SEM copia no aparelho: carregou (isLoaded) mas a configuracao esta indisponivel", async () => {
    await montar();

    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.nomeDaLoja).toBeUndefined();
    expect(retrato.atual?.configIndisponivel).toBe(true);
  });

  it("a nova tentativa automatica acerta: a configuracao chega e o sinal volta a falso", async () => {
    await montar();
    expect(retrato.atual?.configIndisponivel).toBe(true);

    rede.config = CONFIG_DA_LOJA;
    await avancar(1_000);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("rede que volta so por um 'online' depois de esgotar as tentativas: o sinal tambem cai", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(retrato.atual?.configIndisponivel).toBe(true);

    rede.config = CONFIG_DA_LOJA;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(50);

    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("leitura falhou MAS ha copia no aparelho: a loja nao esta pelada, o sinal fica falso", async () => {
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Salva");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("'nao ha linha' (PGRST116) e resposta do servidor, nao falha: o sinal fica falso", async () => {
    rede.config = { data: null, error: SEM_LINHA };
    await montar();

    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("configuracao que chegou de primeira: o sinal nunca acende", async () => {
    rede.config = CONFIG_DA_LOJA;
    await montar();

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("a leitura falha ANTES e a copia do aparelho chega DEPOIS: o sinal cai", async () => {
    let soltarCopia: () => void = () => {};
    rede.esperaCopia = new Promise<void>((resolve) => {
      soltarCopia = resolve;
    });
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();
    // A rede falhou e a copia ainda nao chegou: indisponivel.
    expect(retrato.atual?.configIndisponivel).toBe(true);

    await act(async () => {
      soltarCopia();
    });
    await avancar(50);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Salva");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("a leitura falhou e a configuracao de verdade chega pelo tempo real (evento ou catch-up): o sinal cai e a rede para de insistir", async () => {
    await montar();
    expect(retrato.atual?.configIndisponivel).toBe(true);
    expect(rede.ouvintes.length).toBeGreaterThan(0);

    await act(async () => {
      for (const ouvir of rede.ouvintes) {
        ouvir({
          store: "store_config",
          eventType: "UPDATE",
          newRecord: { id: 1, store_name: "Loja Ao Vivo" },
        });
      }
    });
    await avancar(50);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Ao Vivo");
    expect(retrato.atual?.configIndisponivel).toBe(false);

    // Ja ha configuracao de verdade: as novas tentativas automaticas param.
    const consultasAntes = rede.consultas;
    await avancar(10 * 60_000);
    expect(rede.consultas).toBe(consultasAntes);
  });

  it("falha tardia nao derruba o sinal de quem ja tem configuracao: resposta boa, depois uma releitura que falha, continua falso", async () => {
    rede.config = CONFIG_DA_LOJA;
    await montar();
    expect(retrato.atual?.configIndisponivel).toBe(false);

    // Releitura explicita (o "Tentar de novo" das telas) que falha: a copia de
    // verdade segue na tela, entao nada passa a ser "indisponivel".
    rede.config = { data: null, error: FALHA_DE_REDE };
    await act(async () => {
      await retrato.atual?.refresh({ onlyConfig: true });
    });
    await avancar(10 * 60_000);

    expect(rede.consultas).toBeGreaterThan(1);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });
});
