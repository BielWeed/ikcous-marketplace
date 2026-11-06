// @vitest-environment jsdom
//
// Mesmo defeito da fila de produtos, agora na fila de AVANÇO DE STATUS de
// pedidos: com o painel aberto em duas abas, ao voltar a internet as duas
// liam a mesma fila (o localStorage é um só) e mandavam o mesmo avanço ao
// servidor. A segunda recebia "o pedido mudou de situação" — aviso falso, para
// um avanço que foi aplicado. A passada roda sob um Web Lock (`navigator.locks`)
// por dono da fila: a aba que não o consegue sai sem avisar. Sem
// `navigator.locks`, vale só a trava do módulo (passada em voo), como antes.
//
// Cada "aba" é uma CÓPIA do módulo (`vi.resetModules` + import dinâmico): a
// trava do módulo de uma não vê a da outra, como entre abas de verdade.
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({
  status: "pending",
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  travarRpc: false,
  aoReceberRpc: undefined as undefined | (() => void),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    // Releitura do status antes do avanço (como o banco real: depois do
    // primeiro avanço o pedido já não está em "pending").
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { status: servidor.status },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      servidor.rpcs.push({ nome, args });
      servidor.aoReceberRpc?.();
      if (servidor.travarRpc) return new Promise<never>(() => {});
      if (args.p_status_esperado !== servidor.status) {
        return {
          data: null,
          error: { code: "P0001", message: "pedido_status_mudou" },
        };
      }
      servidor.status = String(args.p_new_status);
      return { data: null, error: null };
    },
    functions: { invoke: vi.fn() },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "sync"),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const DONO = "lojista-1";
const CHAVE = `orders_offline_updates_queue:${DONO}`;

function guardarAvanco() {
  localStorage.setItem(
    CHAVE,
    JSON.stringify([
      {
        orderId: "pedido-1",
        status: "processing",
        statusEsperado: "pending",
        timestamp: Date.now(),
      },
    ]),
  );
}

/** Gerenciador de locks falso com a semântica de `ifAvailable` do navegador. */
function instalarLocksFalsos() {
  const presos = new Set<string>();
  const pedidos: { nome: string; ifAvailable?: boolean }[] = [];
  const request = vi.fn(
    async (
      nome: string,
      opcoes: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => unknown,
    ) => {
      pedidos.push({ nome, ifAvailable: opcoes.ifAvailable });
      if (presos.has(nome)) return callback(null);
      presos.add(nome);
      try {
        return await callback({ name: nome });
      } finally {
        presos.delete(nome);
      }
    },
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return { presos, pedidos, request };
}

function removerLocks() {
  Reflect.deleteProperty(navigator, "locks");
}

async function abrirAba() {
  vi.resetModules();
  const modulo = await import("@/hooks/useOrders");
  return modulo._syncOfflineOrderUpdatesParaTeste;
}

describe("fila offline de pedidos — trava entre abas", () => {
  beforeEach(() => {
    // Mesmo dublê dos vizinhos da fila de pedidos: o localStorage do jsdom não
    // persiste de forma confiável aqui.
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
      clear: () => armazenamento.clear(),
    });
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    servidor.status = "pending";
    servidor.rpcs = [];
    servidor.travarRpc = false;
    servidor.aoReceberRpc = undefined;
  });

  afterEach(() => {
    removerLocks();
    vi.useRealTimers();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("duas abas voltando online juntas: o avanço vai UMA vez e ninguém recebe aviso falso", async () => {
    const locks = instalarLocksFalsos();
    const abaA = await abrirAba();
    const abaB = await abrirAba();
    guardarAvanco();

    const [daA, daB] = await Promise.all([abaA(DONO), abaB(DONO)]);

    expect([daA, daB]).toEqual([true, false]);
    expect(servidor.rpcs).toHaveLength(1);
    expect(servidor.rpcs[0]?.nome).toBe("avancar_status_do_pedido");
    expect(servidor.status).toBe("processing");
    expect(toast.info).toHaveBeenCalledTimes(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(locks.pedidos).toEqual([
      { nome: `ikcous-fila-pedidos:${DONO}`, ifAvailable: true },
      { nome: `ikcous-fila-pedidos:${DONO}`, ifAvailable: true },
    ]);
  });

  it("outra aba já está sincronizando (lock preso): esta sai sem enviar, sem aviso e sem mexer na fila", async () => {
    const locks = instalarLocksFalsos();
    locks.presos.add(`ikcous-fila-pedidos:${DONO}`);
    const aba = await abrirAba();
    guardarAvanco();
    const antes = localStorage.getItem(CHAVE);

    expect(await aba(DONO)).toBe(false);

    expect(servidor.rpcs).toHaveLength(0);
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE)).toBe(antes);
  });

  it("o lock é por dono da fila: outro usuário sincronizando não segura este", async () => {
    const locks = instalarLocksFalsos();
    locks.presos.add("ikcous-fila-pedidos:outro-lojista");
    const aba = await abrirAba();
    guardarAvanco();

    expect(await aba(DONO)).toBe(true);
    expect(servidor.rpcs).toHaveLength(1);
  });

  it("o lock é solto no fim e quando a passada falha: a próxima tentativa roda", async () => {
    const locks = instalarLocksFalsos();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const aba = await abrirAba();
    guardarAvanco();

    // Storage bloqueado na leitura: a passada não conclui, e o lock é solto.
    const real = localStorage;
    let bloqueado = true;
    vi.stubGlobal("localStorage", {
      ...real,
      getItem: (chave: string) => {
        if (bloqueado) throw new DOMException("bloqueado", "SecurityError");
        return real.getItem(chave);
      },
    });
    expect(await aba(DONO)).toBe(false);
    bloqueado = false;
    expect(locks.presos.size).toBe(0);
    expect(servidor.rpcs).toHaveLength(0);

    expect(await aba(DONO)).toBe(true);
    expect(servidor.rpcs).toHaveLength(1);
    expect(locks.presos.size).toBe(0);
  });

  it("a segunda passada (item novo durante a primeira) roda DENTRO do mesmo lock", async () => {
    const locks = instalarLocksFalsos();
    const aba = await abrirAba();
    guardarAvanco();
    // Enquanto a RPC do primeiro avanço está em voo, entra outro avanço na fila.
    servidor.aoReceberRpc = () => {
      servidor.aoReceberRpc = undefined;
      const fila = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
      fila.push({
        orderId: "pedido-2",
        status: "cancelled",
        silent: false,
        timestamp: Date.now() + 1,
      });
      localStorage.setItem(CHAVE, JSON.stringify(fila));
    };

    expect(await aba(DONO)).toBe(true);

    // Duas RPCs (as duas passadas) e UM só pedido de lock: o lock não é
    // pedido de novo pela segunda passada (com `ifAvailable` ela se recusaria).
    expect(servidor.rpcs.map((r) => r.nome)).toEqual([
      "avancar_status_do_pedido",
      "update_order_status_atomic",
    ]);
    expect(locks.request).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("passada travada de vez (RPC que nunca responde): o lock vence em 2 minutos e outra aba envia", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const locks = instalarLocksFalsos();
    const abaA = await abrirAba();
    const abaB = await abrirAba();
    guardarAvanco();
    servidor.travarRpc = true;
    void abaA(DONO); // rede de socket meio aberto: a RPC nunca volta
    await vi.advanceTimersByTimeAsync(0);
    expect(locks.presos.size).toBe(1);
    expect(servidor.rpcs).toHaveLength(1);

    // Dentro do prazo a outra aba continua sem poder, e sem avisar.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await abaB(DONO)).toBe(false);
    expect(servidor.rpcs).toHaveLength(1);
    expect(toast.info).not.toHaveBeenCalled();

    // Passado o prazo o lock é solto, sem timer sobrando, e a outra aba envia.
    servidor.travarRpc = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(locks.presos.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(await abaB(DONO)).toBe(true);
    expect(servidor.rpcs).toHaveLength(2);
    expect(servidor.status).toBe("processing");
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("navegador sem navigator.locks: vale a trava do módulo (passada em voo), como antes", async () => {
    removerLocks();
    expect("locks" in navigator).toBe(false);
    const aba = await abrirAba();
    guardarAvanco();

    const [primeira, segunda] = await Promise.all([aba(DONO), aba(DONO)]);

    // Mesma aba, mesmo usuário: as duas chamadas dividem a mesma passada.
    expect([primeira, segunda]).toEqual([true, true]);
    expect(servidor.rpcs).toHaveLength(1);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
