// @vitest-environment jsdom
//
// PRIMEIRA visita com a rede PENDURADA na consulta da CONFIGURACAO da loja
// (conecta e nao responde, sem erro): a leitura nao tinha prazo, entao
// `isLoaded` ficava falso (painel em "Carregando a escolha da loja...", Salvar
// desligado, formulario de endereco do checkout sem preencher) e a retomada
// (`online` / aba visivel) recusava rodar por haver "consulta em voo" -- so
// recarregar a pagina resolvia. Agora a leitura tem prazo: estourou, vira
// "sem resposta", a tela solta, as tentativas automaticas agendam e a retomada
// volta a funcionar. A resposta que chegar depois do prazo e' descartada.
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
  // Respostas das proximas consultas da configuracao, uma por consulta. Fila
  // vazia = a consulta pendura para sempre (rede pendurada).
  fila: [] as (() => unknown)[],
  consultas: [] as number[],
  // Configuracao salva no aparelho (IndexedDB).
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

function construtorEncadeavel(resultado: () => unknown): unknown {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => Promise.resolve(resultado()).then(resolve, rejeitar);
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
          const proxima = rede.fila.shift();
          // Fila vazia: a rede pendurou -- nunca responde.
          return proxima ? proxima() : new Promise(() => {});
        });
      }
      return construtorEncadeavel(() => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const respondeCom = (store_name: string) => () =>
  Promise.resolve({ data: { store_name, shipping_fee: 12 }, error: null });

// Mais que o prazo da leitura (20 s), menos que a 1a nova tentativa (prazo + 1 s).
const DEPOIS_DO_PRAZO_MS = 20_500;

type Retrato = {
  nomeDaLoja: string | null | undefined;
  isLoaded: boolean;
  configIndisponivel: boolean | undefined;
};

describe("StoreContext — rede pendurada na leitura da configuracao da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: Retrato | null };

  function Espiao() {
    const { config, isLoaded, configIndisponivel } = useStore();
    useEffect(() => {
      retrato.atual = {
        nomeDaLoja: config.storeName,
        isLoaded,
        configIndisponivel,
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
    rede.fila = [];
    rede.consultas = [];
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

  it("rede pendurada sem copia no aparelho: passado o prazo a tela solta (isLoaded) e avisa que a configuracao esta indisponivel", async () => {
    await montar();
    // antes do prazo: ainda esperando
    expect(retrato.atual?.isLoaded).toBe(false);

    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(true);
  });

  it("depois do prazo, a nova tentativa automatica pega a rede de volta e o nome da loja aparece", async () => {
    await montar();
    // a 1a consulta pendurou; a 2a (1 s depois do prazo) responde
    rede.fila = [respondeCom("Loja Teste")];
    await avancar(DEPOIS_DO_PRAZO_MS + 1_000);

    expect(rede.consultas).toHaveLength(2);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("rede que nunca responde: as tentativas automaticas acabam (1 + 3) e depois a rede voltar (online) consulta na hora e a loja aparece", async () => {
    await montar();
    await avancar(10 * 60_000);
    // 1 inicial + 3 automaticas, cada uma limitada pelo prazo -- nunca laco
    expect(rede.consultas).toHaveLength(4);
    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.nomeDaLoja).toBeUndefined();

    rede.fila = [respondeCom("Loja Teste")];
    await disparar(() => window.dispatchEvent(new Event("online")));

    expect(rede.consultas).toHaveLength(5);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("aba que volta a ficar visivel depois do prazo tambem retoma", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    rede.fila = [respondeCom("Loja Teste")];
    await disparar(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(rede.consultas).toHaveLength(5);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Teste");
  });

  it("evento de rede ANTES do prazo nao abre segunda consulta (uma em voo por vez)", async () => {
    await montar();
    await avancar(10_000); // ainda dentro do prazo, consulta pendurada

    await disparar(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(rede.consultas).toHaveLength(1);
  });

  it("resposta que chega DEPOIS do prazo e' descartada: nao sobrescreve a configuracao mais nova", async () => {
    let chegarTarde: (v: unknown) => void = () => {};
    rede.fila = [
      () =>
        new Promise((resolve) => {
          chegarTarde = resolve;
        }),
      respondeCom("Loja Nova"),
    ];
    await montar();
    await avancar(DEPOIS_DO_PRAZO_MS + 1_000);
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Nova");

    await act(async () => {
      chegarTarde({
        data: { store_name: "Loja Antiga", shipping_fee: 99 },
        error: null,
      });
    });
    await avancar(50);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Nova");
  });

  it("copia no aparelho + rede pendurada: a configuracao salva continua na tela, sem aviso de indisponivel e sem insistir", async () => {
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();
    expect(retrato.atual?.nomeDaLoja).toBe("Loja Salva");

    await avancar(10 * 60_000);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Salva");
    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);
    expect(rede.consultas).toHaveLength(1);
  });

  it("rede lenta que responde DENTRO do prazo: a loja aparece sem aviso e sem nova consulta", async () => {
    rede.fila = [
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: { store_name: "Loja Lenta", shipping_fee: 12 },
                error: null,
              }),
            15_000,
          );
        }),
    ];
    await montar();
    expect(retrato.atual?.isLoaded).toBe(false);

    await avancar(15_500);

    expect(retrato.atual?.nomeDaLoja).toBe("Loja Lenta");
    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);
    await avancar(60_000);
    expect(rede.consultas).toHaveLength(1);
  });
});
