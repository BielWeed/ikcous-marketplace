// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), put: vi.fn() }));
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
  DataVault: {
    init: async () => ({ getById: async () => null, put: h.put }),
  },
}));

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Resposta = {
  data: unknown;
  error: { message: string; status: number } | null;
};
function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("useAnalytics — ordem das categorias e aviso do resumo em cache", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let analytics: ReturnType<typeof useAnalytics>;

  function Harness() {
    const atual = useAnalytics();
    useEffect(() => {
      analytics = atual;
    }, [atual]);
    return null;
  }

  beforeEach(async () => {
    clearAnalyticsCache();
    h.rpc.mockReset();
    h.put.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Harness />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "resposta antiga não substitui estado, cache, persistência nem broadcast (background=%s)",
    async (background) => {
      const antigo = [{ name: "Antigo", value: 10 }];
      const novo = [{ name: "Novo", value: 20 }];
      if (background) {
        h.rpc.mockResolvedValueOnce({ data: antigo, error: null });
        await act(async () => {
          await analytics.fetchCategoryAnalytics("inicio", "fim", true);
        });
      }
      const a = pendente();
      const b = pendente();
      h.rpc.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
      h.put.mockClear();
      const evento = vi.fn();
      window.addEventListener("ikcous-admin-category-updated", evento);
      try {
        let chamadaA!: Promise<unknown>;
        let chamadaB!: Promise<unknown>;
        await act(async () => {
          chamadaA = analytics.fetchCategoryAnalytics("a", "fim", !background);
        });
        await act(async () => {
          chamadaB = analytics.fetchCategoryAnalytics("b", "fim", true);
        });
        await act(async () => {
          b.resolver({ data: novo, error: null });
          await chamadaB;
        });
        await act(async () => {
          a.resolver({ data: antigo, error: null });
          await chamadaA;
        });
        expect(analytics.categoryData).toEqual(novo);
        expect(evento).toHaveBeenCalledTimes(1);
        expect(h.put).toHaveBeenCalledTimes(1);
        expect(h.put).toHaveBeenLastCalledWith("store_config", {
          id: "admin_category_data",
          data: novo,
        });
        const chamadas = h.rpc.mock.calls.length;
        await act(async () => {
          expect(await analytics.fetchCategoryAnalytics("b", "fim")).toEqual(
            novo,
          );
        });
        expect(h.rpc).toHaveBeenCalledTimes(chamadas);
      } finally {
        window.removeEventListener("ikcous-admin-category-updated", evento);
      }
    },
  );

  it("erro antigo não apaga o sucesso nem desliga o carregamento da consulta atual", async () => {
    const a = pendente();
    const b = pendente();
    h.rpc.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
    let chamadaA!: Promise<unknown>;
    let chamadaB!: Promise<unknown>;
    await act(async () => {
      chamadaA = analytics.fetchCategoryAnalytics("a", "fim", true);
    });
    await act(async () => {
      chamadaB = analytics.fetchCategoryAnalytics("b", "fim", true);
    });
    await act(async () => {
      a.resolver({
        data: null,
        error: { message: "Falha antiga", status: 403 },
      });
      await chamadaA;
    });
    expect(analytics.categoryError).toBeNull();
    expect(analytics.loading).toBe(true);
    await act(async () => {
      b.resolver({ data: [{ name: "Novo", value: 20 }], error: null });
      await chamadaB;
    });
    expect(analytics.loading).toBe(false);
  });

  it("avisa a falha devolvida pela RPC ao revalidar resumo vencido e preserva os números", async () => {
    const resumo = { totalRevenue: 123 };
    h.rpc.mockResolvedValueOnce({ data: resumo, error: null });
    await act(async () => {
      await analytics.fetchExecutiveSummary(true);
    });
    const agora = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(agora + 31_000);
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "RPC indisponível", status: 403 },
    });
    await act(async () => {
      expect(await analytics.fetchExecutiveSummary(false)).toEqual(resumo);
    });
    expect(analytics.stats).toEqual(resumo);
    expect(analytics.error).toBe(
      "Não foi possível atualizar agora — exibindo a última atualização.",
    );
    h.rpc.mockResolvedValueOnce({ data: resumo, error: null });
    await act(async () => {
      await analytics.fetchExecutiveSummary(false);
    });
    expect(analytics.error).toBeNull();
  });
});
