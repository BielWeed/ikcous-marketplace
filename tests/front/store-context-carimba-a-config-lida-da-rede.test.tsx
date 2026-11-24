// @vitest-environment jsdom
//
// O BOOT CARIMBA A CONFIGURAÇÃO SÓ QUANDO A LEU DA REDE (revisão Opus,
// 24/11/2026).
//
// A rodada inicial do motor (visitante/cliente) pula se o boot acabou de ler.
// Com só o carimbo dos produtos, uma leitura da config que falhava no boot
// (prazo, 5xx) com a cópia antiga já na tela deixava a cliente vendo frete
// grátis, desconto PIX, formas de pagamento e manutenção velhos a sessão
// inteira: o StoreContext não reagenda (há config na tela) e a rodada inicial,
// que antes relia a config, pulava. Agora o boot carimba `store_config` no
// cofre QUANDO a resposta da rede foi aplicada -- nunca pela cópia do aparelho,
// nunca na falha -- e o motor exige os dois carimbos recentes para pular.
//
// Render de verdade do StoreProvider, mesmo padrão de
// store-context-config-tenta-de-novo-na-rede-fraca.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  config: { data: null as unknown, error: null as unknown },
  configSalva: null as unknown,
}));

// UM cofre só, devolvido por todo `DataVault.init()`: o espião do carimbo vê
// as gravações de qualquer caminho.
const cofre = vi.hoisted(() => ({
  getById: null as any,
  getAll: null as any,
  put: null as any,
  replaceAll: null as any,
  setLastSync: null as any,
  clear: null as any,
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => cofre),
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
        return construtorEncadeavel(() => rede.config);
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
const ERRO_5XX = {
  message: "upstream connect error",
  details: "",
  hint: "",
  code: "503",
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

const carimbosDaConfig = () =>
  (cofre.setLastSync as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([gaveta]) => gaveta === "store_config",
  );

describe("StoreContext — carimbo da configuração lida da rede", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    await act(async () => {
      raiz.render(<StoreProvider>{null}</StoreProvider>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.config = { data: null, error: FALHA_DE_REDE };
    rede.configSalva = null;
    cofre.getById = vi.fn().mockImplementation(async () => rede.configSalva);
    cofre.getAll = vi.fn().mockResolvedValue([]);
    cofre.put = vi.fn().mockResolvedValue(undefined);
    cofre.replaceAll = vi.fn().mockResolvedValue(undefined);
    cofre.setLastSync = vi.fn().mockResolvedValue(undefined);
    cofre.clear = vi.fn().mockResolvedValue(undefined);
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

  it("config lida da rede com sucesso: carimba `store_config` (uma vez)", async () => {
    rede.config = CONFIG_DA_LOJA;
    await montar();

    expect(carimbosDaConfig()).toHaveLength(1);
  });

  it("config da rede IGUAL à cópia do aparelho (nada a regravar): carimba mesmo assim -- foi lida agora", async () => {
    rede.config = CONFIG_DA_LOJA;
    await montar();
    expect(carimbosDaConfig()).toHaveLength(1);
    act(() => {
      raiz.unmount();
    });

    // Segunda abertura: a cópia salva é exatamente o que a rede devolve.
    const gravada = (cofre.put as ReturnType<typeof vi.fn>).mock.calls.find(
      ([gaveta]) => gaveta === "store_config",
    )?.[1];
    expect(gravada).toBeTruthy();
    rede.configSalva = gravada;
    (cofre.setLastSync as ReturnType<typeof vi.fn>).mockClear();
    (cofre.put as ReturnType<typeof vi.fn>).mockClear();
    raiz = createRoot(hospedeiro);
    await montar();

    // Prova de que é mesmo o caminho "igual": a config não foi regravada...
    expect(
      (cofre.put as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([gaveta]) => gaveta === "store_config",
      ),
    ).toHaveLength(0);
    // ...e o carimbo veio mesmo assim.
    expect(carimbosDaConfig()).toHaveLength(1);
  });

  it("config FALHOU (rede) com cópia antiga no aparelho: NÃO carimba (a cópia não é leitura de agora)", async () => {
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(carimbosDaConfig()).toHaveLength(0);
    // O catálogo, que chegou, continua carimbado como antes.
    expect(cofre.setLastSync).toHaveBeenCalledWith("products");
  });

  it("config com erro 5xx do servidor e cópia antiga: NÃO carimba", async () => {
    rede.config = { data: null, error: ERRO_5XX };
    rede.configSalva = { id: "singleton", storeName: "Loja Salva" };
    await montar();

    expect(carimbosDaConfig()).toHaveLength(0);
  });

  it("'não há linha' (PGRST116): NÃO carimba -- nada foi aplicado, a rodada inicial do motor roda completa", async () => {
    rede.config = { data: null, error: SEM_LINHA };
    await montar();

    expect(carimbosDaConfig()).toHaveLength(0);
  });

  it("primeira visita, falha e depois a nova tentativa acerta: carimba só quando acerta", async () => {
    await montar();
    expect(carimbosDaConfig()).toHaveLength(0);

    rede.config = CONFIG_DA_LOJA;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(carimbosDaConfig()).toHaveLength(1);
  });
});
