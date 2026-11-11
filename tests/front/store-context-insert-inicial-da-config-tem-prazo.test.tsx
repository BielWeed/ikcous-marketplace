// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

type Resposta = { data: unknown; error: unknown };

const rede = vi.hoisted(() => ({
  leituras: vi.fn<() => Promise<Resposta>>(),
  insert: vi.fn<(linhas: Record<string, unknown>[]) => Promise<Resposta>>(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getById: async () => null,
      getAll: async () => [],
      put: async () => {},
      replaceAll: async () => {},
      setLastSync: async () => {},
      clear: async () => {},
    }),
  },
}));
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: () => () => {},
    onSync: () => () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

// O INSERT tem resposta independente do SELECT: só a escrita pode pendurar.
function consultaEncadeada(
  resultado: () => Promise<Resposta>,
  permiteInsert = false,
): unknown {
  return new Proxy(() => {}, {
    get(_alvo, propriedade) {
      if (propriedade === "then") {
        const promessa = Promise.resolve().then(resultado);
        return promessa.then.bind(promessa);
      }
      if (propriedade === "insert" && permiteInsert) {
        return (linhas: Record<string, unknown>[]) =>
          consultaEncadeada(() => rede.insert(linhas));
      }
      return () => consultaEncadeada(resultado, permiteInsert);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_config") {
        return consultaEncadeada(() => rede.leituras(), true);
      }
      return consultaEncadeada(async () => ({ data: [], error: null }));
    },
    rpc: () => consultaEncadeada(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Depois do prazo de 20 s, antes da primeira nova tentativa (mais 1 s).
const DEPOIS_DO_PRAZO_MS = 20_500;

describe("StoreContext — INSERT inicial da configuracao tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: ReturnType<typeof useStore> | null };

  function Espiao() {
    const store = useStore();
    useEffect(() => {
      retrato.atual = store;
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
    expect(rede.leituras).toHaveBeenCalledTimes(1);
    expect(rede.insert).toHaveBeenCalledTimes(1);
  }

  function recuperarNaProximaLeitura() {
    rede.leituras.mockResolvedValue({
      data: { id: 1, store_name: "Loja Recuperada", shipping_fee: 23 },
      error: null,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.leituras.mockReset().mockResolvedValue({
      data: null,
      error: { code: "PGRST116" },
    });
    rede.insert.mockReset().mockImplementation(() => new Promise(() => {}));
    retrato = { atual: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sem cache e com INSERT pendurado: passado o prazo sai do carregamento e sinaliza a recuperacao", async () => {
    await montar();
    expect(retrato.atual?.isLoaded).toBe(false);

    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(true);
  });

  it("depois do prazo tenta ler de novo automaticamente e aplica a configuracao recuperada", async () => {
    await montar();
    recuperarNaProximaLeitura();

    await avancar(DEPOIS_DO_PRAZO_MS + 1_000);

    expect(rede.leituras).toHaveBeenCalledTimes(2);
    expect(rede.insert).toHaveBeenCalledTimes(1);
    expect(retrato.atual?.config.storeName).toBe("Loja Recuperada");
    expect(retrato.atual?.config.shippingFee).toBe(23);
    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("a rede voltar depois do prazo libera uma nova leitura sem esperar o timer", async () => {
    await montar();
    await avancar(DEPOIS_DO_PRAZO_MS);
    recuperarNaProximaLeitura();

    await act(async () => window.dispatchEvent(new Event("online")));
    await avancar(50);

    expect(rede.leituras).toHaveBeenCalledTimes(2);
    expect(retrato.atual?.config.storeName).toBe("Loja Recuperada");
    expect(retrato.atual?.configIndisponivel).toBe(false);
  });

  it("resposta tardia do INSERT nao sobrescreve a configuracao mais nova", async () => {
    let responderTarde: (resposta: Resposta) => void = () => {};
    rede.insert.mockImplementation(
      () =>
        new Promise((resolve) => {
          responderTarde = resolve;
        }),
    );
    await montar();
    recuperarNaProximaLeitura();
    await avancar(DEPOIS_DO_PRAZO_MS + 1_000);
    expect(retrato.atual?.config.storeName).toBe("Loja Recuperada");

    await act(async () => {
      responderTarde({
        data: { id: 1, store_name: "Semente Antiga", shipping_fee: 99 },
        error: null,
      });
    });
    await avancar(50);

    expect(retrato.atual?.config.storeName).toBe("Loja Recuperada");
    expect(retrato.atual?.config.shippingFee).toBe(23);
  });

  it("INSERT que responde normalmente continua gravando e mapeando a semente sem tentar de novo", async () => {
    rede.insert.mockImplementation(async ([linha]) => ({
      data: { ...linha, store_name: "Loja Inicial" },
      error: null,
    }));
    await montar();

    expect(rede.insert.mock.calls[0][0][0]).toMatchObject({
      id: 1,
      shipping_fee: 15,
      free_shipping_min: 0,
    });
    expect(retrato.atual?.config.storeName).toBe("Loja Inicial");
    expect(retrato.atual?.config.shippingFee).toBe(15);
    expect(retrato.atual?.config.freeShippingMin).toBe(0);
    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);

    await avancar(60_000);
    expect(rede.leituras).toHaveBeenCalledTimes(1);
    expect(rede.insert).toHaveBeenCalledTimes(1);
  });

  it("erro respondido pelo INSERT preserva o caminho existente, sem nova tentativa automatica", async () => {
    rede.insert.mockResolvedValue({ data: null, error: { code: "42501" } });
    await montar();

    expect(retrato.atual?.isLoaded).toBe(true);
    expect(retrato.atual?.configIndisponivel).toBe(false);
    await avancar(60_000);
    expect(rede.leituras).toHaveBeenCalledTimes(1);
    expect(rede.insert).toHaveBeenCalledTimes(1);
  });
});
