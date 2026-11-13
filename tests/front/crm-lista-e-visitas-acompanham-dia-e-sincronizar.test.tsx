// @vitest-environment jsdom
// A geometria do carrossel é verificada à parte; esta suíte verifica dados/navegação.
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn<() => void>(), undefined],
}));
//
// Dois furos do CRM:
// 1) a lista de clientes não relia quando o dia virava: a contagem do grupo
//    ("Novos") mudava, mas a lista continuava com o grupo de ontem;
// 2) "Sincronizar" não relia as visitas do funil: o cache de 30 s segurava a
//    consulta mesmo num toque explícito da lojista.
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn<(nome: string, args?: unknown) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      const data =
        nome === "crm_visitas"
          ? {
              contando_desde: "2026-09-01",
              visitas: 10,
              canais: [{ canal: "direto", visitas: 10 }],
              previas: 0,
              periodo_completo: true,
            }
          : null;
      return Promise.resolve({ data, error: null });
    },
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
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: () => Promise.resolve(null),
    fetchCategoryAnalytics: () => Promise.resolve(null),
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

const ANTES_DA_MEIA_NOITE = "2026-10-14T02:59:50Z"; // 13/10, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-10-14T03:00:10Z"; // 14/10, 00:00:10 em SP

const consultas = (nome: string) =>
  h.rpc.mock.calls.filter(([chamada]) => chamada === nome).length;

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("CRM — lista de clientes e visitas do funil", () => {
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
    vi.useRealTimers();
  });

  async function montar() {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active onNavigate={() => {}} />);
    });
    await avancar(400);
  }

  async function abrirAba(nome: string) {
    const aba = hospedeiro.querySelector<HTMLButtonElement>(
      `button[role="tab"][aria-label="${nome}"]`,
    );
    expect(aba, nome).toBeTruthy();
    await act(async () => {
      aba?.click();
    });
    await avancar(400);
  }

  async function sincronizar() {
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Sincronizar os números do CRM"]',
    );
    expect(botao).toBeTruthy();
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao?.click();
    });
    await avancar(400);
  }

  it("clientes: com a tela aberta na virada do dia, a lista é lida de novo", async () => {
    await montar();
    await abrirAba("Clientes");
    const antes = consultas("crm_clientes");
    expect(antes).toBeGreaterThan(0);
    await avancar(12_000);
    await avancar(400);
    expect(consultas("crm_clientes")).toBe(antes + 1);
  });

  it("clientes: voltando do segundo plano no dia seguinte, a lista é lida de novo", async () => {
    await montar();
    await abrirAba("Clientes");
    const antes = consultas("crm_clientes");
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(consultas("crm_clientes")).toBe(antes + 1);
  });

  it("controle: sem virada de dia, o foco não relê a lista", async () => {
    await montar();
    await abrirAba("Clientes");
    const antes = consultas("crm_clientes");
    await act(async () => {
      vi.setSystemTime(new Date("2026-10-14T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(400);
    expect(consultas("crm_clientes")).toBe(antes);
  });

  it("funil: Sincronizar relê as visitas mesmo com o cache de 30 s fresco", async () => {
    await montar();
    await abrirAba("Funil e pedidos");
    expect(consultas("crm_visitas")).toBe(1);
    await sincronizar();
    expect(consultas("crm_visitas")).toBe(2);
  });

  it("controle: voltar para a aba do funil dentro de 30 s respeita o cache", async () => {
    await montar();
    await abrirAba("Funil e pedidos");
    await abrirAba("Visão geral");
    await abrirAba("Funil e pedidos");
    expect(consultas("crm_visitas")).toBe(1);
  });
});
