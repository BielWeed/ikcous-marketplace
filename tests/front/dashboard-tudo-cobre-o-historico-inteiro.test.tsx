// @vitest-environment jsdom
//
// O botão "Tudo" do gráfico do painel mostrava só 90 dias.
//
// O DEFEITO (auditoria 22/08, achado 7 do lote do dorso): a RPC
// `get_admin_analytics_v2` tem `p_limit_days integer DEFAULT 90`
// (20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql:49) e
// useAnalytics chamava `supabase.rpc("get_admin_analytics_v2")` SEM
// argumento — o "Tudo" de OperationalPerformanceChart exibia o array que
// veio já cortado em 90 dias. Venda feita 4 meses atrás nunca aparecia no
// seletor "Tudo".
//
// Este teste monta o hook de verdade (render React + jsdom, cliente
// Supabase dublê — mesmo precedente de use-analytics-erro-cru-do-banco-
// nao-vaza-no-painel.test.tsx) e cobra que a chamada carregue uma janela
// que cubra o histórico inteiro: p_limit_days MAIOR que 90. Com o
// argumento removido de volta, este teste CAI.

const mockRpc = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos de useAnalytics.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";

type FetchResumo = (forceRefresh?: boolean) => Promise<unknown>;

function SondaResumo({
  aoCapturar,
}: {
  readonly aoCapturar: (fn: FetchResumo) => void;
}) {
  const { fetchExecutiveSummary } = useAnalytics();
  useEffect(() => {
    aoCapturar(fetchExecutiveSummary);
  }, [fetchExecutiveSummary, aoCapturar]);
  return null;
}

describe("fetchExecutiveSummary — a janela cobre o 'Tudo' do gráfico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    clearAnalyticsCache();
    mockRpc.mockReset();
    mockGetSession.mockReset();
    mockRpc.mockResolvedValue({
      data: { today: null, revenueHistory: [] },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("a RPC é chamada com p_limit_days maior que os 90 dias do DEFAULT", async () => {
    const capturada = vi.fn((_metodo: FetchResumo) => {});

    await act(async () => {
      raiz.render(<SondaResumo aoCapturar={capturada} />);
    });
    const metodo = capturada.mock.calls.at(-1)?.[0];
    if (!metodo) throw new Error("A sonda não capturou fetchExecutiveSummary");

    await act(async () => {
      await metodo(true);
    });

    expect(mockRpc).toHaveBeenCalled();
    const chamada = mockRpc.mock.calls.find(
      (c) => c[0] === "get_admin_analytics_v2",
    );
    expect(chamada).toBeDefined();
    // O DEFAULT da RPC é 90: sem argumento, "Tudo" mostra 90 dias. A janela
    // tem de estourar esse teto para o histórico inteiro caber.
    const janela = (chamada?.[1] as { p_limit_days?: number } | undefined)
      ?.p_limit_days;
    expect(typeof janela).toBe("number");
    expect(janela as number).toBeGreaterThan(90);
  });
});
