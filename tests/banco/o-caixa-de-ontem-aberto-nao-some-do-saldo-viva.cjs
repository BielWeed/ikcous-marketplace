"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do proprio teste (nomes de mutante e de cenario). */
// 20261660000000 (o caixa de ontem aberto nao some do saldo; caça de 28/11/2026). Somente Postgres descartavel do rpc-ci
// (rodar-isolado.cjs: CI_BANCO_EFEMERO=1 + localhost + clone prova_*), nunca banco de loja. Fixtures inventadas.
//
// PARTE 1 (uma transacao que termina em ROLLBACK). O caixa abre ONTEM as 09:00 (Brasilia: a sessao aberta pela RPC tem o aberto_em
// recuado para la) e segue aberto depois da meia-noite (HOJE, o now() da transacao). Toda sangria, suprimento e sobra/quebra dele
// leva a data de ONTEM (20261654000000); o saldo de cada conta so soma o que tem data a partir do saldo inicial dela.
//   A1  o defeito do achado: saldo inicial do Caixa acertado "em hoje" -> a sangria de 500 some do Caixa e a abertura seguinte acusa
//       uma "Quebra de caixa" FALSA de 500. Agora o acerto recusa (22023) e a conta fica como estava.
//   A2  sangria para uma conta criada depois da meia-noite (saldo com data de hoje): recusa; acertar a data do cofre para o dia do
//       caixa (o que a mensagem ensina) libera.
//   A3  o banco que recebeu a sangria nao pula o saldo inicial para hoje com o caixa aberto: cancelar a sangria depois mudava o total.
//   A4  suprimento vindo de uma conta criada depois da meia-noite: recusa.
//   A5  so a data (mesmo valor) do Caixa sem movimento nenhum: recusa; a quebra real do fechamento entra uma vez so.
//   A6/A7 o estado ruim que JA existia (gravado pelo corpo anterior): trocar so o valor recusa, a sangria recusa e cita a conta.
// O COMPORTAMENTO NORMAL NAO MUDA (N1..N14): caixa de hoje, conta que o caixa nao toca, a data do proprio dia do caixa, reenviar os
// mesmos valores (o formulario manda todos os campos), renomear no estado ruim, caixa ja fechado, sangria/suprimento com o banco, o
// cofre novo com o caixa de hoje, o replay da mesma tentativa, cancelar no caixa aberto e recusar no fechado, o banco na data do
// dia do caixa, o movimento de HOJE na sessao de ontem, a data mais antiga e o movimento cancelado.
// CONTROLE: com os corpos ANTERIORES (o rollback desta migration) EXATAMENTE A1..A7 ficam vermelhos (o defeito existe e a prova o
// enxerga) e N1..N14 verdes. MUTANTES: cada um tira UM pedaco das duas recusas e derruba EXATAMENTE o que prometeu. DADO QUE JA
// EXISTIA: o estado ruim gravado pelo corpo anterior fica byte a byte no apply; dali em diante a regra nova vale.
// Migration: apply 2x e CRLF iguais, pre-voo recusa sem escrever, rollback byte a byte, segundo rollback recusa, os rollbacks da
// 20261399930000 e da 20261654000000 recusam com esta no ar, consultas 216a/216b (e 128a/210a/55a seguem positivas).
//
// PARTE 2 (corridas reais, COMMIT no clone prova_*; pg_blocking_pids). C1: o cancelamento espera o fechamento e recusa (caixa ja
// fechado); C2: o fechamento espera o cancelamento e nao conta a sangria cancelada (sem sobra falsa). Controle com o rollback
// commitado: o cancelamento passa por baixo do fechamento (C1) e o fechamento acusa sobra falsa (C2). C3: fin_conta_salvar e a
// sangria na mesma conta nunca se cruzam sem uma ver a outra (FOR SHARE); sem o FOR SHARE (mutante) a sangria some do saldo.
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
  "Prova viva: o caixa de ontem aberto nao some do saldo (20261660000000)";
const NOME = "20261660000000_o_caixa_de_ontem_aberto_nao_some_do_saldo.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback1399930 = ler(
  "supabase/migrations/rollback-manual-20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql",
);
const rollback1654 = ler(
  "supabase/migrations/rollback-manual-20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
);
const consultaAntes = ler(
  "scripts/publicacao/consultas/216b-antes-o-caixa-de-ontem-aberto-nao-some-do-saldo-base-vigente.sql",
);
const consultaDepois = ler(
  "scripts/publicacao/consultas/216a-conferir-o-caixa-de-ontem-aberto-nao-some-do-saldo-aplicado.sql",
);
const bloco = (sql, fn) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `definicao de ${fn} ausente`);
  const fim = sql.indexOf("\n$$;", sql.indexOf("AS $$", ini)) + "\n$$;".length;
  return sql.slice(ini, fim);
};
const corpoDe = (b) => b.split("AS $$")[1].slice(0, -3);

const CONTA = "public.fin_conta_salvar(jsonb)";
const MOVER =
  "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)";
const CANCELAR = "public.fin_lancamento_cancelar(uuid,text)";
const ASSINATURAS = [CONTA, MOVER, CANCELAR];
// Os corpos de ANTES, lidos das migrations que os deixaram vivos (nao copiados a mao), e os hashes das duas pontas.
const ANTES = {
  [CONTA]: corpoDe(
    bloco(
      ler(
        "supabase/migrations/20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql",
      ),
      "fin_conta_salvar",
    ),
  ),
  [MOVER]: corpoDe(
    bloco(
      ler(
        "supabase/migrations/20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
      ),
      "fin_caixa_movimentar_com_chave",
    ),
  ),
  [CANCELAR]: corpoDe(
    bloco(
      ler(
        "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
      ),
      "fin_lancamento_cancelar",
    ),
  ),
};
const HASH_ANTES = {
  [CONTA]: "1dc6cfdb075e3a1a0882398e1220d0f1",
  [MOVER]: "f1b22fd85f7a4ae2200d37001c9e1ffb",
  [CANCELAR]: "a0b036d6d16d323dc806732b85b8b1cf",
};
const HASH_DESTA = {
  [CONTA]: "d29894a41940ec4f5bc55ca2b103b69a",
  [MOVER]: "b7df8a8d11d64ab2cc2bd1dc31a57ae3",
  [CANCELAR]: "ee75614cd65e5a7339045320e8a855c3",
};

const U_ADMIN = "5e166000-0000-4000-8000-000000000001";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const MP = "f1000000-0000-4000-8000-000000000003";
const CAT_QUEBRA = "f2000000-0000-4000-8000-000000000031";

// ------------------------------------------------------------------ apoio
const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
/** YYYY-MM-DD -> DD/MM/YYYY (o to_char das mensagens). */
const br = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

async function rpc(c, sql, params = []) {
  return (await c.query(sql, params)).rows[0].r;
}
// Executa e devolve {erro: {code, message}} ou {linhas}; a transacao segue de pe (savepoint).
async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa1660");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa1660");
    return { linhas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa1660");
    await c.query("RELEASE SAVEPOINT tentativa1660");
    return { erro: { code: e.code, message: e.message } };
  }
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1660");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1660");
    await c.query("RELEASE SAVEPOINT caso1660");
  }
}
/** A RPC tinha de aceitar: recusa vira falha de ASSERCAO (o cenario fica vermelho, a rodada nao cai). */
function aceitou(r, rotulo) {
  if (r.erro) {
    assert.fail(
      `[${rotulo}] devia aceitar e recusou: ${r.erro.code} ${r.erro.message}`,
    );
  }
  return r.linhas[0].r;
}
/** A RPC tinha de recusar com 22023 e a mensagem citar cada trecho. */
function recusou(r, rotulo, ...trechos) {
  assert.equal(
    r.erro?.code,
    "22023",
    `[${rotulo}] devia recusar com 22023 (veio ${JSON.stringify(r.erro ?? r.linhas?.[0]?.r)})`,
  );
  for (const t of trechos) {
    assert.ok(
      r.erro.message.includes(t),
      `[${rotulo}] a mensagem devia citar "${t}": ${r.erro.message}`,
    );
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
  assert.equal(linhas.length, 3);
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
// Tudo o que as tres funcoes (e o caixa) escrevem: se mudar, o apply/rollback tocou dado.
async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id), '[]') FROM public.fin_contas x) AS contas,
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.fin_caixa_sessoes s) AS sessoes,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM public.fin_lancamentos l) AS lancamentos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY chave), '[]') FROM public.fin_caixa_movimento_tentativas t) AS tentativas`)
  ).rows[0];
}
async function conferir(c, sql, positivo, rotulo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(
    linhas.length,
    10,
    `${rotulo}: o rol fechado das consultas 216 tem 10 linhas`,
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
/** O dinheiro da loja inteira (soma do saldo de todas as contas, como o painel mostra). */
async function total(c) {
  const lista = await rpc(c, "SELECT public.fin_contas_listar() AS r");
  return num(lista.reduce((s, x) => s + Number(x.saldo), 0));
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
async function contaRow(c, id) {
  return (
    await c.query(
      `SELECT nome, tipo, saldo_inicial::float8 AS saldo_inicial, saldo_inicial_em::text AS saldo_inicial_em, ativa
         FROM public.fin_contas WHERE id = $1`,
      [id],
    )
  ).rows[0];
}
/** O que o formulario do painel manda: TODOS os campos da conta, com as mudancas por cima. */
async function payloadDe(c, id, mudancas = {}) {
  return { id, ...(await contaRow(c, id)), ...mudancas };
}
const salvarConta = (c, p) =>
  tentar(c, "SELECT public.fin_conta_salvar($1::jsonb) AS r", [
    JSON.stringify(p),
  ]);
const mover = (c, s, tipo, valor, contra, chave = randomUUID()) =>
  tentar(
    c,
    "SELECT public.fin_caixa_movimentar_com_chave($1, $2, $3, $4, NULL, $5) AS r",
    [s, chave, tipo, valor, contra],
  );
const cancelar = (c, id) =>
  tentar(
    c,
    "SELECT public.fin_lancamento_cancelar($1, 'Lancado por engano') AS r",
    [id],
  );
const fechar = (c, s, contado) =>
  tentar(c, "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r", [
    s,
    contado,
  ]);
const abrir = (c, valor) =>
  tentar(c, "SELECT public.fin_caixa_abrir($1, NULL) AS r", [valor]);

async function criarConta(c, nome, saldo, em, rotulo) {
  return aceitou(
    await salvarConta(c, {
      nome,
      tipo: "outro",
      saldo_inicial: saldo,
      saldo_inicial_em: em,
      ativa: true,
    }),
    `${rotulo}: criar ${nome}`,
  ).id;
}
async function quebras(c) {
  return (
    await c.query(
      `SELECT valor::float8 AS v FROM public.fin_lancamentos
        WHERE categoria_id = $1 AND status = 'realizado' ORDER BY created_at, id`,
      [CAT_QUEBRA],
    )
  ).rows.map((l) => l.v);
}
async function realizacaoDe(c, id) {
  return rpc(
    c,
    "SELECT data_realizacao::text AS r FROM public.fin_lancamentos WHERE id = $1",
    [id],
  );
}
/** O estado que o corpo ANTERIOR deixava gravar: o saldo inicial do Caixa com a data de HOJE e o caixa de ontem aberto. */
async function estadoRuim(c) {
  await c.query(
    "UPDATE public.fin_contas SET saldo_inicial_em = public.fin__hoje() WHERE id = $1",
    [CAIXA],
  );
}

/**
 * Caixa aberto com `valor` na gaveta e, se `diasAtras` > 0, com a abertura recuada para as 09:00 (Brasilia) daquele dia. O saldo
 * inicial do Caixa vira `valor` antes de abrir: a abertura nao gera ajuste (um ajuste com a data de hoje bagunçaria a conta dos
 * cenarios que mudam o saldo inicial para hoje).
 */
async function caixaAberto(c, valor, diasAtras, rotulo) {
  await c.query(
    "UPDATE public.fin_contas SET saldo_inicial = $2 WHERE id = $1",
    [CAIXA, valor],
  );
  const contar = async () =>
    (await c.query("SELECT count(*)::int AS n FROM public.fin_lancamentos"))
      .rows[0].n;
  const antes = await contar();
  const { id } = aceitou(await abrir(c, valor), `${rotulo}: abrir o caixa`);
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
    await contar(),
    antes,
    `[${rotulo}] PRECONDICAO: a abertura nao gerou ajuste`,
  );
  assert.equal(
    await esperadoDe(c, id),
    valor,
    `[${rotulo}] PRECONDICAO: esperado`,
  );
  assert.equal(
    await saldoDe(c, CAIXA),
    valor,
    `[${rotulo}] PRECONDICAO: saldo do Caixa`,
  );
  return id;
}
const caixaDeOntem = (c, valor, rotulo) => caixaAberto(c, valor, 1, rotulo);
const caixaDeHoje = (c, valor, rotulo) => caixaAberto(c, valor, 0, rotulo);

// ---------------------------------------------------------------- cenarios
const CENARIOS = [];

CENARIOS.push({
  id: "A1",
  nome: "A1: caixa de ontem com 100+500, saldo inicial do Caixa acertado para 600 'em hoje', sangria de 500 -> nada some, nenhuma Quebra falsa na abertura seguinte",
  corpo: async (c) => {
    const [hoje, ontem, trintaAtras] = [
      await dia(c, 0),
      await dia(c, 1),
      await dia(c, 30),
    ];
    const s = await caixaDeOntem(c, 100, "A1");
    aceitou(
      await mover(c, s, "suprimento", 500, BANCO),
      "A1: suprimento de 500",
    );
    const antes = await total(c);
    const r = await salvarConta(
      c,
      await payloadDe(c, CAIXA, { saldo_inicial: 600, saldo_inicial_em: hoje }),
    );
    const sangria = await mover(c, s, "sangria", 500, BANCO);
    assert.equal(
      await total(c),
      antes,
      "[A1] a sangria de 500 para o banco nao cria nem some com dinheiro (total das contas)",
    );
    aceitou(sangria, "A1: a sangria de 500");
    aceitou(await fechar(c, s, 100), "A1: fechar contando 100");
    aceitou(await abrir(c, 100), "A1: abrir de novo com os 100 da gaveta");
    assert.deepEqual(
      await quebras(c),
      [],
      "[A1] nenhuma 'Quebra de caixa' falsa na abertura seguinte",
    );
    recusou(
      r,
      "A1",
      `O caixa aberto em ${br(ontem)}`,
      "ainda lança nesta conta",
    );
    const conta = await contaRow(c, CAIXA);
    assert.deepEqual(
      [conta.saldo_inicial, conta.saldo_inicial_em],
      [100, trintaAtras],
      "[A1] a conta Caixa ficou como estava",
    );
  },
});

CENARIOS.push({
  id: "A2",
  nome: "A2: sangria de 200 para um cofre criado depois da meia-noite (saldo 'em hoje') -> recusa sem gravar; com a data do cofre no dia do caixa, passa",
  corpo: async (c) => {
    const [hoje, ontem] = [await dia(c, 0), await dia(c, 1)];
    const s = await caixaDeOntem(c, 300, "A2");
    const cofre = await criarConta(c, "Cofre da loja", 0, hoje, "A2");
    const antes = await total(c);
    const k = randomUUID();
    const r = await mover(c, s, "sangria", 200, cofre, k);
    assert.equal(
      await total(c),
      antes,
      "[A2] a sangria para o cofre novo nao some com dinheiro (total das contas)",
    );
    recusou(r, "A2", "Cofre da loja", br(hoje), br(ontem), "a sangria");
    assert.equal(
      (
        await c.query(
          `SELECT (SELECT count(*) FROM public.fin_caixa_movimento_tentativas WHERE chave = $1)
                + (SELECT count(*) FROM public.fin_lancamentos WHERE conta_destino_id = $2) AS n`,
          [k, cofre],
        )
      ).rows[0].n,
      "0",
      "[A2] a recusa nao deixou tentativa nem lancamento",
    );
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, cofre, { saldo_inicial_em: ontem }),
      ),
      "A2: a data do saldo do cofre no dia do caixa",
    );
    aceitou(
      await mover(c, s, "sangria", 200, cofre),
      "A2: a sangria depois de acertar a data",
    );
    assert.equal(await saldoDe(c, cofre), 200, "[A2] o cofre recebeu os 200");
    assert.equal(await total(c), antes, "[A2] o total segue o mesmo");
  },
});

CENARIOS.push({
  id: "A3",
  nome: "A3: o banco que recebeu a sangria de ontem nao pula o saldo inicial para hoje com o caixa aberto; cancelar a sangria nao muda o total",
  corpo: async (c) => {
    const [hoje, ontem, trintaAtras] = [
      await dia(c, 0),
      await dia(c, 1),
      await dia(c, 30),
    ];
    const s = await caixaDeOntem(c, 300, "A3");
    const m = aceitou(
      await mover(c, s, "sangria", 200, BANCO),
      "A3: sangria",
    ).id;
    const antes = await total(c);
    const r = await salvarConta(
      c,
      await payloadDe(c, BANCO, {
        saldo_inicial: 1200,
        saldo_inicial_em: hoje,
      }),
    );
    aceitou(await cancelar(c, m), "A3: cancelar a sangria com o caixa aberto");
    assert.equal(
      await total(c),
      antes,
      "[A3] cancelar uma transferencia entre as contas da loja nao muda o total",
    );
    recusou(r, "A3", `O caixa aberto em ${br(ontem)}`);
    const banco = await contaRow(c, BANCO);
    assert.deepEqual(
      [banco.saldo_inicial, banco.saldo_inicial_em],
      [1000, trintaAtras],
      "[A3] a conta do banco ficou como estava",
    );
  },
});

CENARIOS.push({
  id: "A4",
  nome: "A4: suprimento de 200 vindo de um cofre criado depois da meia-noite -> recusa sem gravar",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeOntem(c, 100, "A4");
    const cofre = await criarConta(c, "Cofre da loja", 500, hoje, "A4");
    const antes = await total(c);
    const r = await mover(c, s, "suprimento", 200, cofre);
    assert.equal(
      await total(c),
      antes,
      "[A4] o suprimento do cofre novo nao cria dinheiro (total das contas)",
    );
    recusou(r, "A4", "Cofre da loja", "o suprimento");
  },
});

CENARIOS.push({
  id: "A5",
  nome: "A5: so a data do saldo do Caixa (mesmo valor) para hoje, sem movimento -> recusa; fechar com 70 gera UMA quebra de 30 e a abertura nao repete",
  corpo: async (c) => {
    const [hoje, ontem] = [await dia(c, 0), await dia(c, 1)];
    const s = await caixaDeOntem(c, 100, "A5");
    const r = await salvarConta(
      c,
      await payloadDe(c, CAIXA, { saldo_inicial_em: hoje }),
    );
    aceitou(await fechar(c, s, 70), "A5: fechar contando 70");
    aceitou(await abrir(c, 70), "A5: abrir de novo com os 70");
    assert.deepEqual(
      await quebras(c),
      [30],
      "[A5] uma 'Quebra de caixa' so, a de 30 do fechamento (a abertura nao conta a mesma falta de novo)",
    );
    recusou(r, "A5", `O caixa aberto em ${br(ontem)}`);
  },
});

CENARIOS.push({
  id: "A6",
  nome: "A6: estado ruim que ja existia (saldo do Caixa 'em hoje' com o caixa de ontem aberto) -> trocar so o valor recusa",
  corpo: async (c) => {
    const ontem = await dia(c, 1);
    await caixaDeOntem(c, 100, "A6");
    await estadoRuim(c);
    const r = await salvarConta(
      c,
      await payloadDe(c, CAIXA, { saldo_inicial: 150 }),
    );
    recusou(r, "A6", `O caixa aberto em ${br(ontem)}`);
    assert.equal(
      (await contaRow(c, CAIXA)).saldo_inicial,
      100,
      "[A6] o valor ficou como estava",
    );
  },
});

CENARIOS.push({
  id: "A7",
  nome: "A7: estado ruim que ja existia -> a sangria recusa, cita a conta do caixa e nao some com dinheiro",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "A7");
    await estadoRuim(c);
    const nomeDoCaixa = (await contaRow(c, CAIXA)).nome;
    const antes = await total(c);
    const r = await mover(c, s, "sangria", 50, BANCO);
    assert.equal(
      await total(c),
      antes,
      "[A7] a sangria nao some do Caixa (total das contas)",
    );
    recusou(r, "A7", `A conta ${nomeDoCaixa}`, "a sangria");
  },
});

CENARIOS.push({
  id: "N1",
  nome: "N1: caixa de hoje -> saldo do Caixa 'em hoje' e a sangria seguem livres",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeHoje(c, 100, "N1");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { saldo_inicial_em: hoje }),
      ),
      "N1: saldo do Caixa em hoje",
    );
    const antes = await total(c);
    aceitou(await mover(c, s, "sangria", 30, BANCO), "N1: sangria");
    assert.equal(await total(c), antes, "[N1] total");
    assert.equal(await saldoDe(c, CAIXA), 70, "[N1] Caixa 70");
  },
});

CENARIOS.push({
  id: "N2",
  nome: "N2: caixa de ontem aberto -> a conta que ele nao toca (Mercado Pago) muda o saldo para hoje",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeOntem(c, 100, "N2");
    aceitou(await mover(c, s, "sangria", 30, BANCO), "N2: sangria");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, MP, { saldo_inicial: 50, saldo_inicial_em: hoje }),
      ),
      "N2: Mercado Pago em hoje",
    );
    assert.equal(await saldoDe(c, MP), 50, "[N2] Mercado Pago 50");
  },
});

CENARIOS.push({
  id: "N3",
  nome: "N3: caixa de ontem -> o saldo do Caixa com a data do PROPRIO dia do caixa passa, e a sangria conta",
  corpo: async (c) => {
    const ontem = await dia(c, 1);
    const s = await caixaDeOntem(c, 100, "N3");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { saldo_inicial_em: ontem }),
      ),
      "N3: Caixa em ontem",
    );
    const antes = await total(c);
    aceitou(await mover(c, s, "sangria", 40, BANCO), "N3: sangria");
    assert.equal(await total(c), antes, "[N3] total");
    assert.equal(await saldoDe(c, CAIXA), 60, "[N3] Caixa 60");
  },
});

CENARIOS.push({
  id: "N4",
  nome: "N4: caixa de ontem com sangria -> renomear e reordenar o Caixa reenviando o mesmo saldo e a mesma data, e reenviar o banco igual",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "N4");
    aceitou(await mover(c, s, "sangria", 30, BANCO), "N4: sangria");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { nome: "Gaveta do balcao", ordem: 5 }),
      ),
      "N4: renomear o Caixa",
    );
    aceitou(
      await salvarConta(c, await payloadDe(c, BANCO)),
      "N4: reenviar o banco igual",
    );
    assert.equal(
      (await contaRow(c, CAIXA)).nome,
      "Gaveta do balcao",
      "[N4] nome",
    );
  },
});

CENARIOS.push({
  id: "N5",
  nome: "N5: estado ruim que ja existia -> renomear o Caixa (mesmo saldo, mesma data) segue livre",
  corpo: async (c) => {
    await caixaDeOntem(c, 100, "N5");
    await estadoRuim(c);
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { nome: "Gaveta do balcao" }),
      ),
      "N5: renomear no estado ruim",
    );
  },
});

CENARIOS.push({
  id: "N6",
  nome: "N6: caixa de ontem JA FECHADO -> o saldo do Caixa 'em hoje' passa",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeOntem(c, 100, "N6");
    aceitou(await fechar(c, s, 100), "N6: fechar");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, {
          saldo_inicial: 100,
          saldo_inicial_em: hoje,
        }),
      ),
      "N6: Caixa em hoje",
    );
  },
});

CENARIOS.push({
  id: "N7",
  nome: "N7: caixa de ontem -> sangria e suprimento com o banco (saldo antigo) passam, com a data de ontem, e o total fica",
  corpo: async (c) => {
    const ontem = await dia(c, 1);
    const s = await caixaDeOntem(c, 100, "N7");
    const antes = await total(c);
    const m1 = aceitou(
      await mover(c, s, "sangria", 30, BANCO),
      "N7: sangria",
    ).id;
    const m2 = aceitou(
      await mover(c, s, "suprimento", 50, BANCO),
      "N7: suprimento",
    ).id;
    assert.deepEqual(
      [await realizacaoDe(c, m1), await realizacaoDe(c, m2)],
      [ontem, ontem],
      "[N7] os dois com a data do dia do caixa",
    );
    assert.equal(await total(c), antes, "[N7] total");
    assert.deepEqual(
      [await saldoDe(c, CAIXA), await saldoDe(c, BANCO)],
      [120, 980],
      "[N7] saldos",
    );
  },
});

CENARIOS.push({
  id: "N8",
  nome: "N8: cofre criado hoje e caixa de HOJE -> a sangria para o cofre passa",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const cofre = await criarConta(c, "Cofre da loja", 0, hoje, "N8");
    const s = await caixaDeHoje(c, 100, "N8");
    aceitou(
      await mover(c, s, "sangria", 30, cofre),
      "N8: sangria para o cofre",
    );
    assert.equal(await saldoDe(c, cofre), 30, "[N8] cofre 30");
  },
});

CENARIOS.push({
  id: "N9",
  nome: "N9: a mesma tentativa repetida devolve o MESMO movimento (replay) mesmo que a regra nova recusasse um movimento novo",
  corpo: async (c) => {
    const ontem = await dia(c, 1);
    const s = await caixaDeOntem(c, 100, "N9");
    const cofre = await criarConta(c, "Cofre da loja", 0, ontem, "N9");
    const k = randomUUID();
    const r1 = aceitou(
      await mover(c, s, "sangria", 30, cofre, k),
      "N9: sangria",
    );
    await c.query(
      "UPDATE public.fin_contas SET saldo_inicial_em = public.fin__hoje() WHERE id = $1",
      [cofre],
    );
    const contar = async () =>
      (await c.query("SELECT count(*)::int AS n FROM public.fin_lancamentos"))
        .rows[0].n;
    const n = await contar();
    const r2 = aceitou(
      await mover(c, s, "sangria", 30, cofre, k),
      "N9: replay",
    );
    assert.deepEqual(
      [r2.replay, r2.id],
      [true, r1.id],
      "[N9] replay do mesmo movimento",
    );
    assert.equal(await contar(), n, "[N9] o replay nao gravou nada");
  },
});

CENARIOS.push({
  id: "N10",
  nome: "N10: cancelar a sangria do caixa aberto passa (total e esperado voltam); no caixa fechado, recusa",
  corpo: async (c) => {
    const s = await caixaDeOntem(c, 100, "N10");
    const m = aceitou(
      await mover(c, s, "sangria", 30, BANCO),
      "N10: sangria",
    ).id;
    const antes = await total(c);
    aceitou(await cancelar(c, m), "N10: cancelar no caixa aberto");
    assert.equal(await total(c), antes, "[N10] total");
    assert.equal(await esperadoDe(c, s), 100, "[N10] esperado de volta a 100");
    const m2 = aceitou(
      await mover(c, s, "sangria", 20, BANCO),
      "N10: outra sangria",
    ).id;
    aceitou(await fechar(c, s, 80), "N10: fechar");
    recusou(await cancelar(c, m2), "N10", "caixa já fechado");
  },
});

CENARIOS.push({
  id: "N11",
  nome: "N11: o banco que recebeu a sangria de ontem passa o saldo inicial para ONTEM (o dia do caixa)",
  corpo: async (c) => {
    const ontem = await dia(c, 1);
    const s = await caixaDeOntem(c, 100, "N11");
    aceitou(await mover(c, s, "sangria", 30, BANCO), "N11: sangria");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, BANCO, {
          saldo_inicial: 1000,
          saldo_inicial_em: ontem,
        }),
      ),
      "N11: banco em ontem",
    );
    assert.equal(
      await saldoDe(c, BANCO),
      1030,
      "[N11] banco 1000 no comeco de ontem + a sangria de ontem",
    );
  },
});

CENARIOS.push({
  id: "N12",
  nome: "N12: transferencia de HOJE do banco para a gaveta (na sessao de ontem) -> o banco passa o saldo para hoje (o movimento de hoje conta)",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeOntem(c, 100, "N12");
    const { ids } = aceitou(
      await tentar(c, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
        JSON.stringify({
          tipo: "transferencia",
          valor: 10,
          conta_id: BANCO,
          conta_destino_id: CAIXA,
          descricao: "Troco trazido do banco",
          data_realizacao: hoje,
        }),
      ]),
      "N12: transferencia de hoje",
    );
    assert.equal(
      await rpc(
        c,
        "SELECT caixa_sessao_id AS r FROM public.fin_lancamentos WHERE id = $1",
        [ids[0]],
      ),
      s,
      "[N12] PRECONDICAO: a transferencia de hoje entrou na sessao de ontem",
    );
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, BANCO, {
          saldo_inicial: 1000,
          saldo_inicial_em: hoje,
        }),
      ),
      "N12: banco em hoje",
    );
    assert.equal(
      await saldoDe(c, BANCO),
      990,
      "[N12] banco 1000 no comeco de hoje - a transferencia de hoje",
    );
  },
});

CENARIOS.push({
  id: "N13",
  nome: "N13: caixa de ontem -> recuar a data do saldo do Caixa (mais antiga) passa",
  corpo: async (c) => {
    const quarentaAtras = await dia(c, 40);
    const s = await caixaDeOntem(c, 100, "N13");
    aceitou(await mover(c, s, "sangria", 30, BANCO), "N13: sangria");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { saldo_inicial_em: quarentaAtras }),
      ),
      "N13: Caixa mais antigo",
    );
  },
});

CENARIOS.push({
  id: "N14",
  nome: "N14: a sangria de ontem para o banco foi CANCELADA -> o banco passa o saldo para hoje",
  corpo: async (c) => {
    const hoje = await dia(c, 0);
    const s = await caixaDeOntem(c, 100, "N14");
    const m = aceitou(
      await mover(c, s, "sangria", 30, BANCO),
      "N14: sangria",
    ).id;
    aceitou(await cancelar(c, m), "N14: cancelar");
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, BANCO, {
          saldo_inicial: 1000,
          saldo_inicial_em: hoje,
        }),
      ),
      "N14: banco em hoje",
    );
  },
});

const IDS = CENARIOS.map((x) => x.id);
// Com os corpos ANTERIORES (o defeito), exatamente os cenarios dos achados ficam vermelhos.
const DEFEITO = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"];

// ---------------------------------------------------------------- mutantes
// de/para sao trechos EXATOS do corpo vivo (pg_get_functiondef); cada `de` tem de aparecer 1x. `espera` = os cenarios que TEM de
// ficar vermelhos; todos os outros TEM de seguir verdes (e' o que prova que o vermelho caiu na asserção certa).
const MUTANTES = {
  // fin_conta_salvar sem a recusa.
  "conta-sem-recusa": {
    funcao: CONTA,
    de: "    IF FOUND THEN\n      RAISE EXCEPTION 'O caixa aberto em",
    para: "    IF false THEN\n      RAISE EXCEPTION 'O caixa aberto em",
    espera: ["A1", "A3", "A5", "A6"],
  },
  // So a conta do proprio caixa conta: o banco que recebeu a sangria fica de fora.
  "conta-so-a-do-caixa": {
    funcao: CONTA,
    de: "(s.conta_id = v_id OR EXISTS (",
    para: "(s.conta_id = v_id OR false AND EXISTS (",
    espera: ["A3"],
  },
  // So o movimento conta: o caixa sem movimento nenhum fica de fora.
  "conta-so-pelo-movimento": {
    funcao: CONTA,
    de: "(s.conta_id = v_id OR EXISTS (",
    para: "(false OR EXISTS (",
    espera: ["A5", "A6"],
  },
  // A data do proprio dia do caixa tambem recusa.
  "conta-recusa-o-mesmo-dia": {
    funcao: CONTA,
    de: "AND public.fin__dia(s.aberto_em) < v_novo_em",
    para: "AND public.fin__dia(s.aberto_em) <= v_novo_em",
    espera: ["N1", "N3"],
  },
  // Trocar so o valor nao confere.
  "conta-so-a-data": {
    funcao: CONTA,
    de: "\n     OR (p ? 'saldo_inicial' AND (p ->> 'saldo_inicial')::numeric IS DISTINCT FROM v_atual.saldo_inicial)",
    para: "",
    espera: ["A6"],
  },
  // Confere ate quando nada do saldo mudou (renomear no estado ruim recusaria).
  "conta-confere-sempre": {
    funcao: CONTA,
    de: "  IF v_novo_em IS DISTINCT FROM v_atual.saldo_inicial_em",
    para: "  IF true OR v_novo_em IS DISTINCT FROM v_atual.saldo_inicial_em",
    espera: ["N5"],
  },
  // Qualquer caixa aberto de um dia anterior recusa, mesmo o que nao lanca na conta.
  "conta-qualquer-caixa": {
    funcao: CONTA,
    de: "(s.conta_id = v_id OR EXISTS (",
    para: "(true OR EXISTS (",
    espera: ["N2", "N12", "N14"],
  },
  // O movimento de HOJE na sessao de ontem tambem recusa.
  "conta-ignora-a-data-do-movimento": {
    funcao: CONTA,
    de: "\n                AND l.data_realizacao < v_novo_em",
    para: "",
    espera: ["N12"],
  },
  // O movimento cancelado tambem recusa.
  "conta-conta-o-cancelado": {
    funcao: CONTA,
    de: "l.caixa_sessao_id = s.id AND l.status = 'realizado'",
    para: "l.caixa_sessao_id = s.id",
    espera: ["N14"],
  },
  // O caixa ja fechado tambem recusa.
  "conta-caixa-fechado-recusa": {
    funcao: CONTA,
    de: "WHERE s.status = 'aberto'",
    para: "WHERE true",
    espera: ["N6"],
  },
  // fin_caixa_movimentar_com_chave sem a recusa.
  "mover-sem-recusa": {
    funcao: MOVER,
    de: "  IF FOUND THEN\n    RAISE EXCEPTION 'A conta %",
    para: "  IF false THEN\n    RAISE EXCEPTION 'A conta %",
    espera: ["A2", "A4", "A7"],
  },
  "mover-so-a-contrapartida": {
    funcao: MOVER,
    de: "WHERE c.id IN (v_s.conta_id, v_contra.id)",
    para: "WHERE c.id IN (v_contra.id)",
    espera: ["A7"],
  },
  "mover-so-a-conta-do-caixa": {
    funcao: MOVER,
    de: "WHERE c.id IN (v_s.conta_id, v_contra.id)",
    para: "WHERE c.id IN (v_s.conta_id)",
    espera: ["A2", "A4"],
  },
  // O saldo com a data do proprio dia do caixa tambem recusa.
  "mover-recusa-o-mesmo-dia": {
    funcao: MOVER,
    de: "AND c.saldo_inicial_em > public.fin__dia(v_s.aberto_em)",
    para: "AND c.saldo_inicial_em >= public.fin__dia(v_s.aberto_em)",
    espera: ["A2", "N1", "N3", "N8", "N9"],
  },
};
// Mutante da PARTE 2 (corrida): a contrapartida lida sem trava.
const SEM_FOR_SHARE = {
  de: "WHERE id = v_contra_id FOR SHARE;",
  para: "WHERE id = v_contra_id;",
};

async function mutar(c, funcao, de, para, rotulo) {
  const def = await definicao(c, funcao);
  assert.equal(
    def.split(de).length - 1,
    1,
    `${rotulo}: o trecho tem de aparecer 1x no corpo vivo de ${funcao}`,
  );
  const mutado = def.replace(de, () => para);
  assert.notEqual(mutado, def, `${rotulo}: nada mudou`);
  await c.query(mutado);
  assert.equal(
    await definicao(c, funcao),
    mutado,
    `${rotulo}: o banco nao instalou exatamente o mutante`,
  );
}

// ------------------------------------------------------------------ rodada
/** Admin + contas com saldo inicial antigo (a loja que ja vende ha semanas). `local` = set_config so na transacao. */
async function montarLoja(c, local) {
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@caixa1660.fixture.invalid', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
    [U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Caixa 1660', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [U_ADMIN],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, $2)", [
    U_ADMIN,
    local,
  ]);
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
  // No clone o saldo inicial das contas da loja tem a data do apply (hoje); numa loja de verdade ele e' antigo.
  await c.query(
    `UPDATE public.fin_contas
        SET saldo_inicial = CASE WHEN id = $2 THEN 1000 ELSE 0 END,
            saldo_inicial_em = public.fin__hoje() - 30
      WHERE id = ANY ($1::uuid[])`,
    [[CAIXA, BANCO, MP], BANCO],
  );
}

/** Roda cada cenario num SAVEPOINT desfeito. Erro que nao e' de asserção (SQL, montagem) sobe: e' do teste, nao do corpo. */
async function rodarCenarios(c) {
  const passou = [];
  const falhou = [];
  for (const { id, nome, corpo } of CENARIOS) {
    await c.query("SAVEPOINT cenario1660");
    try {
      await corpo(c);
      passou.push(id);
    } catch (erro) {
      if (erro?.code !== "ERR_ASSERTION") throw erro;
      falhou.push({ id, nome, erro });
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT cenario1660");
      await c.query("RELEASE SAVEPOINT cenario1660");
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

async function parte1(c, resumo) {
  await c.query("BEGIN");
  // Base ainda nos corpos anteriores (arvore local sem a migration)? Aplica; no CI ela ja esta no ar.
  const vivo = await hashes(c);
  if (ASSINATURAS.every((s) => vivo[s] === HASH_ANTES[s])) {
    await c.query(migration);
  }
  assert.deepEqual(
    await hashes(c),
    HASH_DESTA,
    "o clone devia estar com os tres corpos da 20261660000000",
  );
  const topo = await funcoes(c);
  await conferir(c, consultaDepois, true, "216a depois do apply");
  await conferir(c, consultaAntes, false, "216b depois do apply");
  // As consultas das antecessoras aceitam os corpos desta como sucessora: com ela no ar seguem POSITIVAS.
  for (const nome of [
    "128a-conferir-o-caixa-e-a-conta-recusam-valor-que-nao-e-numero-aplicado",
    "210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado",
    "55a-conferir-intencao-do-caixa-aplicado",
  ]) {
    const linhas = (
      await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
    ).rows;
    assert.ok(linhas.length > 0, `${nome}: sem linhas`);
    assert.deepEqual(
      linhas.filter((l) => l.ok !== true).map((l) => l.item),
      [],
      `${nome} com a 1660 no ar`,
    );
  }
  // As antecessoras nao se desfazem por baixo desta (os rollbacks delas recusam com um corpo posterior no ar).
  for (const [rotulo, sql] of [
    ["rollback da 20261399930000", rollback1399930],
    ["rollback da 20261654000000", rollback1654],
  ]) {
    const r = await tentar(c, sql);
    assert.equal(
      r.erro?.code,
      "P0001",
      `${rotulo} com a 1660 no ar: ${JSON.stringify(r)}`,
    );
    assert.match(r.erro.message, /B1_BASELINE_DIVERGENT/, rotulo);
    assert.deepEqual(
      await funcoes(c),
      topo,
      `${rotulo}: escreveu antes de recusar`,
    );
  }

  await montarLoja(c, true);

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
    resumo.push(`${IDS.length}/${IDS.length} cenarios verdes com a migration`);
  }

  // ===== mutantes: cada um derruba EXATAMENTE o que prometeu =====
  for (const nome of Object.keys(MUTANTES)) {
    const m = MUTANTES[nome];
    await c.query("SAVEPOINT mutante1660");
    try {
      await mutar(c, m.funcao, m.de, m.para, `mutante ${nome}`);
      exigirVermelhosExatos(
        await rodarCenarios(c),
        m.espera,
        `mutante ${nome}`,
      );
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT mutante1660");
      await c.query("RELEASE SAVEPOINT mutante1660");
    }
  }
  assert.deepEqual(await funcoes(c), topo, "os mutantes deixaram rastro");
  resumo.push(
    `${Object.keys(MUTANTES).length} mutantes mortos na asserção certa`,
  );

  // ===== CONTROLE com os corpos anteriores + o DADO QUE JA EXISTIA =====
  await isolado(c, async () => {
    await c.query(rollback);
    for (const f of await funcoes(c)) {
      const sig = ASSINATURAS.find((s) => s.includes(`.${f.proname}(`));
      assert.equal(
        f.prosrc,
        ANTES[sig],
        `o rollback nao devolveu ${sig} byte a byte`,
      );
    }
    await conferir(c, consultaAntes, true, "216b depois do rollback");
    await conferir(c, consultaDepois, false, "216a depois do rollback");
    // O defeito existe e a prova o enxerga: so os cenarios dos achados caem; os normais ja passavam.
    exigirVermelhosExatos(
      await rodarCenarios(c),
      DEFEITO,
      "controle com os corpos anteriores",
    );

    // Dado que ja existia: o corpo ANTERIOR deixou gravar o estado ruim (a sangria para o cofre de hoje sumiu; o Caixa 'em hoje').
    const [hoje, ontem] = [await dia(c, 0), await dia(c, 1)];
    const s = await caixaDeOntem(c, 100, "dado antigo");
    aceitou(await mover(c, s, "sangria", 30, BANCO), "dado antigo: sangria");
    const cofre = await criarConta(c, "Cofre da loja", 0, hoje, "dado antigo");
    aceitou(
      await mover(c, s, "sangria", 20, cofre),
      "dado antigo: sangria que some",
    );
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, {
          saldo_inicial: 50,
          saldo_inicial_em: hoje,
        }),
      ),
      "dado antigo: o Caixa 'em hoje'",
    );
    const dados = await fotografar(c);
    await c.query(migration);
    assert.deepEqual(
      await fotografar(c),
      dados,
      "o apply reescreveu conta, sessao, lancamento ou tentativa que ja existiam",
    );
    assert.deepEqual(
      await funcoes(c),
      topo,
      "o apply sobre o corpo anterior nao reproduziu o topo do CI",
    );
    // Dali em diante: renomear segue livre; a sangria recusa ate a lojista acertar a data que a mensagem ensina.
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { nome: "Gaveta do balcao" }),
      ),
      "depois do apply: renomear",
    );
    recusou(
      await mover(c, s, "sangria", 10, BANCO),
      "depois do apply",
      "a sangria",
    );
    aceitou(
      await salvarConta(
        c,
        await payloadDe(c, CAIXA, { saldo_inicial_em: ontem }),
      ),
      "depois do apply: o Caixa na data do dia do caixa",
    );
    aceitou(
      await mover(c, s, "sangria", 10, BANCO),
      "depois do apply: a sangria",
    );
  });
  resumo.push(
    "controle: corpos anteriores vermelhos exatamente em A1..A7; estado ruim antigo intacto no apply",
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

  // ===== pre-voo: corpo, atributo, ACL ou dependencia desconhecidos recusam SEM escrever =====
  for (const [rotulo, sabotagem] of [
    [
      "corpo desconhecido da conta",
      async () =>
        (await definicao(c, CONTA)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
    ],
    [
      "corpo desconhecido do cancelar",
      async () =>
        (await definicao(c, CANCELAR)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
    ],
    [
      "mover SECURITY INVOKER",
      async () => `ALTER FUNCTION ${MOVER} SECURITY INVOKER`,
    ],
    [
      "conta com outro search_path",
      async () => `ALTER FUNCTION ${CONTA} SET search_path TO pg_catalog`,
    ],
    [
      "cancelar aberta ao anon",
      async () => `GRANT EXECUTE ON FUNCTION ${CANCELAR} TO anon`,
    ],
    [
      "mover aberta a PUBLIC",
      async () => `GRANT EXECUTE ON FUNCTION ${MOVER} TO PUBLIC`,
    ],
    [
      "segunda fin_conta_salvar",
      async () =>
        "CREATE FUNCTION public.fin_conta_salvar(p text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
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

  // ===== rollback devolve os TRES corpos byte a byte e nao toca dado; segundo rollback recusa; reaplicar volta ao topo =====
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
    assert.equal(segundo.erro?.code, "P0001", "segundo rollback devia recusar");
    assert.match(segundo.erro.message, /B1_BASELINE_DIVERGENT/);
    await c.query(migration);
    assert.deepEqual(
      await funcoes(c),
      topo,
      "reaplicar depois do rollback nao voltou ao topo",
    );
  }
  resumo.push(
    "rollback byte a byte, segundo rollback recusa; 216a/216b nas duas pontas",
  );
  await c.query("ROLLBACK");
}

// ------------------------------------------------------------- PARTE 2: corridas
async function logar(x) {
  await x.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
}
async function chamar(x, sql, params = []) {
  return (await x.query(sql, params)).rows[0].r;
}
async function observarEspera(obs, pidA, pidB) {
  for (let i = 0; i < 150; i++) {
    const r = await obs.query(
      "SELECT wait_event_type, pg_blocking_pids(pid) AS bloqueadores FROM pg_stat_activity WHERE pid = $1",
      [pidB],
    );
    if (
      r.rows[0]?.wait_event_type === "Lock" &&
      r.rows[0].bloqueadores.includes(pidA)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("B nao foi observado esperando A no Postgres");
}
/**
 * Duas conexoes reais: A abre a transacao e chama; B chama enquanto A segura. `esperaB` = B TEM de ser visto esperando A
 * (pg_blocking_pids); senao B TEM de terminar com A ainda aberta (ninguem trava ninguem: o defeito do controle). A faz COMMIT e B
 * faz COMMIT (ou ROLLBACK, se errou). Devolve {rA, rB: {r} | {e}}.
 */
async function corrida(url, chamadaA, chamadaB, esperaB) {
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  let pendente;
  try {
    await logar(a);
    await logar(b);
    await a.query("BEGIN");
    await b.query("BEGIN");
    await a.query("SET LOCAL statement_timeout = '8s'");
    await b.query("SET LOCAL statement_timeout = '8s'");
    const pidA = (await a.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const rA = await chamadaA(a);
    pendente = chamadaB(b).then(
      (r) => ({ r }),
      (e) => ({ e }),
    );
    if (esperaB) {
      const obs = new Client({ connectionString: url });
      await obs.connect();
      try {
        await observarEspera(obs, pidA, pidB);
      } finally {
        await obs.end();
      }
    } else {
      const fim = await Promise.race([
        pendente,
        new Promise((resolve) => setTimeout(() => resolve("PRESO"), 4000)),
      ]);
      assert.notEqual(fim, "PRESO", "controle: B devia terminar sem esperar A");
    }
    await a.query("COMMIT");
    const rB = await pendente;
    await b.query(rB.e ? "ROLLBACK" : "COMMIT");
    return { rA, rB };
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    if (pendente) await pendente;
    await b.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
  }
}
const sqlFechar = "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r";
const sqlCancelar =
  "SELECT public.fin_lancamento_cancelar($1, 'Cancelado na corrida') AS r";
const sqlMover =
  "SELECT public.fin_caixa_movimentar_com_chave($1, $2, 'sangria', $3, NULL, $4) AS r";
const sqlConta = "SELECT public.fin_conta_salvar($1::jsonb) AS r";

async function caixaComSangria(c, valor, sangria) {
  const s = (
    await chamar(c, "SELECT public.fin_caixa_abrir($1, NULL) AS r", [valor])
  ).id;
  const m = (await chamar(c, sqlMover, [s, randomUUID(), sangria, BANCO])).id;
  return { s, m };
}
async function ajustesDe(c, s) {
  return (
    await c.query(
      "SELECT count(*)::int AS n FROM public.fin_lancamentos WHERE caixa_sessao_id = $1 AND origem = 'ajuste_caixa'",
      [s],
    )
  ).rows[0].n;
}
async function statusDe(c, id) {
  return chamar(
    c,
    "SELECT status AS r FROM public.fin_lancamentos WHERE id = $1",
    [id],
  );
}

/** C1 e C2 com o corpo vivo (`vivo` = true) ou com o anterior (controle). */
async function corridasDoCancelamento(c, url, vivo, rotulo) {
  // C1: o fechamento chega primeiro; o cancelamento da sangria espera e recusa (o caixa fechou).
  {
    const { s, m } = await caixaComSangria(c, 100, 30);
    const { rB } = await corrida(
      url,
      (x) => chamar(x, sqlFechar, [s, 70]),
      (x) => chamar(x, sqlCancelar, [m]),
      vivo,
    );
    if (vivo) {
      assert.equal(
        rB.e?.code,
        "22023",
        `${rotulo} C1: o cancelamento devia recusar (${JSON.stringify(rB)})`,
      );
      assert.match(rB.e.message, /caixa já fechado/, `${rotulo} C1`);
      assert.equal(
        await statusDe(c, m),
        "realizado",
        `${rotulo} C1: a sangria segue`,
      );
      assert.equal(
        await ajustesDe(c, s),
        0,
        `${rotulo} C1: fechou sem diferenca`,
      );
    } else {
      assert.equal(
        rB.r?.status,
        "cancelado",
        `${rotulo} C1: controle (${JSON.stringify(rB)})`,
      );
      // O defeito: o caixa fechou contando a sangria (esperado 70) que acabou cancelada (o certo agora seria 100).
      assert.deepEqual(
        [
          num(
            await chamar(
              c,
              "SELECT valor_esperado AS r FROM public.fin_caixa_sessoes WHERE id = $1",
              [s],
            ),
          ),
          await esperadoDe(c, s),
        ],
        [70, 100],
        `${rotulo} C1: controle mostra o fechamento que contou a sangria cancelada`,
      );
    }
  }
  // C2: o cancelamento chega primeiro; o fechamento espera e nao conta a sangria cancelada.
  {
    const { s, m } = await caixaComSangria(c, 100, 30);
    const { rB } = await corrida(
      url,
      (x) => chamar(x, sqlCancelar, [m]),
      (x) => chamar(x, sqlFechar, [s, 100]),
      vivo,
    );
    if (rB.e) throw rB.e;
    assert.equal(
      num(rB.r.diferenca),
      vivo ? 0 : 30,
      vivo
        ? `${rotulo} C2: contar os 100 fecha sem diferenca (a sangria cancelada nao conta)`
        : `${rotulo} C2: controle mostra a sobra FALSA de 30`,
    );
    assert.equal(await ajustesDe(c, s), vivo ? 0 : 1, `${rotulo} C2: ajustes`);
  }
}

/** C3: a sangria e a mudanca do saldo inicial da contrapartida nunca se cruzam sem uma ver a outra. */
async function corridasDaConta(c, url, comForShare, rotulo) {
  const cofre = async (nome) =>
    (
      await chamar(c, sqlConta, [
        JSON.stringify({
          nome,
          tipo: "outro",
          saldo_inicial: 0,
          saldo_inicial_em: await dia(c, 1),
          ativa: true,
        }),
      ])
    ).id;
  const paraHoje = async (id) =>
    JSON.stringify({
      ...(await payloadDe(c, id)),
      saldo_inicial_em: await dia(c, 0),
    });
  const s = (await chamar(c, "SELECT public.fin_caixa_abrir(300, NULL) AS r"))
    .id;
  await c.query(
    `UPDATE public.fin_caixa_sessoes
        SET aberto_em = ((public.fin__hoje() - 1) + time '09:00') AT TIME ZONE 'America/Sao_Paulo'
      WHERE id = $1`,
    [s],
  );
  try {
    if (comForShare) {
      // C3a: a sangria primeiro; a mudanca para hoje espera e recusa (ve a sangria de ontem).
      const a = await cofre(`Cofre A ${rotulo}`);
      const antes = await total(c);
      const pA = await paraHoje(a);
      const { rB } = await corrida(
        url,
        (x) => chamar(x, sqlMover, [s, randomUUID(), 30, a]),
        (x) => chamar(x, sqlConta, [pA]),
        true,
      );
      assert.equal(
        rB.e?.code,
        "22023",
        `${rotulo} C3a: a mudanca devia recusar (${JSON.stringify(rB)})`,
      );
      assert.equal(await total(c), antes, `${rotulo} C3a: total`);
    }
    // C3b: a mudanca para hoje primeiro; a sangria espera e, com o FOR SHARE, le a data nova e recusa. Sem ele, grava por baixo.
    const b = await cofre(`Cofre B ${rotulo}`);
    const antes = await total(c);
    const pB = await paraHoje(b);
    const { rB } = await corrida(
      url,
      (x) => chamar(x, sqlConta, [pB]),
      (x) => chamar(x, sqlMover, [s, randomUUID(), 30, b]),
      true,
    );
    if (comForShare) {
      assert.equal(
        rB.e?.code,
        "22023",
        `${rotulo} C3b: a sangria devia recusar (${JSON.stringify(rB)})`,
      );
      assert.ok(
        rB.e.message.includes("Cofre B"),
        `${rotulo} C3b: ${rB.e.message}`,
      );
      assert.equal(await total(c), antes, `${rotulo} C3b: total`);
    } else {
      if (rB.e) throw rB.e;
      assert.equal(
        await total(c),
        num(antes - 30),
        `${rotulo} C3b: controle mostra a sangria que some do saldo do cofre`,
      );
    }
  } finally {
    await chamar(c, sqlFechar, [s, await esperadoDe(c, s)]);
  }
}

async function parte2(url, resumo) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const banco = (await c.query("SELECT current_database() AS d")).rows[0].d;
    assert.match(
      banco,
      /^prova_/,
      "a parte das corridas grava (COMMIT): so no clone efemero do rodar-isolado.cjs",
    );
    // Arvore sem a migration no template (fora do CI)? Aplica no clone; no CI ela ja esta no ar.
    const vivo = await hashes(c);
    if (ASSINATURAS.every((s) => vivo[s] === HASH_ANTES[s])) {
      await c.query("BEGIN");
      await c.query(migration);
      await c.query("COMMIT");
    }
    assert.deepEqual(
      await hashes(c),
      HASH_DESTA,
      "parte 2 parte da migration no ar",
    );
    const topoMover = await definicao(c, MOVER);
    await c.query("BEGIN");
    await montarLoja(c, true);
    await c.query("COMMIT");
    await logar(c);

    await corridasDoCancelamento(c, url, true, "vivo");
    await corridasDaConta(c, url, true, "vivo");

    // Controle do cancelamento: o rollback commitado (o corpo anterior) e depois a migration de volta.
    await c.query("BEGIN");
    await c.query(rollback);
    await c.query("COMMIT");
    try {
      await corridasDoCancelamento(c, url, false, "controle");
    } finally {
      await c.query("BEGIN");
      await c.query(migration);
      await c.query("COMMIT");
    }
    // Mutante sem o FOR SHARE, commitado, e o corpo vivo de volta.
    await c.query("BEGIN");
    await mutar(
      c,
      MOVER,
      SEM_FOR_SHARE.de,
      SEM_FOR_SHARE.para,
      "mutante sem FOR SHARE",
    );
    await c.query("COMMIT");
    try {
      await corridasDaConta(c, url, false, "mutante sem FOR SHARE");
    } finally {
      await c.query(topoMover);
    }
    assert.deepEqual(
      await hashes(c),
      HASH_DESTA,
      "a parte 2 deixou o clone fora do topo",
    );
    resumo.push(
      "corridas: cancelar espera o fechamento e recusa; o fechamento espera o cancelamento sem sobra falsa; conta e sangria se veem (FOR SHARE)",
    );
  } finally {
    await c.end();
  }
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resumo = [];
  try {
    await parte1(c, resumo);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  await parte2(url, resumo);
  console.log(`PASSOU 20261660000000: ${resumo.join("; ")}.`);
  anexarAoSummary(TITULO, resumo.map((l) => `- ✅ ${l}`).join("\n"));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ANTES,
  HASH_ANTES,
  HASH_DESTA,
  MUTANTES,
  SEM_FOR_SHARE,
  CONTA,
  MOVER,
  CANCELAR,
  DEFEITO,
  IDS,
};
