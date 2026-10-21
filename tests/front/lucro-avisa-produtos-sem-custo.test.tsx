// @vitest-environment jsdom
//
// PAR da migration 20261234 (#879): a RPC `get_admin_analytics_v2` passa a
// somar no lucro e no "Top 5 mais lucrativos" SÓ produtos com custo
// cadastrado, e devolve `productsWithoutCost` (quantos produtos vendidos
// ficaram de fora). Sem tela nova, uma loja onde nenhum produto vendido tem
// custo via "Nenhum dado de vendas disponível" (falso: a loja vendeu) e o
// "Lucro Acumulado" não dizia que deixou produtos de fora.
//
// A tela é publicada ANTES da migration: com o campo ausente (função
// antiga) tudo fica IGUAL a hoje — os controles abaixo provam isso.
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_ANTIGA = "Nenhum dado de vendas disponível";
const FRASE_NOVA =
  "Cadastre o custo dos produtos vendidos para ver quais dão mais lucro.";

function stats(extra: Record<string, unknown>, comProdutos = false) {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [
      {
        date: "2026-10-10",
        full_date: "10/10",
        revenue: 100,
        orders: 1,
        profit: 40,
        cost_sold: 60,
      },
    ],
    topProducts: comProdutos
      ? [{ id: "p1", name: "Camisa", quantity: 5, total: 100, image: "" }]
      : [],
    inventoryAlerts: 0,
    ...extra,
  } as unknown as DashboardStats;
}

describe("tela do lucro avisa produtos sem custo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  async function montaGrafico(
    s: DashboardStats,
    onNavigate: (v: any) => void = () => {},
  ) {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart
          stats={s}
          loading={false}
          active={true}
          onNavigate={onNavigate}
        />,
      );
    });
    // o "Lucro Acumulado" mora no modo "Retorno do estoque"
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retorno do estoque"),
    );
    await act(async () => {
      botao?.click();
    });
    return hospedeiro.textContent ?? "";
  }

  async function montaTop(s: DashboardStats) {
    await act(async () => {
      raiz.render(
        <TopProductsList stats={s} loading={false} onNavigate={() => {}} />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  describe("OperationalPerformanceChart", () => {
    it.each([undefined, 0, 3])(
      "o lucro avisa visivelmente sobre devolução parcial e estorno mesmo com %s produtos sem custo",
      async (semCusto) => {
        await act(async () =>
          raiz.render(
            <OperationalPerformanceChart
              stats={stats({ productsWithoutCost: semCusto })}
              loading={false}
              active
            />,
          ),
        );
        const aviso =
          "Lucro das vendas. Devolução parcial e estorno só são descontados na aba Resultado do Financeiro.";
        expect(hospedeiro.textContent).not.toContain(aviso);
        const retorno = [...hospedeiro.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Retorno do estoque"),
        )!;
        await act(async () => retorno.click());
        const visivel = hospedeiro.cloneNode(true) as HTMLElement;
        visivel
          .querySelectorAll(".sr-only, [hidden]")
          .forEach((el) => el.remove());
        expect((visivel.textContent ?? "").replace(/\s+/g, " ")).toContain(
          aviso,
        );
        expect(visivel.textContent).toContain("Lucro Acumulado");
      },
    );

    it("controle: campo ausente (função antiga) = nenhum aviso", async () => {
      const texto = await montaGrafico(stats({}));
      expect(texto).toContain("Lucro Acumulado");
      expect(texto).not.toContain("sem custo");
    });

    it("controle: 0 = nenhum aviso", async () => {
      const texto = await montaGrafico(stats({ productsWithoutCost: 0 }));
      expect(texto).not.toContain("sem custo");
    });

    it("1 produto: singular", async () => {
      const texto = await montaGrafico(stats({ productsWithoutCost: 1 }));
      expect(texto).toContain(
        "1 produto sem custo cadastrado ficou fora do lucro.",
      );
    });

    it("3 produtos: plural", async () => {
      const texto = await montaGrafico(stats({ productsWithoutCost: 3 }));
      expect(texto).toContain(
        "3 produtos sem custo cadastrado ficaram fora do lucro.",
      );
    });

    it("o atalho leva à lista de produtos", async () => {
      const ir = vi.fn();
      await montaGrafico(stats({ productsWithoutCost: 2 }), ir);
      const link = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Cadastrar custo"),
      );
      expect(link).toBeTruthy();
      await act(async () => {
        link?.click();
      });
      expect(ir).toHaveBeenCalledWith("admin-products");
    });

    it.each([["3"], [null], [-2], [Number.NaN], [1.5], [{}]])(
      "tipo inesperado (%j) não quebra nem avisa",
      async (valor) => {
        const texto = await montaGrafico(stats({ productsWithoutCost: valor }));
        expect(texto).toContain("Lucro Acumulado");
        expect(texto).not.toContain("sem custo");
        expect(texto).not.toContain("NaN");
      },
    );
  });

  describe("TopProductsList", () => {
    it("vazio e campo ausente: texto de hoje", async () => {
      const texto = await montaTop(stats({}));
      expect(texto).toContain(FRASE_ANTIGA);
      expect(texto).not.toContain(FRASE_NOVA);
    });

    it("vazio e 0: texto de hoje", async () => {
      const texto = await montaTop(stats({ productsWithoutCost: 0 }));
      expect(texto).toContain(FRASE_ANTIGA);
      expect(texto).not.toContain(FRASE_NOVA);
    });

    it("vazio e productsWithoutCost > 0: frase verdadeira", async () => {
      const texto = await montaTop(stats({ productsWithoutCost: 4 }));
      expect(texto).toContain(FRASE_NOVA);
      expect(texto).not.toContain(FRASE_ANTIGA);
    });

    it("vazio e valor de tipo inesperado: texto de hoje", async () => {
      for (const v of ["4", null, -1, Number.NaN]) {
        const texto = await montaTop(stats({ productsWithoutCost: v }));
        expect(texto).toContain(FRASE_ANTIGA);
        expect(texto).not.toContain(FRASE_NOVA);
      }
    });

    it("lista cheia e productsWithoutCost > 0: mostra a lista e o aviso", async () => {
      const texto = await montaTop(stats({ productsWithoutCost: 2 }, true));
      expect(texto).toContain("Camisa");
      expect(texto).toContain(
        "2 produtos sem custo cadastrado ficaram fora do lucro.",
      );
      expect(texto).not.toContain(FRASE_ANTIGA);
      expect(texto).not.toContain(FRASE_NOVA);
    });

    it("lista cheia e campo ausente: sem aviso", async () => {
      const texto = await montaTop(stats({}, true));
      expect(texto).toContain("Camisa");
      expect(texto).not.toContain("sem custo");
    });
  });
});
