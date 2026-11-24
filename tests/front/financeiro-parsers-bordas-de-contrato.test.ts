// Bordas dos leitores de resposta do banco (`parse*` de `src/lib/financeiro.ts`).
//
// A caça por mutação trocou, uma de cada vez, regras de leitura defensiva que
// nenhum teste vigiava (centavos de valor com 3 casas, "" no lugar de número,
// "true" no lugar de verdadeiro, valor zero sem tipo, tipo de conta e grupo da
// DRE desconhecidos...) e a suíte seguia verde. Valores fictícios, centavos
// escritos à mão.
import { describe, expect, it } from "vitest";

import {
  ErroDeFormatoFinanceiro,
  cascataDaDre,
  efeitoNoSaldo,
  parseCaixaAtual,
  parseCategorias,
  parseContas,
  parseDre,
  parseExtrato,
  parseIdsSalvos,
  parseMovimentoDeCaixa,
  parsePrevistos,
  parseResumo,
  previstoEhEditavel,
  serieDoFluxoDeCaixa,
} from "@/lib/financeiro";

describe("dinheiro vindo do banco sempre em centavos exatos", () => {
  it("valor com mais de 2 casas fecha em centavos (19,999 vira 20,00)", () => {
    expect(parseDre({ lucro_liquido: 19.999 }).lucroLiquido).toBe(20);
    expect(parseDre({ lucro_liquido: "19.999" }).lucroLiquido).toBe(20);
    expect(parseDre({ lucro_liquido: 0.1 + 0.2 }).lucroLiquido).toBe(0.3);
  });

  it("texto vazio ou lixo no lugar do número vira 0, nunca NaN", () => {
    const dre = parseDre({
      lucro_liquido: "",
      receita_bruta: "abc",
      cmv: null,
    });
    expect(dre.lucroLiquido).toBe(0);
    expect(dre.receitaBruta).toBe(0);
    expect(dre.cmv).toBe(0);
  });
});

describe("variação do saldo na série do resumo", () => {
  const resumoComVariacao = (variacao: unknown) =>
    parseResumo({
      serie: [
        {
          dia: "2026-09-01",
          entradas: 10,
          saidas: 4,
          variacao_saldo: variacao,
        },
      ],
    }).serie[0]?.variacaoSaldo;

  it("texto vazio é 'sem dado' (null), não uma variação de R$ 0,00", () => {
    expect(resumoComVariacao("")).toBeNull();
    expect(resumoComVariacao(null)).toBeNull();
    expect(resumoComVariacao(undefined)).toBeNull();
    expect(resumoComVariacao("lixo")).toBeNull();
  });

  it("variação negativa é mantida (queda de saldo), e zero é zero", () => {
    expect(resumoComVariacao(-6.5)).toBe(-6.5);
    expect(resumoComVariacao("0")).toBe(0);
  });
});

describe("parcelas do previsto são números inteiros", () => {
  it("parcela fracionada é cortada para baixo, não arredondada para cima", () => {
    const [item] = parsePrevistos([
      { id: "p1", valor: 10, parcela: 2.7, parcelas: "3.6" },
    ]);
    expect(item?.parcela).toBe(2);
    expect(item?.parcelas).toBe(3);
  });

  it("sem parcela, fica null (não 0)", () => {
    const [item] = parsePrevistos([{ id: "p1", valor: 10 }]);
    expect(item?.parcela).toBeNull();
    expect(item?.parcelas).toBeNull();
  });
});

describe("contas e categorias: o que o banco manda fora do contrato", () => {
  it("nome infinito (número não finito) cai no nome padrão; número finito vira texto", () => {
    const contas = parseContas([
      { id: "c1", nome: Number.POSITIVE_INFINITY },
      { id: "c2", nome: 42 },
    ]);
    expect(contas.find((c) => c.id === "c1")?.nome).toBe("Conta");
    expect(contas.find((c) => c.id === "c2")?.nome).toBe("42");
  });

  it("ativa: ausente = ativa; 'true' e 1 = ativa; null, 'false', 0 e 'sim' = inativa", () => {
    const ativa = (valor: unknown) =>
      parseContas([{ id: "c", ativa: valor }])[0]?.ativa;
    expect(parseContas([{ id: "c" }])[0]?.ativa).toBe(true);
    expect(ativa(true)).toBe(true);
    expect(ativa("true")).toBe(true);
    expect(ativa(1)).toBe(true);
    expect(ativa(null)).toBe(false);
    expect(ativa("false")).toBe(false);
    expect(ativa(0)).toBe(false);
    expect(ativa("sim")).toBe(false);
  });

  it("tipo da conta: os três conhecidos ficam, o resto vira 'outro'", () => {
    const tipo = (valor: unknown) =>
      parseContas([{ id: "c", tipo: valor }])[0]?.tipo;
    expect(tipo("caixa")).toBe("caixa");
    expect(tipo("banco")).toBe("banco");
    expect(tipo("mercado_pago")).toBe("mercado_pago");
    expect(tipo("poupanca")).toBe("outro");
    expect(tipo(undefined)).toBe("outro");
  });

  it("natureza da categoria: só 'receita' é receita (ausente é despesa)", () => {
    const natureza = (valor: unknown) =>
      parseCategorias([{ id: "k", natureza: valor }])[0]?.natureza;
    expect(natureza("receita")).toBe("receita");
    expect(natureza("despesa")).toBe("despesa");
    expect(natureza(undefined)).toBe("despesa");
    expect(natureza("outra")).toBe("despesa");
  });

  it("grupo da DRE: os seis conhecidos ficam; o desconhecido cai fora do resultado", () => {
    const grupo = (valor: unknown) =>
      parseCategorias([{ id: "k", grupo_dre: valor }])[0]?.grupoDre;
    for (const g of [
      "receita",
      "deducao",
      "custo_variavel",
      "despesa_fixa",
      "financeiro",
      "fora_dre",
    ]) {
      expect(grupo(g)).toBe(g);
    }
    expect(grupo("imposto")).toBe("fora_dre");
    expect(grupo(undefined)).toBe("fora_dre");
  });
});

describe("linha do extrato", () => {
  const linha = (extra: Record<string, unknown>) =>
    parseExtrato([{ id: "l1", data: "2026-09-01", ...extra }])[0];

  it("status: previsto e cancelado ficam; ausente ou estranho é realizado", () => {
    expect(linha({ status: "previsto" })?.status).toBe("previsto");
    expect(linha({ status: "cancelado" })?.status).toBe("cancelado");
    expect(linha({ status: "pago" })?.status).toBe("realizado");
    expect(linha({})?.status).toBe("realizado");
  });

  it("sem tipo: valor negativo é saída (guarda o módulo), zero e positivo são entrada", () => {
    expect(linha({ valor: -3 })).toMatchObject({ tipo: "saida", valor: 3 });
    expect(linha({ valor: 0 })).toMatchObject({ tipo: "entrada", valor: 0 });
    expect(linha({ valor: 5 })).toMatchObject({ tipo: "entrada", valor: 5 });
  });

  it("com tipo explícito, o tipo manda, mesmo com valor de sinal contrário", () => {
    expect(linha({ tipo: "entrada", valor: -3 })).toMatchObject({
      tipo: "entrada",
      valor: 3,
    });
  });
});

describe("resumo: entradas e saídas chegam sempre positivas", () => {
  it("total, série, canal e forma de pagamento guardam o módulo", () => {
    const resumo = parseResumo({
      entradas: -900,
      saidas: -300,
      por_canal: { online: -50, presencial: -25 },
      por_forma: [{ forma: "pix", valor: -70 }],
      serie: [{ dia: "2026-09-01", entradas: -10, saidas: -4 }],
    });
    expect(resumo.entradas).toBe(900);
    expect(resumo.saidas).toBe(300);
    expect(resumo.porCanal).toEqual({ online: 50, presencial: 25 });
    expect(resumo.porForma).toEqual([{ forma: "pix", valor: 70 }]);
    expect(resumo.serie[0]).toMatchObject({ entradas: 10, saidas: 4 });
  });

  it("conta sem nome no resumo vira 'Conta'", () => {
    const resumo = parseResumo({ contas: [{ id: "c1", saldo: 10 }] });
    expect(resumo.contas[0]?.nome).toBe("Conta");
  });

  it("caixa_aberto sem id não é caixa aberto", () => {
    expect(parseResumo({ caixa_aberto: {} }).caixaAberto).toBeNull();
    expect(parseResumo({ caixa_aberto: { id: "  " } }).caixaAberto).toBeNull();
    expect(
      parseResumo({
        caixa_aberto: { id: "cx1", conta_id: "c1", valor_abertura: 50 },
      }).caixaAberto,
    ).toMatchObject({ id: "cx1", contaId: "c1", valorAbertura: 50 });
  });
});

describe("previsto e categoria: valor e padrão", () => {
  it("valor do previsto é sempre positivo", () => {
    const [item] = parsePrevistos([{ id: "p1", valor: -80.5 }]);
    expect(item?.valor).toBe(80.5);
  });

  it("categoria sem 'ativa' no JSON é ativa; 'false' é inativa", () => {
    expect(parseCategorias([{ id: "k" }])[0]?.ativa).toBe(true);
    expect(parseCategorias([{ id: "k", ativa: false }])[0]?.ativa).toBe(false);
    expect(parseCategorias([{ id: "k", ativa: "true" }])[0]?.ativa).toBe(true);
  });

  it("só o lançamento manual se baixa ou cancela na tela", () => {
    expect(previstoEhEditavel({ origem: "manual" })).toBe(true);
    expect(previstoEhEditavel({ origem: "estorno" })).toBe(false);
    expect(previstoEhEditavel({ origem: "venda_entrega" })).toBe(false);
    expect(previstoEhEditavel({ origem: "venda_online" })).toBe(false);
  });
});

describe("caixa aberto: movimentos e totais", () => {
  const caixaCom = (extra: Record<string, unknown>) =>
    parseCaixaAtual({ id: "cx1", ...extra });

  it("totais do caixa chegam positivos", () => {
    const caixa = caixaCom({
      vendas_dinheiro: -10,
      devolucoes_dinheiro: -5,
      estornos_externos_dinheiro: -2.5,
      entradas_manuais: -7,
      saidas_manuais: -3,
    });
    expect(caixa).toMatchObject({
      vendasDinheiro: 10,
      devolucoesDinheiro: 5,
      estornosExternosDinheiro: 2.5,
      entradasManuais: 7,
      saidasManuais: 3,
    });
  });

  it("movimento: `entra` booleano decide o sentido, e o valor vai em módulo", () => {
    const caixa = caixaCom({
      movimentos: [
        { id: "m1", entra: true, valor: -5 },
        { id: "m2", entra: false, valor: 8 },
      ],
    });
    expect(caixa?.movimentos).toMatchObject([
      { id: "m1", tipo: "entrada", valor: 5 },
      { id: "m2", tipo: "saida", valor: 8 },
    ]);
  });

  it("movimento sem `entra`: valor zero sem tipo é entrada, negativo é saída", () => {
    const caixa = caixaCom({
      movimentos: [
        { id: "m1", valor: 0 },
        { id: "m2", valor: -4 },
      ],
    });
    expect(caixa?.movimentos).toMatchObject([
      { id: "m1", tipo: "entrada", valor: 0 },
      { id: "m2", tipo: "saida", valor: 4 },
    ]);
  });

  it("tipo 'entrada' explícito vence o sinal negativo do valor", () => {
    const caixa = caixaCom({
      movimentos: [{ id: "m1", tipo: "entrada", valor: -5 }],
    });
    expect(caixa?.movimentos[0]).toMatchObject({ tipo: "entrada", valor: 5 });
  });

  it("horário do movimento: `criado_em` (o que fin_caixa_atual manda) vence `created_at`", () => {
    const caixa = caixaCom({
      movimentos: [
        {
          id: "m1",
          valor: 1,
          criado_em: "2026-09-26T12:00:00Z",
          created_at: "2026-09-25T12:00:00Z",
        },
      ],
    });
    expect(caixa?.movimentos[0]?.em).toBe("2026-09-26T12:00:00Z");
  });

  it("movimento sem id ganha um id estável feito do horário e do valor", () => {
    const caixa = caixaCom({
      movimentos: [{ valor: 5, created_at: "T1" }],
    });
    expect(caixa?.movimentos[0]?.id).toBe("T1-5");
  });
});

describe("respostas pequenas das RPCs do caixa e do lançamento", () => {
  it("movimento de caixa exige `replay` booleano (resposta antiga não vale)", () => {
    expect(
      parseMovimentoDeCaixa({ id: "m", status: "ok", replay: false }),
    ).toEqual({ id: "m", status: "ok", replay: false });
    expect(() => parseMovimentoDeCaixa({ id: "m", status: "ok" })).toThrow(
      ErroDeFormatoFinanceiro,
    );
    expect(() =>
      parseMovimentoDeCaixa({ id: "m", status: "ok", replay: "false" }),
    ).toThrow(ErroDeFormatoFinanceiro);
  });

  it("ids salvos: descarta item vazio ou nulo e mantém os reais, na ordem", () => {
    expect(parseIdsSalvos({ ids: ["a", "", null, "b"] })).toEqual(["a", "b"]);
  });
});

describe("saldo e série do fluxo: bordas", () => {
  it("transferência sem conta de destino e sem filtro não mexe no saldo", () => {
    expect(
      efeitoNoSaldo({
        tipo: "transferencia",
        status: "realizado",
        valor: 10,
        contaId: "a",
        contaDestinoId: null,
      }),
    ).toBe(0);
  });

  it("valor negativo na linha conta em módulo (entrada de 10 soma +10)", () => {
    expect(
      efeitoNoSaldo({
        tipo: "entrada",
        status: "realizado",
        valor: -10,
        contaId: "a",
        contaDestinoId: null,
      }),
    ).toBe(10);
  });

  it("a série do gráfico para em 400 dias, mesmo que o intervalo peça mais", () => {
    const pontos = serieDoFluxoDeCaixa(
      [],
      { inicio: "2024-01-01", fim: "2026-12-31" },
      0,
    );
    expect(pontos).toHaveLength(400);
    expect(pontos[0]?.dia).toBe("2024-01-01");
  });
});

describe("DRE: sinal dos custos na cascata", () => {
  it("custos variáveis aparecem como abatimento, venha o número positivo ou negativo", () => {
    const valor = (custos: number) =>
      cascataDaDre(parseDre({ custos_variaveis: custos })).find(
        (l) => l.chave === "custos_variaveis",
      )?.valor;
    expect(valor(30)).toBe(-30);
    expect(valor(-30)).toBe(-30);
  });
});
