// @vitest-environment jsdom
//
// DRE "MÊS A MÊS" SÓ ATÉ 12 MESES (r136-b).
//
// A aba DRE só oferece a visão "Mês a mês" quando o período tem de 2 a 12
// meses (`podeMensal = meses.length > 1 && meses.length <= MAXIMO_DE_MESES`).
// O limite existe porque cada coluna é UMA chamada `fin_dre`: um período de 14
// meses faria 14 chamadas pesadas ao banco de uma vez (e uma tabela larga
// demais para a tela). Nenhum teste derrubava o teto -- o `admin-financeiro-dre`
// só prova 2 e 3 meses.
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
  cmv_estimado: false,
  lucro_bruto: 5700,
  custos_variaveis: 950,
  margem_contribuicao: 4750,
  despesas_fixas: 2850,
  resultado_operacional: 1900,
  resultado_financeiro: -95,
  lucro_liquido: 1805,
  linhas: [{ grupo: "receita", categoria: "App", valor: 6000 }],
};

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — DRE: mês a mês só até 12 meses", () => {
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
          rotuloDoPeriodo="Período de teste"
        />,
      );
    });
    await esperar();
  }

  const botaoMensal = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Mês a mês",
    ) as HTMLButtonElement | undefined;

  it("14 meses (jan/26 a 5 de fev/27): não oferece 'Mês a mês'", async () => {
    await montar({ inicio: "2026-01-01", fim: "2027-02-05" });

    expect(botaoMensal()).toBeUndefined();
    // A visão do período continua lá: a aba não some, só o mês a mês.
    expect(hospedeiro.querySelector("[data-aba-resultado]")).not.toBeNull();
  });

  it("14 meses: chama fin_dre UMA vez (o período inteiro), não uma por mês, mesmo se alguém tentar alternar", async () => {
    await montar({ inicio: "2026-01-01", fim: "2027-02-05" });
    // Se o botão existisse, a pessoa clicaria nele -- é aí que o banco levaria
    // as 14 chamadas. Sem botão, não há o que clicar.
    const botao = botaoMensal();
    if (botao) {
      await act(async () => {
        botao.click();
      });
      await esperar();
    }

    expect(rpcFalso.mock.calls).toEqual([
      ["fin_dre", { p_inicio: "2026-01-01", p_fim: "2027-02-05" }],
    ]);
  });

  it("13 meses (a primeira acima do teto): também não oferece 'Mês a mês'", async () => {
    await montar({ inicio: "2026-01-01", fim: "2027-01-31" });

    expect(botaoMensal()).toBeUndefined();
  });

  it("CONTROLE: exatamente 12 meses oferece 'Mês a mês' e ele busca um mês por chamada", async () => {
    await montar({ inicio: "2026-01-01", fim: "2026-12-31" });

    const botao = botaoMensal();
    expect(botao).toBeDefined();

    rpcFalso.mockClear();
    await act(async () => {
      botao?.click();
    });
    await esperar();

    expect(rpcFalso).toHaveBeenCalledTimes(12);
    expect(rpcFalso.mock.calls[0]).toEqual([
      "fin_dre",
      { p_inicio: "2026-01-01", p_fim: "2026-01-31" },
    ]);
    expect(rpcFalso.mock.calls[11]).toEqual([
      "fin_dre",
      { p_inicio: "2026-12-01", p_fim: "2026-12-31" },
    ]);
  });

  it("CONTROLE: um mês único não oferece 'Mês a mês' (não há o que comparar)", async () => {
    await montar({ inicio: "2026-09-01", fim: "2026-09-30" });

    expect(botaoMensal()).toBeUndefined();
    expect(rpcFalso).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: dois meses oferecem 'Mês a mês' (o piso da faixa)", async () => {
    await montar({ inicio: "2026-08-01", fim: "2026-09-30" });

    expect(botaoMensal()).toBeDefined();
  });
});
