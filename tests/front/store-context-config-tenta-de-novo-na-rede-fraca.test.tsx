// @vitest-environment jsdom
//
// PRIMEIRA visita com a rede falhando na consulta da CONFIGURACAO da loja: o
// contexto so escrevia no console e seguia com a configuracao de fabrica --
// cabecalho sem o nome da loja, WhatsApp e regras de frete como se a lojista
// nunca tivesse configurado nada -- ate a cliente recarregar a pagina. O
// conserto faz ate 3 novas tentativas automaticas (1 s / 2 s / 4 s), tenta de
// novo quando a rede volta (`online`) ou a aba volta a ficar visivel, mantem UM
// pedido em voo por vez e nao mexe em quem ja tem a configuracao na tela.
//
// Render de verdade do StoreProvider (react-dom/client + jsdom), mesmo padrao
// de store-context-catalogo-com-rede-falhando-avisa.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  // Cliente comum (nao lojista): e o caminho da primeira visita pelo link.
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  // O que a consulta publica da configuracao devolve agora (mutado por teste).
  config: { data: null as unknown, error: null as unknown },
  // Quando (relogio do teste) cada consulta da configuracao foi feita.
  consultas: [] as number[],
  // Resposta que SO chega quando o teste mandar (uma consulta lenta).
  proxima: null as Promise<unknown> | null,
  // Configuracao salva no aparelho (IndexedDB) -- o que quem ja visitou ve.
  configSalva: null as unknown,
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => ({
      getById: vi.fn().mockImplementation(async () => rede.configSalva),
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
    onSync: vi.fn(() => () => {}),
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
          rede.consultas.push(Date.now());
          if (rede.proxima) {
            const lenta = rede.proxima;
            rede.proxima = null;
            return lenta;
          }
          return rede.config;
        });
      }
      // catalogo e o resto: respondem bem e vazio, fora do assunto do teste
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

type Retrato = { nomeDaLoja: string | null | undefined; isLoaded: boolean };

describe("StoreContext — rede falhando na consulta da configuracao", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: Retrato | null };

  function Espiao() {
    const { config, isLoaded } = useStore();
    useEffect(() => {
      retrato.atual = { nomeDaLoja: config.storeName, isLoaded };
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
    // deixa o efeito de montagem e as promessas do cofre assentarem
    await avancar(50);
  }

  async function disparar(fazer: () => void) {
    await act(async () => {
      fazer();
    });
    await avancar(50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.config = { data: null, error: FALHA_DE_REDE };
    rede.consultas = [];
    rede.proxima = null;
    rede.configSalva = null;
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

  it("primeira visita sem rede: a loja segue de pe, e a rede volta na nova tentativa — o nome da loja aparece", async () => {
    await montar();
    expect(rede.consultas).toHaveLength(1);
    expect(retrato.atual?.nomeDaLoja).toBeUndefined();
    expect(retrato.atual?.isLoaded).toBe(true);

    rede.config = CONFIG_DA_LOJA;
    await avancar(1_000);

    expect(rede.consultas).toHaveLength(2);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
  });

  it("rede que NAO volta: 3 novas tentativas, espera crescente (1 s, 2 s, 4 s), e para", async () => {
    await montar();
    await avancar(10 * 60_000);

    // 1 consulta inicial + 3 automaticas -- nunca laco infinito.
    expect(rede.consultas).toHaveLength(4);
    const esperas = rede.consultas
      .slice(1)
      .map((t, i) => t - (rede.consultas.at(i) ?? 0));
    expect(esperas).toEqual([1_000, 2_000, 4_000]);
    // o erro continua registrado a cada falha (nada de engolir)
    expect(console.error).toHaveBeenCalled();
    expect(retrato.atual?.nomeDaLoja).toBeUndefined();
  });

  it("depois de esgotar, a rede voltar (online) consulta na hora e ganha folego novo", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    rede.config = CONFIG_DA_LOJA;
    await disparar(() => window.dispatchEvent(new Event("online")));

    expect(rede.consultas).toHaveLength(5);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
  });

  it("rede voltou (online) mas a consulta falha de novo: ganha mais 3 tentativas automaticas, e para", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    await disparar(() => window.dispatchEvent(new Event("online")));
    await avancar(10 * 60_000);

    // 4 + 1 (online) + 3 automaticas -- e nada alem disso
    expect(rede.consultas).toHaveLength(8);
  });

  it("aba que volta a ficar visivel consulta de novo; aba escondida nao", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    const visibilidade = vi.spyOn(document, "visibilityState", "get");
    visibilidade.mockReturnValue("hidden");
    await disparar(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(rede.consultas).toHaveLength(4);

    visibilidade.mockReturnValue("visible");
    await disparar(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(rede.consultas).toHaveLength(5);
  });

  it("um pedido em voo por vez: eventos de rede com consulta pendente nao disparam outra", async () => {
    await montar();
    await avancar(1_000);
    expect(rede.consultas).toHaveLength(2);

    let responder: (v: unknown) => void = () => {};
    rede.proxima = new Promise((resolve) => {
      responder = resolve;
    });
    await avancar(2_000); // 3a consulta fica PENDENTE
    expect(rede.consultas).toHaveLength(3);

    await disparar(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(rede.consultas).toHaveLength(3);

    await act(async () => {
      responder(CONFIG_DA_LOJA);
    });
    await avancar(50);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
  });

  it("evento de rede com consulta pendente NAO renova o folego: as tentativas continuam acabando", async () => {
    await montar();
    await avancar(1_000);
    let falhar: (v: unknown) => void = () => {};
    rede.proxima = new Promise((resolve) => {
      falhar = resolve;
    });
    await avancar(2_000); // 3a consulta fica PENDENTE
    await avancar(5_000); // ...tempo bastante para o piso entre retomadas passar
    expect(rede.consultas).toHaveLength(3);

    await disparar(() => window.dispatchEvent(new Event("online")));
    await act(async () => {
      falhar({ data: null, error: FALHA_DE_REDE });
    });
    await avancar(10 * 60_000);

    // 1 inicial + 3 automaticas, exatamente como sem o evento
    expect(rede.consultas).toHaveLength(4);
  });

  it("rajada de eventos nao martela: no maximo uma consulta a cada poucos segundos", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    await disparar(() => window.dispatchEvent(new Event("online")));
    expect(rede.consultas).toHaveLength(5);
    await disparar(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(rede.consultas).toHaveLength(5);
  });

  it("quem ja tem a configuracao salva no aparelho: sem tentativas extras", async () => {
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();
    await avancar(10 * 60_000);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Salva");
    expect(rede.consultas).toHaveLength(1);

    await disparar(() => window.dispatchEvent(new Event("online")));
    expect(rede.consultas).toHaveLength(1);
  });

  it("configuracao que chegou de primeira: nenhuma nova tentativa, nem com evento de rede", async () => {
    rede.config = CONFIG_DA_LOJA;
    await montar();
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");

    await disparar(() => window.dispatchEvent(new Event("online")));
    await avancar(60_000);
    expect(rede.consultas).toHaveLength(1);
  });

  it("'nao ha linha de configuracao' (PGRST116) e resposta, nao falha de rede: nao insiste", async () => {
    rede.config = { data: null, error: SEM_LINHA };
    await montar();
    await avancar(10 * 60_000);

    expect(rede.consultas).toHaveLength(1);
  });

  it("sair da tela cancela a nova tentativa pendente e solta os ouvidos de rede", async () => {
    const entram = vi.spyOn(window, "addEventListener");
    const saem = vi.spyOn(window, "removeEventListener");
    const entramNoDocumento = vi.spyOn(document, "addEventListener");
    const saemDoDocumento = vi.spyOn(document, "removeEventListener");
    await montar();
    act(() => {
      raiz.unmount();
    });
    // cada ouvido que entrou (online / visibilitychange) saiu com a MESMA funcao
    const entrou = entram.mock.calls.filter(([tipo]) => tipo === "online");
    expect(entrou.length).toBeGreaterThan(0);
    for (const [, funcao] of entrou) {
      expect(
        saem.mock.calls.some(([t, f]) => t === "online" && f === funcao),
      ).toBe(true);
    }
    const entrouNoDocumento = entramNoDocumento.mock.calls.filter(
      ([tipo]) => tipo === "visibilitychange",
    );
    expect(entrouNoDocumento.length).toBeGreaterThan(0);
    for (const [, funcao] of entrouNoDocumento) {
      expect(
        saemDoDocumento.mock.calls.some(
          ([t, f]) => t === "visibilitychange" && f === funcao,
        ),
      ).toBe(true);
    }
    await avancar(10 * 60_000);
    await disparar(() => window.dispatchEvent(new Event("online")));

    expect(rede.consultas).toHaveLength(1);
    // afterEach desmonta de novo -- recria a raiz para nao duplicar o unmount
    raiz = createRoot(hospedeiro);
  });
});
