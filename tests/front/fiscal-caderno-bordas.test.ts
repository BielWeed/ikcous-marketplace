// Gestão Fiscal, caça por mutação: as bordas do caderno das guias que os testes de
// `fiscal-caderno.test.ts` deixavam passar.
//
// O que cada teste protege (em português simples):
//   - uma guia lançada com valor ZERO continua sendo uma guia: se está a pagar, o mês
//     aparece como "a pagar", e se está paga, como "paga" (nunca "sem guia lançada");
//   - a virada de dezembro para janeiro: vencimento no ano seguinte, "hoje" no dia do
//     vencimento (ainda não é atraso) e o dia seguinte (já é);
//   - competência que parece data mas não existe (30 de fevereiro) não cai em mês nenhum;
//   - a soma é feita em centavos.
//
// Todos os valores abaixo foram escritos à mão, sem refazer a conta do código.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type LancamentoDaGuia,
  type MesDoCaderno,
  montarCaderno,
} from "@/lib/fiscal/caderno";

const guia = (trocas: Partial<LancamentoDaGuia> = {}): LancamentoDaGuia => ({
  valor: 100,
  status: "previsto",
  data_competencia: "2026-01-01",
  data_vencimento: "2026-02-20",
  ...trocas,
});

const JANEIRO = { inicio: "2026-01-01", fim: "2026-01-31" };

const doMes = (caderno: readonly MesDoCaderno[], mes: string): MesDoCaderno => {
  const achado = caderno.find((m) => m.mes === mes);
  if (!achado) throw new Error(`mês ${mes} não veio no caderno`);
  return achado;
};

describe("montarCaderno: guia lançada com valor zero ainda é uma guia", () => {
  it("previsto de R$ 0,00 no prazo: o mês está 'a pagar' (e não 'paga')", () => {
    const [janeiro] = montarCaderno(
      [guia({ valor: 0, status: "previsto", data_vencimento: "2026-02-20" })],
      JANEIRO,
      "2026-02-10",
    );
    expect(janeiro).toEqual({
      mes: "2026-01",
      guia: 0,
      pago: 0,
      aPagar: 0,
      estado: "a_pagar",
    });
  });

  it("previsto de R$ 0,00 já vencido: o mês está 'vencida'", () => {
    const [janeiro] = montarCaderno(
      [guia({ valor: 0, status: "previsto", data_vencimento: "2026-02-20" })],
      JANEIRO,
      "2026-02-21",
    );
    expect(janeiro?.estado).toBe("vencida");
  });

  it("realizado de R$ 0,00: o mês está 'paga' (e não 'sem guia lançada')", () => {
    const [janeiro] = montarCaderno(
      [guia({ valor: 0, status: "realizado" })],
      JANEIRO,
      "2026-02-10",
    );
    expect(janeiro).toEqual({
      mes: "2026-01",
      guia: 0,
      pago: 0,
      aPagar: 0,
      estado: "paga",
    });
  });

  it("uma paga de R$ 100 e uma prevista de R$ 0: ainda falta lançar o pagamento da segunda", () => {
    const [janeiro] = montarCaderno(
      [
        guia({ valor: 100, status: "realizado" }),
        guia({ valor: 0, status: "previsto" }),
      ],
      JANEIRO,
      "2026-02-10",
    );
    expect(janeiro).toEqual({
      mes: "2026-01",
      guia: 100,
      pago: 100,
      aPagar: 0,
      estado: "a_pagar",
    });
  });
});

describe("montarCaderno: a virada de dezembro para janeiro", () => {
  const PERIODO = { inicio: "2026-11-01", fim: "2027-02-28" };

  it("guia de dezembro vence em janeiro do ano seguinte e continua sendo do mês 2026-12", () => {
    const caderno = montarCaderno(
      [
        guia({
          valor: 250,
          data_competencia: "2026-12-01",
          data_vencimento: "2027-01-20",
        }),
      ],
      PERIODO,
      "2027-01-10",
    );
    expect(doMes(caderno, "2026-12")).toEqual({
      mes: "2026-12",
      guia: 250,
      pago: 0,
      aPagar: 250,
      estado: "a_pagar",
    });
    // O vencimento em janeiro não cria guia no mês 2027-01.
    expect(doMes(caderno, "2027-01").estado).toBe("sem_guia");
  });

  it("vencer hoje (20/01) ainda não é atraso; no dia seguinte é", () => {
    const lancamentos = [
      guia({
        data_competencia: "2026-12-01",
        data_vencimento: "2027-01-20",
      }),
    ];
    expect(
      doMes(montarCaderno(lancamentos, PERIODO, "2027-01-20"), "2026-12")
        .estado,
    ).toBe("a_pagar");
    expect(
      doMes(montarCaderno(lancamentos, PERIODO, "2027-01-21"), "2026-12")
        .estado,
    ).toBe("vencida");
  });

  it("novembro vencido em 21/12 e dezembro no prazo: cada mês tem o seu estado", () => {
    const caderno = montarCaderno(
      [
        guia({
          data_competencia: "2026-11-01",
          data_vencimento: "2026-12-21",
        }),
        guia({
          data_competencia: "2026-12-01",
          data_vencimento: "2027-01-20",
        }),
      ],
      PERIODO,
      "2027-01-05",
    );
    expect(doMes(caderno, "2026-11").estado).toBe("vencida");
    expect(doMes(caderno, "2026-12").estado).toBe("a_pagar");
  });

  it("competência de dezembro fica fora de um período que só tem 2027", () => {
    const caderno = montarCaderno(
      [guia({ data_competencia: "2026-12-01" })],
      { inicio: "2027-01-01", fim: "2027-03-31" },
      "2027-01-05",
    );
    expect(caderno.map((m) => m.estado)).toEqual([
      "sem_guia",
      "sem_guia",
      "sem_guia",
    ]);
  });
});

describe("montarCaderno: data que não existe e dinheiro em centavos", () => {
  it("competência de 30 de fevereiro não existe e não cai em fevereiro", () => {
    const caderno = montarCaderno(
      [guia({ data_competencia: "2026-02-30" })],
      { inicio: "2026-01-01", fim: "2026-03-31" },
      "2026-03-01",
    );
    expect(caderno.map((m) => m.estado)).toEqual([
      "sem_guia",
      "sem_guia",
      "sem_guia",
    ]);
  });

  it("soma R$ 0,10 + R$ 0,20 em centavos: dá exatamente R$ 0,30", () => {
    const [janeiro] = montarCaderno(
      [guia({ valor: 0.1 }), guia({ valor: 0.2 })],
      JANEIRO,
      "2026-02-10",
    );
    expect(janeiro?.guia).toBe(0.3);
    expect(janeiro?.aPagar).toBe(0.3);
  });
});
