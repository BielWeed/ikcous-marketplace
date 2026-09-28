// @vitest-environment jsdom
//
// Achado do dono (28/09/2026, print do celular em Brave ~390px): o Dashboard
// CRM ROLAVA PARA O LADO — o conteúdo aparecia deslocado ("SHBOARD CRM",
// "…87,40"). Medição com Playwright numa réplica do `AdminArea.tsx:~569`
// (`#rolagem`, o contêiner `absolute size-full overflow-y-auto` onde a
// admin-crm monta) achou a ORIGEM: o enfeite decorativo de
// `TopProductsList.tsx` ("Top 5 produtos mais lucrativos") era `absolute
// -right-20 -top-20` mas ficava FORA do cartão com `overflow-hidden` — um
// irmão anterior dentro de um `<div className="relative">` sem clip
// nenhum. Com `overflow-y: auto` em `#rolagem`, o CSS acopla
// `overflow-x: auto` (regra de interdependência dos dois eixos) e o
// transbordo de 64px virou rolagem lateral na tela inteira. A causa raiz
// (o enfeite dentro do overflow-hidden) é provada em
// tests/front/top-products-list-enfeite-contido.test.tsx; este arquivo
// prova só a rede de segurança.
//
// jsdom não faz layout de verdade (todo `getBoundingClientRect()` volta
// 0×0), então o que dá para provar aqui é estrutural: o elemento raiz de
// AdminCrmView tem `overflow-x-clip` — nunca `overflow-x-hidden`, que
// criaria um contêiner de rolagem próprio e quebraria o `sticky` da barra
// de abas/período. A prova de layout de verdade (scrollWidth === clientWidth
// nas 4 abas × 6 larguras, antes e depois) foi feita à parte com Playwright
// e está colada no relatório desta tarefa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  respostas: new Map<string, { data: unknown; error: unknown }>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve(
        h.respostas.get(nome) ?? { data: null, error: null },
      );
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
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

describe("Dashboard CRM não rola para o lado (achado 28/09/2026)", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    h.rpc.mockClear();
    h.respostas.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("o elemento raiz do AdminCrmView tem a rede de segurança overflow-x-clip (nunca overflow-x-hidden)", async () => {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active={true} onNavigate={() => {}} />);
    });

    const raizDaTela = hospedeiro.firstElementChild as HTMLElement | null;
    expect(raizDaTela).toBeTruthy();
    expect(raizDaTela!.className).toContain("overflow-x-clip");
    // overflow-x-hidden criaria um contêiner de rolagem próprio e quebraria
    // o `sticky` da barra de abas/período (o motivo do dono ter pedido
    // explicitamente "NÃO overflow-x-hidden").
    expect(raizDaTela!.className).not.toContain("overflow-x-hidden");
  });
});
