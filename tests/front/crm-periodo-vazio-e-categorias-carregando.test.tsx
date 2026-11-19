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

function Sonda({
  pedidos = 0,
  devolucao = 0,
  comCompradores = true,
}: {
  pedidos?: number;
  devolucao?: number;
  comCompradores?: boolean;
}) {
  const classico = useDashboardClassico(false);
  return (
    <VisaoGeralDoCrm
      visao={lerVisaoDoCrm({
        kpis: {
          pedidos,
          clientes_compradores: pedidos > 0 && comCompradores ? 2 : 0,
          ticket_medio: pedidos > 0 ? 25 : 0,
          taxa_recompra: comCompradores ? 0.5 : 0,
          receita_recorrente_pct: 0,
          taxa_devolucao: devolucao,
        },
        segmentos: comCompradores
          ? [{ segmento: "novos", clientes: 2 }]
          : [
              { segmento: "pediu_nao_pagou", clientes: 2 },
              { segmento: "nunca_comprou", clientes: 3 },
            ],
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
async function montar(pedidos = 0, devolucao = 0, comCompradores = true) {
  await act(async () =>
    root.render(
      <Sonda
        pedidos={pedidos}
        devolucao={devolucao}
        comCompradores={comCompradores}
      />,
    ),
  );
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

it("sem vendas no período mas com histórico: valor médio é traço, não R$ 0,00", async () => {
  await montar();
  const texto = cartao("Valor médio por venda").textContent;
  expect(texto).toContain("—");
  expect(texto).not.toContain("0,00");
  expect(texto).toContain("Sem venda neste período");
});

it("com venda no período: valor médio continua igual", async () => {
  await montar(2);
  expect(
    cartao("Valor médio por venda").textContent?.replace(/\s+/g, " "),
  ).toContain("R$ 25,00");
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
  expect(cartao("Taxa de recompra").textContent).not.toContain(
    "vem de quem volta",
  );
});

it("período sem venda e sem compradores no histórico: recompra mostra traço", async () => {
  await montar(0, 0, false);
  const texto = cartao("Taxa de recompra").textContent;
  expect(texto).toContain("—");
  expect(texto).not.toContain("0%");
  expect(texto).toContain("Sem venda neste período");
});

it("com venda: zero de devolução é medido e recompra histórica continua", async () => {
  await montar(2);
  expect(cartao("Taxa de devolução").textContent).toContain("0%");
  expect(cartao("Taxa de devolução").textContent).toContain(
    "Do valor vendido no período",
  );
  expect(cartao("Taxa de recompra").textContent).toContain("50%");
  expect(cartao("Taxa de recompra").textContent).toContain(
    "0% da receita das vendas com cliente identificado vem de quem volta",
  );
});

it("recompra não exibe percentual da receita quando só há vendas sem cliente identificado", async () => {
  await montar(2, 0, false);
  const texto = cartao("Taxa de recompra").textContent;
  expect(texto).toContain("Sem vendas com cliente identificado neste período");
  expect(texto).not.toContain("da receita");
});

it("ajuda da recompra explica que a taxa histórica só conta quem já comprou", async () => {
  await montar(2);
  const ajuda = cartao("Taxa de recompra").querySelector<HTMLButtonElement>(
    'button[aria-label="Entender Taxa de recompra"]',
  )!;
  await act(async () => ajuda.click());
  const dialogo = document.body.querySelector('[role="dialog"]');
  expect(dialogo?.textContent).toContain(
    "A taxa de recompra considera quem já comprou desde o início da loja e não muda quando você troca o período.",
  );
});

it("devolveu tudo o que vendeu (pedidos 0, devolução 100%): mostra 100%, não 'Sem venda'", async () => {
  // O banco conta os estornados na taxa, mas não em `pedidos`.
  await montar(0, 1);
  const texto = cartao("Taxa de devolução").textContent;
  expect(texto).toContain("100%");
  expect(texto).toContain("Do valor vendido no período");
  expect(texto).not.toContain("Sem venda neste período");
});

it("devolução parcial sem pedido restante também aparece", async () => {
  await montar(0, 0.4);
  expect(cartao("Taxa de devolução").textContent).toContain("40%");
});
