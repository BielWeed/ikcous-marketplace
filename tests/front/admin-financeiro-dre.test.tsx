// @vitest-environment jsdom
//
// Financeiro — aba "DRE": a cascata clássica (receita bruta → … → lucro
// líquido) com o % de cada linha sobre a receita líquida, subtotais em
// destaque, CMV marcado como estimado quando o servidor diz, categorias que
// abrem por baixo e, em período de vários meses, as colunas mês a mês (uma
// `fin_dre` por mês).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import type { IntervaloDeDatas } from "@/types/financeiro";

const DRE = {
  receita_bruta: 10000,
  receita_online: 6000,
  receita_balcao: 4000,
  deducoes: 500,
  receita_liquida: 9500,
  cmv: 3800,
  cmv_estimado: true,
  lucro_bruto: 5700,
  custos_variaveis: 950,
  margem_contribuicao: 4750,
  despesas_fixas: 2850,
  resultado_operacional: 1900,
  resultado_financeiro: -95,
  lucro_liquido: 1805,
  linhas: [
    { grupo: "despesa_fixa", categoria: "Aluguel", valor: 2000 },
    { grupo: "despesa_fixa", categoria: "Internet", valor: 850 },
    { grupo: "deducao", categoria: "Devoluções", valor: 500 },
  ],
};

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — DRE", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: DRE, error: null });
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
          rotuloDoPeriodo="Setembro de 2026"
        />,
      );
    });
    await esperar();
  }

  const linha = (chave: string) =>
    hospedeiro.querySelector(`[data-linha-dre="${chave}"]`) as HTMLElement;

  it("cada linha com valor e % da receita líquida; subtotais em destaque", async () => {
    await montar({ inicio: "2026-09-01", fim: "2026-09-30" });

    expect(rpcFalso).toHaveBeenCalledWith("fin_dre", {
      p_inicio: "2026-09-01",
      p_fim: "2026-09-30",
    });

    const esperado: [string, string, string][] = [
      ["receita_bruta", "R$ 10.000,00", "105,3%"],
      ["deducoes", "−R$ 500,00", "−5,3%"],
      ["receita_liquida", "R$ 9.500,00", "100,0%"],
      ["cmv", "−R$ 3.800,00", "−40,0%"],
      ["lucro_bruto", "R$ 5.700,00", "60,0%"],
      ["custos_variaveis", "−R$ 950,00", "−10,0%"],
      ["margem_contribuicao", "R$ 4.750,00", "50,0%"],
      ["despesas_fixas", "−R$ 2.850,00", "−30,0%"],
      ["resultado_operacional", "R$ 1.900,00", "20,0%"],
      ["resultado_financeiro", "−R$ 95,00", "−1,0%"],
      ["lucro_liquido", "R$ 1.805,00", "19,0%"],
    ];
    for (const [chave, valor, pct] of esperado) {
      const texto = normalizar(linha(chave).textContent);
      expect(texto, chave).toContain(valor);
      expect(texto, chave).toContain(pct);
    }

    // Subtotais em negrito e com fundo; o lucro líquido é a linha final.
    for (const chave of [
      "receita_liquida",
      "lucro_bruto",
      "margem_contribuicao",
      "resultado_operacional",
    ]) {
      expect(linha(chave).className, chave).toContain("font-black");
      expect(linha(chave).className, chave).toContain("border-t");
    }
    expect(linha("lucro_liquido").className).toContain("border-admin-gold/40");
    expect(linha("cmv").className).not.toContain("font-black");

    // O CMV avisa que é estimado pelo custo ATUAL dos produtos.
    expect(normalizar(linha("cmv").textContent)).toContain(
      "Estimado pelo custo atual dos produtos",
    );

    // A receita bruta já abre separando app e loja física.
    const tudo = normalizar(hospedeiro.textContent);
    expect(tudo).toMatch(/App \(vendas online\) ?R\$ 6\.000,00/);
    expect(tudo).toMatch(/Loja física \(balcão e entrega\) ?R\$ 4\.000,00/);
  });

  it("despesas fixas abrem as categorias por baixo", async () => {
    await montar({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(normalizar(hospedeiro.textContent)).not.toContain("Aluguel");

    const botao = linha("despesas_fixas").querySelector(
      "button[aria-expanded]",
    ) as HTMLButtonElement;
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      botao.click();
    });

    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const tudo = normalizar(hospedeiro.textContent);
    expect(tudo).toMatch(/Aluguel ?−R\$ 2\.000,00/);
    expect(tudo).toMatch(/Internet ?−R\$ 850,00/);
  });

  it("período de vários meses ganha colunas mês a mês", async () => {
    await montar({ inicio: "2026-07-01", fim: "2026-09-30" });
    rpcFalso.mockClear();

    const mensal = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Mês a mês",
    ) as HTMLButtonElement;
    await act(async () => {
      mensal.click();
    });
    await esperar();

    expect(rpcFalso.mock.calls).toEqual([
      ["fin_dre", { p_inicio: "2026-07-01", p_fim: "2026-07-31" }],
      ["fin_dre", { p_inicio: "2026-08-01", p_fim: "2026-08-31" }],
      ["fin_dre", { p_inicio: "2026-09-01", p_fim: "2026-09-30" }],
    ]);
    const cabecalho = [...hospedeiro.querySelectorAll("thead th")].map((th) =>
      normalizar(th.textContent),
    );
    expect(cabecalho).toEqual(["Linha", "jul/26", "ago/26", "set/26", "Total"]);
  });

  it("falha do servidor vira frase com tentar de novo", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await montar({ inicio: "2026-09-01", fim: "2026-09-30" });

    const texto = normalizar(hospedeiro.textContent);
    expect(texto).toContain(
      "O Financeiro ainda não foi instalado no banco desta loja.",
    );
    expect(texto).not.toContain("Could not find");
    expect(texto).toContain("Tentar de novo");
  });
});
