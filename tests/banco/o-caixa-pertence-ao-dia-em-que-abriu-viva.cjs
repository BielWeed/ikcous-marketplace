"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do proprio teste (nomes de mutante e de cenario). */
// 20261654000000 (o caixa pertence ao dia em que abriu; caça de 28/11/2026). Somente Postgres descartavel do rpc-ci (rodar-isolado.cjs:
// CI_BANCO_EFEMERO=1 + localhost), nunca banco de loja. Tudo roda numa transacao que termina em ROLLBACK; as fixtures sao inventadas.
//
// O CENARIO DA VIRADA: a lojista abre o caixa num dia (aqui, ONTEM as 09:00 de Brasilia: a sessao aberta pela RPC tem o aberto_em
// recuado para la) e mexe nele depois da meia-noite (HOJE, o now() da transacao). O caixa pertence ao dia em que ABRIU:
//   V1/V2   a quebra/sobra do fechamento leva a data de ONTEM (competencia, vencimento e realizacao) e o resultado (fin_dre) a conta
//           no dia de ontem, nao no de hoje;
//   V3/V4   a sangria/o suprimento feitos depois da meia-noite levam a data de ONTEM;
//   V5/V6   o gasto pago em dinheiro ONTEM e lancado/baixado HOJE (salvar/baixar) sai da gaveta da sessao de ontem ainda aberta: o
//           fechamento nao acusa falta falsa e nao nasce "Quebra de caixa" por cima da despesa (a despesa contada duas vezes);
//   V7      o gasto de HOJE entra na sessao de ontem ainda aberta (como antes);
//   V8/V9   o gasto/baixa de ANTEONTEM (antes da abertura) fica fora da gaveta;
//   V10     a transferencia do banco para a gaveta, datada de ontem, entra na sessao;
//   V11     sessao de ontem ja FECHADA nao recebe nada;
//   V12     editar um "a pagar" para pago com a data de ontem liga a sessao (o caminho de edicao do salvar).
// O CAIXA DE UM DIA SO (aberto hoje) segue exatamente como antes:
//   U1/U2   gasto/baixa de ONTEM nao sai da gaveta de hoje (os C4/C5 de o-saldo-da-conta-e-o-ajuste-do-caixa-batem-viva.cjs);
//   U3/U4   quebra e sangria levam a data de hoje.
//
// CONTROLE: com os corpos ANTERIORES (o rollback desta migration, na mesma fixture) os cenarios da virada ficam VERMELHOS (o defeito
// existe e a prova o enxerga) e os de um dia so, verdes. MUTANTES (sempre rodados, cada um num SAVEPOINT): cada um tira UM pedaco da
// regra e tem de derrubar EXATAMENTE os cenarios que prometeu, e nenhum outro. DADO QUE JA EXISTIA: o lancamento gravado pelo corpo
// anterior com a sessao aberta fica como estava (o apply nao reescreve nada); o que vem depois segue a regra nova.
// Migration: apply 2x e CRLF iguais, pre-voo recusa sem escrever, rollback byte a byte, segundo rollback recusa, o rollback da 252 e o
// da 246 recusam com esta no ar, consultas 210a/210b.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o caixa pertence ao dia em que abriu (20261654000000)";
const NOME = "20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback252 = ler(
  "supabase/migrations/rollback-manual-20261252000000_o_caixa_preserva_a_intencao.sql",
);
const rollback246 = ler(
  "supabase/migrations/rollback-manual-20261246000000_o_lancamento_repetido_nao_duplica.sql",
);
const consultaAntes = ler(
  "scripts/publicacao/consultas/210b-antes-o-caixa-pertence-ao-dia-em-que-abriu-base-vigente.sql",
);
const consultaDepois = ler(
  "scripts/publicacao/consultas/210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado.sql",
);
const bloco = (sql, fn) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `definicao de ${fn} ausente`);
  const fim = sql.indexOf("\n$$;", sql.indexOf("AS $$", ini)) + "\n$$;".length;
  return sql.slice(ini, fim);
};
const corpoDe = (b) => b.split("AS $$")[1].slice(0, -3);

const SALVAR = "public.fin_lancamento_salvar(jsonb)";
const BAIXAR = "public.fin_lancamento_baixar(uuid,date,uuid)";
const FECHAR = "public.fin_caixa_fechar_sessao(uuid,numeric,text)";
const MOVER =
  "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)";
const ASSINATURAS = [SALVAR, BAIXAR, FECHAR, MOVER];
// Os corpos de ANTES, lidos das migrations que os deixaram vivos (nao copiados a mao), e os hashes das duas pontas.
const ANTES = {
  [SALVAR]: corpoDe(
    bloco(
      ler(
        "supabase/migrations/20261246000000_o_lancamento_repetido_nao_duplica.sql",
      ),
      "fin_lancamento_salvar",
    ),
  ),
  [BAIXAR]: corpoDe(
    bloco(
      ler(
        "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
      ),
      "fin_lancamento_baixar",
    ),
  ),
  [FECHAR]: corpoDe(
    bloco(
      ler("supabase/migrations/20261252000000_o_caixa_preserva_a_intencao.sql"),
      "fin_caixa_fechar_sessao",
    ),
  ),
  [MOVER]: corpoDe(
    bloco(
      ler("supabase/migrations/20261252000000_o_caixa_preserva_a_intencao.sql"),
      "fin_caixa_movimentar_com_chave",
    ),
  ),
};
const HASH_ANTES = {
  [SALVAR]: "1356dbfc037a9202ef163ba598854891",
  [BAIXAR]: "e59bc12ea20182da4209a257df0be8c1",
  [FECHAR]: "f10208ba223450fd25af3c9e11dca073",
  [MOVER]: "134bd5b7c5872bf30041601725fc37ba",
};
const HASH_DESTA = {
  [SALVAR]: "3e31817ce1d13bb091ce2d0871cbd718",
  [BAIXAR]: "7d1204cdf214a290cfdb378482795f1b",
  [FECHAR]: "3bc5c509d150fca3c5135361461dcc40",
  [MOVER]: "f1b22fd85f7a4ae2200d37001c9e1ffb",
};

const U_ADMIN = "5e165400-0000-4000-8000-000000000001";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const CAT_OUTRAS_DESPESAS = "f2000000-0000-4000-8000-000000000025";
const CAT_SOBRA = "f2000000-0000-4000-8000-000000000005";
const CAT_QUEBRA = "f2000000-0000-4000-8000-000000000031";

// ------------------------------------------------------------------ apoio
const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

async function rpc(c, sql, params = []) {
  return (await c.query(sql, params)).rows[0].r;
}
// Executa e devolve {erro: {code, message}} ou {linhas}; a transacao segue de pe (savepoint).
async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa1654");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa1654");
    return { linhas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa1654");
    await c.query("RELEASE SAVEPOINT tentativa1654");
    return { erro: { code: e.code, message: e.message } };
  }
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1654");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1654");
    await c.query("RELEASE SAVEPOINT caso1654");
  }
}

/** A data de `n` dias atras no calendario da loja (texto YYYY-MM-DD). */
async function dia(c, n) {
  return rpc(c, "SELECT (public.fin__hoje() - $1::int)::text AS r", [n]);
}
async function definicao(c, sig) {
  return (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [sig])
  ).rows[0].d.replace(/\r/g, "");
}
async function funcoes(c) {
  const linhas = (
    await c.query(
      "SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = ANY ($1::regprocedure[]) ORDER BY p.proname",
      [ASSINATURAS],
    )
  ).rows.map((l) => ({ ...l.a, prosrc: l.a.prosrc.replace(/\r/g, "") }));
  assert.equal(linhas.length, 4);
  return linhas;
}
async function hashes(c) {
  const saida = {};
  for (const sig of ASSINATURAS) {
    saida[sig] = (
      await c.query(
        "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.h;
  }
  return saida;
}
// Tudo o que as quatro funcoes escrevem: se mudar, o apply/rollback tocou dado.
async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.fin_caixa_sessoes s) AS sessoes,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM public.fin_lancamentos l) AS lancamentos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY chave), '[]') FROM public.fin_caixa_movimento_tentativas t) AS tentativas`)
  ).rows[0];
}
async function conferir(c, sql, positivo, rotulo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(
    linhas.length,
    13,
    `${rotulo}: o rol fechado das consultas 210 tem 13 linhas`,
  );
  assert.equal(
    linhas.every((l) => l.ok === true),
    positivo,
    `${rotulo}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
  );
}

async function saldoDe(c, contaId) {
  const lista = await rpc(c, "SELECT public.fin_contas_listar() AS r");
  const conta = lista.find((x) => x.id === contaId);
  assert.ok(conta, `conta ${contaId} fora da lista do painel`);
  return num(conta.saldo);
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
/** O "(+/-) Resultado financeiro" do Resultado (fin_dre) num dia: e' onde a quebra/sobra pesa. */
async function resultadoFinanceiroDo(c, data) {
  return num(
    await rpc(
      c,
      "SELECT (public.fin_dre($1::date, $1::date) ->> 'resultado_financeiro')::numeric AS r",
      [data],
    ),
  );
}

/**
 * Caixa aberto com `valor` na gaveta e, se `diasAtras` > 0, com a abertura recuada para as 09:00 (Brasilia) daquele dia: o caixa
 * que abriu ontem e segue aberto depois da meia-noite. Confere o esperado, o saldo reconciliado e o dia da abertura.
 */
async function caixaAberto(c, valor, diasAtras, rotulo) {
  const { id } = await rpc(c, "SELECT public.fin_caixa_abrir($1, NULL) AS r", [
    valor,
  ]);
  if (diasAtras > 0) {
    await c.query(
      `UPDATE public.fin_caixa_sessoes
          SET aberto_em = ((public.fin__hoje() - $2::int) + time '09:00') AT TIME ZONE 'America/Sao_Paulo'
        WHERE id = $1`,
      [id, diasAtras],
    );
  }
  assert.equal(
    await rpc(
      c,
      "SELECT public.fin__dia(aberto_em)::text AS r FROM public.fin_caixa_sessoes WHERE id = $1",
      [id],
    ),
    await dia(c, diasAtras),
    `[${rotulo}] PRECONDICAO: a sessao pertence ao dia de ${diasAtras} dia(s) atras`,
  );
  assert.equal(
    await esperadoDe(c, id),
    valor,
    `[${rotulo}] PRECONDICAO: o esperado ao abrir e a abertura (${valor})`,
  );
  assert.equal(
    await saldoDe(c, CAIXA),
    valor,
    `[${rotulo}] PRECONDICAO: a abertura reconcilia o saldo da conta Caixa em ${valor}`,
  );
  return id;
}
const caixaDeOntem = (c, valor, rotulo) => caixaAberto(c, valor, 1, rotulo);
const caixaDeHoje = (c, valor, rotulo) => caixaAberto(c, valor, 0, rotulo);

async function fecharCaixa(c, sessaoId, contado) {
  return rpc(c, "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r", [
    sessaoId,
    contado,
  ]);
}
async function movimentar(c, sessaoId, tipo, valor) {
  return rpc(
    c,
    "SELECT public.fin_caixa_movimentar_com_chave($1, $2, $3, $4, NULL, $5) AS r",
    [sessaoId, randomUUID(), tipo, valor, BANCO],
  );
}
/** Lancamento pelo caminho do painel (fin_lancamento_salvar); devolve o id. */
async function lancar(c, p) {
  const { ids } = await rpc(
    c,
    "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
    [JSON.stringify(p)],
  );
  assert.equal(ids.length, 1, "o lancamento devia gerar um id so");
  return ids[0];
}
async function baixar(c, id, data) {
  return rpc(c, "SELECT public.fin_lancamento_baixar($1, $2::date) AS r", [
    id,
    data,
  ]);
}
async function linhaDe(c, id) {
  return (
    await c.query(
      `SELECT tipo, status, valor::float8 AS valor, conta_id, conta_destino_id, categoria_id, origem, caixa_sessao_id,
              data_competencia::text AS competencia, data_vencimento::text AS vencimento, data_realizacao::text AS realizacao
         FROM public.fin_lancamentos WHERE id = $1`,
      [id],
    )
  ).rows[0];
}
async function ajustesDaSessao(c, sessaoId) {
  return (
    await c.query(
      `SELECT tipo, valor::float8 AS valor, conta_id, categoria_id,
              data_competencia::text AS competencia, data_vencimento::text AS vencimento, data_realizacao::text AS realizacao
         FROM public.fin_lancamentos WHERE caixa_sessao_id = $1 AND origem = 'ajuste_caixa'`,
      [sessaoId],
    )
  ).rows;
}
const gasto = (extra = {}) => ({
  tipo: "saida",
  valor: 20,
  conta_id: CAIXA,
  categoria_id: CAT_OUTRAS_DESPESAS,
  forma_pagamento: "dinheiro",
  descricao: "Gasto pago da gaveta",
  ...extra,
});
async function datasSao(_c, linha, esperada, rotulo) {
  assert.deepEqual(
    {
      competencia: linha.competencia,
      vencimento: linha.vencimento,
      realizacao: linha.realizacao,
    },
    { competencia: esperada, vencimento: esperada, realizacao: esperada },
    `${rotulo}: competencia, vencimento e realizacao`,
  );
}
/** Contar `contado` fecha SEM diferenca, sem ajuste e sem nenhuma "Quebra de caixa" (a despesa nao e' contada duas vezes). */
async function fechaSemQuebra(c, s, contado, rotulo) {
  const r = await fecharCaixa(c, s, contado);
  assert.equal(
    num(r.diferenca),
    0,
    `[${rotulo}] contar ${contado} fecha SEM diferenca (esperado ${num(r.esperado)})`,
  );
  assert.equal(
    (await ajustesDaSessao(c, s)).length,
    0,
    `[${rotulo}] nenhum ajuste de sobra/quebra`,
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM public.fin_lancamentos WHERE categoria_id = $1",
        [CAT_QUEBRA],
      )
    ).rows[0].n,
    0,
    `[${rotulo}] nenhuma 'Quebra de caixa' por cima da despesa`,
  );
  assert.equal(
    await saldoDe(c, CAIXA),
    contado,
    `[${rotulo}] o saldo da conta Caixa = ${contado} (o gasto uma vez so)`,
  );
}

// ---------------------------------------------------------------- cenarios
const CENARIOS = [];

CENARIOS.push({
  id: "V1",
  nome: "V1: caixa de ontem fechado depois da meia-noite com quebra de 30 -> a quebra e' de ONTEM, no resultado de ontem e nao no de hoje",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V1");
    const ontem = await dia(c, 1);
    const hoje = await dia(c, 0);
    const ontemAntes = await resultadoFinanceiroDo(c, ontem);
    const hojeAntes = await resultadoFinanceiroDo(c, hoje);
    const r = await fecharCaixa(c, s, 70);
    assert.equal(num(r.diferenca), -30, "[V1] diferenca -30");
    const ajustes = await ajustesDaSessao(c, s);
    assert.equal(ajustes.length, 1, "[V1] UM ajuste");
    assert.equal(ajustes[0].tipo, "saida", "[V1] a quebra e' saida");
    assert.equal(ajustes[0].categoria_id, CAT_QUEBRA, "[V1] Quebra de caixa");
    await datasSao(
      c,
      ajustes[0],
      ontem,
      "[V1] a quebra leva a data do dia em que o caixa abriu",
    );
    assert.equal(
      await resultadoFinanceiroDo(c, ontem),
      num(ontemAntes - 30),
      "[V1] o resultado de ONTEM (o dia das vendas desse caixa) leva a quebra",
    );
    assert.equal(
      await resultadoFinanceiroDo(c, hoje),
      hojeAntes,
      "[V1] o resultado de HOJE nao leva a quebra do caixa de ontem",
    );
    assert.equal(await saldoDe(c, CAIXA), 70, "[V1] Caixa = contado (70)");
  },
});

CENARIOS.push({
  id: "V2",
  nome: "V2: caixa de ontem fechado depois da meia-noite com sobra de 30 -> a sobra e' de ONTEM",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V2");
    const r = await fecharCaixa(c, s, 130);
    assert.equal(num(r.diferenca), 30, "[V2] diferenca +30");
    const ajustes = await ajustesDaSessao(c, s);
    assert.equal(ajustes.length, 1, "[V2] UM ajuste");
    assert.equal(ajustes[0].tipo, "entrada", "[V2] a sobra e' entrada");
    assert.equal(ajustes[0].categoria_id, CAT_SOBRA, "[V2] Sobra de caixa");
    await datasSao(
      c,
      ajustes[0],
      await dia(c, 1),
      "[V2] a sobra leva a data do dia em que o caixa abriu",
    );
    assert.equal(await saldoDe(c, CAIXA), 130, "[V2] Caixa = contado (130)");
  },
});

CENARIOS.push({
  id: "V3",
  nome: "V3: sangria de 20 depois da meia-noite no caixa de ontem -> a sangria e' de ONTEM; esperado 80; contar 80 fecha sem quebra",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V3");
    const m = await movimentar(c, s, "sangria", 20);
    const l = await linhaDe(c, m.id);
    assert.equal(l.origem, "sangria", "[V3] origem sangria");
    assert.equal(l.caixa_sessao_id, s, "[V3] na sessao de ontem");
    await datasSao(
      c,
      l,
      await dia(c, 1),
      "[V3] a sangria leva a data do dia em que o caixa abriu",
    );
    assert.equal(await esperadoDe(c, s), 80, "[V3] esperado 100 - 20");
    await fechaSemQuebra(c, s, 80, "V3");
  },
});

CENARIOS.push({
  id: "V4",
  nome: "V4: suprimento de 15 depois da meia-noite no caixa de ontem -> o suprimento e' de ONTEM; esperado 115",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V4");
    const m = await movimentar(c, s, "suprimento", 15);
    const l = await linhaDe(c, m.id);
    assert.equal(l.origem, "suprimento", "[V4] origem suprimento");
    await datasSao(
      c,
      l,
      await dia(c, 1),
      "[V4] o suprimento leva a data do dia em que o caixa abriu",
    );
    assert.equal(await esperadoDe(c, s), 115, "[V4] esperado 100 + 15");
  },
});

CENARIOS.push({
  id: "V5",
  nome: "V5: gasto de 20 pago em dinheiro ONTEM, lancado depois da meia-noite (salvar), com o caixa de ontem aberto -> sai da gaveta; contar 80 fecha sem quebra",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V5");
    const g = await lancar(c, gasto({ data_realizacao: await dia(c, 1) }));
    const l = await linhaDe(c, g);
    assert.equal(l.realizacao, await dia(c, 1), "[V5] pago ontem");
    assert.equal(
      l.caixa_sessao_id,
      s,
      "[V5] o gasto pago no dia da abertura entra na sessao ainda aberta",
    );
    assert.equal(await esperadoDe(c, s), 80, "[V5] esperado 100 - 20");
    await fechaSemQuebra(c, s, 80, "V5");
  },
});

CENARIOS.push({
  id: "V6",
  nome: "V6: gasto a pagar de 20 baixado com a data de ONTEM (baixar) com o caixa de ontem aberto -> sai da gaveta; contar 80 fecha sem quebra",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V6");
    const g = await lancar(
      c,
      gasto({ status: "previsto", data_vencimento: await dia(c, 1) }),
    );
    assert.equal(await esperadoDe(c, s), 100, "[V6] a pagar nao desconta");
    await baixar(c, g, await dia(c, 1));
    const l = await linhaDe(c, g);
    assert.equal(l.status, "realizado", "[V6] baixado");
    assert.equal(
      l.caixa_sessao_id,
      s,
      "[V6] a baixa no dia da abertura entra na sessao ainda aberta",
    );
    assert.equal(await esperadoDe(c, s), 80, "[V6] esperado 100 - 20");
    await fechaSemQuebra(c, s, 80, "V6");
  },
});

CENARIOS.push({
  id: "V7",
  nome: "V7: gasto de 20 pago HOJE com o caixa de ontem ainda aberto -> entra na sessao (como antes); esperado 80",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V7");
    const g = await lancar(c, gasto({ data_realizacao: await dia(c, 0) }));
    assert.equal((await linhaDe(c, g)).caixa_sessao_id, s, "[V7] na sessao");
    assert.equal(await esperadoDe(c, s), 80, "[V7] esperado 100 - 20");
  },
});

CENARIOS.push({
  id: "V8",
  nome: "V8: gasto de 20 pago ANTEONTEM (antes da abertura) com o caixa de ontem aberto -> fica fora da gaveta; esperado 100",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V8");
    const g = await lancar(c, gasto({ data_realizacao: await dia(c, 2) }));
    assert.equal(
      (await linhaDe(c, g)).caixa_sessao_id,
      null,
      "[V8] o gasto de antes da abertura nao entra na sessao",
    );
    assert.equal(await esperadoDe(c, s), 100, "[V8] esperado segue 100");
  },
});

CENARIOS.push({
  id: "V9",
  nome: "V9: gasto a pagar baixado com a data de ANTEONTEM com o caixa de ontem aberto -> fica fora da gaveta; esperado 100",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V9");
    const g = await lancar(
      c,
      gasto({ status: "previsto", data_vencimento: await dia(c, 2) }),
    );
    await baixar(c, g, await dia(c, 2));
    assert.equal(
      (await linhaDe(c, g)).caixa_sessao_id,
      null,
      "[V9] a baixa de antes da abertura nao entra na sessao",
    );
    assert.equal(await esperadoDe(c, s), 100, "[V9] esperado segue 100");
  },
});

CENARIOS.push({
  id: "V10",
  nome: "V10: transferencia de 10 do banco para a gaveta datada de ONTEM com o caixa de ontem aberto -> entra na sessao; esperado 110",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V10");
    const t = await lancar(c, {
      tipo: "transferencia",
      valor: 10,
      conta_id: BANCO,
      conta_destino_id: CAIXA,
      descricao: "Troco trazido do banco",
      data_realizacao: await dia(c, 1),
    });
    assert.equal(
      (await linhaDe(c, t)).caixa_sessao_id,
      s,
      "[V10] a transferencia para a gaveta no dia da abertura entra na sessao",
    );
    assert.equal(await esperadoDe(c, s), 110, "[V10] esperado 100 + 10");
  },
});

CENARIOS.push({
  id: "V11",
  nome: "V11: caixa de ontem ja FECHADO; gasto de ontem lancado depois -> nao entra em sessao nenhuma",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V11");
    await fecharCaixa(c, s, 100);
    const g = await lancar(c, gasto({ data_realizacao: await dia(c, 1) }));
    assert.equal(
      (await linhaDe(c, g)).caixa_sessao_id,
      null,
      "[V11] sessao fechada nao recebe lancamento",
    );
  },
});

CENARIOS.push({
  id: "V12",
  nome: "V12: um 'a pagar' editado para pago com a data de ONTEM (salvar com id) com o caixa de ontem aberto -> entra na sessao; esperado 80",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "V12");
    const base = gasto({
      status: "previsto",
      data_vencimento: await dia(c, 1),
    });
    const g = await lancar(c, base);
    await lancar(c, {
      ...base,
      id: g,
      status: "realizado",
      data_realizacao: await dia(c, 1),
    });
    const l = await linhaDe(c, g);
    assert.equal(l.status, "realizado", "[V12] editado para pago");
    assert.equal(l.caixa_sessao_id, s, "[V12] a edicao liga a sessao aberta");
    assert.equal(await esperadoDe(c, s), 80, "[V12] esperado 100 - 20");
  },
});

CENARIOS.push({
  id: "U1",
  nome: "U1: caixa aberto HOJE; gasto de 20 pago ONTEM (salvar) -> nao sai da gaveta de hoje; esperado 100; contar 100 fecha sem diferenca",
  corpo: async (c) => {
    const s = await caixaDeHoje(c, 100, "U1");
    const g = await lancar(c, gasto({ data_realizacao: await dia(c, 1) }));
    assert.equal(
      (await linhaDe(c, g)).caixa_sessao_id,
      null,
      "[U1] o gasto de ontem nao entra no caixa aberto hoje",
    );
    assert.equal(await esperadoDe(c, s), 100, "[U1] esperado segue 100");
    const r = await fecharCaixa(c, s, 100);
    assert.equal(num(r.diferenca), 0, "[U1] contar 100 fecha sem diferenca");
  },
});

CENARIOS.push({
  id: "U2",
  nome: "U2: caixa aberto HOJE; gasto a pagar baixado com a data de ONTEM -> nao sai da gaveta de hoje; esperado 100",
  corpo: async (c) => {
    const s = await caixaDeHoje(c, 100, "U2");
    const g = await lancar(
      c,
      gasto({ status: "previsto", data_vencimento: await dia(c, 1) }),
    );
    await baixar(c, g, await dia(c, 1));
    assert.equal(
      (await linhaDe(c, g)).caixa_sessao_id,
      null,
      "[U2] a baixa de ontem nao entra no caixa aberto hoje",
    );
    assert.equal(await esperadoDe(c, s), 100, "[U2] esperado segue 100");
  },
});

CENARIOS.push({
  id: "U3",
  nome: "U3: caixa aberto e fechado HOJE com quebra de 30 -> a quebra e' de HOJE (como antes)",
  corpo: async (c) => {
    const s = await caixaDeHoje(c, 100, "U3");
    await fecharCaixa(c, s, 70);
    const ajustes = await ajustesDaSessao(c, s);
    assert.equal(ajustes.length, 1, "[U3] UM ajuste");
    await datasSao(
      c,
      ajustes[0],
      await dia(c, 0),
      "[U3] a quebra do caixa de um dia so e' de hoje",
    );
    assert.equal(await saldoDe(c, CAIXA), 70, "[U3] Caixa = 70");
  },
});

CENARIOS.push({
  id: "U4",
  nome: "U4: sangria de 20 no caixa aberto HOJE -> a sangria e' de HOJE (como antes)",
  corpo: async (c) => {
    const s = await caixaDeHoje(c, 100, "U4");
    const m = await movimentar(c, s, "sangria", 20);
    await datasSao(
      c,
      await linhaDe(c, m.id),
      await dia(c, 0),
      "[U4] a sangria do caixa de um dia so e' de hoje",
    );
    assert.equal(await esperadoDe(c, s), 80, "[U4] esperado 80");
  },
});

const IDS = CENARIOS.map((x) => x.id);
// Com os corpos ANTERIORES (o defeito), so os cenarios da virada que dependem da regra nova ficam vermelhos.
const DEFEITO = ["V1", "V2", "V3", "V4", "V5", "V6", "V10", "V12"];

// ---------------------------------------------------------------- mutantes
// de/para sao trechos EXATOS do corpo vivo (pg_get_functiondef); cada `de` tem de aparecer 1x. `espera` = os cenarios que TEM de
// ficar vermelhos; todos os outros TEM de seguir verdes (e' o que prova que o vermelho caiu na asserção certa).
const MUTANTES = {
  // Volta a regra antiga no salvar: so o pago HOJE entra.
  "salvar-so-hoje": {
    funcao: SALVAR,
    de: "AND v_real >= public.fin__dia(s.aberto_em)",
    para: "AND v_real = public.fin__hoje()",
    espera: ["V5", "V10", "V12"],
  },
  // Tira o limite do dia da abertura no salvar: o gasto de antes da abertura (e o de ontem no caixa de hoje) entra na gaveta.
  "salvar-sem-dia-da-abertura": {
    funcao: SALVAR,
    de: "\n       AND v_real >= public.fin__dia(s.aberto_em)",
    para: "",
    espera: ["V8", "U1"],
  },
  "baixar-so-hoje": {
    funcao: BAIXAR,
    de: "AND v_data >= public.fin__dia(s.aberto_em)",
    para: "AND v_data = public.fin__hoje()",
    espera: ["V6"],
  },
  "baixar-sem-dia-da-abertura": {
    funcao: BAIXAR,
    de: "\n     AND v_data >= public.fin__dia(s.aberto_em)",
    para: "",
    espera: ["V9", "U2"],
  },
  // A sobra/quebra volta para o dia do FECHAMENTO.
  "quebra-no-dia-do-fechamento": {
    funcao: FECHAR,
    de: "v_dia := public.fin__dia(v_s.aberto_em);",
    para: "v_dia := public.fin__hoje();",
    espera: ["V1", "V2"],
  },
  // A sangria/suprimento volta para o dia do MOVIMENTO.
  "sangria-no-dia-do-movimento": {
    funcao: MOVER,
    de: "v_dia := public.fin__dia(v_s.aberto_em);",
    para: "v_dia := public.fin__hoje();",
    espera: ["V3", "V4"],
  },
};

async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  const def = await definicao(c, m.funcao);
  assert.equal(
    def.split(m.de).length - 1,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo de ${m.funcao}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notEqual(mutado, def, `mutante ${nome}: nada mudou`);
  await c.query(mutado);
  assert.equal(
    await definicao(c, m.funcao),
    mutado,
    `mutante ${nome}: o banco nao instalou exatamente o mutante`,
  );
}

// ------------------------------------------------------------------ rodada
async function montarLoja(c) {
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@caixa1654.fixture.invalid', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
    [U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Caixa 1654', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [U_ADMIN],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [U_ADMIN]);
  const sujo = (
    await c.query(
      `SELECT (SELECT count(*) FROM public.fin_lancamentos)::int AS lanc,
              (SELECT count(*) FROM public.fin_caixa_sessoes)::int AS sess,
              (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos`,
    )
  ).rows[0];
  assert.deepEqual(
    sujo,
    { lanc: 0, sess: 0, pedidos: 0 },
    "PRECONDICAO: a prova parte do clone SEM lancamento, sessao de caixa nem pedido (rodar-isolado.cjs)",
  );
  // Numa loja de verdade o saldo inicial da conta Caixa e' antigo (a data em que o financeiro nasceu); no clone ele e' a data do apply
  // (hoje), e a quebra de ONTEM nao entraria no saldo. Recuar a data do saldo inicial reproduz a loja que ja vende ha semanas.
  await c.query(
    "UPDATE public.fin_contas SET saldo_inicial_em = public.fin__hoje() - 30 WHERE id = $1",
    [CAIXA],
  );
}

/** Roda cada cenario num SAVEPOINT desfeito. Erro que nao e' de asserção (SQL, montagem) sobe: e' do teste, nao do corpo. */
async function rodarCenarios(c) {
  const passou = [];
  const falhou = [];
  for (const { id, nome, corpo } of CENARIOS) {
    await c.query("SAVEPOINT cenario1654");
    try {
      await corpo(c);
      passou.push(id);
    } catch (erro) {
      if (erro?.code !== "ERR_ASSERTION") throw erro;
      falhou.push({ id, nome, erro });
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT cenario1654");
      await c.query("RELEASE SAVEPOINT cenario1654");
    }
  }
  return { passou, falhou };
}
const linhaDoErro = (f) =>
  `${f.id}: ${f.erro.message.split("\n")[0]} (visto ${JSON.stringify(f.erro.actual)}, esperado ${JSON.stringify(f.erro.expected)})`;
function exigirVermelhosExatos(r, espera, rotulo) {
  const vermelhos = r.falhou.map((f) => f.id).sort();
  assert.deepEqual(
    vermelhos,
    [...espera].sort(),
    `${rotulo}: vermelho em [${vermelhos.join(", ")}], esperado EXATAMENTE [${espera.join(", ")}]\n${r.falhou.map(linhaDoErro).join("\n")}`,
  );
  assert.deepEqual(
    [...r.passou].sort(),
    IDS.filter((id) => !espera.includes(id)).sort(),
    `${rotulo}: os outros cenarios tinham de seguir verdes`,
  );
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  const resumo = [];
  try {
    await c.query("BEGIN");

    // Base ainda nos corpos anteriores (arvore local sem a migration)? Aplica; no CI ela ja esta no ar.
    const vivo = await hashes(c);
    if (ASSINATURAS.every((s) => vivo[s] === HASH_ANTES[s])) {
      await c.query(migration);
    }
    assert.deepEqual(
      await hashes(c),
      HASH_DESTA,
      "o clone devia estar com os quatro corpos da 20261654000000",
    );
    const topo = await funcoes(c);
    await conferir(c, consultaDepois, true, "210a depois do apply");
    await conferir(c, consultaAntes, false, "210b depois do apply");
    // As consultas da 246 (49a) e da 252 (55a) aceitam os corpos desta como sucessora: com ela no ar seguem POSITIVAS
    // (as provas da 246 e da 252 a tiram do clone antes de medir, entao so aqui se mede a 49a/55a com ela no ar).
    for (const nome of [
      "49a-conferir-lancamento-idempotente-aplicado",
      "55a-conferir-intencao-do-caixa-aplicado",
    ]) {
      const linhas = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.ok(linhas.length > 0, `${nome}: sem linhas`);
      assert.deepEqual(
        linhas.filter((l) => l.ok !== true).map((l) => l.item),
        [],
        `${nome} com a 1654 no ar`,
      );
    }
    // A 252 e a 246 nao se desfazem por baixo desta (os rollbacks delas recusam com um corpo posterior no ar).
    for (const [rotulo, sql] of [
      ["rollback da 20261252000000", rollback252],
      ["rollback da 20261246000000", rollback246],
    ]) {
      const r = await tentar(c, sql);
      assert.equal(
        r.erro?.code,
        "P0001",
        `${rotulo} com a 1654 no ar: ${JSON.stringify(r)}`,
      );
      assert.match(r.erro.message, /B1_BASELINE_DIVERGENT/, rotulo);
      assert.deepEqual(
        await funcoes(c),
        topo,
        `${rotulo}: escreveu antes de recusar`,
      );
    }

    await montarLoja(c);

    // ===== o estado novo: todos os cenarios verdes =====
    {
      const r = await rodarCenarios(c);
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
          `cenarios vermelhos com a migration no ar:\n${r.falhou.map(linhaDoErro).join("\n")}`,
        );
      }
      resumo.push(
        `${IDS.length}/${IDS.length} cenarios verdes com a migration`,
      );
    }

    // ===== mutantes: cada um derruba EXATAMENTE o que prometeu =====
    for (const nome of Object.keys(MUTANTES)) {
      await c.query("SAVEPOINT mutante1654");
      try {
        await aplicarMutante(c, nome);
        exigirVermelhosExatos(
          await rodarCenarios(c),
          MUTANTES[nome].espera,
          `mutante ${nome}`,
        );
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT mutante1654");
        await c.query("RELEASE SAVEPOINT mutante1654");
      }
    }
    assert.deepEqual(await funcoes(c), topo, "os mutantes deixaram rastro");
    resumo.push(
      `${Object.keys(MUTANTES).length} mutantes mortos na asserção certa`,
    );

    // ===== CONTROLE com os corpos anteriores + o DADO QUE JA EXISTIA =====
    await isolado(c, async () => {
      await c.query(rollback);
      const anterior = await funcoes(c);
      for (const f of anterior) {
        const sig = ASSINATURAS.find((s) => s.includes(`.${f.proname}(`));
        assert.equal(
          f.prosrc,
          ANTES[sig],
          `o rollback nao devolveu ${sig} byte a byte`,
        );
      }
      await conferir(c, consultaAntes, true, "210b depois do rollback");
      await conferir(c, consultaDepois, false, "210a depois do rollback");
      // O defeito existe e a prova o enxerga: so os cenarios da virada caem; os de um dia so ja passavam.
      exigirVermelhosExatos(
        await rodarCenarios(c),
        DEFEITO,
        "controle com os corpos anteriores",
      );

      // Dado que ja existia: caixa aberto ontem e um gasto de ontem lancado pelo corpo ANTERIOR (ficou fora da gaveta).
      const s = await caixaDeOntem(c, 100, "dado antigo");
      const velho = await lancar(
        c,
        gasto({ data_realizacao: await dia(c, 1) }),
      );
      assert.equal(
        (await linhaDe(c, velho)).caixa_sessao_id,
        null,
        "controle: o corpo anterior deixava o gasto de ontem fora",
      );
      const dados = await fotografar(c);
      await c.query(migration);
      assert.deepEqual(
        await fotografar(c),
        dados,
        "o apply reescreveu sessao, lancamento ou tentativa que ja existiam",
      );
      assert.deepEqual(
        await funcoes(c),
        topo,
        "o apply sobre o corpo anterior nao reproduziu o topo do CI",
      );
      // Daqui para a frente a sessao aberta segue a regra nova; o lancamento antigo fica como foi gravado.
      const novo = await lancar(c, gasto({ data_realizacao: await dia(c, 1) }));
      assert.equal(
        (await linhaDe(c, novo)).caixa_sessao_id,
        s,
        "depois do apply o gasto de ontem entra na sessao aberta",
      );
      assert.equal(
        (await linhaDe(c, velho)).caixa_sessao_id,
        null,
        "o lancamento antigo nao foi religado",
      );
      assert.equal(
        await esperadoDe(c, s),
        80,
        "o esperado conta so o lancamento novo (100 - 20)",
      );
      const r = await fecharCaixa(c, s, 80);
      assert.equal(num(r.diferenca), 0, "fechar 80 nao gera quebra");
    });
    resumo.push(
      "controle: corpos anteriores vermelhos so na virada; dado antigo intacto no apply",
    );

    // ===== reaplicar (inclusive CRLF) nao muda nada =====
    {
      const dados = await fotografar(c);
      await c.query(migration);
      await c.query(migration.replace(/\n/g, "\r\n"));
      assert.deepEqual(await fotografar(c), dados, "reaplicar tocou dados");
      assert.deepEqual(
        await funcoes(c),
        topo,
        "reaplicar mudou corpo, OID, dono, ACL ou atributos",
      );
    }

    // ===== pre-voo: corpo, atributo ou ACL desconhecidos recusam SEM escrever =====
    for (const [rotulo, sabotagem] of [
      [
        "corpo desconhecido do salvar",
        async () =>
          (await definicao(c, SALVAR)).replace(
            "DECLARE",
            "-- corpo desconhecido\nDECLARE",
          ),
      ],
      [
        "corpo desconhecido do fechar",
        async () =>
          (await definicao(c, FECHAR)).replace(
            "DECLARE",
            "-- corpo desconhecido\nDECLARE",
          ),
      ],
      [
        "baixar SECURITY INVOKER",
        async () => `ALTER FUNCTION ${BAIXAR} SECURITY INVOKER`,
      ],
      [
        "mover com outro search_path",
        async () => `ALTER FUNCTION ${MOVER} SET search_path TO pg_catalog`,
      ],
      [
        "salvar aberta ao anon",
        async () => `GRANT EXECUTE ON FUNCTION ${SALVAR} TO anon`,
      ],
      [
        "fechar aberta a PUBLIC",
        async () => `GRANT EXECUTE ON FUNCTION ${FECHAR} TO PUBLIC`,
      ],
      [
        "sem fin__dia",
        async () =>
          "ALTER FUNCTION public.fin__dia(timestamptz) RENAME TO fin__dia_sumiu",
      ],
    ]) {
      await isolado(c, async () => {
        await c.query(await sabotagem());
        const sabotada = await funcoes(c);
        const dados = await fotografar(c);
        const r = await tentar(c, migration);
        assert.equal(
          r.erro?.code,
          "P0001",
          `${rotulo}: o pre-voo nao recusou (${JSON.stringify(r.erro)})`,
        );
        assert.match(r.erro.message, /B1_BASELINE_DIVERGENT/, rotulo);
        assert.deepEqual(
          await funcoes(c),
          sabotada,
          `${rotulo}: o pre-voo escreveu antes de recusar`,
        );
        assert.deepEqual(await fotografar(c), dados, `${rotulo}: tocou dados`);
      });
    }
    resumo.push("reaplicar 2x e CRLF iguais; pre-voo recusa sem escrever");

    // ===== rollback devolve os QUATRO corpos byte a byte e nao toca dado; segundo rollback recusa; reaplicar volta ao topo =====
    {
      const dados = await fotografar(c);
      await c.query(rollback);
      for (const f of await funcoes(c)) {
        const sig = ASSINATURAS.find((s) => s.includes(`.${f.proname}(`));
        assert.equal(
          f.prosrc,
          ANTES[sig],
          `o rollback nao devolveu ${sig} byte a byte`,
        );
        const novo = topo.find((t) => t.proname === f.proname);
        assert.deepEqual(
          { ...f, prosrc: undefined },
          { ...novo, prosrc: undefined },
          `o rollback mudou OID, dono, ACL ou atributo de ${sig}`,
        );
      }
      assert.deepEqual(await fotografar(c), dados, "o rollback tocou dados");
      const segundo = await tentar(c, rollback);
      assert.equal(
        segundo.erro?.code,
        "P0001",
        "segundo rollback devia recusar",
      );
      assert.match(segundo.erro.message, /B1_BASELINE_DIVERGENT/);
      await c.query(migration);
      assert.deepEqual(
        await funcoes(c),
        topo,
        "reaplicar depois do rollback nao voltou ao topo",
      );
    }
    resumo.push(
      "rollback byte a byte, segundo rollback recusa; 210a/210b nas duas pontas",
    );

    console.log(`PASSOU 20261654000000: ${resumo.join("; ")}.`);
    anexarAoSummary(TITULO, resumo.map((l) => `- ✅ ${l}`).join("\n"));
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
