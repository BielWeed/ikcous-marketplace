"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do proprio teste (assinaturas, nomes de funcao e de cenario). */
// 20261663000000 (a despesa nao entra no caixa fechado; caça de 28/11/2026). Somente Postgres descartavel do rpc-ci
// (rodar-isolado.cjs: CI_BANCO_EFEMERO=1 + localhost + clone prova_*), nunca banco de loja. Fixtures inventadas.
//
// O DEFEITO: fin_lancamento_salvar e fin_lancamento_baixar (corpos da 20261654000000) liam a sessao de caixa aberta SEM trava e
// so gravavam depois; fin_caixa_fechar_sessao trava a sessao (FOR UPDATE) e calcula o esperado. O fechamento que pegava a trava
// entre a leitura e a gravacao nao via a despesa: Quebra de caixa FALSA e a despesa gravada ligada ao caixa ja fechado (a perda
// contada duas vezes no resultado). O conserto: a leitura trava a sessao (FOR SHARE OF s).
//
// PARTE 1 (uma transacao que termina em ROLLBACK): hashes, consultas 219a/219b nas duas pontas, 210a e 49a positivas com esta no
// ar, o rollback da 1654 recusa por baixo dela; N1..N10 (uma conexao so: a despesa e a baixa no caixa aberto, depois do fechamento,
// a transferencia para a gaveta, o caixa de ontem, a edicao do a pagar, o parcelado, a outra conta e o replay da chave) VERDES
// com a migration E com os corpos anteriores (a trava nao muda nada para uma conexao so); o dado ruim que ja existia (lancamento
// ligado a caixa fechado) intacto no apply; reaplicar 2x e CRLF; pre-voo recusa sem escrever; rollback byte a byte; segundo
// rollback recusa.
//
// PARTE 2 (corridas reais, COMMIT no clone prova_*; pg_blocking_pids). Um gatilho SO DE PROVA (criado e apagado aqui) para a
// despesa/baixa marcada "Corrida 1663" DENTRO da gravacao, depois da leitura da sessao, ate um pg_advisory_lock ser solto: e'
// exatamente a janela do defeito. Para o salvar e para a baixa:
//   R1  o lancamento le a sessao e para; o fechamento chega. Com a trava, o fechamento ESPERA o lancamento e conta a despesa
//       (diferenca 0, sem ajuste). Sem ela (controle e mutante), o fechamento termina por baixo: Quebra FALSA de 30 e o
//       lancamento gravado ligado ao caixa ja fechado (esperado gravado 100, recalculado 70).
//   R2  o fechamento trava primeiro; o lancamento chega. Com a trava, a leitura espera, rele a sessao fechada e o lancamento
//       grava SEM caixa (como depois de fechar). Sem ela, o lancamento espera so pela chave estrangeira e grava ligado ao caixa
//       ja fechado (o caixa fechado deixa de bater com o proprio recalculo).
// CONTROLE com o rollback commitado (os dois defeitos nas duas funcoes) e MUTANTES sem a trava de cada uma (so a funcao mutada
// cai; a outra segue protegida).
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
  "Prova viva: a despesa nao entra no caixa fechado (20261663000000)";
const NOME = "20261663000000_a_despesa_nao_entra_no_caixa_fechado.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback1654 = ler(
  "supabase/migrations/rollback-manual-20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
);
const consultaAntes = ler(
  "scripts/publicacao/consultas/219b-antes-a-despesa-nao-entra-no-caixa-fechado-base-vigente.sql",
);
const consultaDepois = ler(
  "scripts/publicacao/consultas/219a-conferir-a-despesa-nao-entra-no-caixa-fechado-aplicado.sql",
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
const ASSINATURAS = [SALVAR, BAIXAR];
// Os corpos de ANTES, lidos da migration que os deixou vivos (nao copiados a mao), e os hashes das duas pontas.
const FONTE_1654 = ler(
  "supabase/migrations/20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql",
);
const ANTES = {
  [SALVAR]: corpoDe(bloco(FONTE_1654, "fin_lancamento_salvar")),
  [BAIXAR]: corpoDe(bloco(FONTE_1654, "fin_lancamento_baixar")),
};
const HASH_ANTES = {
  [SALVAR]: "3e31817ce1d13bb091ce2d0871cbd718",
  [BAIXAR]: "7d1204cdf214a290cfdb378482795f1b",
};
const HASH_DESTA = {
  [SALVAR]: "729fc6e3e4a643459df835d214fa082e",
  [BAIXAR]: "0abf8da5b460d8b8236ffb5ffc111524",
};
// Mutante da PARTE 2: a leitura da sessao sem a trava (o corpo anterior, so nesta linha).
const SEM_TRAVA = {
  de: "LIMIT 1 FOR SHARE OF s;",
  para: "LIMIT 1;",
};

const U_ADMIN = "5e166300-0000-4000-8000-000000000001";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const MP = "f1000000-0000-4000-8000-000000000003";
const CAT_OUTRAS_DESPESAS = "f2000000-0000-4000-8000-000000000025";

// ------------------------------------------------------------------ apoio
const num = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

async function rpc(c, sql, params = []) {
  return (await c.query(sql, params)).rows[0].r;
}
// Executa e devolve {erro: {code, message}} ou {linhas}; a transacao segue de pe (savepoint).
async function tentar(c, sql, params = []) {
  await c.query("SAVEPOINT tentativa1663");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa1663");
    return { linhas: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa1663");
    await c.query("RELEASE SAVEPOINT tentativa1663");
    return { erro: { code: e.code, message: e.message } };
  }
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1663");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1663");
    await c.query("RELEASE SAVEPOINT caso1663");
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
  assert.equal(linhas.length, 2);
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
// Tudo o que as duas funcoes (e o caixa) escrevem: se mudar, o apply/rollback tocou dado.
async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.fin_caixa_sessoes s) AS sessoes,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM public.fin_lancamentos l) AS lancamentos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY chave), '[]') FROM public.fin_lancamento_tentativas t) AS tentativas`)
  ).rows[0];
}
async function conferir(c, sql, positivo, rotulo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(
    linhas.length,
    7,
    `${rotulo}: o rol fechado das consultas 219 tem 7 linhas`,
  );
  assert.equal(
    linhas.every((l) => l.ok === true),
    positivo,
    `${rotulo}: ${JSON.stringify(linhas.filter((l) => !l.ok))}`,
  );
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
async function sessaoDe(c, lancamentoId) {
  return rpc(
    c,
    "SELECT caixa_sessao_id AS r FROM public.fin_lancamentos WHERE id = $1",
    [lancamentoId],
  );
}
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

/** Admin + contas com saldo inicial antigo (a loja que ja vende ha semanas). `local` = set_config so na transacao. */
async function montarLoja(c, local) {
  // Admin de verdade tem o papel nas DUAS fontes (is_admin_atual, 20261199000000).
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, 'admin@despesa1663.fixture.invalid', '{"role":"admin"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data`,
    [U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Despesa 1663', 'admin')
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

const lancar = async (c, p) =>
  rpc(c, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
    JSON.stringify(p),
  ]);
/** Lancamento pelo caminho do painel; devolve o id (um so). */
async function lancarUm(c, p) {
  const { ids } = await lancar(c, p);
  assert.equal(ids.length, 1, "o lancamento devia gerar um id so");
  return ids[0];
}
const baixar = (c, id, data = null) =>
  rpc(c, "SELECT public.fin_lancamento_baixar($1, $2::date) AS r", [id, data]);
const fechar = (c, s, contado) =>
  rpc(c, "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r", [
    s,
    contado,
  ]);
const despesa = (extra = {}) => ({
  tipo: "saida",
  valor: 30,
  conta_id: CAIXA,
  categoria_id: CAT_OUTRAS_DESPESAS,
  forma_pagamento: "dinheiro",
  descricao: "Despesa paga da gaveta",
  ...extra,
});

/**
 * Caixa aberto com `valor` na gaveta e, se `diasAtras` > 0, com a abertura recuada para as 09:00 (Brasilia) daquele dia. O saldo
 * inicial do Caixa vira `valor` antes de abrir: a abertura nao gera ajuste.
 */
async function caixaAberto(c, valor, diasAtras, rotulo) {
  await c.query(
    "UPDATE public.fin_contas SET saldo_inicial = $2 WHERE id = $1",
    [CAIXA, valor],
  );
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
    await esperadoDe(c, id),
    valor,
    `[${rotulo}] PRECONDICAO: esperado da abertura`,
  );
  return id;
}

// ---------------------------------------------------------------- cenarios (uma conexao so)
// Todos tem de dar o MESMO resultado com a migration e com os corpos anteriores: a trava so muda quem espera quem.
const CENARIOS = [];

CENARIOS.push({
  id: "N1",
  nome: "a despesa paga da gaveta com o caixa aberto entra nele, e o fechamento conta a despesa",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N1");
    const d = await lancarUm(c, despesa());
    assert.equal(await sessaoDe(c, d), s, "[N1] a despesa entra no caixa");
    assert.equal(await esperadoDe(c, s), 70, "[N1] esperado");
    const r = await fechar(c, s, 70);
    assert.equal(num(r.diferenca), 0, "[N1] fecha sem diferenca");
  },
});
CENARIOS.push({
  id: "N2",
  nome: "a despesa lancada depois do fechamento grava sem caixa",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N2");
    await fechar(c, s, 100);
    const d = await lancarUm(c, despesa());
    assert.equal(await sessaoDe(c, d), null, "[N2] sem caixa");
    assert.equal(await esperadoDe(c, s), 100, "[N2] o caixa fechado segue");
  },
});
CENARIOS.push({
  id: "N3",
  nome: "a baixa de uma conta a pagar da gaveta com o caixa aberto entra nele",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N3");
    const l = await lancarUm(c, despesa({ status: "previsto" }));
    assert.equal(await sessaoDe(c, l), null, "[N3] a pagar nao entra");
    await baixar(c, l);
    assert.equal(await sessaoDe(c, l), s, "[N3] a baixa entra no caixa");
    assert.equal(await esperadoDe(c, s), 70, "[N3] esperado");
  },
});
CENARIOS.push({
  id: "N4",
  nome: "a baixa depois do fechamento grava sem caixa",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N4");
    const l = await lancarUm(c, despesa({ status: "previsto" }));
    await fechar(c, s, 100);
    await baixar(c, l);
    assert.equal(await sessaoDe(c, l), null, "[N4] sem caixa");
    assert.equal(await esperadoDe(c, s), 100, "[N4] o caixa fechado segue");
  },
});
CENARIOS.push({
  id: "N5",
  nome: "a transferencia do banco para a gaveta entra no caixa (pela conta de destino)",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N5");
    const t = await lancarUm(c, {
      tipo: "transferencia",
      valor: 50,
      conta_id: BANCO,
      conta_destino_id: CAIXA,
      descricao: "Troco do banco para a gaveta",
    });
    assert.equal(await sessaoDe(c, t), s, "[N5] entra no caixa");
    assert.equal(await esperadoDe(c, s), 150, "[N5] esperado");
  },
});
CENARIOS.push({
  id: "N6",
  nome: "caixa de ontem aberto: o pago ontem entra, o pago anteontem nao (a regra da 20261654000000 intacta)",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 1, "N6");
    const ontem = await lancarUm(
      c,
      despesa({ data_realizacao: await dia(c, 1) }),
    );
    const anteontem = await lancarUm(
      c,
      despesa({ data_realizacao: await dia(c, 2) }),
    );
    assert.equal(await sessaoDe(c, ontem), s, "[N6] o de ontem entra");
    assert.equal(await sessaoDe(c, anteontem), null, "[N6] o de anteontem nao");
    assert.equal(await esperadoDe(c, s), 70, "[N6] esperado");
  },
});
CENARIOS.push({
  id: "N7",
  nome: "editar a conta a pagar para paga (o caminho da edicao) entra no caixa aberto",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N7");
    const l = await lancarUm(c, despesa({ status: "previsto" }));
    const r = await lancar(c, despesa({ id: l, status: "realizado" }));
    assert.deepEqual(r.ids, [l], "[N7] edita o mesmo");
    assert.equal(await sessaoDe(c, l), s, "[N7] entra no caixa");
    assert.equal(await esperadoDe(c, s), 70, "[N7] esperado");
  },
});
CENARIOS.push({
  id: "N8",
  nome: "duas despesas na mesma transacao e o parcelado: a sessao travada duas vezes pela mesma transacao, so a 1a parcela entra",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N8");
    const a = await lancarUm(c, despesa({ valor: 10 }));
    const b = await lancarUm(c, despesa({ valor: 20 }));
    const { ids } = await lancar(c, despesa({ valor: 90, parcelas: 3 }));
    assert.equal(ids.length, 3, "[N8] tres parcelas");
    const sessoes = [];
    for (const id of [a, b, ...ids]) sessoes.push(await sessaoDe(c, id));
    assert.deepEqual(sessoes, [s, s, s, null, null], "[N8] sessoes");
    assert.equal(await esperadoDe(c, s), 40, "[N8] esperado");
  },
});
CENARIOS.push({
  id: "N9",
  nome: "a despesa de outra conta nao entra no caixa",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N9");
    const d = await lancarUm(
      c,
      despesa({ conta_id: BANCO, forma_pagamento: "pix" }),
    );
    assert.equal(await sessaoDe(c, d), null, "[N9] fora do caixa");
    assert.equal(await esperadoDe(c, s), 100, "[N9] esperado");
  },
});
CENARIOS.push({
  id: "N10",
  nome: "a mesma tentativa repetida devolve o mesmo lancamento, uma vez so no caixa",
  async corpo(c) {
    const s = await caixaAberto(c, 100, 0, "N10");
    const p = despesa({ chave_idempotencia: randomUUID() });
    const r1 = await lancar(c, p);
    const r2 = await lancar(c, p);
    assert.deepEqual(r2.ids, r1.ids, "[N10] replay");
    assert.equal(await sessaoDe(c, r1.ids[0]), s, "[N10] entra no caixa");
    assert.equal(await esperadoDe(c, s), 70, "[N10] uma vez so");
  },
});
const IDS = CENARIOS.map((x) => x.id);

/** Roda cada cenario num SAVEPOINT desfeito. Erro que nao e' de asserção (SQL, montagem) sobe: e' do teste ou do corpo. */
async function rodarCenarios(c) {
  const passou = [];
  const falhou = [];
  for (const { id, nome, corpo } of CENARIOS) {
    await c.query("SAVEPOINT cenario1663");
    try {
      await corpo(c);
      passou.push(id);
    } catch (erro) {
      if (erro?.code !== "ERR_ASSERTION") throw erro;
      falhou.push({ id, nome, erro });
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT cenario1663");
      await c.query("RELEASE SAVEPOINT cenario1663");
    }
  }
  return { passou, falhou };
}
const linhaDoErro = (f) =>
  `${f.id}: ${f.erro.message.split("\n")[0]} (visto ${JSON.stringify(f.erro.actual)}, esperado ${JSON.stringify(f.erro.expected)})`;
function exigirTodosVerdes(r, rotulo) {
  if (r.falhou.length > 0) {
    anexarAoSummary(
      TITULO,
      r.falhou
        .map(
          (f) =>
            `- ❌ ${rotulo}: ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
        )
        .join("\n"),
    );
    falhar(
      "FALHOU",
      `${rotulo}: cenarios vermelhos:\n${r.falhou.map(linhaDoErro).join("\n")}`,
    );
  }
  assert.deepEqual([...r.passou].sort(), [...IDS].sort(), rotulo);
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
    "o clone devia estar com os dois corpos da 20261663000000",
  );
  const topo = await funcoes(c);
  await conferir(c, consultaDepois, true, "219a depois do apply");
  await conferir(c, consultaAntes, false, "219b depois do apply");
  // As consultas das antecessoras aceitam os corpos desta como sucessora: com ela no ar seguem POSITIVAS.
  for (const nome of [
    "210a-conferir-o-caixa-pertence-ao-dia-em-que-abriu-aplicado",
    "49a-conferir-lancamento-idempotente-aplicado",
  ]) {
    const linhas = (
      await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
    ).rows;
    assert.ok(linhas.length > 0, `${nome}: sem linhas`);
    assert.deepEqual(
      linhas.filter((l) => l.ok !== true).map((l) => l.item),
      [],
      `${nome} com a 1663 no ar`,
    );
  }
  // A antecessora nao se desfaz por baixo desta (o rollback dela recusa com um corpo posterior no ar).
  {
    const r = await tentar(c, rollback1654);
    assert.equal(
      r.erro?.code,
      "P0001",
      `rollback da 20261654000000 com a 1663 no ar: ${JSON.stringify(r)}`,
    );
    assert.match(r.erro.message, /B1_BASELINE_DIVERGENT/);
    assert.deepEqual(
      await funcoes(c),
      topo,
      "rollback da 1654: escreveu antes de recusar",
    );
  }

  await montarLoja(c, true);

  // ===== uma conexao so: o comportamento e' o MESMO nos dois corpos =====
  exigirTodosVerdes(await rodarCenarios(c), "com a migration");
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
    await conferir(c, consultaAntes, true, "219b depois do rollback");
    await conferir(c, consultaDepois, false, "219a depois do rollback");
    exigirTodosVerdes(await rodarCenarios(c), "com os corpos anteriores");

    // Dado que ja existia: o resultado da corrida antiga (a despesa ligada ao caixa ja fechado, e a quebra falsa gravada junto) e
    // um caixa ainda aberto com despesa. O apply nao toca em nenhum deles; dali em diante o caixa aberto segue recebendo.
    const fechado = await caixaAberto(c, 100, 0, "dado antigo");
    await fechar(c, fechado, 70);
    const ligada = await lancarUm(
      c,
      despesa({ descricao: "Despesa da corrida antiga" }),
    );
    await c.query(
      "UPDATE public.fin_lancamentos SET caixa_sessao_id = $2 WHERE id = $1",
      [ligada, fechado],
    );
    const aberto = await caixaAberto(
      c,
      100,
      0,
      "dado antigo: o caixa seguinte",
    );
    const antiga = await lancarUm(c, despesa({ valor: 10 }));
    assert.equal(await sessaoDe(c, antiga), aberto);
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
    const nova = await lancarUm(c, despesa({ valor: 20 }));
    assert.equal(
      await sessaoDe(c, nova),
      aberto,
      "depois do apply: entra no caixa aberto",
    );
    assert.equal(
      num((await fechar(c, aberto, 70)).diferenca),
      0,
      "depois do apply: fecha sem diferenca",
    );
  });
  resumo.push(
    `${IDS.length}/${IDS.length} cenarios de uma conexao verdes com a migration E com os corpos anteriores; dado antigo intacto no apply`,
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
      "corpo desconhecido do salvar",
      async () =>
        (await definicao(c, SALVAR)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
    ],
    [
      "corpo desconhecido da baixa",
      async () =>
        (await definicao(c, BAIXAR)).replace(
          "DECLARE",
          "-- corpo desconhecido\nDECLARE",
        ),
    ],
    [
      "baixa SECURITY INVOKER",
      async () => `ALTER FUNCTION ${BAIXAR} SECURITY INVOKER`,
    ],
    [
      "salvar com outro search_path",
      async () => `ALTER FUNCTION ${SALVAR} SET search_path TO pg_catalog`,
    ],
    [
      "salvar aberta ao anon",
      async () => `GRANT EXECUTE ON FUNCTION ${SALVAR} TO anon`,
    ],
    [
      "baixa aberta a PUBLIC",
      async () => `GRANT EXECUTE ON FUNCTION ${BAIXAR} TO PUBLIC`,
    ],
    [
      "segunda fin_lancamento_baixar",
      async () =>
        "CREATE FUNCTION public.fin_lancamento_baixar(p text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
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

  // ===== rollback devolve os DOIS corpos byte a byte e nao toca dado; segundo rollback recusa; reaplicar volta ao topo =====
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
    "rollback byte a byte, segundo rollback recusa; 219a/219b nas duas pontas; 210a e 49a positivas com ela no ar",
  );
  await c.query("ROLLBACK");
}

// ------------------------------------------------------------- PARTE 2: corridas
// A pausa SO DE PROVA: o lancamento marcado "Corrida 1663" para DENTRO da gravacao (INSERT do salvar, UPDATE da baixa), depois da
// leitura da sessao, ate a conexao da pausa soltar o pg_advisory_lock. Nenhum outro lancamento passa por ela.
const CHAVE_DA_PAUSA = 1663000;
const DESCRICAO_DA_CORRIDA = "Corrida 1663: despesa paga da gaveta";
const PAUSA_CRIAR = `
CREATE OR REPLACE FUNCTION public.prova1663_pausa() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_advisory_xact_lock(${CHAVE_DA_PAUSA});
  RETURN NEW;
END;
$f$;
CREATE TRIGGER prova1663_pausa BEFORE INSERT OR UPDATE ON public.fin_lancamentos
  FOR EACH ROW WHEN (NEW.descricao LIKE 'Corrida 1663%') EXECUTE FUNCTION public.prova1663_pausa();`;
const PAUSA_DESFAZER = `
DROP TRIGGER IF EXISTS prova1663_pausa ON public.fin_lancamentos;
DROP FUNCTION IF EXISTS public.prova1663_pausa();`;

async function logar(x) {
  await x.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
}
async function chamar(x, sql, params = []) {
  return (await x.query(sql, params)).rows[0].r;
}
async function observarEspera(obs, pidQuemSegura, pidQuemEspera, rotulo) {
  for (let i = 0; i < 150; i++) {
    const r = await obs.query(
      "SELECT wait_event_type, pg_blocking_pids(pid) AS bloqueadores FROM pg_stat_activity WHERE pid = $1",
      [pidQuemEspera],
    );
    if (
      r.rows[0]?.wait_event_type === "Lock" &&
      r.rows[0].bloqueadores.includes(pidQuemSegura)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`${rotulo}: a espera nao foi observada no Postgres`);
}
const resultado = (p) =>
  p.then(
    (r) => ({ r }),
    (e) => ({ e }),
  );

/**
 * R1: A (o lancamento) le a sessao e PARA na gravacao (pausa de prova); B (o fechamento) chega. `protegido` = B TEM de ser visto
 * esperando A (a sessao travada pela leitura de A); senao B TEM de terminar com A ainda parado (o defeito). Depois a pausa solta, e
 * cada um faz COMMIT na ordem em que terminou (sem a trava, A ainda espera a trava do fechamento pela chave estrangeira).
 */
async function corridaPausada(url, chamadaA, chamadaB, protegido, rotulo) {
  const t = new Client({ connectionString: url });
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  const obs = new Client({ connectionString: url });
  for (const x of [t, a, b, obs]) await x.connect();
  let pA;
  let pB;
  try {
    await logar(a);
    await logar(b);
    await t.query("SELECT pg_advisory_lock($1)", [CHAVE_DA_PAUSA]);
    await a.query("BEGIN");
    await b.query("BEGIN");
    await a.query("SET LOCAL statement_timeout = '8s'");
    await b.query("SET LOCAL statement_timeout = '8s'");
    const pid = async (x) =>
      (await x.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const [pidT, pidA, pidB] = [await pid(t), await pid(a), await pid(b)];
    pA = resultado(chamadaA(a));
    await observarEspera(
      obs,
      pidT,
      pidA,
      `${rotulo}: o lancamento parado na pausa`,
    );
    pB = resultado(chamadaB(b));
    if (protegido) {
      await observarEspera(
        obs,
        pidA,
        pidB,
        `${rotulo}: o fechamento esperando o lancamento`,
      );
    } else {
      const fim = await Promise.race([
        pB,
        new Promise((resolve) => setTimeout(() => resolve("PRESO"), 4000)),
      ]);
      assert.notEqual(
        fim,
        "PRESO",
        `${rotulo}: sem a trava, o fechamento devia terminar com o lancamento ainda parado`,
      );
    }
    await t.query("SELECT pg_advisory_unlock($1)", [CHAVE_DA_PAUSA]);
    const primeiro = await Promise.race([
      pA.then(() => "A"),
      pB.then(() => "B"),
    ]);
    const [x1, p1, x2, p2] = primeiro === "A" ? [a, pA, b, pB] : [b, pB, a, pA];
    const r1 = await p1;
    await x1.query(r1.e ? "ROLLBACK" : "COMMIT");
    const r2 = await p2;
    await x2.query(r2.e ? "ROLLBACK" : "COMMIT");
    return { rA: await pA, rB: await pB, primeiro };
  } finally {
    await t.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    // Os dois ROLLBACK juntos: quem espera o outro e' solto pelo ROLLBACK do outro (e o statement_timeout segura o resto).
    await Promise.allSettled([a.query("ROLLBACK"), b.query("ROLLBACK")]);
    await Promise.allSettled([pA, pB].filter(Boolean));
    for (const x of [t, a, b, obs]) await x.end().catch(() => {});
  }
}

/**
 * R2: A (o fechamento) trava e segura a transacao; B (o lancamento) chega e TEM de ser visto esperando A (com a trava, na leitura
 * da sessao; sem ela, so na chave estrangeira da gravacao). A faz COMMIT e B faz COMMIT (ou ROLLBACK, se errou).
 */
async function corridaComOFechamentoNaFrente(url, chamadaA, chamadaB, rotulo) {
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  const obs = new Client({ connectionString: url });
  for (const x of [a, b, obs]) await x.connect();
  let pB;
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
    pB = resultado(chamadaB(b));
    await observarEspera(
      obs,
      pidA,
      pidB,
      `${rotulo}: o lancamento esperando o fechamento`,
    );
    await a.query("COMMIT");
    const rB = await pB;
    await b.query(rB.e ? "ROLLBACK" : "COMMIT");
    return { rA, rB };
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    if (pB) await pB;
    await b.query("ROLLBACK").catch(() => {});
    for (const x of [a, b, obs]) await x.end().catch(() => {});
  }
}

const sqlFechar = "SELECT public.fin_caixa_fechar_sessao($1, $2, NULL) AS r";
const sqlSalvar = "SELECT public.fin_lancamento_salvar($1::jsonb) AS r";
const sqlBaixar = "SELECT public.fin_lancamento_baixar($1, NULL) AS r";
const despesaDaCorrida = (extra = {}) =>
  despesa({ descricao: DESCRICAO_DA_CORRIDA, ...extra });
// O lancamento da corrida: a despesa nova (salvar) ou a baixa de uma conta a pagar ja gravada (baixar). Devolvem o id.
const LANCAMENTOS = {
  salvar: {
    preparar: async () => null,
    chamar: async (x) =>
      (await chamar(x, sqlSalvar, [JSON.stringify(despesaDaCorrida())])).ids[0],
  },
  baixar: {
    preparar: async (c) =>
      (
        await chamar(c, sqlSalvar, [
          JSON.stringify(despesaDaCorrida({ status: "previsto" })),
        ])
      ).ids[0],
    chamar: async (x, id) => {
      await chamar(x, sqlBaixar, [id]);
      return id;
    },
  },
};

async function abrirCaixa(c) {
  return (await chamar(c, "SELECT public.fin_caixa_abrir(100, NULL) AS r")).id;
}
/** O que o resultado do mes e a conferencia do caixa enxergam depois da corrida. */
async function retrato(c, s, lancamentoId) {
  const linha = (
    await c.query(
      `SELECT valor_esperado::float8 AS esperado, diferenca::float8 AS diferenca,
              (SELECT count(*)::int FROM public.fin_lancamentos l
                WHERE l.caixa_sessao_id = s.id AND l.origem = 'ajuste_caixa') AS ajustes
         FROM public.fin_caixa_sessoes s WHERE s.id = $1 AND s.status = 'fechado'`,
      [s],
    )
  ).rows[0];
  assert.ok(linha, "o caixa da corrida devia estar fechado");
  return {
    diferenca: num(linha.diferenca),
    ajustes: linha.ajustes,
    sessaoDoLancamento: await sessaoDe(c, lancamentoId),
    esperadoGravado: num(linha.esperado),
    esperadoRecalculado: await esperadoDe(c, s),
  };
}

/** R1 e R2 de uma funcao (`fn` = salvar | baixar), com a trava (`protegido`) ou sem ela (controle/mutante). */
async function corridasDe(c, url, fn, protegido, rotulo) {
  const lanc = LANCAMENTOS[fn];
  // R1: o lancamento le a sessao primeiro e para; o fechamento (contando 70: os 100 da abertura menos a despesa de 30) chega.
  {
    const s = await abrirCaixa(c);
    const id = await lanc.preparar(c);
    const r = await corridaPausada(
      url,
      (x) => lanc.chamar(x, id),
      (x) => chamar(x, sqlFechar, [s, 70]),
      protegido,
      `${rotulo} ${fn} R1`,
    );
    if (r.rA.e) throw r.rA.e;
    if (r.rB.e) throw r.rB.e;
    assert.equal(
      r.primeiro,
      protegido ? "A" : "B",
      `${rotulo} ${fn} R1: quem terminou primeiro`,
    );
    assert.deepEqual(
      await retrato(c, s, r.rA.r),
      protegido
        ? {
            diferenca: 0,
            ajustes: 0,
            sessaoDoLancamento: s,
            esperadoGravado: 70,
            esperadoRecalculado: 70,
          }
        : {
            // O defeito: Quebra FALSA de 30 e a despesa ligada ao caixa ja fechado (a perda contada duas vezes).
            diferenca: -30,
            ajustes: 1,
            sessaoDoLancamento: s,
            esperadoGravado: 100,
            esperadoRecalculado: 70,
          },
      protegido
        ? `${rotulo} ${fn} R1: o fechamento espera e conta a despesa`
        : `${rotulo} ${fn} R1: sem a trava, o defeito aparece`,
    );
  }
  // R2: o fechamento (contando 100) trava primeiro; o lancamento chega.
  {
    const s = await abrirCaixa(c);
    const id = await lanc.preparar(c);
    const { rB } = await corridaComOFechamentoNaFrente(
      url,
      (x) => chamar(x, sqlFechar, [s, 100]),
      (x) => lanc.chamar(x, id),
      `${rotulo} ${fn} R2`,
    );
    if (rB.e) throw rB.e;
    assert.deepEqual(
      await retrato(c, s, rB.r),
      protegido
        ? {
            // Como depois de fechar: o lancamento grava sem caixa e o caixa fechado segue batendo com o proprio recalculo.
            diferenca: 0,
            ajustes: 0,
            sessaoDoLancamento: null,
            esperadoGravado: 100,
            esperadoRecalculado: 100,
          }
        : {
            // O defeito: o lancamento ligado ao caixa ja fechado, que nao o contou.
            diferenca: 0,
            ajustes: 0,
            sessaoDoLancamento: s,
            esperadoGravado: 100,
            esperadoRecalculado: 70,
          },
      protegido
        ? `${rotulo} ${fn} R2: o lancamento ve o caixa fechado e grava sem caixa`
        : `${rotulo} ${fn} R2: sem a trava, o defeito aparece`,
    );
  }
}
async function corridas(c, url, protegidos, rotulo) {
  for (const fn of ["salvar", "baixar"])
    await corridasDe(c, url, fn, protegidos[fn], rotulo);
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
    const topo = {
      [SALVAR]: await definicao(c, SALVAR),
      [BAIXAR]: await definicao(c, BAIXAR),
    };
    await c.query("BEGIN");
    await montarLoja(c, true);
    await c.query("COMMIT");
    await logar(c);
    await c.query(PAUSA_CRIAR);
    try {
      await corridas(c, url, { salvar: true, baixar: true }, "vivo");

      // Controle: o rollback commitado (os corpos anteriores) e depois a migration de volta.
      await c.query("BEGIN");
      await c.query(rollback);
      await c.query("COMMIT");
      try {
        await corridas(c, url, { salvar: false, baixar: false }, "controle");
      } finally {
        await c.query("BEGIN");
        await c.query(migration);
        await c.query("COMMIT");
      }
      // Mutantes: sem a trava de UMA funcao, commitado, e o corpo vivo de volta. So a funcao mutada cai.
      for (const [fn, sig] of [
        ["salvar", SALVAR],
        ["baixar", BAIXAR],
      ]) {
        await c.query("BEGIN");
        await mutar(
          c,
          sig,
          SEM_TRAVA.de,
          SEM_TRAVA.para,
          `mutante sem a trava do ${fn}`,
        );
        await c.query("COMMIT");
        try {
          await corridas(
            c,
            url,
            { salvar: fn !== "salvar", baixar: fn !== "baixar" },
            `mutante sem a trava do ${fn}`,
          );
        } finally {
          await c.query(topo[sig]);
        }
      }
      assert.deepEqual(
        await hashes(c),
        HASH_DESTA,
        "a parte 2 deixou o clone fora do topo",
      );
    } finally {
      await c.query(PAUSA_DESFAZER);
    }
    resumo.push(
      "corridas (salvar e baixa contra o fechamento, nas duas ordens): com a trava o fechamento conta a despesa ou a despesa grava sem caixa; controle com o rollback e os 2 mutantes sem a trava mostram a quebra falsa e o lancamento ligado ao caixa fechado",
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
  console.log(`PASSOU 20261663000000: ${resumo.join("; ")}.`);
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
  SEM_TRAVA,
  SALVAR,
  BAIXAR,
  IDS,
};
