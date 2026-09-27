// Funções puras do redesenho visual das abas "Canais" e "Funil e pedidos"
// do Dashboard CRM (spec `docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md`).
// Arquivo NOVO para não conflitar com `crm-e-inicio-funcoes-puras.test.ts`,
// que outra dupla mexe em paralelo.
import {
  conversaoEntreEtapas,
  diasPorExtenso,
  fraseLeituraDasFormas,
  fraseLeituraDosCanais,
  garantirAppELoja,
  pedidosNaoPagos,
  percentualDoTotal,
  taxaDePagamento,
  ticketPorForma,
} from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("garantirAppELoja", () => {
  it("canal ausente vira zero — os dois canais aparecem sempre", () => {
    const resultado = garantirAppELoja([
      { canal: "presencial", receita: 187.4, pedidos: 2, ticketMedio: 93.7 },
    ]);
    expect(resultado.presencial).toEqual({
      canal: "presencial",
      receita: 187.4,
      pedidos: 2,
      ticketMedio: 93.7,
    });
    expect(resultado.online).toEqual({
      canal: "online",
      receita: 0,
      pedidos: 0,
      ticketMedio: 0,
    });
  });

  it("lista vazia: os dois canais vêm zerados", () => {
    const resultado = garantirAppELoja([]);
    expect(resultado.online.receita).toBe(0);
    expect(resultado.presencial.receita).toBe(0);
  });

  it("os dois canais presentes: nenhum é inventado", () => {
    const resultado = garantirAppELoja([
      { canal: "online", receita: 3000, pedidos: 15, ticketMedio: 200 },
      { canal: "presencial", receita: 2000, pedidos: 25, ticketMedio: 80 },
    ]);
    expect(resultado.online.receita).toBe(3000);
    expect(resultado.presencial.receita).toBe(2000);
  });
});

describe("percentualDoTotal", () => {
  it("divisão por zero: total <= 0 vira null, nunca 0%", () => {
    expect(percentualDoTotal(50, 0)).toBeNull();
    expect(percentualDoTotal(0, 0)).toBeNull();
    expect(percentualDoTotal(50, -10)).toBeNull();
  });

  it("arredondamento por casas decimais", () => {
    expect(percentualDoTotal(1, 3, 0)).toBe(33);
    expect(percentualDoTotal(2, 3, 1)).toBe(66.7);
    expect(percentualDoTotal(3500, 5000)).toBe(70);
  });
});

describe("ticketPorForma", () => {
  it("divisão por zero: sem pedidos, ticket é null (não sei, não zero)", () => {
    expect(ticketPorForma(1500, 0)).toBeNull();
    expect(ticketPorForma(0, 0)).toBeNull();
  });

  it("receita ÷ pedidos, arredondado ao centavo", () => {
    expect(ticketPorForma(1500, 20)).toBe(75);
    expect(ticketPorForma(100, 3)).toBe(33.33);
  });
});

describe("conversaoEntreEtapas", () => {
  it("conversão > 100% vira null — um funil nunca mostra mais de 100%", () => {
    expect(conversaoEntreEtapas(105, 100)).toBeNull();
    expect(conversaoEntreEtapas(13, 2)).toBeNull(); // o caso real do "650%"
  });

  it("exatamente 100% é um valor válido", () => {
    expect(conversaoEntreEtapas(40, 40)).toBe(100);
  });

  it("divisão por zero e etapas não medidas viram null", () => {
    expect(conversaoEntreEtapas(10, 0)).toBeNull();
    expect(conversaoEntreEtapas(null, 40)).toBeNull();
    expect(conversaoEntreEtapas(40, null)).toBeNull();
  });

  it("arredonda a 1 casa decimal", () => {
    expect(conversaoEntreEtapas(40, 60)).toBe(66.7);
  });
});

describe("taxaDePagamento", () => {
  it("pagos ÷ criados, mesma unidade (pedidos)", () => {
    expect(taxaDePagamento(60, 40)).toBe(66.7);
  });

  it("pagos > criados (janela de data) ainda vira null, nunca acima de 100%", () => {
    expect(taxaDePagamento(10, 12)).toBeNull();
  });

  it("sem pedidos criados: null, não 0%", () => {
    expect(taxaDePagamento(0, 0)).toBeNull();
  });
});

describe("pedidosNaoPagos", () => {
  it("etapa não medida vira null", () => {
    expect(pedidosNaoPagos(null, 5)).toBeNull();
    expect(pedidosNaoPagos(13, null)).toBeNull();
  });

  it("diferença entre criados e pagos, nunca negativa", () => {
    expect(pedidosNaoPagos(13, 0)).toBe(13);
    expect(pedidosNaoPagos(60, 40)).toBe(20);
    expect(pedidosNaoPagos(10, 12)).toBe(0);
  });
});

describe("fraseLeituraDosCanais", () => {
  it("um canal zerado: a frase nomeia quem fez 100%", () => {
    const online = { canal: "online", receita: 0, pedidos: 0, ticketMedio: 0 };
    const presencial = {
      canal: "presencial",
      receita: 187.4,
      pedidos: 2,
      ticketMedio: 93.7,
    };
    expect(fraseLeituraDosCanais(online, presencial)).toBe(
      "A loja física fez 100% da receita do período.",
    );
  });

  it("app na frente", () => {
    const online = {
      canal: "online",
      receita: 8000,
      pedidos: 40,
      ticketMedio: 200,
    };
    const presencial = {
      canal: "presencial",
      receita: 2000,
      pedidos: 20,
      ticketMedio: 100,
    };
    expect(fraseLeituraDosCanais(online, presencial)).toBe(
      "O app fez 80% da receita do período.",
    );
  });

  it("quase empatado: frase neutra, sem apontar líder por 1 ponto", () => {
    const online = {
      canal: "online",
      receita: 5100,
      pedidos: 10,
      ticketMedio: 510,
    };
    const presencial = {
      canal: "presencial",
      receita: 4900,
      pedidos: 10,
      ticketMedio: 490,
    };
    expect(fraseLeituraDosCanais(online, presencial)).toBe(
      "App e loja física dividem a receita quase igual neste período.",
    );
  });

  it("sem venda nos dois canais", () => {
    const zero = { canal: "x", receita: 0, pedidos: 0, ticketMedio: 0 };
    expect(fraseLeituraDosCanais(zero, zero)).toBe("Nenhuma venda no período.");
  });
});

describe("fraseLeituraDasFormas", () => {
  it("aponta a forma líder e a fatia dela", () => {
    expect(
      fraseLeituraDasFormas([
        { forma: "pix", receita: 3500, pedidos: 20 },
        { forma: "cash", receita: 1500, pedidos: 20 },
      ]),
    ).toBe("PIX é 70% da receita do período.");
  });

  it("sem pagamentos: null", () => {
    expect(fraseLeituraDasFormas([])).toBeNull();
    expect(
      fraseLeituraDasFormas([{ forma: "pix", receita: 0, pedidos: 0 }]),
    ).toBeNull();
  });
});

describe("diasPorExtenso", () => {
  it("escreve 'dias' por extenso, nunca 'd'", () => {
    expect(diasPorExtenso(81)).toBe("81 dias");
    expect(diasPorExtenso(2)).toBe("2 dias");
  });

  it("singular para 1 dia", () => {
    expect(diasPorExtenso(1)).toBe("1 dia");
  });

  it("arredonda para baixo e nunca fica negativo", () => {
    expect(diasPorExtenso(1.9)).toBe("1 dia");
    expect(diasPorExtenso(-3)).toBe("0 dias");
  });
});
