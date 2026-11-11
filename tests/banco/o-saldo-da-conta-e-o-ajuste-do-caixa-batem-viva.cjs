"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) de três leituras
 * de dinheiro do financeiro da loja, contra o Postgres EFÊMERO com as
 * migrations aplicadas do zero (rpc-ci), chamando as RPCs como o painel as
 * chama (admin atual):
 *
 *  (1) o SALDO DA CONTA (`fin__saldos`, que alimenta `fin_contas_listar` e o
 *      ajuste da abertura do caixa): só soma movimento realizado com data >=
 *      `saldo_inicial_em`. Sem o filtro, quem informa o saldo inicial de hoje
 *      veria o saldo inflado pelo histórico inteiro.
 *  (2) o AJUSTE DE SOBRA/QUEBRA do fechamento (`fin_caixa_fechar_sessao`, a RPC
 *      que o app chama): sobra entra como ENTRADA na categoria "Sobra de
 *      caixa"; quebra entra como SAÍDA em "Quebra de caixa"; contado igual ao
 *      esperado não grava ajuste. O saldo da conta Caixa tem de ficar igual ao
 *      que foi contado.
 *  (3) o GASTO PAGO EM DINHEIRO DA GAVETA (`fin_lancamento_salvar` e
 *      `fin_lancamento_baixar`): o lançamento de hoje na conta de um caixa
 *      aberto entra na sessão e desconta do ESPERADO. Sem isso, contar o que
 *      sobrou vira "Quebra de caixa" e soma-se à despesa (dupla contagem).
 *
 * CENÁRIOS (cada um num SAVEPOINT desfeito; datas relativas a fin__hoje()):
 *   A1  conta saldo_inicial 100 em hoje; +50 ontem, +30 hoje, +999 PREVISTO
 *       hoje -> saldo 130 (o de ontem NÃO soma; o previsto não conta)
 *   A2  saldo_inicial 100 em hoje-5; +7 em hoje-6 (fora), +20 em hoje-5 (borda
 *       exata, ENTRA), +50 em hoje-3, +30 hoje -> saldo 200 (histórico desde a
 *       data informada conta inteiro)
 *   A3  transferência A->B de 40 ontem (fora das duas pontas) e de 10 hoje ->
 *       A 120 e B 10 (o filtro vale para a origem E para o destino)
 *   B1  caixa aberto 100, contado 130 -> sobra 30: ENTRADA de 30 na categoria
 *       de sobra, Caixa = 130
 *   B2  contado 70 -> quebra 30: SAÍDA de 30 na categoria de quebra, Caixa = 70
 *   B3  contado 100 = esperado -> nenhum ajuste, Caixa = 100
 *   B4  contado 100,01 -> sobra de UM centavo (entrada de 0,01)
 *   B5  contado 0 -> quebra de 100 (saída), Caixa = 0
 *   C1  gasto realizado de 20 em dinheiro na conta Caixa (fin_lancamento_salvar):
 *       esperado 80; contar 80 fecha SEM quebra e Caixa = 80
 *   C2  gasto a pagar de 20 (previsto) não desconta; depois de
 *       fin_lancamento_baixar desconta -> esperado 80; contar 80 fecha sem quebra
 *   C3  gasto de 20 pago pela conta BANCÁRIA não mexe no esperado do caixa
 *
 * MUTANTES: MUTANTE_R111D=<nome> troca UM trecho do corpo vivo (pg_get_functiondef,
 * dentro da transação desfeita) e roda os cenários; a execução TEM de ficar
 * vermelha nos cenários que o nome promete e verde nos que ele não toca. Nome
 * desconhecido é ERRO. Sem MUTANTE_R111D a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-saldo-da-conta-e-o-ajuste-do-caixa-batem-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: saldo da conta e ajuste de sobra/quebra do caixa (rpc-ci)";
const U_ADMIN = "5a1d0000-0000-4000-8000-0000000000d1";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const CAT_OUTRAS_RECEITAS = "f2000000-0000-4000-8000-000000000002";
const CAT_SOBRA = "f2000000-0000-4000-8000-000000000005";
const CAT_OUTRAS_DESPESAS = "f2000000-0000-4000-8000-000000000025";
const CAT_QUEBRA = "f2000000-0000-4000-8000-000000000031";

const SALDOS = "public.fin__saldos()";
const FECHAR = "public.fin_caixa_fechar_sessao(uuid,numeric,text)";
const SALVAR = "public.fin_lancamento_salvar(jsonb)";
const BAIXAR = "public.fin_lancamento_baixar(uuid,date,uuid)";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada `de`
// tem de aparecer 1x. `espera` = cenários onde a prova TEM de ficar vermelha;
// `verde` = cenários que o mutante não toca e que TÊM de seguir verdes (é o que
// prova que o vermelho caiu na asserção certa, não num erro de montagem).
const CASE_TIPO = "CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END";
const CASE_CATEGORIA_SOBRA =
  "CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000005'::uuid";

const MUTANTES = {
  "saldo-sem-filtro-do-saldo-inicial": {
    funcao: SALDOS,
    espera: ["A1", "A2", "A3"],
    verde: ["B1", "B2", "B3", "C1", "C2", "C3"],
    de: "\n              AND m.data >= c.saldo_inicial_em",
    para: "",
  },
  // O Caixa da loja também tem saldo_inicial_em = hoje: sem o "igual", o ajuste
  // da ABERTURA (feito hoje) deixa de entrar no saldo dele, e B/C caem já na
  // asserção "a abertura reconcilia o saldo". É a mesma raiz, não vazamento.
  "saldo-inicial-sem-igual": {
    funcao: SALDOS,
    espera: ["A1", "A2", "A3", "B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3"],
    verde: [],
    de: "m.data >= c.saldo_inicial_em",
    para: "m.data > c.saldo_inicial_em",
  },
  "sobra-vira-saida": {
    funcao: FECHAR,
    espera: ["B1", "B4"],
    verde: ["A1", "A2", "A3", "B2", "B3", "B5", "C1", "C2", "C3"],
    de: CASE_TIPO,
    para: "CASE WHEN v_dif > 0 THEN 'saida' ELSE 'saida' END",
  },
  "quebra-vira-entrada": {
    funcao: FECHAR,
    espera: ["B2", "B5"],
    verde: ["A1", "A2", "A3", "B1", "B3", "B4", "C1", "C2", "C3"],
    de: CASE_TIPO,
    para: "CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'entrada' END",
  },
  "sobra-na-categoria-de-quebra": {
    funcao: FECHAR,
    espera: ["B1", "B4"],
    verde: ["B2", "B3", "B5", "C1", "C2", "C3"],
    de: CASE_CATEGORIA_SOBRA,
    para: "CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000031'::uuid",
  },
  "sem-desconto-do-gasto-em-dinheiro": {
    funcao: SALVAR,
    espera: ["C1"],
    verde: ["A1", "A2", "A3", "B1", "B2", "B3", "C2", "C3"],
    de: "IF v_status = 'realizado' AND v_real = v_hoje THEN",
    para: "IF false THEN",
  },
  "sem-desconto-do-gasto-baixado-em-dinheiro": {
    funcao: BAIXAR,
    espera: ["C2"],
    verde: ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C3"],
    de: "IF v_data = public.fin__hoje() THEN",
    para: "IF false THEN",
  },
};

// ------------------------------------------------------------------ apoio
const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

async function rpc(c, sql, params = []) {
  return (await c.query(sql, params)).rows[0].r;
}

/** A data de `n` dias atrás no fuso da loja (n negativo = futuro). */
async function dia(c, n) {
  return rpc(c, "SELECT (public.fin__hoje() - $1::int)::text AS r", [n]);
}

async function criarConta(c, { nome, saldoInicial, emDias }) {
  const { id } = await rpc(
    c,
    "SELECT public.fin_conta_salvar($1::jsonb) AS r",
    [
      JSON.stringify({
        nome,
        tipo: "banco",
        saldo_inicial: saldoInicial,
        saldo_inicial_em: await dia(c, emDias),
      }),
    ],
  );
  return id;
}

/** Lançamento pelo caminho do painel (fin_lancamento_salvar); devolve o id. */
async function lancar(c, p) {
  const { ids } = await rpc(
    c,
    "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
    [JSON.stringify(p)],
  );
  assert.strictEqual(ids.length, 1, "o lançamento devia gerar um id só");
  return ids[0];
}

/** O que o painel mostra como saldo de cada conta (fin_contas_listar). */
async function saldoDe(c, contaId) {
  const lista = await rpc(c, "SELECT public.fin_contas_listar() AS r");
  const conta = lista.find((x) => x.id === contaId);
  assert(conta, `conta ${contaId} fora da lista do painel`);
  return num(conta.saldo);
}

async function abrirCaixa(c, valor) {
  const { id } = await rpc(c, "SELECT public.fin_caixa_abrir($1, NULL) AS r", [
    valor,
  ]);
  return id;
}

async function esperadoDe(c, sessaoId) {
  return num(
    await rpc(
      c,
      "SELECT (public.fin__caixa_calculo($1) ->> 'esperado')::numeric AS r",
      [sessaoId],
    ),
  );
}

async function fecharCaixa(c, sessaoId, contado) {
  return rpc(c, "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r", [
    sessaoId,
    contado,
  ]);
}

async function ajustesDaSessao(c, sessaoId) {
  return (
    await c.query(
      `SELECT tipo, status, valor::float8 AS valor, conta_id, categoria_id, origem
         FROM public.fin_lancamentos
        WHERE caixa_sessao_id = $1 AND origem = 'ajuste_caixa'`,
      [sessaoId],
    )
  ).rows;
}

/** Caixa aberto com `valor` na gaveta, já conferido: abertura, esperado e saldo. */
async function caixaAbertoCom(c, valor, rotulo) {
  const s = await abrirCaixa(c, valor);
  assert.strictEqual(
    await esperadoDe(c, s),
    valor,
    `[${rotulo}] o esperado ao abrir é a abertura (${valor})`,
  );
  assert.strictEqual(
    await saldoDe(c, CAIXA),
    valor,
    `[${rotulo}] a abertura reconcilia o saldo da conta Caixa em ${valor}`,
  );
  return s;
}

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "A1",
  nome: "A1: saldo inicial 100 em hoje; +50 ontem, +30 hoje, +999 previsto -> saldo 130",
  corpo: async (c) => {
    const conta = await criarConta(c, {
      nome: "Conta A1",
      saldoInicial: 100,
      emDias: 0,
    });
    const entrada = async (valor, dias, status = "realizado") =>
      lancar(c, {
        tipo: "entrada",
        status,
        valor,
        conta_id: conta,
        categoria_id: CAT_OUTRAS_RECEITAS,
        descricao: `Entrada ${valor}`,
        ...(status === "realizado"
          ? { data_realizacao: await dia(c, dias) }
          : { data_vencimento: await dia(c, dias) }),
      });
    await entrada(50, 1);
    await entrada(30, 0);
    await entrada(999, 0, "previsto");
    assert.strictEqual(
      await saldoDe(c, conta),
      130,
      "[A1] saldo = 100 + 30: só o movimento a partir do saldo inicial (hoje) soma; o de ontem (+50) e o previsto (+999) ficam de fora",
    );
  },
});

CENARIOS.push({
  id: "A2",
  nome: "A2: saldo inicial 100 em hoje-5; +7 (hoje-6, fora), +20 (hoje-5, borda), +50 (hoje-3), +30 -> saldo 200",
  corpo: async (c) => {
    const conta = await criarConta(c, {
      nome: "Conta A2",
      saldoInicial: 100,
      emDias: 5,
    });
    for (const [valor, dias] of [
      [7, 6],
      [20, 5],
      [50, 3],
      [30, 0],
    ]) {
      await lancar(c, {
        tipo: "entrada",
        valor,
        conta_id: conta,
        categoria_id: CAT_OUTRAS_RECEITAS,
        descricao: `Entrada ${valor}`,
        data_realizacao: await dia(c, dias),
      });
    }
    assert.strictEqual(
      await saldoDe(c, conta),
      200,
      "[A2] saldo = 100 + 20 + 50 + 30: o histórico desde a data informada conta INTEIRO, a borda exata (hoje-5) entra e o de hoje-6 (+7) fica de fora",
    );
  },
});

CENARIOS.push({
  id: "A3",
  nome: "A3: transferência A->B de 40 ontem (fora) e de 10 hoje -> A 120 e B 10",
  corpo: async (c) => {
    const a = await criarConta(c, {
      nome: "Conta A3 origem",
      saldoInicial: 130,
      emDias: 0,
    });
    const b = await criarConta(c, {
      nome: "Conta A3 destino",
      saldoInicial: 0,
      emDias: 0,
    });
    for (const [valor, dias] of [
      [40, 1],
      [10, 0],
    ]) {
      await lancar(c, {
        tipo: "transferencia",
        valor,
        conta_id: a,
        conta_destino_id: b,
        descricao: `Transferência ${valor}`,
        data_realizacao: await dia(c, dias),
      });
    }
    assert.strictEqual(
      await saldoDe(c, a),
      120,
      "[A3] origem = 130 - 10: a transferência de ontem (40) é anterior ao saldo inicial e não sai",
    );
    assert.strictEqual(
      await saldoDe(c, b),
      10,
      "[A3] destino = 0 + 10: a transferência de ontem (40) é anterior ao saldo inicial e não entra",
    );
  },
});

/** Fecha um caixa aberto com 100 contando `contado` e devolve resposta + ajustes. */
async function fecharAberto100(c, contado, rotulo) {
  const s = await caixaAbertoCom(c, 100, rotulo);
  const r = await fecharCaixa(c, s, contado);
  assert.strictEqual(
    num(r.esperado),
    100,
    `[${rotulo}] esperado do fechamento`,
  );
  assert.strictEqual(num(r.contado), contado, `[${rotulo}] contado gravado`);
  return { s, r, ajustes: await ajustesDaSessao(c, s) };
}

CENARIOS.push({
  id: "B1",
  nome: "B1: esperado 100, contado 130 -> sobra 30: ENTRADA de 30 na categoria de sobra, Caixa = 130",
  corpo: async (c) => {
    const { r, ajustes } = await fecharAberto100(c, 130, "B1");
    assert.strictEqual(num(r.diferenca), 30, "[B1] diferença = +30");
    assert.strictEqual(ajustes.length, 1, "[B1] exatamente UM ajuste");
    assert.strictEqual(
      ajustes[0].tipo,
      "entrada",
      "[B1] a sobra entra como ENTRADA (e não como saída)",
    );
    assert.strictEqual(ajustes[0].valor, 30, "[B1] o ajuste é de 30");
    assert.strictEqual(
      ajustes[0].categoria_id,
      CAT_SOBRA,
      "[B1] a sobra vai para a categoria 'Sobra de caixa'",
    );
    assert.strictEqual(ajustes[0].conta_id, CAIXA, "[B1] na conta Caixa");
    assert.strictEqual(ajustes[0].status, "realizado", "[B1] já realizado");
    assert.strictEqual(
      await saldoDe(c, CAIXA),
      130,
      "[B1] o saldo da conta Caixa fica IGUAL ao contado (130), não 60 abaixo",
    );
  },
});

CENARIOS.push({
  id: "B2",
  nome: "B2: esperado 100, contado 70 -> quebra 30: SAÍDA de 30 na categoria de quebra, Caixa = 70",
  corpo: async (c) => {
    const { r, ajustes } = await fecharAberto100(c, 70, "B2");
    assert.strictEqual(num(r.diferenca), -30, "[B2] diferença = -30");
    assert.strictEqual(ajustes.length, 1, "[B2] exatamente UM ajuste");
    assert.strictEqual(
      ajustes[0].tipo,
      "saida",
      "[B2] a quebra entra como SAÍDA (e não como entrada)",
    );
    assert.strictEqual(ajustes[0].valor, 30, "[B2] o ajuste é de 30");
    assert.strictEqual(
      ajustes[0].categoria_id,
      CAT_QUEBRA,
      "[B2] a quebra vai para a categoria 'Quebra de caixa'",
    );
    assert.strictEqual(ajustes[0].conta_id, CAIXA, "[B2] na conta Caixa");
    assert.strictEqual(
      await saldoDe(c, CAIXA),
      70,
      "[B2] o saldo da conta Caixa fica IGUAL ao contado (70)",
    );
  },
});

CENARIOS.push({
  id: "B3",
  nome: "B3: contado = esperado (100) -> nenhum ajuste, Caixa = 100",
  corpo: async (c) => {
    const { r, ajustes } = await fecharAberto100(c, 100, "B3");
    assert.strictEqual(num(r.diferenca), 0, "[B3] diferença = 0");
    assert.strictEqual(
      ajustes.length,
      0,
      "[B3] contado igual ao esperado NÃO grava ajuste",
    );
    assert.strictEqual(await saldoDe(c, CAIXA), 100, "[B3] Caixa segue em 100");
  },
});

CENARIOS.push({
  id: "B4",
  nome: "B4: contado 100,01 -> sobra de UM centavo (entrada de 0,01), Caixa = 100,01",
  corpo: async (c) => {
    const { r, ajustes } = await fecharAberto100(c, 100.01, "B4");
    assert.strictEqual(num(r.diferenca), 0.01, "[B4] diferença = +0,01");
    assert.strictEqual(ajustes.length, 1, "[B4] UM ajuste de um centavo");
    assert.strictEqual(
      ajustes[0].tipo,
      "entrada",
      "[B4] a sobra de um centavo é ENTRADA",
    );
    assert.strictEqual(ajustes[0].valor, 0.01, "[B4] o ajuste é de 0,01");
    assert.strictEqual(
      ajustes[0].categoria_id,
      CAT_SOBRA,
      "[B4] categoria de sobra",
    );
    assert.strictEqual(await saldoDe(c, CAIXA), 100.01, "[B4] Caixa = 100,01");
  },
});

CENARIOS.push({
  id: "B5",
  nome: "B5: contado 0 contra esperado 100 -> quebra de 100 (saída), Caixa = 0",
  corpo: async (c) => {
    const { r, ajustes } = await fecharAberto100(c, 0, "B5");
    assert.strictEqual(num(r.diferenca), -100, "[B5] diferença = -100");
    assert.strictEqual(ajustes.length, 1, "[B5] UM ajuste");
    assert.strictEqual(ajustes[0].tipo, "saida", "[B5] a quebra total é SAÍDA");
    assert.strictEqual(ajustes[0].valor, 100, "[B5] o ajuste é de 100");
    assert.strictEqual(
      ajustes[0].categoria_id,
      CAT_QUEBRA,
      "[B5] categoria de quebra",
    );
    assert.strictEqual(await saldoDe(c, CAIXA), 0, "[B5] Caixa zerado");
  },
});

/** Confere que contar `contado` fecha SEM quebra e sem nenhum ajuste. */
async function fechaSemQuebra(c, s, contado, rotulo) {
  const r = await fecharCaixa(c, s, contado);
  assert.strictEqual(
    num(r.diferenca),
    0,
    `[${rotulo}] contar ${contado} fecha SEM diferença (esperado ${num(r.esperado)})`,
  );
  assert.strictEqual(
    (await ajustesDaSessao(c, s)).length,
    0,
    `[${rotulo}] nenhum ajuste de sobra/quebra: o gasto não vira 'Quebra de caixa' por cima da despesa`,
  );
  const quebras = (
    await c.query(
      "SELECT count(*)::int AS n FROM public.fin_lancamentos WHERE categoria_id = $1",
      [CAT_QUEBRA],
    )
  ).rows[0].n;
  assert.strictEqual(
    quebras,
    0,
    `[${rotulo}] nenhum lançamento 'Quebra de caixa'`,
  );
  assert.strictEqual(
    await saldoDe(c, CAIXA),
    contado,
    `[${rotulo}] o saldo da conta Caixa = ${contado} (100 - 20 de gasto, UMA vez só: sem dupla contagem)`,
  );
}

const gastoEmDinheiro = (conta, extra = {}) => ({
  tipo: "saida",
  valor: 20,
  conta_id: conta,
  categoria_id: CAT_OUTRAS_DESPESAS,
  forma_pagamento: "dinheiro",
  descricao: "Gasto pago da gaveta",
  ...extra,
});

CENARIOS.push({
  id: "C1",
  nome: "C1: gasto de 20 pago em dinheiro da gaveta (salvar realizado) -> esperado 80; contar 80 fecha sem quebra",
  corpo: async (c) => {
    const s = await caixaAbertoCom(c, 100, "C1");
    const gasto = await lancar(c, gastoEmDinheiro(CAIXA));
    assert.strictEqual(
      await esperadoDe(c, s),
      80,
      "[C1] o esperado do caixa cai 20 (100 - 20)",
    );
    const { rows } = await c.query(
      "SELECT caixa_sessao_id FROM public.fin_lancamentos WHERE id = $1",
      [gasto],
    );
    assert.strictEqual(
      rows[0].caixa_sessao_id,
      s,
      "[C1] o gasto de hoje na conta do caixa aberto entra na sessão",
    );
    await fechaSemQuebra(c, s, 80, "C1");
  },
});

CENARIOS.push({
  id: "C2",
  nome: "C2: gasto a pagar de 20 não desconta; baixado em dinheiro desconta -> esperado 80; contar 80 fecha sem quebra",
  corpo: async (c) => {
    const s = await caixaAbertoCom(c, 100, "C2");
    const gasto = await lancar(
      c,
      gastoEmDinheiro(CAIXA, {
        status: "previsto",
        data_vencimento: await dia(c, 0),
      }),
    );
    assert.strictEqual(
      await esperadoDe(c, s),
      100,
      "[C2] gasto só PREVISTO ainda não saiu da gaveta: esperado segue 100",
    );
    await rpc(c, "SELECT public.fin_lancamento_baixar($1) AS r", [gasto]);
    const { rows } = await c.query(
      "SELECT status, caixa_sessao_id FROM public.fin_lancamentos WHERE id = $1",
      [gasto],
    );
    assert.strictEqual(rows[0].status, "realizado", "[C2] baixado");
    assert.strictEqual(
      await esperadoDe(c, s),
      80,
      "[C2] depois da baixa o esperado cai 20 (100 - 20)",
    );
    assert.strictEqual(
      rows[0].caixa_sessao_id,
      s,
      "[C2] a baixa de hoje na conta do caixa aberto entra na sessão",
    );
    await fechaSemQuebra(c, s, 80, "C2");
  },
});

CENARIOS.push({
  id: "C3",
  nome: "C3: gasto de 20 pago pela conta BANCÁRIA não mexe no esperado do caixa (contar 100 fecha sem quebra)",
  corpo: async (c) => {
    const s = await caixaAbertoCom(c, 100, "C3");
    await lancar(c, gastoEmDinheiro(BANCO, { forma_pagamento: "pix" }));
    assert.strictEqual(
      await esperadoDe(c, s),
      100,
      "[C3] gasto pago por OUTRA conta não desconta da gaveta",
    );
    const r = await fecharCaixa(c, s, 100);
    assert.strictEqual(
      num(r.diferenca),
      0,
      "[C3] contar 100 fecha sem diferença",
    );
    assert.strictEqual(
      (await ajustesDaSessao(c, s)).length,
      0,
      "[C3] nenhum ajuste de caixa",
    );
    assert.strictEqual(await saldoDe(c, CAIXA), 100, "[C3] Caixa segue em 100");
    assert.strictEqual(await saldoDe(c, BANCO), -20, "[C3] o banco paga os 20");
  },
});

// ------------------------------------------------------------------ rodada

const corpoVivo = async (c, funcao) =>
  (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [funcao])
  ).rows[0].d.replace(/\r/g, "");

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  const def = await corpoVivo(c, m.funcao);
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo de ${m.funcao} (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await corpoVivo(c, m.funcao),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

async function montarAdmin(c) {
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@caixa111d.fixture.invalid', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
    [U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Caixa 111d', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [U_ADMIN],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), admin, precondição de loja
 * limpa, e cada cenário num SAVEPOINT. Erro que não é de asserção (SQL,
 * conexão, montagem) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await montarAdmin(c);
    const sujo = (
      await c.query(
        `SELECT (SELECT count(*) FROM public.fin_lancamentos)::int AS lanc,
                (SELECT count(*) FROM public.fin_caixa_sessoes)::int AS sess,
                (SELECT count(*) FROM public.fin_contas)::int AS contas,
                (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos`,
      )
    ).rows[0];
    assert.deepStrictEqual(
      sujo,
      { lanc: 0, sess: 0, contas: 3, pedidos: 0 },
      "PRECONDICAO: a prova parte do clone SEM lançamento, sessão de caixa, conta extra nem pedido (rodar-isolado.cjs)",
    );

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R111D || "";
  if (nomeMutante && !Object.hasOwn(MUTANTES, nomeMutante)) {
    falhar(
      "ERRO",
      `MUTANTE_R111D='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      const vazou = r.mutante.verde.filter((id) =>
        r.falhou.some((f) => f.id === id),
      );
      if (vazou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} derrubou também [${vazou.join(", ")}], que ele não toca: o vermelho não caiu só na asserção certa`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "O saldo da conta ou o ajuste de sobra/quebra do caixa divergiram — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-saldo-da-conta-e-o-ajuste-do-caixa] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
