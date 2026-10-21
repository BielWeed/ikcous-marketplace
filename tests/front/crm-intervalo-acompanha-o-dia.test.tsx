// @vitest-environment jsdom
// A geometria do carrossel é verificada à parte; esta suíte verifica dados/navegação.
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));
//
// O intervalo do CRM ("Hoje", "7 dias", "30 dias"…) era calculado uma vez por
// escolha de período: tela aberta, ou voltando do segundo plano, depois da
// meia-noite continuava consultando os dias de ontem. Relógio falso cruzando a
// meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve({ data: null, error: null });
    },
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(null),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  }),
}));
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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

const ANTES_DA_MEIA_NOITE = "2026-10-14T02:59:50Z"; // 13/10, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-10-14T03:00:10Z"; // 14/10, 00:00:10 em SP

function periodosConsultados() {
  return h.rpc.mock.calls
    .filter(([nome]) => nome === "crm_visao")
    .map(([, args]) => args as { p_inicio: string; p_fim: string });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CRM — o intervalo acompanha o dia de São Paulo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    h.rpc.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  async function montar(ativa = true) {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active={ativa} onNavigate={() => {}} />);
    });
    await avancar(400); // espera do chip de período (250 ms)
  }

  it("30 dias: a consulta de antes da meia-noite termina em 13/10", async () => {
    await montar();
    expect(periodosConsultados().at(-1)).toEqual({
      p_inicio: "2026-09-14",
      p_fim: "2026-10-13",
    });
  });

  it("tela aberta quando o dia vira: consulta de novo, agora terminando em 14/10", async () => {
    await montar();
    await avancar(12_000);
    await avancar(400);
    expect(periodosConsultados().at(-1)).toEqual({
      p_inicio: "2026-09-15",
      p_fim: "2026-10-14",
    });
  });

  it("voltando do segundo plano no dia seguinte: consulta de novo com o dia novo", async () => {
    await montar();
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(400);
    expect(periodosConsultados().at(-1)).toEqual({
      p_inicio: "2026-09-15",
      p_fim: "2026-10-14",
    });
  });

  it("o período 'Hoje' deixa de ser ontem: de 13/10 para 14/10", async () => {
    await montar();
    const botaoHoje = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Hoje",
    );
    expect(botaoHoje).toBeTruthy();
    await act(async () => {
      botaoHoje?.click();
    });
    await avancar(400);
    expect(periodosConsultados().at(-1)).toEqual({
      p_inicio: "2026-10-13",
      p_fim: "2026-10-13",
    });
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(periodosConsultados().at(-1)).toEqual({
      p_inicio: "2026-10-14",
      p_fim: "2026-10-14",
    });
  });

  it("controle: sem virada de dia, a consulta não se repete por causa do foco", async () => {
    await montar();
    const antes = periodosConsultados().length;
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(periodosConsultados().length).toBe(antes);
  });
});
