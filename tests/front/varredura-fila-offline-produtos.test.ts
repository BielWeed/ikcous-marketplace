// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `syncOfflineUpdates` (useProducts) lê a
// fila do localStorage UMA vez, envia item por item (cada um com `await`) e
// no fim grava `remainingQueue` ou apaga a chave. Se a conexão cai no meio do
// sync e o lojista edita outro produto nessa janela, a edição entra na fila
// (caminho offline do `updateProduct`) e o fim do sync a apaga: alteração do
// lojista perdida em silêncio. A fila de pedidos já relê a fila fresca
// (`mesclarFilaOfflineAposPassada`); esta é a mesma regra para produtos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "products_offline_updates_queue:lojista-1";

const { liberarUpdate, updates } = vi.hoisted(() => ({
  liberarUpdate: { fn: null as null | (() => void) },
  updates: [] as { id: string; payload: unknown }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => ({
        eq: (_col: string, id: string) => {
          // Fila: .eq(id).eq(versao).is(deleted_at).select(id).
          const encadeado = {
            eq: () => encadeado,
            is: () => encadeado,
            select: () =>
              new Promise((resolve) => {
                updates.push({ id, payload });
                liberarUpdate.fn = () =>
                  resolve({ data: [{ id }], error: null });
              }),
          };
          return encadeado;
        },
      }),
    }),
    rpc: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "t"),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("fila offline de produtos — edição feita DURANTE o sync não se perde", () => {
  beforeEach(() => {
    updates.length = 0;
    liberarUpdate.fn = null;
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("item enfileirado enquanto o sync espera o servidor continua na fila", async () => {
    const { _syncOfflineUpdatesParaTeste } = await import(
      "@/hooks/useProducts"
    );
    localStorage.setItem(
      CHAVE,
      JSON.stringify([
        {
          id: "p1",
          updates: { name: "A" },
          baseUpdatedAt: "2026-10-01T10:00:00.000000+00:00",
          timestamp: Date.now(),
        },
      ]),
    );

    const sync = _syncOfflineUpdatesParaTeste("lojista-1");
    // O sync está no await do UPDATE do p1: a conexão oscilou e o lojista
    // editou o p2, que foi para a fila.
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    const fila = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    fila.push({
      id: "p2",
      updates: { name: "B" },
      baseUpdatedAt: "2026-10-01T10:00:00.000000+00:00",
      timestamp: Date.now() + 1,
    });
    localStorage.setItem(CHAVE, JSON.stringify(fila));

    liberarUpdate.fn?.();
    await sync;

    const final = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    expect(final.map((i: { id: string }) => i.id)).toEqual(["p2"]);
  });

  it("sem edição nova, a fila é esvaziada como sempre", async () => {
    const { _syncOfflineUpdatesParaTeste } = await import(
      "@/hooks/useProducts"
    );
    localStorage.setItem(
      CHAVE,
      JSON.stringify([
        {
          id: "p1",
          updates: { name: "A" },
          baseUpdatedAt: "2026-10-01T10:00:00.000000+00:00",
          timestamp: Date.now(),
        },
      ]),
    );
    const sync = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    liberarUpdate.fn?.();
    await sync;
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });
});
