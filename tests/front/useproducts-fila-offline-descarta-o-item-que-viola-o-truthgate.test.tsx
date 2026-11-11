// @vitest-environment jsdom
import { _syncOfflineUpdatesParaTeste } from "@/hooks/useProducts";
import type { Product } from "@/types";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fila offline vive no localStorage: pode ter sido adulterada, ou ser de uma
// versão antiga, entre o enfileiramento e o reenvio. Ao reenviar, o item é
// conferido de novo pelo TruthGate; se violar (estoque negativo, acima de
// 10.000, preço inválido) NÃO vai ao banco, NÃO volta para a fila e o lojista é
// avisado. Cada cenário mistura um item inválido com um válido: o válido tem
// de seguir (a violação de um não trava a fila inteira).

const mock = vi.hoisted(() => ({
  // Um registro por UPDATE que chegou ao banco: o id vem do `.eq("id", ...)`.
  envios: [] as { id: unknown; payload: Record<string, unknown> }[],
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
        const filtros = new Map<string, unknown>();
        const query = {
          eq: (coluna: string, valor: unknown) => {
            filtros.set(coluna, valor);
            return query;
          },
          is: () => query,
          select: async () => {
            mock.envios.push({ id: filtros.get("id"), payload });
            return {
              data: [{ id: filtros.get("id"), ultima_atualizacao: BASE }],
              error: null,
            };
          },
        };
        return query;
      },
    }),
  },
}));

const CHAVE = "products_offline_updates_queue:lojista-1";
const BASE = "2026-10-16T07:00:00.123456+00:00";

function item(id: string, nome: string, updates: Partial<Product>) {
  return {
    id,
    productName: nome,
    updates,
    timestamp: Date.now(),
    baseUpdatedAt: BASE,
  };
}

function guardarFila(...itens: ReturnType<typeof item>[]) {
  localStorage.setItem(CHAVE, JSON.stringify(itens));
}

const AVISO_DE_DESCARTE =
  "1 alteração feita sem internet foi descartada porque o produto não aceita esses valores (por exemplo, preço ou estoque inválido). Confira o produto.";

describe("fila offline de produtos — item que viola o TruthGate", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mock.envios = [];
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    { motivo: "estoque acima de 10.000", updates: { stock: 10001 } },
    { motivo: "estoque negativo", updates: { stock: -5 } },
    { motivo: "preço negativo", updates: { price: -10 } },
    {
      motivo: "preço que não é número",
      updates: { price: null as unknown as number },
    },
  ])(
    "descarta o item com $motivo: não vai ao banco, sai da fila e avisa; o válido segue",
    async ({ updates }) => {
      guardarFila(
        item("produto-invalido", "Caneca Torta", updates),
        item("produto-valido", "Caneca Reta", { stock: 6, price: 35 }),
      );

      expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);

      // Só o válido chegou ao banco, e com o valor dele.
      expect(mock.envios).toEqual([
        { id: "produto-valido", payload: { estoque: 6, preco_venda: 35 } },
      ]);
      expect(mock.envios.map((e) => e.id)).not.toContain("produto-invalido");

      // O inválido não volta para a fila (nem o válido, que foi enviado).
      expect(localStorage.getItem(CHAVE)).toBeNull();

      // O lojista é avisado do descarte; nada de "sincronizado com sucesso".
      expect(toast.warning).toHaveBeenCalledWith(AVISO_DE_DESCARTE);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("fila só com item inválido: nada vai ao banco, a fila é apagada e o aviso sai", async () => {
    guardarFila(item("produto-invalido", "Caneca Torta", { stock: 10001 }));

    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(false);

    expect(mock.envios).toEqual([]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(AVISO_DE_DESCARTE);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("dois itens inválidos: o aviso fala no plural", async () => {
    guardarFila(
      item("p-a", "Caneca A", { stock: -1 }),
      item("p-b", "Caneca B", { price: -1 }),
    );

    await _syncOfflineUpdatesParaTeste("lojista-1");

    expect(mock.envios).toEqual([]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(
      "2 alterações feitas sem internet foram descartadas porque o produto não aceita esses valores (por exemplo, preço ou estoque inválido). Confira o produto.",
    );
  });
});
