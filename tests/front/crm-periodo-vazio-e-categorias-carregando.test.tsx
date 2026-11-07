// @vitest-environment jsdom
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { useDashboardClassico } from "@/hooks/useCrm";
import { lerVisaoDoCrm } from "@/lib/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  analytics: {
    stats: { revenueHistory: [{ revenue: 100, orders: 1 }] },
    categoryData: null as { name: string; value: number }[] | null,
    error: null,
    categoryError: null as string | null,
    fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAnalytics", () => ({ useAnalytics: () => h.analytics }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: () => null,
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));

// @ts-expect-error flag interna de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  h.analytics.categoryData = null;
  h.analytics.categoryError = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Sonda({ pedidos = 0 }: { pedidos?: number }) {
  const classico = useDashboardClassico(false);
  return (
    <VisaoGeralDoCrm
      visao={lerVisaoDoCrm({
        kpis: {
          pedidos,
          taxa_recompra: 0.5,
          receita_recorrente_pct: 0,
          taxa_devolucao: 0,
        },
        segmentos: [],
        canais: [],
        formas: [],
        pipeline: [],
      })}
      carregando={false}
      comparacao="vs. período anterior"
      classico={classico}
      active
      onNavigate={vi.fn()}
      aoVerSegmento={vi.fn()}
    />
  );
}
async function montar(pedidos = 0) {
  await act(async () => root.render(<Sonda pedidos={pedidos} />));
}
function cartao(rotulo: string) {
  const tile = host.querySelector(`article[aria-label="${rotulo}"]`);
  expect(tile, rotulo).toBeTruthy();
  return tile!;
}

it("resumo já chegou mas categorias não: mantém esqueleto até a resposta", async () => {
  await montar();
  const categorias = host.querySelector(
    'section[aria-labelledby="crm-categorias-titulo"]',
  )!;
  expect(categorias).not.toBeNull();
  expect(categorias.textContent).not.toContain("Sem dados registrados");
  expect(categorias.querySelector(".premium-shimmer")).not.toBeNull();
  h.analytics.categoryData = [];
  await montar();
  expect(categorias.textContent).toContain("Sem dados registrados");
  expect(categorias.querySelector(".premium-shimmer")).toBeNull();
});

it("erro de categorias não é escondido por carregamento", async () => {
  h.analytics.categoryError = "Sem conexão";
  await montar();
  expect(host.textContent).toContain("Sem conexão");
  expect(host.textContent).not.toContain("Sem dados registrados");
});

it("período sem venda: devolução e receita recorrente não afirmam 0%", async () => {
  await montar();
  expect(cartao("Taxa de devolução").textContent).toContain("—");
  expect(cartao("Taxa de devolução").textContent).toContain(
    "Sem venda neste período",
  );
  expect(cartao("Taxa de devolução").textContent).not.toContain("0%");
});

it("período sem venda: recompra preserva histórico mas não inventa percentual da receita", async () => {
  await montar();
  expect(cartao("Taxa de recompra").textContent).toContain("50%");
  expect(cartao("Taxa de recompra").textContent).toContain(
    "Sem venda neste período",
  );
  expect(host.textContent).not.toContain("0% da receita vem de quem volta");
});

it("com venda: zero de devolução é medido e recompra histórica continua", async () => {
  await montar(2);
  expect(cartao("Taxa de devolução").textContent).toContain("0%");
  expect(cartao("Taxa de devolução").textContent).toContain(
    "Do valor vendido no período",
  );
  expect(cartao("Taxa de recompra").textContent).toContain("50%");
  expect(host.textContent).toContain("0% da receita vem de quem volta");
});
