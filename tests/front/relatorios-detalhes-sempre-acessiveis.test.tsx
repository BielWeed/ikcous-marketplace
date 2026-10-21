// @vitest-environment jsdom
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import {
  type CategoryData,
  StrategicIntelligenceBlocks,
} from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function clicar(texto: string) {
  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === texto,
  );
  expect(botao).toBeDefined();
  act(() => botao!.click());
}

it("o aviso de custo não prende a janela do histórico numa altura fixa", async () => {
  await act(async () =>
    root.render(
      <OperationalPerformanceChart
        stats={
          {
            productsWithoutCost: 3,
            inventory: { totalCost: 100 },
            revenueHistory: [],
          } as unknown as DashboardStats
        }
        loading={false}
        active={false}
        onNavigate={vi.fn()}
      />,
    ),
  );
  clicar("Retorno do estoque");
  expect(host.textContent).toContain("3 produtos sem custo cadastrado");
  expect(host.textContent).toContain("Cadastrar custo");
  const secao = host.querySelector('section[aria-label="Histórico da loja"]')!;
  // jsdom não mede altura: protege a regra CSS; o recorte exige navegador real.
  expect(secao.classList.contains("min-h-[404px]")).toBe(true);
  expect(secao.classList.contains("h-[404px]")).toBe(false);
  expect(
    secao.querySelector('[aria-label="Janela do histórico"]'),
  ).not.toBeNull();
});

const categorias: CategoryData[] = [
  { name: "Roupas", value: 100, avg_ticket: 50, orders: 2 },
  { name: "Calçados", value: 300, avg_ticket: 150, orders: 2 },
  { name: "Bolsas", value: 200, avg_ticket: 100, orders: 2 },
  { name: "Acessórios", value: 400, avg_ticket: 200, orders: 2 },
];

it.each([1, 2, 3])(
  "%i categorias mostram valor médio e total sem precisar expandir",
  async (quantidade) => {
    await act(async () =>
      root.render(
        <StrategicIntelligenceBlocks
          categoryData={categorias.slice(0, quantidade)}
          loading={false}
        />,
      ),
    );
    const linhas = [...host.querySelectorAll("li")];
    expect(linhas).toHaveLength(quantidade);
    for (const linha of linhas) {
      expect(linha.textContent).toContain("Valor médio por venda:");
    }
    expect(linhas[0].textContent).toMatch(/R\$\s*50,00/);
    const total = categorias
      .slice(0, quantidade)
      .reduce((soma, categoria) => soma + categoria.value, 0);
    expect(host.textContent?.replace(/\s/g, " ")).toContain(
      `Faturamento Total: R$ ${total},00`,
    );
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
  },
);

it("mais de três categorias mantêm os detalhes recolhidos até expandir", async () => {
  await act(async () =>
    root.render(
      <StrategicIntelligenceBlocks categoryData={categorias} loading={false} />,
    ),
  );
  expect(host.querySelectorAll("li")).toHaveLength(3);
  expect(host.textContent).not.toContain("Valor médio por venda:");
  expect(host.textContent).not.toContain("Faturamento Total:");
  clicar("Ver todas as 4 categorias");
  expect(host.querySelectorAll("li")).toHaveLength(4);
  for (const linha of host.querySelectorAll("li")) {
    expect(linha.textContent).toContain("Valor médio por venda:");
  }
  expect(host.textContent?.replace(/\s/g, " ")).toContain(
    "Faturamento Total: R$ 1.000,00",
  );
  clicar("Recolher");
  expect(host.textContent).not.toContain("Valor médio por venda:");
  expect(host.textContent).not.toContain("Faturamento Total:");
});
