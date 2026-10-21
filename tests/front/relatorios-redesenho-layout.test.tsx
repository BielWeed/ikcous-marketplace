// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useCrm", () => ({
  useCrmVisao: () => ({
    visao: null,
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
  useCrmClientes: () => ({
    lista: { total: 0, clientes: [] },
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
  useDashboardClassico: () => ({
    stats: null,
    categorias: [],
    carregando: false,
    erro: null,
    erroDeCategoria: null,
    carregar: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Fictícia" } }),
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
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));
// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("Clientes não oferece período; voltar a Visão restaura os cinco controles", async () => {
  const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<AdminCrmView active onNavigate={vi.fn()} />),
    );
    const periodo = () =>
      host.querySelector('[role="group"][aria-label="Período"]');
    expect(periodo()?.querySelectorAll("button").length).toBe(5);
    const clientes =
      host.querySelector<HTMLButtonElement>("#crm-aba-clientes")!;
    await act(async () => clientes.click());
    expect(periodo()).toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("#crm-aba-visao")!.click(),
    );
    expect(periodo()?.querySelectorAll("button").length).toBe(5);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("o resumo de relatórios é fixo e não ganha o Expandir do topo", async () => {
  const { MetricasDoPainel } = await import(
    "@/components/admin/MetricasDoPainel"
  );
  const { ShoppingBag } = await import("lucide-react");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MetricasDoPainel
          titulo="Resumo"
          legendasDoResumo={["Receita", "Pedidos"]}
          cards={[
            { label: "Receita", value: "R$ 170,88", icon: ShoppingBag },
            { label: "Pedidos", value: 9, icon: ShoppingBag },
          ]}
          {...{ relatorio: { rodape: "21 set – 20 out · vs. 30 dias antes" } }}
        />,
      ),
    );
    expect(host.querySelector(".metricas-relatorio")).not.toBeNull();
    expect(host.textContent).not.toContain("Expandir");
    expect(host.textContent).toContain("21 set – 20 out");
  } finally {
    act(() => root.unmount());
  }
});
