// @vitest-environment jsdom
//
// Lote 224 — números do painel que enganavam a lojista (só a parte do front):
//  3. "Produtos que mais dão lucro": centavos (R$ 26,67, nunca 26,667) e o
//     negativo com o menos no lugar certo (nunca "R$ -5,00");
//  4. "vs. 30 dias antes" some quando os 30 dias antes não tiveram venda (a
//     RPC devolve +100 "de zero para qualquer coisa");
//  5. Financeiro aberto relê ao voltar ao app, com trava e sem passar por cima
//     de uma folha aberta;
//  9. o atalho "Pagar e receber" do Início abre na aba certa (lado certo);
// 10. balão do gráfico com centavos e menos de verdade.
import { act, cloneElement } from "react";
import type { ReactElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
// O jsdom não mede layout: sem tamanho o recharts não desenha nada.
vi.mock("recharts", async (original) => {
  const real = await original<typeof import("recharts")>();
  return {
    ...real,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 420, height: 220 } as never),
  };
});

import { BalaoDoGrafico } from "@/components/admin/dashboard/BalaoDoGrafico";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SEM_NBSP = (t: string | null | undefined) =>
  (t ?? "").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("IntersectionObserver", ObserverStub);
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
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("3. Produtos que mais dão lucro", () => {
  function montar(totais: number[]) {
    const stats = {
      topProducts: totais.map((total, i) => ({
        id: `p${i}`,
        name: `Produto ${i}`,
        quantity: 2,
        total,
        image: null,
      })),
    } as unknown as DashboardStats;
    act(() =>
      raiz.render(
        <TopProductsList stats={stats} loading={false} onNavigate={vi.fn()} />,
      ),
    );
  }

  it("lucro com dízima sai com centavos: R$ 26,67, nunca 26,667", () => {
    montar([26.6666666667]);
    const t = SEM_NBSP(hospedeiro.textContent);
    expect(t).toContain("R$ 26,67");
    expect(t).not.toContain("26,667");
  });

  it("lucro negativo: o menos vem antes do R$, nunca 'R$ -5,00'", () => {
    montar([-5]);
    const t = SEM_NBSP(hospedeiro.textContent);
    expect(t).toContain("-R$ 5,00");
    expect(t).not.toContain("R$ -5");
  });
});

describe("4. selo 'vs. 30 dias antes'", () => {
  const dia = (i: number, revenue: number) => ({
    date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
    full_date: "x",
    revenue,
    orders: revenue > 0 ? 1 : 0,
    profit: 0,
    cost_sold: 0,
  });
  // 60 dias: os 30 primeiros são os "30 dias antes"; os 30 últimos, o período.
  const historico = (antes: number, agora: number) =>
    Array.from({ length: 60 }, (_, i) => dia(i, i < 30 ? antes : agora));

  async function montar(growth: number, revenueHistory: unknown[]) {
    const stats = {
      growth,
      revenueHistory,
      topProducts: [],
      inventory: { totalCost: 0 },
    } as unknown as DashboardStats;
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={stats} loading={false} active />,
      );
    });
  }
  const selo = () => hospedeiro.querySelector("[data-selo-de-crescimento]");

  it("sem venda nos 30 dias antes (+100 da RPC): nenhum selo", async () => {
    await montar(100, historico(0, 50));
    expect(selo()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("+100,0%");
  });

  it("loja sem venda nos 60 dias (growth 0 da RPC): nenhum selo", async () => {
    await montar(0, historico(0, 0));
    expect(selo()).toBeNull();
  });

  it("0% verdadeiro (vendeu igual nos dois períodos) continua aparecendo", async () => {
    await montar(0, historico(25, 25));
    expect(selo()?.textContent).toContain("0,0%");
  });

  it("aba Retorno do estoque: lucro acumulado negativo com centavos e o menos antes do R$", async () => {
    const h = historico(0, 0);
    h[h.length - 1].profit = -12.5;
    await montar(0, h);
    const aba = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Retorno do estoque"),
    );
    await act(async () => aba?.click());
    const t = SEM_NBSP(hospedeiro.textContent);
    expect(t).toContain("−R$ 12,50");
    expect(t).not.toContain("R$ -");
  });

  it("com venda antes e o dobro agora: o +100,0% é verdadeiro e aparece", async () => {
    await montar(100, historico(25, 50));
    expect(selo()?.textContent).toContain("+100,0%");
  });
});

describe("10. balão do gráfico", () => {
  it("venda do dia com centavos: R$ 19,90, não 'R$ 20'", () => {
    act(() =>
      raiz.render(
        <BalaoDoGrafico tipo="vendas" data="d" receita={19.9} pedidos={1} />,
      ),
    );
    const t = SEM_NBSP(hospedeiro.textContent);
    expect(t).toContain("R$ 19,90");
    expect(t).not.toContain("R$ 20 ");
  });

  it("lucro negativo: −R$ 12,50 com o menos de verdade, nunca 'R$ -12,50'", () => {
    act(() =>
      raiz.render(
        <BalaoDoGrafico
          tipo="lucro"
          data="d"
          lucroAcumulado={-12.5}
          estoqueInvestido={320}
        />,
      ),
    );
    const t = SEM_NBSP(hospedeiro.textContent);
    expect(t).toContain("−R$ 12,50");
    expect(t).not.toContain("R$ -");
    expect(t).toContain("R$ 320,00");
  });
});

describe("Financeiro: relê ao voltar ao app e abre no lado certo", () => {
  const RESUMO = {
    periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
    saldo_total: 0,
    contas: [],
    entradas: 0,
    saidas: 0,
    resultado: 0,
    a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
    a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
    por_forma: [],
    por_canal: { online: 0, presencial: 0 },
    serie: [],
    caixa_aberto: null,
  };

  async function esperar() {
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  const leituras = (nome: string) =>
    rpcFalso.mock.calls.filter(([n]) => n === nome).length;

  async function montar(abaInicial?: string) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          abaInicial={abaInicial}
        />,
      );
    });
    await esperar();
  }

  function voltarAoApp() {
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  }

  beforeEach(() => {
    localStorage.clear();
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo") return { data: RESUMO, error: null };
      if (nome === "fin_caixa_atual") return { data: null, error: null };
      return { data: [], error: null };
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00-03:00"));
  });

  it("5. ao voltar ao app depois de um tempo, lê o caixa de novo (uma vez só, mesmo com visibilitychange + focus)", async () => {
    await montar("caixa");
    const antes = leituras("fin_caixa_atual");
    expect(antes).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-10-27T12:10:00-03:00"));
    voltarAoApp();
    await esperar();
    expect(leituras("fin_caixa_atual")).toBe(antes + 1);

    // Em rajada (segundos depois): a trava segura.
    vi.setSystemTime(new Date("2026-10-27T12:10:03-03:00"));
    voltarAoApp();
    await esperar();
    expect(leituras("fin_caixa_atual")).toBe(antes + 1);
  });

  it("5. com uma folha aberta (formulário), NÃO relê por cima", async () => {
    await montar();
    const botaoAbrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Abrir caixa/.test(b.textContent ?? ""),
    );
    expect(botaoAbrir).toBeTruthy();
    await act(async () => botaoAbrir?.click());
    await esperar();
    expect(
      document.querySelector('[data-slot="sheet-content"]'),
    ).not.toBeNull();
    const antes = leituras("fin_caixa_atual");

    vi.setSystemTime(new Date("2026-10-27T12:10:00-03:00"));
    voltarAoApp();
    await esperar();
    expect(leituras("fin_caixa_atual")).toBe(antes);
  });

  it("5. com o app em segundo plano (hidden), não relê", async () => {
    await montar("caixa");
    const antes = leituras("fin_caixa_atual");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.setSystemTime(new Date("2026-10-27T12:10:00-03:00"));
    voltarAoApp();
    await esperar();
    expect(leituras("fin_caixa_atual")).toBe(antes);
    vi.restoreAllMocks();
  });

  const abaAtiva = () =>
    SEM_NBSP(
      hospedeiro.querySelector('[role="tab"][data-state="active"]')
        ?.textContent,
    ).trim();

  it("9. 'previstos' abre em Pagar e receber, lado a pagar", async () => {
    await montar("previstos");
    expect(abaAtiva()).toBe("Pagar e receber");
    expect(rpcFalso).toHaveBeenCalledWith("fin_previstos", { p_tipo: "saida" });
  });

  it("9. 'previstos-entrada' abre em Pagar e receber, lado a receber", async () => {
    await montar("previstos-entrada");
    expect(abaAtiva()).toBe("Pagar e receber");
    expect(rpcFalso).toHaveBeenCalledWith("fin_previstos", {
      p_tipo: "entrada",
    });
  });
});
