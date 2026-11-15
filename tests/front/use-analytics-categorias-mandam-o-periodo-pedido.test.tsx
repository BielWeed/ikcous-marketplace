// @vitest-environment jsdom
//
// Categorias do painel: a consulta ao banco leva o período que a lojista
// escolheu, com o começo como começo e o fim como fim. Se o fim virar o
// começo, o painel pede "um dia só" e mostra categorias de um período que
// ninguém escolheu, sem erro nenhum.
//
// O vizinho `use-analytics-respostas-atrasadas` entrega respostas por
// sequência e não olha os argumentos da consulta.
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

describe("useAnalytics: a consulta de categorias leva o período pedido", () => {
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

  const categorias = [{ name: "Camisetas", value: 10 }];

  it("primeiro plano (sem cache): start_date é o começo e end_date é o fim", async () => {
    h.rpc.mockResolvedValueOnce({ data: categorias, error: null });
    await act(async () => {
      await analytics.fetchCategoryAnalytics("2026-10-01", "2026-10-31");
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_category_analytics", {
      start_date: "2026-10-01",
      end_date: "2026-10-31",
    });
  });

  it("segundo plano (com cache de outro período): a revalidação leva o NOVO começo e o NOVO fim", async () => {
    // Enche o cache com um período; a chamada seguinte, de outro período e sem
    // forçar, devolve o cache na hora e revalida por baixo dos panos.
    h.rpc.mockResolvedValueOnce({ data: categorias, error: null });
    await act(async () => {
      await analytics.fetchCategoryAnalytics("2026-09-01", "2026-09-30", true);
    });
    h.rpc.mockClear();

    h.rpc.mockResolvedValueOnce({
      data: [{ name: "Bonés", value: 20 }],
      error: null,
    });
    await act(async () => {
      expect(
        await analytics.fetchCategoryAnalytics("2026-10-01", "2026-10-31"),
      ).toEqual(categorias); // o cache velho volta na hora: é o caminho de fundo
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_category_analytics", {
      start_date: "2026-10-01",
      end_date: "2026-10-31",
    });
  });
});
