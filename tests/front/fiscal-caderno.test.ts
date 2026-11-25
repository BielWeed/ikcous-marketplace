import { hojeEmSaoPaulo } from "@/lib/financeiro";
// Gestão Fiscal, tarefa 10: o caderno das guias. Recebe os lançamentos da categoria de
// impostos que a lojista lançou (guia do DAS etc.) e devolve, por mês de COMPETÊNCIA, o
// valor da guia, quanto já foi pago, quanto falta e em que estado o mês está.
//
// Só lê o que ela lançou: não calcula imposto, não grava nada. O "hoje" vem de fora
// (calendário de São Paulo, `hojeEmSaoPaulo`), a função não olha o relógio.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import {
  type LancamentoDaGuia,
  type MesDoCaderno,
  montarCaderno,
} from "@/lib/fiscal/caderno";
import { describe, expect, it } from "vitest";

const TRIMESTRE = { inicio: "2026-01-01", fim: "2026-03-31" };
const HOJE = "2026-02-10";

const guia = (trocas: Partial<LancamentoDaGuia> = {}): LancamentoDaGuia => ({
  valor: 100,
  status: "previsto",
  data_competencia: "2026-01-01",
  data_vencimento: "2026-02-20",
  ...trocas,
});

const doMes = (caderno: readonly MesDoCaderno[], mes: string): MesDoCaderno => {
  const achado = caderno.find((m) => m.mes === mes);
  if (!achado) throw new Error(`mês ${mes} não veio no caderno`);
  return achado;
};

describe("montarCaderno: os meses do período", () => {
  it("devolve um item por mês do período, do mais antigo ao mais novo", () => {
    const caderno = montarCaderno([], TRIMESTRE, HOJE);
    expect(caderno.map((m) => m.mes)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("sem nenhum lançamento, todo mês é 'sem guia lançada' com tudo zerado", () => {
    const caderno = montarCaderno([], TRIMESTRE, HOJE);
    for (const m of caderno) {
      expect(m).toEqual({
        mes: m.mes,
        guia: 0,
        pago: 0,
        aPagar: 0,
        estado: "sem_guia",
      });
    }
  });

  it("período que cruza o ano mantém a ordem e o ano certo", () => {
    const caderno = montarCaderno(
      [],
      { inicio: "2026-11-01", fim: "2027-01-31" },
      "2026-12-01",
    );
    expect(caderno.map((m) => m.mes)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });
});

describe("montarCaderno: o estado de cada mês", () => {
  it("guia lançada e ainda no prazo = a pagar, e o valor da guia é o valor a pagar", () => {
    const m = doMes(
      montarCaderno([guia({ valor: 410.55 })], TRIMESTRE, HOJE),
      "2026-01",
    );
    expect(m).toEqual({
      mes: "2026-01",
      guia: 410.55,
      pago: 0,
      aPagar: 410.55,
      estado: "a_pagar",
    });
  });

  it("guia baixada = paga: o valor da guia é o pago e não sobra nada a pagar", () => {
    const m = doMes(
      montarCaderno(
        [
          guia({
            valor: 410.55,
            status: "realizado",
            data_vencimento: "2026-01-20",
          }),
        ],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m).toEqual({
      mes: "2026-01",
      guia: 410.55,
      pago: 410.55,
      aPagar: 0,
      estado: "paga",
    });
  });

  it("guia paga com vencimento antigo continua paga, não vira vencida", () => {
    const m = doMes(
      montarCaderno(
        [guia({ status: "realizado", data_vencimento: "2025-01-20" })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.estado).toBe("paga");
  });

  it("vence ontem = vencida; vence hoje ainda NÃO está vencida", () => {
    const ontem = montarCaderno(
      [guia({ data_vencimento: "2026-02-09" })],
      TRIMESTRE,
      HOJE,
    );
    const hoje = montarCaderno(
      [guia({ data_vencimento: "2026-02-10" })],
      TRIMESTRE,
      HOJE,
    );
    const amanha = montarCaderno(
      [guia({ data_vencimento: "2026-02-11" })],
      TRIMESTRE,
      HOJE,
    );
    expect(doMes(ontem, "2026-01").estado).toBe("vencida");
    expect(doMes(hoje, "2026-01").estado).toBe("a_pagar");
    expect(doMes(amanha, "2026-01").estado).toBe("a_pagar");
  });

  it("guia a pagar sem data de vencimento não pode ser vencida: fica a pagar", () => {
    const m = doMes(
      montarCaderno([guia({ data_vencimento: null })], TRIMESTRE, HOJE),
      "2026-01",
    );
    expect(m.estado).toBe("a_pagar");
  });

  it("o 'hoje' é o de São Paulo: 01h UTC do dia 11 ainda é dia 10 na loja, então vencer no dia 10 não é atraso", () => {
    const hojeNaLoja = hojeEmSaoPaulo(new Date("2026-02-11T01:00:00Z"));
    expect(hojeNaLoja).toBe("2026-02-10");
    const m = doMes(
      montarCaderno(
        [guia({ data_vencimento: "2026-02-10" })],
        TRIMESTRE,
        hojeNaLoja,
      ),
      "2026-01",
    );
    expect(m.estado).toBe("a_pagar");
  });
});

describe("montarCaderno: lançamentos que mudam a conta", () => {
  it("cancelado fica fora: sozinho, o mês continua 'sem guia lançada'", () => {
    const m = doMes(
      montarCaderno(
        [guia({ status: "cancelado", valor: 999 })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m).toEqual({
      mes: "2026-01",
      guia: 0,
      pago: 0,
      aPagar: 0,
      estado: "sem_guia",
    });
  });

  it("cancelado ao lado de uma guia viva não entra em valor nenhum", () => {
    const m = doMes(
      montarCaderno(
        [guia({ valor: 200 }), guia({ status: "cancelado", valor: 999 })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.guia).toBe(200);
    expect(m.aPagar).toBe(200);
    expect(m.estado).toBe("a_pagar");
  });

  it("status que o caderno não conhece não conta como guia (nem some em silêncio como se fosse paga)", () => {
    const m = doMes(
      montarCaderno([guia({ status: "rascunho", valor: 50 })], TRIMESTRE, HOJE),
      "2026-01",
    );
    expect(m.estado).toBe("sem_guia");
    expect(m.guia).toBe(0);
  });

  it("dois lançamentos no mesmo mês de competência somam, em centavos", () => {
    const m = doMes(
      montarCaderno(
        [guia({ valor: 0.1 }), guia({ valor: 0.2 })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.guia).toBe(0.3);
    expect(m.aPagar).toBe(0.3);
  });

  it("valores que o ponto flutuante estraga (1,15 e 0,57) saem exatos, sem 1,1499999", () => {
    const m = doMes(
      montarCaderno(
        [guia({ valor: 1.15 }), guia({ valor: 0.57, status: "realizado" })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.aPagar).toBe(1.15);
    expect(m.pago).toBe(0.57);
    expect(m.guia).toBe(1.72);
  });

  it("um pago e outro no prazo: guia é a soma, pago e a pagar separados, estado a pagar", () => {
    const m = doMes(
      montarCaderno(
        [
          guia({ valor: 300, status: "realizado" }),
          guia({ valor: 120.5, data_vencimento: "2026-03-01" }),
        ],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m).toEqual({
      mes: "2026-01",
      guia: 420.5,
      pago: 300,
      aPagar: 120.5,
      estado: "a_pagar",
    });
  });

  it("um pago e o outro vencido: o mês está vencido (falta pagar e já passou do prazo)", () => {
    const m = doMes(
      montarCaderno(
        [
          guia({ valor: 300, status: "realizado" }),
          guia({ valor: 120.5, data_vencimento: "2026-02-01" }),
        ],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.estado).toBe("vencida");
    expect(m.pago).toBe(300);
    expect(m.aPagar).toBe(120.5);
  });

  it("dois lançamentos IDÊNTICOS são duas guias, não uma duplicata a esconder", () => {
    const m = doMes(
      montarCaderno(
        [guia({ valor: 80 }), guia({ valor: 80 })],
        TRIMESTRE,
        HOJE,
      ),
      "2026-01",
    );
    expect(m.guia).toBe(160);
  });
});

describe("montarCaderno: o mês é o da COMPETÊNCIA, não o do vencimento nem o do recorte", () => {
  it("a guia de janeiro que vence em fevereiro aparece em janeiro, e fevereiro continua sem guia", () => {
    const caderno = montarCaderno(
      [guia({ data_competencia: "2026-01-01", data_vencimento: "2026-02-20" })],
      TRIMESTRE,
      HOJE,
    );
    expect(doMes(caderno, "2026-01").estado).toBe("a_pagar");
    expect(doMes(caderno, "2026-02").estado).toBe("sem_guia");
  });

  it("primeiro e último dia do mês caem no mês certo, sem deslizar por fuso", () => {
    const caderno = montarCaderno(
      [
        guia({ valor: 1, data_competencia: "2026-01-31" }),
        guia({ valor: 2, data_competencia: "2026-02-01" }),
        guia({ valor: 4, data_competencia: "2026-02-28" }),
        guia({ valor: 8, data_competencia: "2026-03-01" }),
      ],
      TRIMESTRE,
      HOJE,
    );
    expect(doMes(caderno, "2026-01").guia).toBe(1);
    expect(doMes(caderno, "2026-02").guia).toBe(6);
    expect(doMes(caderno, "2026-03").guia).toBe(8);
  });

  it("período que começa no meio do mês ainda conta a guia (competência dia 1) desse mês", () => {
    const caderno = montarCaderno(
      [guia({ valor: 77, data_competencia: "2026-01-01" })],
      { inicio: "2026-01-15", fim: "2026-02-10" },
      HOJE,
    );
    expect(caderno.map((m) => m.mes)).toEqual(["2026-01", "2026-02"]);
    expect(doMes(caderno, "2026-01").guia).toBe(77);
  });

  it("lançamento de competência fora do período não aparece nem contamina outro mês", () => {
    const caderno = montarCaderno(
      [
        guia({ valor: 500, data_competencia: "2025-12-01" }),
        guia({ valor: 600, data_competencia: "2026-04-01" }),
      ],
      TRIMESTRE,
      HOJE,
    );
    expect(caderno.map((m) => m.mes)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(caderno.every((m) => m.estado === "sem_guia")).toBe(true);
  });

  it("competência com cara de data mas que não existe (2026-01-99) não cai em janeiro", () => {
    const caderno = montarCaderno(
      [guia({ valor: 9, data_competencia: "2026-01-99" })],
      TRIMESTRE,
      HOJE,
    );
    expect(doMes(caderno, "2026-01").estado).toBe("sem_guia");
  });

  it("competência malformada não derruba a função nem cai em mês nenhum", () => {
    const caderno = montarCaderno(
      [guia({ valor: 9, data_competencia: "" }), guia({ valor: 3 })],
      TRIMESTRE,
      HOJE,
    );
    expect(doMes(caderno, "2026-01").guia).toBe(3);
    expect(caderno.reduce((soma, m) => soma + m.guia, 0)).toBe(3);
  });
});

describe("montarCaderno: não mexe no que recebeu", () => {
  it("lista congelada passa sem erro e continua igual", () => {
    const lista = Object.freeze([
      Object.freeze(guia({ valor: 10 })),
      Object.freeze(guia({ valor: 20, status: "realizado" })),
    ]);
    const caderno = montarCaderno(lista, TRIMESTRE, HOJE);
    expect(doMes(caderno, "2026-01").guia).toBe(30);
    expect(lista).toHaveLength(2);
  });
});
