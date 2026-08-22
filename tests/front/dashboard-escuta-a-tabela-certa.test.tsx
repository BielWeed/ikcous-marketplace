// @vitest-environment jsdom
//
// Achado A2: o canal de realtime do catálogo no Dashboard escutava a tabela
// "products" (inglês, plural) — mas o catálogo se chama "produtos" no
// banco. O lojista mudava custo/preço/estoque de um produto, voltava ao
// Dashboard, e os números continuavam os de antes até clicar em
// "Sincronizar" à mão, porque o canal nunca recebia o evento.
//
// Este teste monta o AdminDashboardView de verdade (líder, sessão ativa),
// captura os argumentos passados a cada `.on("postgres_changes", ...)` por
// canal, e prova as duas pontas: existe uma assinatura com
// `table: "produtos"`, e NENHUMA com `table: "products"`. Sem a segunda
// asserção o teste passaria com as duas assinaturas coexistindo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ArgumentosOn = { event: string; opts: Record<string, unknown> };

// vi.mock é içado para o topo — os dublês do canal do Supabase precisam
// nascer dentro de vi.hoisted para ficarem visíveis na fábrica do mock.
const h = vi.hoisted(() => {
  const chamadasPorCanal = new Map<string, ArgumentosOn[]>();

  function criarCanal(nome: string) {
    const registros: ArgumentosOn[] = [];
    chamadasPorCanal.set(nome, registros);
    const canal = {
      on: (event: string, opts: Record<string, unknown>) => {
        registros.push({ event, opts });
        return canal;
      },
      subscribe: () => canal,
    };
    return canal;
  }

  return { chamadasPorCanal, criarCanal };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (nome: string) => h.criarCanal(nome),
    removeChannel: () => {},
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-1" } } }),
}));

// isLeader: true — é só no líder que AdminDashboardView estabelece as
// assinaturas de verdade (o seguidor só ouve o BroadcastChannel).
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Os blocos filhos (gráficos, KPIs) não importam para este achado — mocados
// para não arrastar recharts/matchMedia para um teste que só prova a
// assinatura do canal de realtime.
vi.mock("@/components/admin/dashboard/KpiSummaryCards", () => ({
  KpiSummaryCards: () => null,
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminDashboardView — o canal do catálogo escuta 'produtos', não 'products' (A2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.chamadasPorCanal.clear();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("assina 'produtos' e NUNCA assina 'products'", async () => {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );

    await act(async () => {
      raiz.render(<AdminDashboardView onNavigate={() => {}} active={true} />);
    });

    const chamadasDoCanalDeProdutos =
      h.chamadasPorCanal.get("admin-dashboard-products") ?? [];

    // Existe: uma assinatura de postgres_changes com a tabela certa.
    const assinaTabelaCerta = chamadasDoCanalDeProdutos.some(
      (chamada) =>
        chamada.event === "postgres_changes" &&
        chamada.opts.table === "produtos",
    );
    expect(assinaTabelaCerta).toBe(true);

    // Não existe: nenhuma assinatura, em nenhum canal, aponta para a tabela
    // que não existe no banco.
    const assinaTabelaInexistente = [...h.chamadasPorCanal.values()]
      .flat()
      .some(
        (chamada) =>
          chamada.event === "postgres_changes" &&
          chamada.opts.table === "products",
      );
    expect(assinaTabelaInexistente).toBe(false);
  });
});
