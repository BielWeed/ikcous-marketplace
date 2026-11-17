// @vitest-environment jsdom
//
// LIMPAR O CACHE NO MEIO DA PRIMEIRA CONSULTA NÃO PODE DEIXAR A TELA PARADA.
// `clearAnalyticsCache` faz a resposta que estava em voo ser descartada (ela é
// anterior à limpeza). Dois defeitos nasciam daí quando não havia dado em cache:
//  - categorias: o "carregando" só desligava se a consulta NÃO tivesse ficado
//    atrasada; a limpeza a deixava atrasada sem haver consulta mais nova, e o
//    carregando ficava ligado para sempre;
//  - resumo: a resposta descartada não provocava nova leitura e `stats`
//    seguia nulo -- o efeito de Produtos/Clientes, que depende de `stats`, não
//    rodava de novo e o KPI ficava vazio. Agora lê UMA vez.
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

// Dá a vez a microtarefas e timers curtos: prova que NENHUMA leitura a mais sai.
const esperar = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("useAnalytics — limpeza com a primeira consulta em andamento", () => {
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

  it("categorias: resposta descartada pela limpeza desliga o carregando", async () => {
    const consulta = pendente();
    h.rpc.mockReturnValueOnce(consulta.promessa);
    let chamada!: Promise<unknown>;
    await act(async () => {
      chamada = analytics.fetchCategoryAnalytics("inicio", "fim");
    });
    expect(analytics.loading).toBe(true);

    clearAnalyticsCache();
    await act(async () => {
      consulta.resolver({ data: [{ name: "Antigo", value: 10 }], error: null });
      await chamada;
    });

    expect(analytics.categoryData).toBeNull();
    expect(analytics.loading).toBe(false);
  });

  it("categorias: duas consultas em voo -- a mais antiga ao terminar NÃO desliga o carregando", async () => {
    const antiga = pendente();
    const recente = pendente();
    h.rpc
      .mockReturnValueOnce(antiga.promessa)
      .mockReturnValueOnce(recente.promessa);
    let chamadaAntiga!: Promise<unknown>;
    let chamadaRecente!: Promise<unknown>;
    await act(async () => {
      chamadaAntiga = analytics.fetchCategoryAnalytics("inicio", "fim");
    });
    await act(async () => {
      chamadaRecente = analytics.fetchCategoryAnalytics("inicio", "fim", true);
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      antiga.resolver({ data: [{ name: "Antiga", value: 1 }], error: null });
      await chamadaAntiga;
    });
    expect(analytics.loading).toBe(true);

    await act(async () => {
      recente.resolver({ data: [{ name: "Recente", value: 2 }], error: null });
      await chamadaRecente;
    });
    expect(analytics.loading).toBe(false);
    expect(analytics.categoryData).toEqual([{ name: "Recente", value: 2 }]);
  });

  it("resumo: resposta descartada pela limpeza, sem cache, lê de novo UMA vez e entrega o dado novo", async () => {
    const consulta = pendente();
    const novo = { totalRevenue: 20 };
    h.rpc
      .mockReturnValueOnce(consulta.promessa)
      .mockResolvedValueOnce({ data: novo, error: null });
    let chamada!: Promise<unknown>;
    await act(async () => {
      chamada = analytics.fetchExecutiveSummary(false);
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);

    clearAnalyticsCache();
    let resultado: unknown;
    await act(async () => {
      consulta.resolver({ data: { totalRevenue: 10 }, error: null });
      resultado = await chamada;
    });

    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(resultado).toEqual(novo);
    expect(analytics.stats).toEqual(novo);
    expect(analytics.loading).toBe(false);
  });

  it("resumo: a releitura também é varrida pela limpeza -- não lê uma terceira vez", async () => {
    const primeira = pendente();
    const releitura = pendente();
    h.rpc
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(releitura.promessa);
    let chamada!: Promise<unknown>;
    await act(async () => {
      chamada = analytics.fetchExecutiveSummary(false);
    });

    clearAnalyticsCache();
    await act(async () => {
      primeira.resolver({ data: { totalRevenue: 10 }, error: null });
      await esperar();
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);

    clearAnalyticsCache();
    await act(async () => {
      releitura.resolver({ data: { totalRevenue: 15 }, error: null });
      await chamada;
      await esperar();
    });

    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(analytics.stats).toBeNull();
  });

  it("resumo: se já existe consulta mais nova depois da limpeza, a descartada NÃO lê de novo", async () => {
    const consulta = pendente();
    const maisNova = pendente();
    h.rpc
      .mockReturnValueOnce(consulta.promessa)
      .mockReturnValueOnce(maisNova.promessa);
    let chamada!: Promise<unknown>;
    let chamadaNova!: Promise<unknown>;
    await act(async () => {
      chamada = analytics.fetchExecutiveSummary(false);
    });

    clearAnalyticsCache();
    await act(async () => {
      chamadaNova = analytics.fetchExecutiveSummary(true);
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      consulta.resolver({ data: { totalRevenue: 10 }, error: null });
      await chamada;
      await esperar();
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      maisNova.resolver({ data: { totalRevenue: 30 }, error: null });
      await chamadaNova;
    });
    expect(analytics.stats).toEqual({ totalRevenue: 30 });
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });
});
