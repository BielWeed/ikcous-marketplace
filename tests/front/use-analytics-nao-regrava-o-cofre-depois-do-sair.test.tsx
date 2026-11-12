// @vitest-environment jsdom
//
// A CONSULTA DO PAINEL EM VOO NÃO REGRAVA O RESUMO DE VENDAS NO COFRE DEPOIS
// DO "SAIR" (caça r136, território relatórios-do-painel, achado 1).
//
// O DEFEITO: o "Sair" apaga do cofre local (IndexedDB) as linhas
// `store_config/admin_dashboard_stats` (faturamento, lucro, custo do estoque,
// mais vendidos) e `store_config/admin_category_data` por
// `esquecerCofreDeQuemSaiu`, que também sobe a geração do cofre
// (`invalidarGravacoesEmVoo`). O motor de sincronização compara a geração
// antes de gravar; `useAnalytics` não comparava: uma consulta
// `get_admin_analytics_v2` / `get_category_analytics` que estava a caminho no
// Sair terminava DEPOIS da limpeza e gravava o resumo de volta no aparelho
// (tablet de balcão compartilhado, legível no DevTools).
//
// O CONSERTO: a consulta anota a geração quando nasce e, antes de cada
// `vault.put`, confere; mudou => descarta a gravação (mesmo contador do motor).
//
// Os quatro pontos de gravação, cada um com o seu caso:
//   1. resumo, caminho direto;   2. resumo, revalidação em segundo plano;
//   3. categorias, caminho direto; 4. categorias, revalidação em segundo plano.
// Controles: sem Sair no meio, a gravação acontece como sempre.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Pendente = { nome: string; responder: (dados: unknown) => void };
  const estado = {
    pendentes: [] as Pendente[],
    gavetas: new Map<string, Map<string, unknown>>(),
    rpc: vi.fn(),
    put: vi.fn(),
    deleteById: vi.fn(),
    clear: vi.fn(),
    getById: vi.fn(),
  };
  return estado;
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin-fixture" } } },
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      put: h.put,
      deleteById: h.deleteById,
      clear: h.clear,
      getById: h.getById,
    }),
  },
}));

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";
import { esquecerCofreDeQuemSaiu } from "@/lib/cofre-de-quem-saiu";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RESUMO_V1 = { executive: { totalRevenue: 111 }, topProducts: [] };
const RESUMO_V2 = { executive: { totalRevenue: 222 }, topProducts: [] };
const CATEGORIAS_V1 = [{ name: "Verão", value: 10 }];
const CATEGORIAS_V2 = [{ name: "Inverno", value: 20 }];

/** Deixa as promessas já resolvidas correrem até o próximo ponto de espera. */
const soltar = () => new Promise((resolve) => setTimeout(resolve, 0));

/** O cofre guardado agora (o que o DevTools do tablet enxergaria). */
function linhaDoCofre(id: string): unknown {
  return h.gavetas.get("store_config")?.get(id);
}

function gravouNoCofre(id: string): boolean {
  return h.put.mock.calls.some(
    ([gaveta, linha]) => gaveta === "store_config" && linha?.id === id,
  );
}

describe("useAnalytics — consulta em voo não regrava o cofre depois do Sair", () => {
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

  /** Espera a RPC nº `n` (1-based) ter sido chamada, e a devolve. */
  async function rpcChamada(n: number) {
    await vi.waitFor(() =>
      expect(h.pendentes.length).toBeGreaterThanOrEqual(n),
    );
    return h.pendentes[n - 1];
  }

  /** O "Sair" de lojista: apaga as duas linhas do resumo e sobe a geração. */
  async function sairDeLojista() {
    esquecerCofreDeQuemSaiu(true);
    await vi.waitFor(() => expect(h.deleteById).toHaveBeenCalledTimes(2));
    await soltar();
  }

  /** Move o relógio além da vida do cache (30 s): a próxima chamada revalida. */
  function envelhecerOCache() {
    const agora = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(agora + 31_000);
  }

  beforeEach(() => {
    clearAnalyticsCache();
    vi.clearAllMocks();
    h.pendentes.length = 0;
    h.gavetas.clear();
    h.gavetas.set(
      "store_config",
      new Map<string, unknown>([["singleton", { nomeDaLoja: "Loja pública" }]]),
    );
    h.getById.mockResolvedValue(undefined);
    h.rpc.mockImplementation(
      (nome: string) =>
        new Promise((resolve) => {
          h.pendentes.push({
            nome,
            responder: (dados) => resolve({ data: dados, error: null }),
          });
        }),
    );
    h.put.mockImplementation(async (gaveta: string, linha: { id: string }) => {
      h.gavetas.get(gaveta)?.set(linha.id, linha);
    });
    h.deleteById.mockImplementation(async (gaveta: string, id: string) => {
      h.gavetas.get(gaveta)?.delete(id);
    });
    h.clear.mockResolvedValue(undefined);
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => raiz.unmount());
    alvo.remove();
  });

  async function montar() {
    await act(async () => raiz.render(<Sonda />));
  }

  // ---------------------------------------------------------------- controles

  it("controle — resumo SEM Sair no meio: a gravação acontece como sempre", async () => {
    await montar();
    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchExecutiveSummary(true);
      (await rpcChamada(1)).responder(RESUMO_V1);
      await consulta;
    });
    await soltar();

    expect(gravouNoCofre("admin_dashboard_stats")).toBe(true);
    expect(linhaDoCofre("admin_dashboard_stats")).toEqual({
      id: "admin_dashboard_stats",
      data: RESUMO_V1,
    });
  });

  it("controle — categorias SEM Sair no meio: a gravação acontece como sempre", async () => {
    await montar();
    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchCategoryAnalytics("inicio", "fim", true);
      (await rpcChamada(1)).responder(CATEGORIAS_V1);
      await consulta;
    });
    await soltar();

    expect(linhaDoCofre("admin_category_data")).toEqual({
      id: "admin_category_data",
      data: CATEGORIAS_V1,
    });
  });

  it("controle — Sair ANTES de a consulta nascer: a consulta nova grava normalmente", async () => {
    await montar();
    await sairDeLojista();

    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchExecutiveSummary(true);
      (await rpcChamada(1)).responder(RESUMO_V1);
      await consulta;
    });
    await soltar();

    // A sessão seguinte (consulta nascida na geração nova) não é descartada.
    expect(gravouNoCofre("admin_dashboard_stats")).toBe(true);
  });

  // ------------------------------------------------------------ os 4 pontos

  it("resumo, caminho direto: Sair com a RPC em voo => o resumo não volta ao cofre", async () => {
    await montar();
    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchExecutiveSummary(true);
      await rpcChamada(1); // a consulta nasceu e está pendurada na rede
    });

    await sairDeLojista();
    expect(linhaDoCofre("admin_dashboard_stats")).toBeUndefined();

    await act(async () => {
      h.pendentes[0].responder(RESUMO_V1);
      await consulta;
    });
    await soltar();

    expect(gravouNoCofre("admin_dashboard_stats")).toBe(false);
    expect(linhaDoCofre("admin_dashboard_stats")).toBeUndefined();
    // O singleton PÚBLICO da gaveta segue de pé: só as linhas do resumo saem.
    expect(linhaDoCofre("singleton")).toEqual({ nomeDaLoja: "Loja pública" });
  });

  it("resumo, revalidação em segundo plano: Sair com a RPC em voo => não volta ao cofre", async () => {
    await montar();
    // 1ª consulta normal enche o cache em memória.
    await act(async () => {
      const primeira = analytics.fetchExecutiveSummary(true);
      (await rpcChamada(1)).responder(RESUMO_V1);
      await primeira;
    });
    await soltar();
    h.put.mockClear();
    h.gavetas.get("store_config")?.delete("admin_dashboard_stats");

    envelhecerOCache();
    await act(async () => {
      // Cache velho, sem força: devolve o cache na hora e revalida ao fundo.
      expect(await analytics.fetchExecutiveSummary(false)).toEqual(RESUMO_V1);
      await rpcChamada(2);
    });

    await sairDeLojista();

    await act(async () => {
      h.pendentes[1].responder(RESUMO_V2);
      await soltar();
    });
    await soltar();

    expect(gravouNoCofre("admin_dashboard_stats")).toBe(false);
    expect(linhaDoCofre("admin_dashboard_stats")).toBeUndefined();
  });

  it("categorias, caminho direto: Sair com a RPC em voo => as categorias não voltam ao cofre", async () => {
    await montar();
    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchCategoryAnalytics("inicio", "fim", true);
      await rpcChamada(1);
    });

    await sairDeLojista();
    expect(linhaDoCofre("admin_category_data")).toBeUndefined();

    await act(async () => {
      h.pendentes[0].responder(CATEGORIAS_V1);
      await consulta;
    });
    await soltar();

    expect(gravouNoCofre("admin_category_data")).toBe(false);
    expect(linhaDoCofre("admin_category_data")).toBeUndefined();
  });

  it("categorias, revalidação em segundo plano: Sair com a RPC em voo => não volta ao cofre", async () => {
    await montar();
    await act(async () => {
      const primeira = analytics.fetchCategoryAnalytics("inicio", "fim", true);
      (await rpcChamada(1)).responder(CATEGORIAS_V1);
      await primeira;
    });
    await soltar();
    h.put.mockClear();
    h.gavetas.get("store_config")?.delete("admin_category_data");

    envelhecerOCache();
    await act(async () => {
      // Mesmo período, cache velho, sem força: devolve o cache e revalida.
      expect(await analytics.fetchCategoryAnalytics("inicio", "fim")).toEqual(
        CATEGORIAS_V1,
      );
      await rpcChamada(2);
    });

    await sairDeLojista();

    await act(async () => {
      h.pendentes[1].responder(CATEGORIAS_V2);
      await soltar();
    });
    await soltar();

    expect(gravouNoCofre("admin_category_data")).toBe(false);
    expect(linhaDoCofre("admin_category_data")).toBeUndefined();
  });

  // ----------------------------------------------------------------- bordas

  it("duas consultas em voo (resumo e categorias) + Sair: nenhuma das duas linhas volta", async () => {
    await montar();
    let resumo!: Promise<unknown>;
    let categorias!: Promise<unknown>;
    await act(async () => {
      resumo = analytics.fetchExecutiveSummary(true);
      categorias = analytics.fetchCategoryAnalytics("inicio", "fim", true);
      await rpcChamada(2);
    });

    await sairDeLojista();

    await act(async () => {
      for (const p of h.pendentes) {
        p.responder(
          p.nome === "get_admin_analytics_v2" ? RESUMO_V1 : CATEGORIAS_V1,
        );
      }
      await Promise.all([resumo, categorias]);
    });
    await soltar();

    expect(h.put).not.toHaveBeenCalled();
    expect(linhaDoCofre("admin_dashboard_stats")).toBeUndefined();
    expect(linhaDoCofre("admin_category_data")).toBeUndefined();
  });

  it("o Sair não derruba o que a tela já tem: quem chamou ainda recebe o resumo", async () => {
    await montar();
    let consulta!: Promise<unknown>;
    await act(async () => {
      consulta = analytics.fetchExecutiveSummary(true);
      await rpcChamada(1);
    });
    await sairDeLojista();

    let devolvido: unknown;
    await act(async () => {
      h.pendentes[0].responder(RESUMO_V1);
      devolvido = await consulta;
    });

    // Só a GRAVAÇÃO EM DISCO é descartada; a devolução ao chamador não muda.
    expect(devolvido).toEqual(RESUMO_V1);
  });
});
