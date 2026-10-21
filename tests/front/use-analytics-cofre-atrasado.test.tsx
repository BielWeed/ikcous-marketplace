// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), getById: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin" } } },
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ getById: h.getById, put: h.put }) },
}));

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("categorias — hidratação do cofre atrasada", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let analytics: ReturnType<typeof useAnalytics>;
  function Sonda() {
    const atual = useAnalytics();
    useEffect(() => {
      analytics = atual;
    });
    return null;
  }

  beforeEach(() => {
    clearAnalyticsCache();
    vi.clearAllMocks();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  it("o resultado novo da RPC vence o cofre no estado, cache e broadcast", async () => {
    const antigo = [{ name: "Antigo", value: 10 }];
    const novo = [{ name: "Novo", value: 20 }];
    let liberar!: (valor: unknown) => void;
    const leitura = new Promise((resolve) => {
      liberar = resolve;
    });
    h.getById.mockImplementation((_tabela, id) =>
      id === "admin_category_data" ? leitura : Promise.resolve(null),
    );
    h.rpc.mockResolvedValue({ data: novo, error: null });
    const evento = vi.fn();
    window.addEventListener("ikcous-admin-category-updated", evento);
    try {
      await act(async () => raiz.render(<Sonda />));
      expect(h.getById).toHaveBeenCalledWith(
        "store_config",
        "admin_category_data",
      );
      await act(async () => {
        await analytics.fetchCategoryAnalytics("inicio", "fim", true);
      });
      expect(analytics.categoryData).toEqual(novo);
      await act(async () => {
        liberar({ data: antigo });
        await leitura;
      });
      expect(analytics.categoryData).toEqual(novo);
      expect(evento).toHaveBeenCalledTimes(1);
      expect(evento.mock.calls[0][0].detail).toEqual(novo);
      const chamadas = h.rpc.mock.calls.length;
      await act(async () => {
        expect(await analytics.fetchCategoryAnalytics("inicio", "fim")).toEqual(
          novo,
        );
      });
      expect(h.rpc).toHaveBeenCalledTimes(chamadas);
      expect(h.put).toHaveBeenLastCalledWith("store_config", {
        id: "admin_category_data",
        data: novo,
      });
    } finally {
      window.removeEventListener("ikcous-admin-category-updated", evento);
    }
  });
});
