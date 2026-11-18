// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";

const dias = [{ date: "2025-11-18", revenue: 10, orders: 1 }, { date: "2026-11-18", revenue: 20, orders: 1 }];
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
// Só a geometria do Recharts é substituída: os formatadores vêm do componente real.
vi.mock("recharts", () => {
  const caixa = ({ children }: { children: ReactNode }) => createElement("div", null, children);
  const vazio = () => null;
  return {
    ResponsiveContainer: caixa, BarChart: caixa, AreaChart: caixa,
    Bar: vazio, Area: vazio, CartesianGrid: vazio, YAxis: vazio,
    XAxis: ({ tickFormatter }: { tickFormatter: (dia: string) => string }) =>
      createElement("div", { "data-testid": "eixo" }, dias.map((dia) =>
        createElement("span", { key: dia.date }, tickFormatter(dia.date)))),
    Tooltip: ({ content }: { content: (props: unknown) => ReactNode }) =>
      createElement("div", { "data-testid": "balao" }, dias.map((dia) =>
        createElement("div", { key: dia.date }, content({ active: true, payload: [{ payload: dia }] })))),
  };
});
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

it.each(["Vendas", "Retorno do estoque"])("%s distingue os anos no eixo e no balão", async (modo) => {
  vi.useFakeTimers();
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  try {
    const stats = { revenueHistory: dias, inventory: { totalCost: 10 } } as DashboardStats;
    await act(async () => raiz.render(createElement(OperationalPerformanceChart, { stats, loading: false })));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => {
      [...hospedeiro.querySelectorAll("button")].find((b) => b.textContent === modo)?.click();
    });
    for (const seletor of ["eixo", "balao"]) {
      const elemento = hospedeiro.querySelector(`[data-testid="${seletor}"]`);
      expect(elemento).not.toBeNull();
      expect(elemento?.textContent).toContain("18/11/25");
      expect(elemento?.textContent).toContain("18/11/26");
    }
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
  }
});
