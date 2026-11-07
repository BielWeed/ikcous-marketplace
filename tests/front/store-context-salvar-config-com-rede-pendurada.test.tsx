// @vitest-environment jsdom
//
// SALVAR AS CONFIGURAÇÕES DA LOJA com a rede PENDURADA (conecta e não
// responde, sem erro): `updateConfig` fazia `await supabase.rpc(
// "upsert_store_config")` sem prazo, então o botão de Salvar (frete, formas de
// pagamento, frete grátis, contato...) ficava em "Salvando" até o navegador
// desistir, minutos depois, sem frase e sem saída.
//
// Agora a espera tem prazo (20 s). Estourou: `updateConfig` devolve `false`
// (os `finally` das telas soltam o botão), a frase NÃO afirma que a mudança
// "não foi feita" (a gravação pode ter chegado ao servidor), o estado real é
// RELIDO, e a resposta que chegar depois do prazo não vira aviso de sucesso
// nem mexe na configuração da tela.
//
// Render de verdade do StoreProvider, mesmo molde de
// store-context-vitrine-nao-declara-sucesso-sem-conferir.test.tsx.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  dataVaultPut: vi.fn().mockResolvedValue(undefined),
  // Como a RPC se comporta nesta rodada: "pendura" nunca responde; "manual"
  // responde quando o teste chamar `liberarRpc`.
  liberarRpc: null as null | ((r: { data: unknown; error: unknown }) => void),
  rpcChamadas: 0,
  // Quantas vezes a configuração da loja foi lida (fetchConfig).
  leiturasDaConfig: 0,
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: rede.dataVaultPut,
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
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

function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
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
      if (tabela === "store_config") rede.leiturasDaConfig += 1;
      return construtorEncadeavel({ data: [], error: null });
    },
    rpc: () => {
      rede.rpcChamadas += 1;
      // Promessa que só o teste resolve -- ou que nunca resolve.
      return new Promise((resolve) => {
        rede.liberarRpc = resolve;
      });
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfigFn = (
  updates: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<boolean>;

function Capturador({ onReady }: { onReady: (fn: UpdateConfigFn) => void }) {
  const { updateConfig } = useStore();
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    onReadyRef.current(updateConfig as UpdateConfigFn);
  }, [updateConfig]);
  return null;
}

// Passa do prazo de gravação (20 s) e fica aquém de qualquer outro relógio.
const DEPOIS_DO_PRAZO_MS = 21_000;
const ANTES_DO_PRAZO_MS = 5_000;

describe("StoreContext.updateConfig — rede pendurada ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let updateConfigRef: { current: UpdateConfigFn | null };

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // Dispara o salvar SEM esperar por ele: com a rede pendurada a promessa só
  // assenta no estouro do prazo, e esperar por ela dentro do `act` travaria o
  // teste (em vez de mostrar a falha).
  async function salvar(
    updates: Record<string, unknown>,
    opcoes?: Record<string, unknown>,
  ) {
    const estado: { terminou: boolean; resultado: boolean | undefined } = {
      terminou: false,
      resultado: undefined,
    };
    await act(async () => {
      void updateConfigRef.current!(updates, opcoes).then((v) => {
        estado.terminou = true;
        estado.resultado = v;
      });
    });
    return estado;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.liberarRpc = null;
    rede.rpcChamadas = 0;
    rede.leiturasDaConfig = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    updateConfigRef = { current: null };

    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador
            onReady={(fn) => {
              updateConfigRef.current = fn;
            }}
          />
        </StoreProvider>,
      );
    });
    await avancar(50);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("RPC pendurada: antes do prazo o botão segue esperando; estourou, updateConfig solta com false", async () => {
    const salvando = await salvar({ shippingFee: 20 });
    await avancar(ANTES_DO_PRAZO_MS);
    expect(rede.rpcChamadas).toBe(1);
    expect(salvando.terminou).toBe(false);

    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(salvando.terminou).toBe(true);
    expect(salvando.resultado).toBe(false);
  });

  it("no estouro, a frase manda conferir (não afirma que NÃO foi feito), sem aviso de sucesso", async () => {
    await salvar({ shippingFee: 20 });
    await avancar(DEPOIS_DO_PRAZO_MS);

    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const frase = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(frase).toMatch(/sem resposta da rede/i);
    expect(frase).toMatch(/confira/i);
    // Nunca o genérico, que soa como "não gravou".
    expect(frase).not.toMatch(/erro ao salvar/i);
    expect(frase).not.toMatch(/não foi (feito|salvo)/i);
  });

  it("no estouro, a configuração real é RELIDA (a gravação pode ter chegado ao servidor)", async () => {
    await salvar({ shippingFee: 20 });
    const leiturasAntes = rede.leiturasDaConfig;
    await avancar(DEPOIS_DO_PRAZO_MS);
    await avancar(50);
    expect(rede.leiturasDaConfig).toBeGreaterThan(leiturasAntes);
  });

  it("resposta de sucesso que chega DEPOIS do prazo não gera aviso de sucesso nem grava no aparelho", async () => {
    const salvando = await salvar({ shippingFee: 20 });
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(salvando.terminou).toBe(true);
    rede.dataVaultPut.mockClear();

    // O servidor responde tarde, com a linha "gravada".
    await act(async () => {
      rede.liberarRpc?.({
        data: { id: 1, shipping_fee: 20 },
        error: null,
      });
    });
    await avancar(50);

    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(rede.dataVaultPut).not.toHaveBeenCalled();
  });

  it("silent: no estouro não mostra aviso, mas ainda solta com false", async () => {
    const salvando = await salvar({ shippingFee: 20 }, { silent: true });
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(salvando.terminou).toBe(true);
    expect(salvando.resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("caminho feliz dentro do prazo continua salvando normalmente", async () => {
    const salvando = await salvar({ shippingFee: 20 });
    await avancar(ANTES_DO_PRAZO_MS);
    await act(async () => {
      rede.liberarRpc?.({
        data: { id: 1, shipping_fee: 20 },
        error: null,
      });
    });
    await avancar(50);
    expect(salvando.terminou).toBe(true);
    expect(salvando.resultado).toBe(true);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("Configurações salvas");
  });
});
