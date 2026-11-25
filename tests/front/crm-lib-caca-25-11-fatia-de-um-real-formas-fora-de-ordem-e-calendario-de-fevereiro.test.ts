// Caça por mutação em `src/lib/crm.ts` (25/11/2026), a conta que a lojista lê
// nos relatórios do CRM. Defeitos de uma linha que nenhum teste derrubava:
//   1. `diasDoIntervalo` conta dias no calendário real: de 28/02 a 01/03 são
//      2 dias (o defeito deslocava os dois lados um mês e a conta saía 5);
//   2. `formatarVariacao` escreve "+" também nas variações pequenas (0,5%);
//   3. `percentualDoTotal` arredonda sem casas por padrão e aceita total de
//      R$ 1,00 (o defeito tratava R$ 1 como "sem base" e dava 33,3 em vez de 33);
//   4. as frases dos cartões "App × loja física" e "Formas de pagamento" valem
//      já para R$ 1,00 de receita, e a forma líder é a MAIOR, em qualquer ordem;
//   5. pedido de R$ 0,00 (brinde) é venda, contado nos dois canais somados;
//   6. a idade em horas é arredondada para BAIXO (90 min é "1 hora").
// Só valores inventados.
import {
  diasDoIntervalo,
  formatarVariacao,
  fraseLeituraDasFormas,
  fraseLeituraDosCanais,
  idadePorExtenso,
  percentualDoTotal,
} from "@/lib/crm";
import type { CanalDoCrm, FormaDePagamentoDoCrm } from "@/types/crm";
import { describe, expect, it } from "vitest";

const canal = (nome: string, receita: number, pedidos: number): CanalDoCrm => ({
  canal: nome,
  receita,
  pedidos,
  ticketMedio: pedidos > 0 ? receita / pedidos : 0,
});

const forma = (nome: string, receita: number): FormaDePagamentoDoCrm => ({
  forma: nome,
  receita,
  pedidos: 1,
});

describe("dias do intervalo — calendário real, inclusive a virada de fevereiro", () => {
  it("de 28/02/2026 a 01/03/2026 são 2 dias (fevereiro tem 28)", () => {
    expect(diasDoIntervalo({ inicio: "2026-02-28", fim: "2026-03-01" })).toBe(
      2,
    );
  });

  it("de 31/01/2026 a 01/03/2026 são 30 dias (31/01 + 28 de fevereiro + 01/03 - 1)", () => {
    expect(diasDoIntervalo({ inicio: "2026-01-31", fim: "2026-03-01" })).toBe(
      30,
    );
  });

  it("de 01/12/2025 a 03/01/2026 são 34 dias (a virada do ano)", () => {
    expect(diasDoIntervalo({ inicio: "2025-12-01", fim: "2026-01-03" })).toBe(
      34,
    );
  });

  it("um dia só vale 1", () => {
    expect(diasDoIntervalo({ inicio: "2026-11-25", fim: "2026-11-25" })).toBe(
      1,
    );
  });
});

describe("variação percentual escrita para a lojista", () => {
  it("meio ponto para cima é '+0,5%', um ponto é '+1%'", () => {
    expect(formatarVariacao(0.5)).toBe("+0,5%");
    expect(formatarVariacao(1)).toBe("+1%");
  });

  it("meio ponto para baixo é '−0,5%' (sinal de menos de verdade)", () => {
    expect(formatarVariacao(-0.5)).toBe("−0,5%");
  });

  it("menos de 0,05 ponto arredonda para '0%', sem sinal", () => {
    expect(formatarVariacao(0.04)).toBe("0%");
  });
});

describe("percentual do total", () => {
  it("1 de 3 sem pedir casas é 33 (inteiro), e com 1 casa é 33,3", () => {
    expect(percentualDoTotal(1, 3)).toBe(33);
    expect(percentualDoTotal(1, 3, 1)).toBe(33.3);
  });

  it("total de R$ 1,00 é base válida: 1 de 1 é 100", () => {
    expect(percentualDoTotal(1, 1)).toBe(100);
  });

  it("total zero ou negativo não tem base: nulo, nunca 0%", () => {
    expect(percentualDoTotal(5, 0)).toBeNull();
    expect(percentualDoTotal(5, -3)).toBeNull();
  });
});

describe("frase do cartão App × loja física", () => {
  it("só R$ 1,00 vendido no app: o app fez 100% (R$ 1 já é venda)", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 1, 1), canal("presencial", 0, 0)),
    ).toBe("O app fez 100% da receita do período.");
  });

  it("só R$ 1,00 vendido na loja física: a loja física fez 100%", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 0, 0), canal("presencial", 1, 1)),
    ).toBe("A loja física fez 100% da receita do período.");
  });

  it("um brinde só no app (R$ 0,00, 1 pedido): a frase fala em brindes", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 0, 1), canal("presencial", 0, 0)),
    ).toBe("As vendas do período somaram R$ 0,00 (brindes).");
  });

  it("um brinde só na loja física: a frase também fala em brindes", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 0, 0), canal("presencial", 0, 1)),
    ).toBe("As vendas do período somaram R$ 0,00 (brindes).");
  });

  it("um brinde em cada canal (2 pedidos de R$ 0,00): brindes, não 'nenhuma venda'", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 0, 1), canal("presencial", 0, 1)),
    ).toBe("As vendas do período somaram R$ 0,00 (brindes).");
  });

  it("nenhum pedido em nenhum canal: 'Nenhuma venda no período.'", () => {
    expect(
      fraseLeituraDosCanais(canal("online", 0, 0), canal("presencial", 0, 0)),
    ).toBe("Nenhuma venda no período.");
  });
});

describe("frase do cartão Formas de pagamento", () => {
  it("a forma líder é a de MAIOR receita, em qualquer ordem da lista", () => {
    const esperado = "Cartão de crédito é 90% da receita do período.";
    expect(
      fraseLeituraDasFormas([forma("pix", 10), forma("credito", 90)]),
    ).toBe(esperado);
    expect(
      fraseLeituraDasFormas([forma("credito", 90), forma("pix", 10)]),
    ).toBe(esperado);
    expect(
      fraseLeituraDasFormas([
        forma("pix", 10),
        forma("dinheiro", 50),
        forma("credito", 90),
      ]),
    ).toBe("Cartão de crédito é 60% da receita do período.");
  });

  it("uma forma só com R$ 1,00 já é 100% (R$ 1 é receita)", () => {
    expect(fraseLeituraDasFormas([forma("pix", 1)])).toBe(
      "PIX é 100% da receita do período.",
    );
  });

  it("receita total zero: sem frase", () => {
    expect(fraseLeituraDasFormas([forma("pix", 0)])).toBeNull();
    expect(fraseLeituraDasFormas([])).toBeNull();
  });
});

describe("idade por extenso — horas arredondadas para baixo", () => {
  const agora = Date.parse("2026-11-25T12:00:00Z");
  const haMinutos = (m: number) => new Date(agora - m * 60_000).toISOString();

  it("90 minutos é '1 hora' (não 2)", () => {
    expect(idadePorExtenso(haMinutos(90), agora)).toBe("1 hora");
  });

  it("119 minutos ainda é '1 hora'; 120 é '2 horas'", () => {
    expect(idadePorExtenso(haMinutos(119), agora)).toBe("1 hora");
    expect(idadePorExtenso(haMinutos(120), agora)).toBe("2 horas");
  });

  it("36 horas é '1 dia' (a conta em dias também é para baixo)", () => {
    expect(idadePorExtenso(haMinutos(36 * 60), agora)).toBe("1 dia");
  });
});
