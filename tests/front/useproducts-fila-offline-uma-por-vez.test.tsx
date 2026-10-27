// @vitest-environment jsdom
//
// Caça 9, item 9 — ao voltar a rede, VÁRIOS `useProducts` montados (um por
// tela do painel) disparam a mesma sincronização da fila offline quase juntos.
// Sem trava, todos leem a mesma fila antes de qualquer um gravar: o primeiro
// grava e muda a versão do produto no servidor, os outros chegam com a versão
// velha, recebem 0 linhas e a lojista via o aviso falso "sua edição offline não
// foi aplicada" — para uma edição que FOI aplicada. A trava é do módulo: só uma
// sincronização por dono da fila roda por vez; as outras saem sem avisar.
import { _syncOfflineUpdatesParaTeste } from "@/hooks/useProducts";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  version: "2026-10-16T07:00:00.123456+00:00",
  payloads: [] as Record<string, unknown>[],
  updates: 0,
  error: null as null | { message: string },
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
        // O UPDATE só altera a linha se a versão-base ainda é a do servidor;
        // quem chega com a versão velha recebe 0 linhas (como no banco real).
        const query = {
          eq: (column: string, value: unknown) => {
            filters.set(column, value);
            return query;
          },
          is: () => query,
          select: async () => {
            mock.updates += 1;
            if (mock.travarEnvio) return new Promise<never>(() => {});
            if (mock.error) return { data: null, error: mock.error };
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

function item(id: string, updates: Record<string, unknown>, base = BASE) {
  return {
    id,
    productName: "Caneca",
    updates,
    timestamp: Date.now(),
    baseUpdatedAt: base,
  };
}

function guardar(...itens: ReturnType<typeof item>[]) {
  localStorage.setItem(CHAVE, JSON.stringify(itens));
}

describe("fila offline de produtos — uma sincronização por vez", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mock.version = BASE;
    mock.payloads = [];
    mock.updates = 0;
    mock.error = null;
    mock.travarEnvio = false;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("duas telas sincronizando juntas: a edição vai UMA vez e ninguém recebe aviso falso", async () => {
    guardar(item("p1", { stock: 6 }));

    const [primeira, segunda, terceira] = await Promise.all([
      _syncOfflineUpdatesParaTeste(DONO),
      _syncOfflineUpdatesParaTeste(DONO),
      _syncOfflineUpdatesParaTeste(DONO),
    ]);

    expect([primeira, segunda, terceira]).toEqual([true, false, false]);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
    // Um único envio ao servidor: as outras duas nem tentaram.
    expect(mock.updates).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("a trava solta no fim: uma edição nova, enfileirada depois, sincroniza", async () => {
    guardar(item("p1", { stock: 6 }));
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(true);

    guardar(item("p1", { stock: 4 }, mock.version));
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(true);
    expect(mock.payloads).toEqual([{ estoque: 6 }, { estoque: 4 }]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a trava solta mesmo quando o envio falha: a edição fica na fila e a próxima tentativa roda", async () => {
    guardar(item("p1", { stock: 6 }));
    mock.error = { message: "Failed to fetch" };
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(false);
    expect(localStorage.getItem(CHAVE)).not.toBeNull();

    mock.error = null;
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(true);
    expect(mock.payloads).toEqual([{ estoque: 6 }]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("fila vazia ou ausente: sai sem trancar nada", async () => {
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(false);
    guardar(item("p1", { stock: 6 }));
    expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(true);
  });

  it("passada travada de vez (rede que nunca responde) não impede a fila para sempre: a trava vence em 2 minutos", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      guardar(item("p1", { stock: 6 }));
      mock.travarEnvio = true;
      void _syncOfflineUpdatesParaTeste(DONO); // fica pendurada para sempre
      await Promise.resolve();
      await Promise.resolve();

      // Dentro do prazo, quem chega ainda sai sem fazer nada.
      vi.setSystemTime(Date.now() + 60_000);
      expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(false);
      expect(mock.updates).toBe(1);

      // Passado o prazo, uma nova passada assume e leva a edição.
      mock.travarEnvio = false;
      vi.setSystemTime(Date.now() + 61_000);
      expect(await _syncOfflineUpdatesParaTeste(DONO)).toBe(true);
      expect(mock.payloads).toEqual([{ estoque: 6 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o aviso de andamento fala no singular com 1 edição e no plural com 2", async () => {
    guardar(item("p1", { stock: 6 }));
    await _syncOfflineUpdatesParaTeste(DONO);
    expect(toast.loading).toHaveBeenLastCalledWith(
      "Sincronizando 1 atualização pendente offline...",
    );

    mock.version = BASE;
    guardar(item("p1", { stock: 6 }), item("p2", { stock: 3 }));
    await _syncOfflineUpdatesParaTeste(DONO);
    expect(toast.loading).toHaveBeenLastCalledWith(
      "Sincronizando 2 atualizações pendentes offline...",
    );
  });
});
