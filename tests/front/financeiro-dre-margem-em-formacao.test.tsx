// @vitest-environment jsdom
//
// Financeiro — Resultado (DRE) no começo do mês: as despesas do mês inteiro já
// estão lançadas e a receita só vai até hoje, então a margem sai absurda
// (−1.400%). Até o dia 15 do mês corrente a tela diz "Margem em formação" no
// quadro do lucro líquido e põe "—" no % das linhas que carregam as despesas
// do mês; fora disso, tudo igual. Nenhum valor em reais muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, hoje } = vi.hoisted(() => ({
  rpcFalso: vi.fn(),
  hoje: { dia: "2026-11-03" },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("@/hooks/useDiaDeSaoPaulo", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/hooks/useDiaDeSaoPaulo")>()),
  useDiaDeSaoPaulo: () => hoje.dia,
}));

import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import type { IntervaloDeDatas } from "@/types/financeiro";

// Começo de mês: R$ 200 de venda contra R$ 3.000 de despesas do mês inteiro.
const DRE_NO_VERMELHO = {
  receita_bruta: 200,
  receita_online: 200,
  receita_balcao: 0,
  deducoes: 0,
  receita_liquida: 200,
  cmv: 80,
  cmv_estimado: false,
  lucro_bruto: 120,
  custos_variaveis: 0,
  margem_contribuicao: 120,
  despesas_fixas: 3000,
  resultado_operacional: -2880,
  resultado_financeiro: -20,
  lucro_liquido: -2900,
  linhas: [
    { grupo: "receita", categoria: "App (vendas online)", valor: 200 },
    { grupo: "despesa_fixa", categoria: "Aluguel", valor: 2000 },
    { grupo: "despesa_fixa", categoria: "Internet", valor: 1000 },
  ],
};

const DRE_NO_AZUL = {
  ...DRE_NO_VERMELHO,
  despesas_fixas: 50,
  resultado_operacional: 70,
  resultado_financeiro: 0,
  lucro_liquido: 70,
  linhas: [{ grupo: "despesa_fixa", categoria: "Aluguel", valor: 50 }],
};

const NOVEMBRO: IntervaloDeDatas = { inicio: "2026-11-01", fim: "2026-11-30" };
const OUTUBRO: IntervaloDeDatas = { inicio: "2026-10-01", fim: "2026-10-31" };

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — Resultado: margem em formação no começo do mês", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: DRE_NO_VERMELHO, error: null });
    hoje.dia = "2026-11-03";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(intervalo: IntervaloDeDatas) {
    await act(async () => {
      raiz.render(
        <AbaDre
          ativo
          intervalo={intervalo}
          versao={0}
          rotuloDoPeriodo="Período"
        />,
      );
    });
    await esperar();
  }

  const quadro = (rotulo: string) =>
    [...hospedeiro.querySelectorAll("[data-quadro-do-resultado]")].find(
      (q) => q.querySelector("[data-rotulo-do-kpi]")?.textContent === rotulo,
    ) as HTMLElement;

  const textoDaLinha = (chave: string) =>
    normalizar(
      (hospedeiro.querySelector(`[data-linha-dre="${chave}"]`) as HTMLElement)
        .textContent,
    );

  /** Texto da última célula (% rec. líq.) da linha. */
  const percentualDaLinha = (chave: string) =>
    normalizar(
      (hospedeiro.querySelector(`[data-linha-dre="${chave}"]`) as HTMLElement)
        .lastElementChild?.textContent,
    );

  it("a tabela do período fica em uma região que rola horizontalmente", async () => {
    await montar(NOVEMBRO);
    const tabela = [...hospedeiro.querySelectorAll("table")].find((el) =>
      el
        .querySelector("caption")
        ?.textContent?.includes("resultado do período"),
    );
    expect(tabela).toBeDefined();
    expect(
      tabela?.closest("section")?.classList.contains("overflow-x-auto"),
    ).toBe(true);
  });

  it("dia 3 do mês corrente com margem muito negativa: 'Margem em formação' no lugar do percentual", async () => {
    await montar(NOVEMBRO);

    const lucro = normalizar(quadro("Lucro líquido").textContent);
    expect(lucro).toContain("Margem em formação");
    expect(lucro).not.toContain("Margem líquida");
    expect(lucro).not.toContain("1.450");
    // O valor em reais continua à mostra.
    expect(lucro).toContain("2.900,00");
    expect(normalizar(hospedeiro.textContent)).not.toContain("1.450,0%");
  });

  it("a coluna % rec. líq. põe '—' nas linhas que carregam as despesas do mês e mantém as proporcionais às vendas", async () => {
    await montar(NOVEMBRO);

    for (const chave of [
      "despesas_fixas",
      "resultado_operacional",
      "resultado_financeiro",
      "lucro_liquido",
    ]) {
      expect(percentualDaLinha(chave), chave).toBe("—");
    }
    // O que acompanha as vendas segue com o percentual de sempre.
    expect(percentualDaLinha("receita_bruta")).toBe("100,0%");
    expect(percentualDaLinha("receita_liquida")).toBe("100,0%");
    expect(percentualDaLinha("cmv")).toBe("−40,0%");
    expect(percentualDaLinha("lucro_bruto")).toBe("60,0%");
    expect(percentualDaLinha("margem_contribuicao")).toBe("60,0%");
    // Os valores em reais das linhas afetadas não mudam.
    expect(textoDaLinha("lucro_liquido")).toContain("2.900,00");
    expect(textoDaLinha("despesas_fixas")).toContain("3.000,00");
  });

  it("as categorias que abrem por baixo das despesas também ficam sem percentual", async () => {
    await montar(NOVEMBRO);
    const abrir = hospedeiro.querySelector(
      '[data-linha-dre="despesas_fixas"] button',
    ) as HTMLButtonElement;
    await act(async () => {
      abrir.click();
    });

    const aluguel = [...hospedeiro.querySelectorAll("tbody tr")].find((tr) =>
      (tr.textContent ?? "").includes("Aluguel"),
    ) as HTMLElement;
    expect(aluguel).toBeDefined();
    expect(normalizar(aluguel.lastElementChild?.textContent)).toBe("—");
    // A sublinha da receita (aberta de saída) mantém o percentual.
    const app = [...hospedeiro.querySelectorAll("tbody tr")].find((tr) =>
      (tr.textContent ?? "").includes("App (vendas online)"),
    ) as HTMLElement;
    expect(normalizar(app.lastElementChild?.textContent)).toBe("100,0%");
  });

  it("dia 15 ainda está em formação; dia 16 mostra o percentual de verdade", async () => {
    hoje.dia = "2026-11-15";
    await montar(NOVEMBRO);
    expect(normalizar(quadro("Lucro líquido").textContent)).toContain(
      "Margem em formação",
    );

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    hoje.dia = "2026-11-16";
    await montar(NOVEMBRO);
    expect(normalizar(quadro("Lucro líquido").textContent)).toContain(
      "Margem líquida −1.450,0%",
    );
  });

  it("dia 20: tudo como sempre, com o percentual e a coluna cheia", async () => {
    hoje.dia = "2026-11-20";
    await montar(NOVEMBRO);

    const lucro = normalizar(quadro("Lucro líquido").textContent);
    expect(lucro).toContain("Margem líquida −1.450,0%");
    expect(lucro).not.toContain("em formação");
    expect(percentualDaLinha("despesas_fixas")).toBe("−1.500,0%");
    expect(percentualDaLinha("lucro_liquido")).toBe("−1.450,0%");
  });

  it("mês passado, mesmo no dia 3: tudo como sempre", async () => {
    await montar(OUTUBRO);

    const lucro = normalizar(quadro("Lucro líquido").textContent);
    expect(lucro).toContain("Margem líquida −1.450,0%");
    expect(lucro).not.toContain("em formação");
    expect(percentualDaLinha("lucro_liquido")).toBe("−1.450,0%");
  });

  it("lucro positivo no começo do mês: o percentual aparece", async () => {
    rpcFalso.mockResolvedValue({ data: DRE_NO_AZUL, error: null });
    await montar(NOVEMBRO);

    const lucro = normalizar(quadro("Lucro líquido").textContent);
    expect(lucro).toContain("Margem líquida 35,0%");
    expect(lucro).not.toContain("em formação");
    expect(percentualDaLinha("lucro_liquido")).toBe("35,0%");
  });

  it("os outros quadros não mudam em formação (margem bruta e sobra seguem as vendas)", async () => {
    await montar(NOVEMBRO);

    expect(normalizar(quadro("Lucro bruto").textContent)).toContain(
      "Margem bruta 60,0%",
    );
    expect(
      normalizar(quadro("Sobra depois dos custos da venda").textContent),
    ).toContain("60,0% da receita");
  });
});
