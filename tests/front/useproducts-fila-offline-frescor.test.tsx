// @vitest-environment jsdom
import { _syncOfflineUpdatesParaTeste, useProducts } from "@/hooks/useProducts";
import type { Product } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  products: [] as Product[],
  version: "2026-10-16T07:00:00.123456+00:00",
  payloads: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][],
  error: null as null | { message: string },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: mock.products,
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
        // O UPDATE só altera a linha se TODAS as condições casarem. Mudar
        // mock.version antes do envio simula outra aba salvando no servidor.
        const query = {
          eq: (column: string, value: unknown) => {
            filters.set(column, value);
            mock.filters.push([column, value]);
            return query;
          },
          is: (column: string, value: unknown) => {
            filters.set(column, value);
            return query;
          },
          select: async () => {
            if (mock.error) return { data: null, error: mock.error };
            if (filters.get("ultima_atualizacao") !== mock.version) {
              return { data: [], error: null };
            }
            mock.payloads.push(payload);
            mock.version = "2026-10-16T08:00:00+00:00";
            return { data: [{ id: "p1" }], error: null };
          },
        };
        return query;
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "products_offline_updates_queue:lojista-1";
const BASE = "2026-10-16T07:00:00.123456+00:00";
type Api = ReturnType<typeof useProducts>;

function Sonda({ ready }: { ready: (api: Api) => void }) {
  const api = useProducts();
  useEffect(() => ready(api));
  return null;
}

function guardar(updates: Partial<Product>) {
  localStorage.setItem(
    CHAVE,
    JSON.stringify([
      {
        id: "p1",
        productName: "Caneca",
        updates,
        timestamp: Date.now(),
        baseUpdatedAt: BASE,
      },
    ]),
  );
}

describe("fila offline de produtos — frescor e medidas", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mock.version = BASE;
    mock.payloads = [];
    mock.filters = [];
    mock.error = null;
    mock.products = [
      {
        id: "p1",
        name: "Caneca",
        price: 30,
        stock: 8,
        description: "",
        category: "Casa",
        images: [],
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: BASE,
        updatedAt: BASE,
      },
    ];
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("grava estoque e preço só com a versão-base no próprio UPDATE", async () => {
    guardar({ stock: 6, price: 35 });
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);
    expect(mock.filters).toContainEqual(["ultima_atualizacao", BASE]);
    expect(mock.payloads).toEqual([{ estoque: 6, preco_venda: 35 }]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("descarta edição antiga quando outra aba já mudou a versão", async () => {
    guardar({ stock: 6, price: 35 });
    mock.version = "2026-10-16T07:01:00+00:00";
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(false);
    expect(mock.payloads).toEqual([]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(
      "O produto Caneca foi alterado em outro lugar; sua edição offline não foi aplicada.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("item legado sem versão não sobrescreve e sai da fila com aviso", async () => {
    guardar({ stock: 6 });
    const [item] = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    delete item.baseUpdatedAt;
    localStorage.setItem(CHAVE, JSON.stringify([item]));
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(false);
    expect(mock.payloads).toEqual([]);
    expect(mock.filters).toEqual([]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("não foi possível confirmar a versão original"),
    );
  });

  it("falha de rede mantém a edição e a versão-base para tentar de novo", async () => {
    guardar({ stock: 6 });
    const antes = localStorage.getItem(CHAVE);
    mock.error = { message: "Failed to fetch" };
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(false);
    expect(localStorage.getItem(CHAVE)).toBe(antes);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it.each([
    { weightKg: 0.5, widthCm: 12, heightCm: 10, lengthCm: 15 },
    { weightKg: null, widthCm: null, heightCm: null, lengthCm: null },
    { weightKg: 0, widthCm: 0, heightCm: 0, lengthCm: 0 },
  ])(
    "leva peso e medidas ao servidor sem perder zero ou null: %j",
    async (updates) => {
      guardar(updates);
      await _syncOfflineUpdatesParaTeste("lojista-1");
      expect(mock.payloads).toEqual([
        {
          peso_kg: updates.weightKg,
          largura_cm: updates.widthCm,
          altura_cm: updates.heightCm,
          comprimento_cm: updates.lengthCm,
        },
      ]);
    },
  );

  it("enfileira a versão original sem arredondar e a conserva ao reeditar", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let api: Api | undefined;
    const root = createRoot(document.createElement("div"));
    const ready = (value: Api) => {
      api = value;
    };
    try {
      await act(async () => root.render(<Sonda ready={ready} />));
      await act(async () => {
        await api?.updateProduct("p1", { stock: 6, weightKg: 0.5 });
      });
      // Mesmo se a tela ganhar outro snapshot, a edição pendente ainda nasceu
      // sobre BASE; a fusão não pode adotar uma versão mais recente.
      mock.products = mock.products.map((p) => ({
        ...p,
        updatedAt: "2026-10-16T07:01:00+00:00",
      }));
      await act(async () => root.render(<Sonda ready={ready} />));
      await act(async () => {
        await api?.updateProduct("p1", { price: 35, widthCm: 12 });
      });
      expect(JSON.parse(localStorage.getItem(CHAVE) ?? "[]")).toEqual([
        expect.objectContaining({
          baseUpdatedAt: BASE,
          productName: "Caneca",
          updates: { stock: 6, weightKg: 0.5, price: 35, widthCm: 12 },
        }),
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
