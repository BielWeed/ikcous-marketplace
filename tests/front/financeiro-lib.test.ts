// Funções puras do Financeiro (src/lib/financeiro.ts): dinheiro em pt-BR,
// conta de período no calendário da loja, parsers defensivos das RPCs
// `fin_*`, agrupamento do extrato, saldo corrente, DRE e validação do
// lançamento. Sem DOM — o que a tela faz com isso tem teste próprio.
import { describe, expect, it } from "vitest";

import {
  ErroDeFormatoFinanceiro,
  agruparExtratoPorDia,
  cascataDaDre,
  diferencaDoFechamento,
  efeitoNoSaldo,
  formatarBRL,
  formatarBRLComSinal,
  formatarPercentual,
  formularioInicialDoLancamento,
  hojeEmSaoPaulo,
  intervaloDoPeriodo,
  mensagemDeErroFinanceiro,
  mesesDoIntervalo,
  ordenarPorVencimento,
  parseCaixaAtual,
  parseContas,
  parseDre,
  parseExtrato,
  parsePrevistos,
  parseResumo,
  parseValorBR,
  percentualDaReceita,
  saldoCorrenteRetroativo,
  serieDoFluxoDeCaixa,
  situacaoDoVencimento,
  sublinhasDaDre,
  textoDoVencimento,
  totaisDosPrevistos,
  validarCategoria,
  validarConta,
  validarIntervalo,
  validarLancamento,
  valorDaParcela,
} from "@/lib/financeiro";
import type { LinhaDoExtrato } from "@/types/financeiro";

/** O Intl põe espaço inseparável depois de "R$"; o teste compara texto. */
const semNbsp = (texto: string) => texto.replace(/\s/g, " ");

describe("dinheiro em pt-BR", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1234,5", 1234.5],
    ["1.234", 1234],
    ["1234.56", 1234.56],
    ["0,01", 0.01],
    ["R$ 1.234,56", 1234.56],
    [`R$${String.fromCharCode(160)}1.234,56`, 1234.56],
    ["1.234.567,89", 1234567.89],
    ["  10  ", 10],
    ["-10,00", -10],
  ])("lê %s como %s", (texto, esperado) => {
    expect(parseValorBR(texto)).toBe(esperado);
  });

  it.each(["", "abc", "1,234", "12.34,5", "1.2.3", "10,", ",5", "R$"])(
    "recusa %j",
    (texto) => {
      expect(parseValorBR(texto)).toBeNull();
    },
  );

  it("arredonda número para centavos e recusa NaN", () => {
    expect(parseValorBR(10.006)).toBe(10.01);
    expect(parseValorBR(Number.NaN)).toBeNull();
    expect(parseValorBR(null)).toBeNull();
  });

  it("formata com e sem sinal, sem '-0'", () => {
    expect(semNbsp(formatarBRL(1234.5))).toBe("R$ 1.234,50");
    expect(semNbsp(formatarBRL(-0.001))).toBe("R$ 0,00");
    expect(semNbsp(formatarBRLComSinal(10))).toBe("+R$ 10,00");
    expect(semNbsp(formatarBRLComSinal(-10))).toBe("−R$ 10,00");
    expect(semNbsp(formatarBRLComSinal(0))).toBe("R$ 0,00");
    expect(formatarPercentual(12.345)).toBe("12,3%");
    expect(formatarPercentual(-5.26)).toBe("−5,3%");
    expect(formatarPercentual(null)).toBe("—");
  });

  it("divide parcelas em centavos e diz quando não fecha", () => {
    expect(valorDaParcela(90, 3)).toEqual({ parcela: 30, exata: true });
    expect(valorDaParcela(100, 3)).toEqual({ parcela: 33.33, exata: false });
    expect(valorDaParcela(1234.56, 3)).toEqual({
      parcela: 411.52,
      exata: true,
    });
  });
});

describe("período no calendário da loja", () => {
  it("hoje é o dia de São Paulo, não o de UTC", () => {
    // 02:30 UTC do dia 27 ainda é 23:30 do dia 26 em Brasília.
    expect(hojeEmSaoPaulo(new Date("2026-09-27T02:30:00Z"))).toBe("2026-09-26");
    expect(hojeEmSaoPaulo(new Date("2026-09-27T03:00:00Z"))).toBe("2026-09-27");
  });

  it("mês atual e anterior são o calendário inteiro", () => {
    expect(intervaloDoPeriodo({ preset: "mes_atual" }, "2026-09-26")).toEqual({
      inicio: "2026-09-01",
      fim: "2026-09-30",
    });
    expect(
      intervaloDoPeriodo({ preset: "mes_anterior" }, "2026-01-15"),
    ).toEqual({ inicio: "2025-12-01", fim: "2025-12-31" });
    expect(
      intervaloDoPeriodo({ preset: "mes_anterior" }, "2024-03-10"),
    ).toEqual({ inicio: "2024-02-01", fim: "2024-02-29" });
  });

  it("7 e 30 dias terminam hoje; ano é o ano inteiro", () => {
    expect(intervaloDoPeriodo({ preset: "7d" }, "2026-09-26")).toEqual({
      inicio: "2026-09-20",
      fim: "2026-09-26",
    });
    expect(intervaloDoPeriodo({ preset: "30d" }, "2026-09-26")).toEqual({
      inicio: "2026-08-28",
      fim: "2026-09-26",
    });
    expect(intervaloDoPeriodo({ preset: "ano" }, "2026-09-26")).toEqual({
      inicio: "2026-01-01",
      fim: "2026-12-31",
    });
  });

  it("personalizado só vale com datas reais e em ordem", () => {
    const ok = { inicio: "2026-09-01", fim: "2026-09-10" };
    expect(
      intervaloDoPeriodo(
        { preset: "personalizado", personalizado: ok },
        "2026-09-26",
      ),
    ).toEqual(ok);
    expect(
      intervaloDoPeriodo(
        {
          preset: "personalizado",
          personalizado: { inicio: "2026-09-10", fim: "2026-09-01" },
        },
        "2026-09-26",
      ),
    ).toBeNull();
    expect(
      intervaloDoPeriodo({ preset: "personalizado" }, "2026-09-26"),
    ).toBeNull();
    expect(validarIntervalo("2026-02-30", "2026-03-01")).toBe(
      "Informe a data de início.",
    );
  });

  it("quebra o período em meses recortados", () => {
    expect(
      mesesDoIntervalo({ inicio: "2026-01-15", fim: "2026-03-10" }).map(
        ({ inicio, fim }) => [inicio, fim],
      ),
    ).toEqual([
      ["2026-01-15", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-10"],
    ]);
  });
});

describe("parsers defensivos", () => {
  it("resumo: número como texto, lista nula, série ordenada", () => {
    const resumo = parseResumo({
      periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
      saldo_total: "1500.5",
      contas: [
        { id: "c1", nome: "Caixa", tipo: "caixa", saldo: 200 },
        { nome: "sem id" },
      ],
      entradas: 900,
      saidas: -300,
      resultado: 600,
      a_receber: { total: 50, vencido: 10, proximos_7_dias: 40 },
      a_pagar: null,
      por_forma: null,
      por_canal: { online: 500, presencial: "400" },
      serie: [
        { dia: "2026-09-02", entradas: 10, saidas: 0 },
        { dia: "2026-09-01", entradas: 5, saidas: 2 },
        { dia: "lixo", entradas: 1, saidas: 1 },
      ],
      caixa_aberto: null,
    });
    expect(resumo.saldoTotal).toBe(1500.5);
    expect(resumo.contas).toEqual([
      { id: "c1", nome: "Caixa", tipo: "caixa", saldo: 200 },
    ]);
    expect(resumo.saidas).toBe(300);
    expect(resumo.aPagar).toEqual({ total: 0, vencido: 0, proximos7Dias: 0 });
    expect(resumo.porForma).toEqual([]);
    expect(resumo.porCanal).toEqual({ online: 500, presencial: 400 });
    expect(resumo.serie.map((d) => d.dia)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
    expect(resumo.caixaAberto).toBeNull();
    expect(() => parseResumo(null)).toThrow(ErroDeFormatoFinanceiro);
    expect(() => parseResumo({ contas: "x" })).toThrow(ErroDeFormatoFinanceiro);
  });

  it("extrato: descarta linha sem id, valor sempre positivo, tipo pelo sinal quando falta", () => {
    const linhas = parseExtrato([
      {
        id: "l1",
        origem: "manual",
        tipo: "saida",
        status: "realizado",
        valor: -80,
        data: "2026-09-10",
        conta_id: "c1",
        conta_nome: "Banco",
        descricao: "Internet",
        editavel: true,
      },
      {
        id: "l2",
        valor: -5,
        data: "2026-09-10T10:00:00Z",
        origem: "venda_online",
      },
      { valor: 10, data: "2026-09-10" },
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas.at(0)).toMatchObject({
      valor: 80,
      tipo: "saida",
      editavel: true,
    });
    expect(linhas.at(1)).toMatchObject({
      valor: 5,
      tipo: "saida",
      status: "realizado",
      data: "2026-09-10",
      descricao: "Venda online",
      editavel: false,
    });
    expect(parseExtrato(null)).toEqual([]);
    expect(() => parseExtrato({})).toThrow(ErroDeFormatoFinanceiro);
  });

  it("previstos, contas e DRE com campos faltando", () => {
    expect(
      parsePrevistos([
        {
          id: "p1",
          valor: "99.9",
          vencimento: "2026-10-01",
          parcela: 2,
          parcelas: 3,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "p1",
        valor: 99.9,
        parcela: 2,
        parcelas: 3,
        origem: "manual",
      }),
    ]);
    const contas = parseContas([
      { id: "b", nome: "B", tipo: "banco", ordem: 2 },
      { id: "a", nome: "A", tipo: "desconhecido", ordem: 1, sistema: true },
    ]);
    expect(contas.map((c) => [c.id, c.tipo, c.ativa])).toEqual([
      ["a", "outro", true],
      ["b", "banco", true],
    ]);
    const dre = parseDre({
      receita_bruta: 10,
      linhas: null,
      cmv_estimado: true,
    });
    expect(dre).toMatchObject({
      receitaBruta: 10,
      lucroLiquido: 0,
      cmvEstimado: true,
      linhas: [],
    });
  });

  it("caixa: null é fechado; sangria é saída", () => {
    expect(parseCaixaAtual(null)).toBeNull();
    const caixa = parseCaixaAtual({
      id: "s1",
      conta_id: "c1",
      aberto_em: "2026-09-26T12:00:00Z",
      valor_abertura: 100,
      esperado: 150,
      movimentos: [
        {
          id: "m1",
          origem: "sangria",
          valor: 50,
          descricao: "",
          created_at: "2026-09-26T15:00:00Z",
        },
        { id: "m2", tipo: "entrada", origem: "suprimento", valor: 20 },
      ],
    });
    expect(caixa?.movimentos.map((m) => [m.tipo, m.descricao])).toEqual([
      ["saida", "Sangria"],
      ["entrada", "Suprimento"],
    ]);
    expect(caixa?.contaNome).toBe("Caixa da loja");
  });
});

function linha(
  parcial: Partial<LinhaDoExtrato> & Pick<LinhaDoExtrato, "id">,
): LinhaDoExtrato {
  return {
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    valor: 0,
    data: "2026-09-10",
    contaId: "banco",
    contaNome: "Banco",
    contaDestinoId: null,
    contaDestinoNome: null,
    categoriaId: null,
    categoriaNome: null,
    descricao: "x",
    formaPagamento: null,
    pedidoId: null,
    vencimento: null,
    editavel: false,
    ...parcial,
  };
}

describe("extrato por dia e saldo corrente", () => {
  const linhas: LinhaDoExtrato[] = [
    linha({ id: "a", data: "2026-09-10", tipo: "entrada", valor: 100 }),
    linha({ id: "b", data: "2026-09-10", tipo: "saida", valor: 30.1 }),
    linha({
      id: "c",
      data: "2026-09-10",
      tipo: "saida",
      valor: 999,
      status: "previsto",
    }),
    linha({
      id: "d",
      data: "2026-09-11",
      tipo: "saida",
      valor: 50,
      status: "cancelado",
    }),
    linha({
      id: "e",
      data: "2026-09-11",
      tipo: "transferencia",
      valor: 40,
      contaId: "caixa",
      contaDestinoId: "banco",
    }),
    linha({
      id: "f",
      data: "2026-09-12",
      tipo: "entrada",
      valor: 0.2,
      contaId: "banco",
    }),
  ];

  it("agrupa do dia mais recente para o mais antigo, só o realizado no resultado", () => {
    const grupos = agruparExtratoPorDia(linhas);
    expect(grupos.map((g) => g.dia)).toEqual([
      "2026-09-12",
      "2026-09-11",
      "2026-09-10",
    ]);
    const dia10 = grupos.at(2);
    expect(dia10?.linhas.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(dia10?.resultado).toBe(69.9);
    expect(dia10?.entradas).toBe(100);
    expect(dia10?.saidas).toBe(30.1);
    // Sem conta filtrada a transferência não muda nada; o cancelado também não.
    expect(grupos.at(1)?.resultado).toBe(0);
    expect(grupos.every((g) => g.saldoAoFim === null)).toBe(true);
  });

  it("com conta filtrada, transferência tem sentido e o saldo por dia se reconstrói", () => {
    const grupos = agruparExtratoPorDia(linhas, {
      contaFiltrada: "banco",
      saldoAtual: 1000,
    });
    expect(grupos.map((g) => [g.dia, g.resultado, g.saldoAoFim])).toEqual([
      ["2026-09-12", 0.2, 1000],
      ["2026-09-11", 40, 999.8],
      ["2026-09-10", 69.9, 959.8],
    ]);
    expect(efeitoNoSaldo(linhas.at(4) as LinhaDoExtrato, "caixa")).toBe(-40);
    expect(efeitoNoSaldo(linhas.at(4) as LinhaDoExtrato, "banco")).toBe(40);
  });

  it("saldo retroativo e série de 30 dias com os buracos preenchidos", () => {
    expect(saldoCorrenteRetroativo(1000, [100, -50, 200])).toEqual([
      850, 800, 1000,
    ]);
    const serie = serieDoFluxoDeCaixa(
      [
        { dia: "2026-09-24", entradas: 100, saidas: 20 },
        { dia: "2026-09-26", entradas: 0, saidas: 10.5 },
      ],
      { inicio: "2026-09-24", fim: "2026-09-26" },
      500,
    );
    expect(serie.map((p) => [p.dia, p.resultado, p.saldo])).toEqual([
      ["2026-09-24", 80, 510.5],
      ["2026-09-25", 0, 510.5],
      ["2026-09-26", -10.5, 500],
    ]);
  });
});

describe("a pagar / a receber", () => {
  const hoje = "2026-09-26";
  it("situação e texto do vencimento", () => {
    expect(situacaoDoVencimento("2026-09-20", hoje)).toBe("vencido");
    expect(situacaoDoVencimento(hoje, hoje)).toBe("hoje");
    expect(situacaoDoVencimento("2026-10-03", hoje)).toBe("semana");
    expect(situacaoDoVencimento("2026-10-04", hoje)).toBe("depois");
    expect(situacaoDoVencimento(null, hoje)).toBe("sem_data");
    expect(textoDoVencimento("2026-09-20", hoje)).toBe("Venceu há 6 dias");
    expect(textoDoVencimento("2026-09-25", hoje)).toBe("Venceu ontem");
    expect(textoDoVencimento("2026-09-27", hoje)).toBe("Vence amanhã");
    expect(textoDoVencimento("2026-10-20", hoje)).toBe("Vence em 20/10/2026");
  });

  it("totais e ordem por vencimento", () => {
    const itens = parsePrevistos([
      { id: "3", valor: 5, vencimento: null },
      { id: "2", valor: 20, vencimento: "2026-09-30" },
      { id: "1", valor: 10.1, vencimento: "2026-09-01" },
      { id: "4", valor: 1, vencimento: "2026-12-01" },
    ]);
    expect(ordenarPorVencimento(itens).map((i) => i.id)).toEqual([
      "1",
      "2",
      "4",
      "3",
    ]);
    expect(totaisDosPrevistos(itens, hoje)).toEqual({
      total: 36.1,
      vencido: 10.1,
      proximos7Dias: 20,
    });
  });
});

describe("DRE", () => {
  const dre = parseDre({
    receita_bruta: 10000,
    receita_online: 6000,
    receita_balcao: 4000,
    deducoes: 500,
    receita_liquida: 9500,
    cmv: 3800,
    lucro_bruto: 5700,
    custos_variaveis: -950,
    margem_contribuicao: 4750,
    despesas_fixas: 2850,
    resultado_operacional: 1900,
    resultado_financeiro: -95,
    lucro_liquido: 1805,
    linhas: [
      { grupo: "despesa_fixa", categoria: "Aluguel", valor: 2000 },
      { grupo: "financeiro", categoria: "Tarifa", valor: -95 },
    ],
  });

  it("cascata com deduções sempre negativas e subtotais marcados", () => {
    const cascata = cascataDaDre(dre);
    expect(cascata.map((l) => [l.chave, l.valor, l.subtotal])).toEqual([
      ["receita_bruta", 10000, false],
      ["deducoes", -500, false],
      ["receita_liquida", 9500, true],
      ["cmv", -3800, false],
      ["lucro_bruto", 5700, true],
      ["custos_variaveis", -950, false],
      ["margem_contribuicao", 4750, true],
      ["despesas_fixas", -2850, false],
      ["resultado_operacional", 1900, true],
      ["resultado_financeiro", -95, false],
      ["lucro_liquido", 1805, true],
    ]);
    expect(cascata.at(-1)?.final).toBe(true);
  });

  it("sublinhas e % da receita líquida", () => {
    expect(sublinhasDaDre(dre, "receita_bruta").map((s) => s.valor)).toEqual([
      6000, 4000,
    ]);
    expect(sublinhasDaDre(dre, "despesas_fixas")).toEqual([
      { rotulo: "Aluguel", valor: -2000 },
    ]);
    expect(sublinhasDaDre(dre, "resultado_financeiro")).toEqual([
      { rotulo: "Tarifa", valor: -95 },
    ]);
    expect(sublinhasDaDre(dre, "cmv")).toEqual([]);
    expect(percentualDaReceita(1805, 9500)).toBeCloseTo(19);
    expect(percentualDaReceita(10, 0)).toBeNull();
  });
});

describe("formulários", () => {
  const hoje = "2026-09-26";

  it("lançamento vazio aponta todos os campos obrigatórios", () => {
    const r = validarLancamento(formularioInicialDoLancamento(hoje), hoje);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros).sort()).toEqual([
      "categoriaId",
      "contaId",
      "descricao",
      "valor",
    ]);
  });

  it("despesa paga vira realizado com data de pagamento", () => {
    const r = validarLancamento(
      formularioInicialDoLancamento(hoje, {
        valor: "1.234,56",
        descricao: "  Aluguel  ",
        categoriaId: "cat",
        contaId: "banco",
        formaPagamento: "pix",
      }),
      hoje,
    );
    expect(r).toEqual({
      ok: true,
      payload: {
        tipo: "saida",
        valor: 1234.56,
        conta_id: "banco",
        categoria_id: "cat",
        descricao: "Aluguel",
        forma_pagamento: "pix",
        data_competencia: hoje,
        status: "realizado",
        data_realizacao: hoje,
      },
    });
  });

  it("a pagar parcelado leva vencimento e parcelas; pago não parcela; futuro não é pago", () => {
    const base = formularioInicialDoLancamento(hoje, {
      valor: "300.00",
      descricao: "Fornecedor",
      categoriaId: "cat",
      contaId: "banco",
    });
    const parcelado = validarLancamento(
      {
        ...base,
        situacao: "previsto",
        dataVencimento: "2026-10-05",
        parcelas: "3",
      },
      hoje,
    );
    expect(parcelado.ok && parcelado.payload).toMatchObject({
      status: "previsto",
      data_vencimento: "2026-10-05",
      parcelas: 3,
    });
    expect(parcelado.ok && "data_realizacao" in parcelado.payload).toBe(false);

    const pagoParcelado = validarLancamento({ ...base, parcelas: "2" }, hoje);
    expect(!pagoParcelado.ok && pagoParcelado.erros.parcelas).toBeTruthy();

    const futuro = validarLancamento(
      { ...base, dataRealizacao: "2026-09-27" },
      hoje,
    );
    expect(!futuro.ok && futuro.erros.dataRealizacao).toMatch(/futuro/);
  });

  it("transferência: sem categoria, destino diferente da origem", () => {
    const base = formularioInicialDoLancamento(hoje, {
      tipo: "transferencia",
      valor: "50,00",
      descricao: "Depósito",
      contaId: "caixa",
      contaDestinoId: "caixa",
      formaPagamento: "pix",
    });
    const mesma = validarLancamento(base, hoje);
    expect(!mesma.ok && mesma.erros.contaDestinoId).toBe(
      "A conta de destino precisa ser outra.",
    );
    const ok = validarLancamento({ ...base, contaDestinoId: "banco" }, hoje);
    expect(ok).toEqual({
      ok: true,
      payload: {
        tipo: "transferencia",
        valor: 50,
        conta_id: "caixa",
        conta_destino_id: "banco",
        descricao: "Depósito",
        data_competencia: hoje,
        status: "realizado",
        data_realizacao: hoje,
      },
    });
  });

  it("conta e categoria", () => {
    expect(
      validarConta({
        nome: " Cofre ",
        tipo: "outro",
        saldoInicial: "",
        saldoInicialEm: "2026-09-01",
        ativa: true,
      }),
    ).toEqual({
      ok: true,
      payload: {
        nome: "Cofre",
        tipo: "outro",
        saldo_inicial: 0,
        saldo_inicial_em: "2026-09-01",
        ativa: true,
      },
    });
    const errada = validarCategoria({
      nome: "Luz",
      natureza: "receita",
      grupoDre: "despesa_fixa",
      ativa: true,
    });
    expect(!errada.ok && errada.erros.grupoDre).toBeTruthy();
  });
});

describe("caixa e erros", () => {
  it("diferença do fechamento", () => {
    expect(diferencaDoFechamento(480.5, 470)).toEqual({
      diferenca: -10.5,
      situacao: "quebra",
    });
    expect(diferencaDoFechamento(100, 100.1)).toEqual({
      diferenca: 0.1,
      situacao: "sobra",
    });
    expect(diferencaDoFechamento(0.3, 0.1 + 0.2)).toEqual({
      diferenca: 0,
      situacao: "bateu",
    });
  });

  it("traduz a falha sem SQLSTATE nem inglês na tela", () => {
    expect(mensagemDeErroFinanceiro(new TypeError("Failed to fetch"))).toMatch(
      /conexão/,
    );
    expect(
      mensagemDeErroFinanceiro({ code: "PGRST202", message: "Could not find" }),
    ).toMatch(/não foi instalado/);
    expect(
      mensagemDeErroFinanceiro({ code: "42501", message: "denied" }),
    ).toMatch(/administrador/);
    expect(
      mensagemDeErroFinanceiro({
        code: "P0001",
        message: "Já existe um caixa aberto.",
      }),
    ).toBe("Já existe um caixa aberto.");
    expect(
      mensagemDeErroFinanceiro({
        code: "23514",
        message: "violates check constraint",
      }),
    ).not.toMatch(/violates/);
    expect(
      mensagemDeErroFinanceiro(new ErroDeFormatoFinanceiro("fin_resumo")),
    ).toMatch(/formato/);
  });
});
