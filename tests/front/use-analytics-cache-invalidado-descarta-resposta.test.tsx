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

function pendente() {
  let resolver!: (resposta: { data: unknown; error: null }) => void;
  const promessa = new Promise<{ data: unknown; error: null }>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("useAnalytics — invalidação com consulta em andamento", () => {
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

  // "resumo" sem cache em segundo plano (consulta bloqueante) não está aqui: a
  // resposta descartada pela limpeza agora provoca UMA releitura, coberta em
  // use-analytics-limpeza-nao-deixa-a-tela-sem-leitura.test.tsx.
  it.each([
    ["resumo", true],
    ["categorias", false],
    ["categorias", true],
  ] as const)(
    "descarta resposta anterior à limpeza e busca de novo (%s, background=%s)",
    async (tipo, background) => {
      const categorias = tipo === "categorias";
      const anterior = categorias
        ? [{ name: "Anterior", value: 5 }]
        : { totalRevenue: 5 };
      const antigo = categorias
        ? [{ name: "Antigo", value: 10 }]
        : { totalRevenue: 10 };
      const novo = categorias
        ? [{ name: "Novo", value: 20 }]
        : { totalRevenue: 20 };
      const buscar = (forcar = false) =>
        categorias
          ? analytics.fetchCategoryAnalytics("inicio", "fim", forcar)
          : analytics.fetchExecutiveSummary(forcar);
      const estado = () =>
        categorias ? analytics.categoryData : analytics.stats;

      if (background) {
        h.rpc.mockResolvedValueOnce({ data: anterior, error: null });
        await act(async () => {
          await buscar(true);
        });
        const agora = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(agora + 31_000);
      }

      const consulta = pendente();
      h.rpc.mockReturnValueOnce(consulta.promessa);
      h.put.mockClear();
      const evento = vi.fn();
      const nomeEvento = categorias
        ? "ikcous-admin-category-updated"
        : "ikcous-admin-stats-updated";
      window.addEventListener(nomeEvento, evento);
      try {
        let chamada!: Promise<unknown>;
        await act(async () => {
          chamada = buscar();
        });
        expect(h.rpc).toHaveBeenCalledTimes(background ? 2 : 1);
        clearAnalyticsCache();
        await act(async () => {
          consulta.resolver({ data: antigo, error: null });
          await chamada;
        });

        expect(estado()).toEqual(background ? anterior : null);
        expect(evento).not.toHaveBeenCalled();
        expect(h.put).not.toHaveBeenCalled();

        const chamadas = h.rpc.mock.calls.length;
        h.rpc.mockResolvedValueOnce({ data: novo, error: null });
        await act(async () => {
          expect(await buscar()).toEqual(novo);
        });
        expect(h.rpc).toHaveBeenCalledTimes(chamadas + 1);
        expect(estado()).toEqual(novo);
      } finally {
        window.removeEventListener(nomeEvento, evento);
      }
    },
  );
});
