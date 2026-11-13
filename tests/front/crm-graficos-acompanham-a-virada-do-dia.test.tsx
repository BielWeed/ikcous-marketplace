// @vitest-environment jsdom
// A geometria do carrossel é verificada à parte; esta suíte verifica dados.
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn<() => void>(), undefined],
}));
//
// Defeito: com o CRM aberto de 23h59 a 00h01 (São Paulo), os números do topo
// avançavam para o novo período mas a fonte dos gráficos (resumo executivo,
// `get_admin_analytics_v2`) não era lida de novo: o gráfico de 30 dias seguia
// cobrindo [hoje-30 .. ontem] e uma venda que já saiu da janela continuava no
// faturamento dele. O servidor calcula o fuso certo; faltava reconsultar
// quando o dia da loja muda.
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // Estáveis entre renders (como o useAnalytics real, com useCallback):
  // senão o efeito do dashboard rodaria de novo por causa do dublê.
  const analytics = {
    fetchExecutiveSummary: vi
      .fn<(forcar?: boolean) => Promise<null>>()
      .mockResolvedValue(null),
    fetchCategoryAnalytics: vi
      .fn<(de: string, ate: string, forcar?: boolean) => Promise<null>>()
      .mockResolvedValue(null),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  };
  return { analytics };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn<() => void>(),
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({ useAnalytics: () => h.analytics }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja do Gabriel" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}));
vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: () => null,
}));
vi.mock("@/components/admin/dashboard/StrategicIntelligenceBlocks", () => ({
  StrategicIntelligenceBlocks: () => null,
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-11-13T03:00:10Z"; // 13/11, 00:00:10 em SP

const leiturasDoResumo = () => h.analytics.fetchExecutiveSummary.mock.calls;

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CRM — os gráficos acompanham a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    h.analytics.fetchExecutiveSummary.mockClear();
    h.analytics.fetchCategoryAnalytics.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function desenhar(active: boolean) {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active={active} onNavigate={() => {}} />);
    });
    await avancar(400);
  }

  it("com a tela aberta na virada do dia, o resumo dos gráficos é lido de novo (forçado)", async () => {
    await desenhar(true);
    const antes = leiturasDoResumo().length;
    expect(antes).toBeGreaterThan(0);
    // A abertura da tela respeita o cache de 30 s; só a virada força.
    expect(leiturasDoResumo()[0]).toEqual([false]);

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s
    await avancar(400);

    expect(leiturasDoResumo().length).toBe(antes + 1);
    // Forçado: o resumo em cache de menos de 30 s não pode segurar a leitura.
    expect(leiturasDoResumo().at(-1)).toEqual([true]);
  });

  it("voltando do segundo plano no dia seguinte, o resumo é lido de novo", async () => {
    await desenhar(true);
    const antes = leiturasDoResumo().length;
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(leiturasDoResumo().length).toBe(antes + 1);
  });

  it("controle: sem virada de dia, o foco não relê o resumo", async () => {
    await desenhar(true);
    const antes = leiturasDoResumo().length;
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-13T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(leiturasDoResumo().length).toBe(antes);
  });

  it("tela inativa não consulta, nem na virada do dia", async () => {
    await desenhar(false);
    expect(leiturasDoResumo().length).toBe(0);
    await avancar(12_000);
    await avancar(400);
    expect(leiturasDoResumo().length).toBe(0);
  });

  it("tela que fica ativa já no dia seguinte relê UMA vez só (sem rajada)", async () => {
    await desenhar(false);
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
    });
    await desenhar(true);
    await avancar(1_000);
    expect(leiturasDoResumo().length).toBe(1);
  });
});
