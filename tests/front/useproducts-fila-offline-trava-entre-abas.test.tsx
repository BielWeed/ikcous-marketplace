// @vitest-environment jsdom
//
// Painel aberto em DUAS abas: ao voltar a internet, as duas sincronizam a mesma
// fila offline de produtos (o localStorage é compartilhado). A trava do módulo
// só enxerga a própria aba: as duas liam a fila, a primeira gravava e mudava a
// versão do produto, e a segunda (com a versão velha) recebia 0 linhas e
// avisava "sua edição offline não foi aplicada" — para uma edição que FOI
// aplicada. A passada agora roda sob um Web Lock (`navigator.locks`) por dono
// da fila: a aba que não o consegue sai sem avisar. Sem `navigator.locks`
// (Safari antigo) vale só a trava do módulo, como antes.
//
// Cada "aba" é uma CÓPIA do módulo (`vi.resetModules` + import dinâmico): a
// trava do módulo de uma não vê a da outra, como entre abas de verdade; o
// localStorage, o servidor falso e o gerenciador de locks falso são comuns.
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  version: "2026-10-16T07:00:00.123456+00:00",
  payloads: [] as Record<string, unknown>[],
  updates: 0,
  travarEnvio: false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "sync"),
    dismiss: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const filters = new Map<string, unknown>();
        const query = {
          eq: (column: string, value: unknown) => {
            filters.set(column, value);
            return query;
          },
          is: () => query,
          select: async () => {
            mock.updates += 1;
            if (mock.travarEnvio) return new Promise<never>(() => {});
            if (filters.get("ultima_atualizacao") !== mock.version) {
              return { data: [], error: null };
            }
            mock.payloads.push(payload);
            mock.version = `2026-10-16T08:0${mock.payloads.length}:00+00:00`;
            return {
              data: [{ id: "p1", ultima_atualizacao: mock.version }],
              error: null,
            };
          },
        };
        return query;
      },
    }),
  },
}));

const DONO = "lojista-1";
const CHAVE = `products_offline_updates_queue:${DONO}`;
const BASE = "2026-10-16T07:00:00.123456+00:00";

function guardar(stock: number, base = BASE) {
  localStorage.setItem(
    CHAVE,
    JSON.stringify([
      {
        id: "p1",
        productName: "Caneca",
        updates: { stock },
        timestamp: Date.now(),
        baseUpdatedAt: base,
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
  const modulo = await import("@/hooks/useProducts");
  return modulo._syncOfflineUpdatesParaTeste;
}

describe("fila offline de produtos — trava entre abas", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mock.version = BASE;
    mock.payloads = [];
    mock.updates = 0;
    mock.travarEnvio = false;
  });

  afterEach(() => {
    removerLocks();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("duas abas voltando online juntas: só uma envia e a outra sai sem aviso falso", async () => {
    const locks = instalarLocksFalsos();
    const abaA = await abrirAba();
    const abaB = await abrirAba();
    guardar(6);

    const [daA, daB] = await Promise.all([abaA(DONO), abaB(DONO)]);

    expect([daA, daB]).toEqual([true, false]);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
    expect(mock.updates).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    // O lock é do dono da fila e pedido sem esperar (a aba que perde não fica
    // na fila de espera).
    expect(locks.pedidos).toEqual([
      { nome: `ikcous-fila-produtos:${DONO}`, ifAvailable: true },
      { nome: `ikcous-fila-produtos:${DONO}`, ifAvailable: true },
    ]);
  });

  it("outra aba já está sincronizando (lock preso): esta sai sem enviar, sem aviso e sem mexer na fila", async () => {
    const locks = instalarLocksFalsos();
    locks.presos.add(`ikcous-fila-produtos:${DONO}`);
    const aba = await abrirAba();
    guardar(6);
    const antes = localStorage.getItem(CHAVE);

    expect(await aba(DONO)).toBe(false);

    expect(mock.updates).toBe(0);
    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE)).toBe(antes);
  });

  it("o lock é por dono da fila: outro usuário sincronizando não segura este", async () => {
    const locks = instalarLocksFalsos();
    locks.presos.add("ikcous-fila-produtos:outro-lojista");
    const aba = await abrirAba();
    guardar(6);

    expect(await aba(DONO)).toBe(true);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
  });

  it("o lock é solto no fim: uma edição nova, enfileirada depois, sincroniza", async () => {
    const locks = instalarLocksFalsos();
    const aba = await abrirAba();
    guardar(6);
    expect(await aba(DONO)).toBe(true);
    expect(locks.presos.size).toBe(0);

    guardar(4, mock.version);
    expect(await aba(DONO)).toBe(true);
    expect(mock.payloads).toEqual([{ estoque: 6 }, { estoque: 4 }]);
  });

  it("passada travada de vez: o lock vence em 2 minutos e outra aba assume", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const locks = instalarLocksFalsos();
    const abaA = await abrirAba();
    const abaB = await abrirAba();
    guardar(6);
    mock.travarEnvio = true;
    void abaA(DONO); // fica pendurada para sempre
    await vi.advanceTimersByTimeAsync(0);
    expect(locks.presos.size).toBe(1);

    // Dentro do prazo a outra aba continua sem poder.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await abaB(DONO)).toBe(false);
    expect(mock.updates).toBe(1);

    // Passado o prazo o lock é liberado e a outra aba leva a edição.
    mock.travarEnvio = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(locks.presos.size).toBe(0);
    expect(await abaB(DONO)).toBe(true);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
  });

  it("navegador sem navigator.locks: vale a trava do módulo, como antes", async () => {
    removerLocks();
    expect("locks" in navigator).toBe(false);
    const aba = await abrirAba();
    guardar(6);

    const [primeira, segunda] = await Promise.all([aba(DONO), aba(DONO)]);

    expect([primeira, segunda]).toEqual([true, false]);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("navigator.locks que recusa o pedido (origem restrita): a passada roda mesmo assim", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("sem locks aqui", "SecurityError");
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    const aba = await abrirAba();
    guardar(6);

    expect(await aba(DONO)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
  });
});
