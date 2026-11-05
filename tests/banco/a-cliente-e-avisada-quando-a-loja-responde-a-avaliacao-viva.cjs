"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

/**
 * PROVA VIVA da migration 20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql
 * (public.reply_review_atomic, as DUAS sobrecargas) contra o Postgres EFEMERO com as migrations aplicadas do zero
 * (rpc-ci). O defeito: a loja responde a avaliacao, mas a cliente nunca e avisada (zero linhas em `notificacoes`):
 * a RPC lia o user_id da avaliacao e so gravava a linha do log de push.
 *
 *   (0) CONTROLE: o corpo de antes (o rollback-manual aplicado numa transacao desfeita) reproduz o defeito:
 *       resposta gravada, nenhum aviso para a cliente, uma linha no log de push.
 *   (1) DEPOIS: a loja responde e nasce UM aviso no sino da cliente que ESCREVEU a avaliacao (e so dela): tipo, titulo,
 *       mensagem com o nome do produto, destino que abre o produto, nao lido. A linha do log de push CONTINUA sendo
 *       gravada, uma por resposta (a consulta 27m a usa como rastro). Nas duas sobrecargas.
 *   (2) UM aviso por avaliacao: resposta repetida e EDITADA nao duplicam; outra avaliacao da mesma cliente tem o seu
 *       aviso; dispensado o aviso, a edicao avisa de novo (decisao declarada); avaliacao respondida ANTES da migration
 *       nao ganha aviso em massa, so se a loja editar; avaliacao em analise tambem avisa; avaliacao que nao existe
 *       nao grava nada e nao erra.
 *   (3) PERMISSAO: quem nao e admin e recusado sem escrever nada; o visitante (anon) nao executa; a ACL, o dono,
 *       SECURITY DEFINER, search_path e retorno das duas sobrecargas sao iguais antes e depois.
 *   (4) o aviso e best-effort: se o INSERT do aviso falhar (CHECK ou gatilho), a RESPOSTA da loja e a linha do log sao
 *       gravadas mesmo assim e a falha fica logada como WARNING.
 *   (5) CORRIDA: duas lojistas respondendo a MESMA avaliacao ao mesmo tempo (duas conexoes reais) geram um aviso.
 *   (6) a MIGRATION: so o corpo das duas funcoes muda (nenhuma outra funcao, ACL de tabela, politica ou dado); aplicar
 *       2x e em CRLF = mesmo estado; transacional (um erro no fim desfaz tudo); o rollback devolve o corpo de antes
 *       BYTE A BYTE; o pre-voo (da migration e do rollback) recusa sem escrever; a conferencia final do rollback recusa.
 *   (7) MUTANTES: cada guarda tirada do corpo novo deixa a prova vermelha, pelo motivo certo.
 *   (8) FICHAS 120a/120b (nos dois estados, uma linha reprovando por estrago) e a 82a (aceita o corpo desta migration
 *       como sucessor do da 20261360000000, e continua reprovando qualquer outro).
 *   (9) ENSAIO NO BANCO REAL: o mesmo cenario, em um unico bloco DO que termina em RAISE EXCEPTION (nada fica gravado),
 *       reaproveitavel numa loja real.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-viva.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const CONSULTAS = path.join(RAIZ, "scripts", "publicacao", "consultas");
const ARQ =
  "20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const STEM_A =
  "120a-conferir-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-aplicado";
const STEM_B =
  "120b-antes-a-cliente-e-avisada-quando-a-loja-responde-a-avaliacao-base-vigente";
const STEM_82A = "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas";
const lerConsulta = (stem) =>
  fs.readFileSync(path.join(CONSULTAS, `${stem}.sql`), "utf8");
const FICHA_A = lerConsulta(STEM_A);
const FICHA_B = lerConsulta(STEM_B);
const FICHA_82A = lerConsulta(STEM_82A);

const F2 = "public.reply_review_atomic(uuid,text)";
const F3 = "public.reply_review_atomic(uuid,text,uuid)";
// Os corpos escritos por extenso: o teste NUNCA os le do arquivo da migration (um erro de digitacao na migration
// passaria pela prova). ANTES = os vigentes da 20261360000000; DEPOIS = os desta migration.
const H_ANTES = {
  [F2]: "0e58549366e4b4be17ae070a8fc622dc",
  [F3]: "64b337eb3ec5dd1431e0dbf9d12a49ac",
};
const H_DEPOIS = {
  [F2]: "f617966c37037537410c3c78d85b8785",
  [F3]: "08569f17f477dea9ff87709ca3edd218",
};

/** Os dois CREATE OR REPLACE da migration, sem o pre-voo nem a conferencia final (para os mutantes). */
const FUNCOES_SQL = MIGRATION.slice(
  MIGRATION.indexOf("CREATE OR REPLACE FUNCTION"),
  MIGRATION.indexOf("-- CONFERÊNCIA FINAL"),
);
/** Os dois CREATE OR REPLACE do rollback, SEM o pre-voo nem a conferencia final (monta o corpo de antes por cima de um corpo alheio). */
const ROLLBACK_SO_CORPOS = ROLLBACK.slice(
  ROLLBACK.indexOf("CREATE OR REPLACE FUNCTION"),
  ROLLBACK.indexOf("-- CONFERÊNCIA FINAL"),
);

const U = {
  admin: "7e7e3994-0000-4000-8000-0000000000a1",
  admin2: "7e7e3994-0000-4000-8000-0000000000a2",
  cliente: "7e7e3994-0000-4000-8000-0000000000c1",
  outra: "7e7e3994-0000-4000-8000-0000000000c2",
};
const PROD = "7e7e3994-0000-4000-8000-0000000000f1";
const PROD2 = "7e7e3994-0000-4000-8000-0000000000f2";
const R = {
  r1: "7e7e3994-0000-4000-8000-0000000000b1", // cliente -> PROD
  r2: "7e7e3994-0000-4000-8000-0000000000b2", // outra -> PROD
  r3: "7e7e3994-0000-4000-8000-0000000000b3", // cliente -> PROD2
  r4: "7e7e3994-0000-4000-8000-0000000000b4", // cliente -> PROD (ja respondida ANTES da migration)
  r5: "7e7e3994-0000-4000-8000-0000000000b5", // cliente -> PROD, ainda em analise (pendente)
};
const INEXISTENTE = "7e7e3994-0000-4000-8000-0000000000bf";
const NOME_PROD = "Camiseta Azul 40";
const NOME_PROD2 = "Calça Preta 42";
const TITULO = "Sua avaliação foi respondida";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({ role: "authenticated" });

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita; `antes` monta o estado ANTES (rollback-manual). */
async function emTransacao(fn, { antes = false } = {}) {
  await C.query("BEGIN");
  try {
    if (antes) {
      await C.query(ROLLBACK);
      assert.equal(
        await hashVivo(F2),
        H_ANTES[F2],
        "o ANTES (2 args) nao montou",
      );
      assert.equal(
        await hashVivo(F3),
        H_ANTES[F3],
        "o ANTES (3 args) nao montou",
      );
    } else {
      await C.query(MIGRATION);
      assert.equal(
        await hashVivo(F2),
        H_DEPOIS[F2],
        "o DEPOIS (2 args) nao montou",
      );
      assert.equal(
        await hashVivo(F3),
        H_DEPOIS[F3],
        "o DEPOIS (3 args) nao montou",
      );
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` (null = sessao direta), com o JWT e o auth.uid() pedidos. */
async function como(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    // transacao abortada nao aceita RESET ROLE e o erro dela esconderia o original
    await C.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

const hashVivo = async (assinatura) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [assinatura],
    )
  ).rows[0]?.h;

/** A loja (admin) responde pelo caminho que o app usa (2 args) ou pelo de 3 args. */
const responder = (rid, texto, { tres = false, uid = U.admin } = {}) =>
  tentar(
    "authenticated",
    tres
      ? "SELECT public.reply_review_atomic($1::uuid, $2::text, $3::uuid)"
      : "SELECT public.reply_review_atomic($1::uuid, $2::text)",
    tres ? [rid, texto, uid] : [rid, texto],
    { uid, claims: JWT_ADMIN },
  );

const contar = async (sql, params = []) =>
  Number((await C.query(sql, params)).rows[0].n);
const totais = async () => ({
  respondidas: await contar(
    "SELECT count(*) AS n FROM public.reviews WHERE merchant_reply IS NOT NULL",
  ),
  avisos: await contar("SELECT count(*) AS n FROM public.notificacoes"),
  log: await contar("SELECT count(*) AS n FROM public.push_notifications_log"),
});
/** Os avisos de uma avaliacao, lidos como dono (por cima da RLS). */
const avisosDa = async (rid) =>
  (
    await C.query(
      `SELECT usuario_id::text AS usuario_id, tipo, titulo, mensagem, dados, acao, lida
         FROM public.notificacoes WHERE dados ->> 'review_id' = $1 ORDER BY created_at, id`,
      [rid],
    )
  ).rows;
const respostaDa = async (rid) =>
  (
    await C.query(
      "SELECT merchant_reply, merchant_reply_at IS NOT NULL AS tem_data FROM public.reviews WHERE id = $1",
      [rid],
    )
  ).rows[0];
/** As linhas do log de push que o app mostra como "Sua avaliacao foi respondida!" (com e sem acento). */
const logsDeAvaliacao = async () =>
  contar(
    "SELECT count(*) AS n FROM public.push_notifications_log WHERE title IN ('Sua avaliação foi respondida!', 'Sua avaliacao foi respondida!')",
  );

/** Pessoas, produtos e avaliacoes (commitado: o clone e descartavel; o finally limpa). */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@120.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 120', 'admin'), ($2, 'Admin Dois 120', 'admin'),
       ($3, 'Cliente 120', 'customer'), ($4, 'Outra 120', 'customer')`,
    [U.admin, U.admin2, U.cliente, U.outra],
  );
  for (const id of [U.admin, U.admin2])
    await C.query(
      'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
      [id],
    );
  await C.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES
       ($1, $2, 100, 10, true, 40), ($3, $4, 100, 10, true, 40)`,
    [PROD, NOME_PROD, PROD2, NOME_PROD2],
  );
  await C.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES
       ($1, $2, $3, 2, 'Veio com defeito.', 'publicada'),
       ($4, $2, $5, 5, 'Adorei!', 'publicada'),
       ($6, $7, $3, 4, 'Bom, mas apertada.', 'publicada'),
       ($8, $2, $3, 3, 'Normal.', 'publicada'),
       ($9, $2, $3, 1, 'Nao gostei.', 'pendente')`,
    [R.r1, PROD, U.cliente, R.r2, U.outra, R.r3, PROD2, R.r4, R.r5],
  );
  // A avaliacao 4 foi respondida ANTES da migration: resposta gravada direto, sem aviso nenhum.
  await C.query(
    "UPDATE public.reviews SET merchant_reply = 'Obrigado!', merchant_reply_at = now() - interval '3 days' WHERE id = $1",
    [R.r4],
  );
}

async function limpar() {
  const rs = Object.values(R);
  await C.query(
    "DELETE FROM public.notificacoes WHERE dados ->> 'review_id' = ANY($1::text[])",
    [rs],
  ).catch(() => {});
  await C.query("DELETE FROM public.reviews WHERE id = ANY($1::uuid[])", [
    rs,
  ]).catch(() => {});
  await C.query("DELETE FROM public.produtos WHERE id = ANY($1::uuid[])", [
    [PROD, PROD2],
  ]).catch(() => {});
  await C.query("DELETE FROM public.profiles WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]).catch(() => {});
  await C.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]).catch(() => {});
  await C.query(
    "DELETE FROM public.push_notifications_log WHERE url LIKE '/product/' || $1 || '%' OR url LIKE '/product/' || $2 || '%'",
    [PROD, PROD2],
  ).catch(() => {});
}

// ---- o cenario principal, reexecutavel (corpo novo e mutantes) -----------------------------------------------
/** Pre-condicao: a transacao esta no estado DEPOIS (ou no mutante). Falha com assert se algo estiver errado. */
async function cenarioPrincipal() {
  const antes = await totais();
  const logAntes = await logsDeAvaliacao();

  // (1) 2 args: nasce UM aviso, so para a cliente que escreveu a avaliacao
  const r = await responder(R.r1, "Sentimos muito, vamos trocar!");
  assert.ok(r.linhas, `a loja foi recusada: ${r.erro}`);
  let avisos = await avisosDa(R.r1);
  assert.equal(avisos.length, 1, "esperava UM aviso para a avaliacao 1");
  const a = avisos[0];
  assert.equal(a.usuario_id, U.cliente, "o aviso e' da cliente que avaliou");
  assert.equal(a.tipo, "info");
  assert.equal(a.titulo, TITULO);
  assert.equal(
    a.mensagem,
    `A loja respondeu sua avaliação sobre ${NOME_PROD}.`,
  );
  assert.deepEqual(a.dados, { review_id: R.r1, product_id: PROD });
  assert.deepEqual(
    a.acao,
    { url: `/product-detail?id=${PROD}` },
    "o aviso abre o produto",
  );
  assert.equal(a.lida, false);
  const dep = await respostaDa(R.r1);
  assert.equal(dep.merchant_reply, "Sentimos muito, vamos trocar!");
  assert.equal(dep.tem_data, true, "a data da resposta e' gravada");
  const depois = await totais();
  assert.equal(
    depois.respondidas,
    antes.respondidas + 1,
    "a resposta e' gravada",
  );
  assert.equal(depois.avisos, antes.avisos + 1, "nasce exatamente 1 aviso");
  assert.equal(
    await logsDeAvaliacao(),
    logAntes + 1,
    "a linha do log de push continua sendo gravada (a consulta 27m a usa)",
  );

  // o sino e' so dela: a RLS mostra a linha para a dona e esconde da outra cliente
  const sql =
    "SELECT count(*)::int AS n FROM public.notificacoes WHERE dados ->> 'review_id' = $1";
  const dela = await como("authenticated", sql, [R.r1], {
    uid: U.cliente,
    claims: JWT_CLIENTE,
  });
  assert.equal(dela[0].n, 1, "a dona ve o aviso no proprio sino");
  const alheia = await como("authenticated", sql, [R.r1], {
    uid: U.outra,
    claims: JWT_CLIENTE,
  });
  assert.equal(alheia[0].n, 0, "a outra cliente NAO ve o aviso da dona");

  // (1b) 3 args: mesmo comportamento, para a cliente da avaliacao 2
  const r3 = await responder(R.r2, "Que bom que gostou!", { tres: true });
  assert.ok(r3.linhas, `a sobrecarga de 3 args foi recusada: ${r3.erro}`);
  avisos = await avisosDa(R.r2);
  assert.equal(avisos.length, 1, "3 args: esperava UM aviso");
  assert.equal(avisos[0].usuario_id, U.outra, "3 args: aviso da outra cliente");
  assert.equal(
    avisos[0].mensagem,
    `A loja respondeu sua avaliação sobre ${NOME_PROD}.`,
  );
  assert.deepEqual(avisos[0].acao, { url: `/product-detail?id=${PROD}` });
  assert.equal(
    await logsDeAvaliacao(),
    logAntes + 2,
    "3 args: a linha do log de push tambem continua sendo gravada",
  );

  // (2) UM aviso por avaliacao: repetir e EDITAR a resposta nao duplica
  for (const texto of [
    "Sentimos muito, vamos trocar!",
    "Corrigindo: a troca e' gratis.",
  ]) {
    const rr = await responder(R.r1, texto);
    assert.ok(rr.linhas, `reenvio recusado: ${rr.erro}`);
  }
  const rr3 = await responder(R.r1, "De novo pela de 3 args.", { tres: true });
  assert.ok(rr3.linhas, `reenvio (3 args) recusado: ${rr3.erro}`);
  assert.equal(
    (await avisosDa(R.r1)).length,
    1,
    "repetir e editar a resposta (2 e 3 args) nao duplica o aviso",
  );
  assert.equal(
    (await respostaDa(R.r1)).merchant_reply,
    "De novo pela de 3 args.",
    "a resposta editada e' a que fica",
  );
  assert.equal(
    await logsDeAvaliacao(),
    logAntes + 5,
    "cada resposta continua gravando a sua linha no log de push",
  );

  // outra avaliacao da MESMA cliente tem o seu proprio aviso, com o nome do outro produto
  const r2 = await responder(R.r3, "Obrigada pelo retorno.");
  assert.ok(r2.linhas);
  const av3 = await avisosDa(R.r3);
  assert.equal(
    av3.length,
    1,
    "outra avaliacao da mesma cliente tem o seu aviso",
  );
  assert.equal(av3[0].usuario_id, U.cliente);
  assert.equal(
    av3[0].mensagem,
    `A loja respondeu sua avaliação sobre ${NOME_PROD2}.`,
  );
  assert.deepEqual(av3[0].acao, { url: `/product-detail?id=${PROD2}` });
  assert.equal(
    await contar(
      "SELECT count(*) AS n FROM public.notificacoes WHERE usuario_id = $1",
      [U.cliente],
    ),
    2,
    "a cliente tem os 2 avisos das 2 avaliacoes dela",
  );
  assert.equal(
    await contar(
      "SELECT count(*) AS n FROM public.notificacoes WHERE usuario_id = ANY($1::uuid[])",
      [[U.admin, U.admin2]],
    ),
    0,
    "nenhum aviso nasce para a lojista",
  );
}

// ---- (0) CONTROLE ---------------------------------------------------------------------------------------------
prova(
  "(0) CONTROLE: o corpo de ANTES reproduz o defeito (resposta gravada, cliente no escuro, uma linha no log)",
  () =>
    emTransacao(
      async () => {
        for (const tres of [false, true]) {
          const antes = await totais();
          const logAntes = await logsDeAvaliacao();
          const rid = tres ? R.r2 : R.r1;
          const r = await responder(rid, "Obrigado!", { tres });
          assert.ok(r.linhas, `controle recusado: ${r.erro}`);
          const depois = await totais();
          assert.equal(depois.respondidas, antes.respondidas + 1);
          assert.equal(
            depois.avisos,
            antes.avisos,
            `ANTES${tres ? " (3 args)" : ""}: a cliente nao ganha aviso nenhum`,
          );
          assert.equal(await logsDeAvaliacao(), logAntes + 1);
        }
      },
      { antes: true },
    ),
);

// ---- (1) e (2) DEPOIS -----------------------------------------------------------------------------------------
prova(
  "(1)(2) DEPOIS: aviso so para quem avaliou (2 e 3 args), log de push mantido, repetir/editar nao duplica",
  () => emTransacao(cenarioPrincipal),
);

prova(
  "(2) dispensado o aviso, editar a resposta avisa de novo; avaliacao antiga so ganha aviso se a loja editar; em analise tambem avisa",
  () =>
    emTransacao(async () => {
      assert.ok((await responder(R.r1, "Vamos trocar!")).linhas);
      assert.equal((await avisosDa(R.r1)).length, 1);
      // a cliente dispensa o aviso (o sino dela deixa apagar o proprio aviso)
      const del = await como(
        "authenticated",
        "DELETE FROM public.notificacoes WHERE dados ->> 'review_id' = $1 RETURNING id",
        [R.r1],
        { uid: U.cliente, claims: JWT_CLIENTE },
      );
      assert.equal(del.length, 1);
      assert.equal((await avisosDa(R.r1)).length, 0);
      assert.ok((await responder(R.r1, "Corrigindo: troca gratis.")).linhas);
      assert.equal(
        (await avisosDa(R.r1)).length,
        1,
        "a correcao da resposta avisa a cliente de novo",
      );

      // a avaliacao 4 foi respondida antes da migration: aplicar a migration nao criou aviso nenhum...
      assert.equal(
        (await avisosDa(R.r4)).length,
        0,
        "nada em massa: a avaliacao antiga segue sem aviso",
      );
      // ... e so uma edicao da loja faz nascer o aviso que ela nunca recebeu
      assert.ok((await responder(R.r4, "Obrigado!")).linhas);
      const av = await avisosDa(R.r4);
      assert.equal(av.length, 1);
      assert.equal(av[0].usuario_id, U.cliente);

      // a avaliacao 5 ainda esta em analise (pendente): a loja pode responder e a autora e avisada do mesmo jeito
      assert.ok((await responder(R.r5, "Pode nos chamar no WhatsApp.")).linhas);
      assert.equal((await avisosDa(R.r5)).length, 1);
    }),
);

prova(
  "(2) avaliacao que nao existe: nao grava nada, nao avisa ninguem e nao da erro (nas duas sobrecargas)",
  () =>
    emTransacao(async () => {
      const antes = await totais();
      const logAntes = await logsDeAvaliacao();
      for (const tres of [false, true]) {
        const r = await responder(INEXISTENTE, "Ola?", { tres });
        assert.ok(r.linhas, `a avaliacao inexistente deu erro: ${r.erro}`);
      }
      assert.deepEqual(await totais(), antes, "nada foi gravado");
      assert.equal(await logsDeAvaliacao(), logAntes);
    }),
);

// ---- (3) PERMISSAO --------------------------------------------------------------------------------------------
prova(
  "(3) quem nao e admin e recusado sem escrever nada (2 e 3 args); o visitante nao executa; ACL e atributos iguais",
  async () => {
    const retrato = async () =>
      (
        await C.query(
          `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl, p.prosecdef,
                  p.provolatile, p.proconfig::text AS cfg, p.proowner::regrole::text AS dono,
                  p.proparallel, p.procost, p.proisstrict, p.proleakproof,
                  pg_get_function_result(p.oid) AS retorno, pg_get_function_arguments(p.oid) AS args
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reply_review_atomic' ORDER BY 1`,
        )
      ).rows;
    let retratoAntes;
    await emTransacao(
      async () => {
        retratoAntes = await retrato();
      },
      { antes: true },
    );
    await emTransacao(async () => {
      assert.deepEqual(
        await retrato(),
        retratoAntes,
        "ACL, dono, SECURITY DEFINER, search_path, retorno e OID iguais antes e depois",
      );
      assert.equal(retratoAntes.length, 2);
      const antes = await totais();
      // cliente comum (nem profiles admin, nem JWT admin)
      for (const tres of [false, true]) {
        const r = await tentar(
          "authenticated",
          tres
            ? "SELECT public.reply_review_atomic($1::uuid, $2::text, $3::uuid)"
            : "SELECT public.reply_review_atomic($1::uuid, $2::text)",
          tres
            ? [R.r1, "tomei a voz da loja", U.outra]
            : [R.r1, "tomei a voz da loja"],
          { uid: U.outra, claims: JWT_CLIENTE },
        );
        assert.ok(
          r.erro,
          `${tres ? "3" : "2"} args: cliente comum devia ser recusada`,
        );
        assert.match(r.erro, /Unauthorized/);
      }
      // a autora da propria avaliacao tambem nao responde por ela
      const propria = await tentar(
        "authenticated",
        "SELECT public.reply_review_atomic($1::uuid, $2::text)",
        [R.r1, "eu mesma respondo"],
        { uid: U.cliente, claims: JWT_CLIENTE },
      );
      assert.match(propria.erro, /Unauthorized/);
      // o visitante (anon) nem chega ao corpo
      for (const tres of [false, true]) {
        const r = await tentar(
          "anon",
          tres
            ? "SELECT public.reply_review_atomic($1::uuid, $2::text, $3::uuid)"
            : "SELECT public.reply_review_atomic($1::uuid, $2::text)",
          tres ? [R.r1, "x", U.admin] : [R.r1, "x"],
        );
        assert.equal(
          r.codigo,
          "42501",
          `${tres ? "3" : "2"} args: anon sem EXECUTE`,
        );
      }
      assert.deepEqual(await totais(), antes, "nada foi gravado pelas recusas");
    });
  },
);

// ---- (4) best-effort ------------------------------------------------------------------------------------------
async function cenarioBestEffort(preparar) {
  const avisosDoBanco = [];
  const ouvinte = (n) => avisosDoBanco.push(n.message);
  C.on("notice", ouvinte);
  try {
    await preparar();
    for (const tres of [false, true]) {
      const antes = await totais();
      const logAntes = await logsDeAvaliacao();
      const rid = tres ? R.r2 : R.r1;
      const r = await responder(rid, "Obrigado!", { tres });
      assert.ok(
        r.linhas,
        `a falha do aviso derrubou a resposta da loja: ${r.erro}`,
      );
      const depois = await totais();
      assert.equal(
        depois.respondidas,
        antes.respondidas + 1,
        "a resposta foi gravada",
      );
      assert.equal(depois.avisos, antes.avisos, "o aviso nao nasceu");
      assert.equal(
        await logsDeAvaliacao(),
        logAntes + 1,
        "a linha do log tambem foi gravada",
      );
    }
    assert.ok(
      avisosDoBanco.some((m) => m.includes("aviso da avaliacao")),
      `a falha tem de ficar logada como WARNING: ${JSON.stringify(avisosDoBanco)}`,
    );
  } finally {
    C.off("notice", ouvinte);
  }
}
const recusaPorCheck = () =>
  C.query(
    `ALTER TABLE public.notificacoes ADD CONSTRAINT prova_recusa_aviso CHECK (titulo <> '${TITULO}')`,
  );
const recusaPorGatilho = async () => {
  await C.query(
    `CREATE FUNCTION public.prova_recusa_aviso_fn() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'gatilho de prova recusa o aviso'; END $$`,
  );
  await C.query(
    `CREATE TRIGGER prova_recusa_aviso BEFORE INSERT ON public.notificacoes
       FOR EACH ROW EXECUTE FUNCTION public.prova_recusa_aviso_fn()`,
  );
};
prova(
  "(4) o aviso e best-effort: se ele falhar (CHECK), a resposta e o log sao gravados e a falha fica logada",
  () => emTransacao(() => cenarioBestEffort(recusaPorCheck)),
);
prova(
  "(4) o aviso e best-effort: se ele falhar (gatilho que levanta erro), a resposta e o log sao gravados",
  () => emTransacao(() => cenarioBestEffort(recusaPorGatilho)),
);

// ---- (5) CORRIDA ----------------------------------------------------------------------------------------------
prova(
  "(5) duas lojistas respondendo a MESMA avaliacao ao mesmo tempo geram UM aviso (duas conexoes reais)",
  async () => {
    await C.query(MIGRATION);
    await cenarioCorrida();
  },
);

/** As funcoes vivas (commitadas) fazem o trabalho: nao roda dentro de transacao. */
async function cenarioCorrida() {
  const url = lerDatabaseUrlEfemera();
  const dbAtual = (await C.query("SELECT current_database() AS d")).rows[0].d;
  const u = new URL(url);
  u.pathname = `/${dbAtual}`;
  const c1 = new Client({ connectionString: u.toString() });
  const c2 = new Client({ connectionString: u.toString() });
  await c1.connect();
  await c2.connect();
  try {
    const abrir = async (c, uid) => {
      await c.query("BEGIN");
      await c.query(
        "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
        [uid, JWT_ADMIN],
      );
      await c.query("SET LOCAL ROLE authenticated");
    };
    await abrir(c1, U.admin);
    await abrir(c2, U.admin2);
    await c1.query("SELECT public.reply_review_atomic($1::uuid, $2::text)", [
      R.r1,
      "Resposta da lojista 1",
    ]);
    // a segunda espera o commit da primeira (o UPDATE da avaliacao trava a linha)
    const segunda = c2
      .query("SELECT public.reply_review_atomic($1::uuid, $2::text)", [
        R.r1,
        "Resposta da lojista 2",
      ])
      .then(() => "ok");
    await new Promise((r) => setTimeout(r, 400));
    await c1.query("COMMIT");
    assert.equal(await segunda, "ok");
    await c2.query("COMMIT");
    assert.equal(
      (await avisosDa(R.r1)).length,
      1,
      "a corrida gerou aviso em dobro",
    );
    assert.equal(
      (await respostaDa(R.r1)).merchant_reply,
      "Resposta da lojista 2",
    );
  } finally {
    await c1.query("ROLLBACK").catch(() => {});
    await c2.query("ROLLBACK").catch(() => {});
    await c1.end().catch(() => {});
    await c2.end().catch(() => {});
    await C.query(
      "DELETE FROM public.notificacoes WHERE dados ->> 'review_id' = $1",
      [R.r1],
    );
    await C.query(
      "UPDATE public.reviews SET merchant_reply = NULL, merchant_reply_at = NULL WHERE id = $1",
      [R.r1],
    );
    await C.query(
      "DELETE FROM public.push_notifications_log WHERE url = '/product/' || $1",
      [PROD],
    );
  }
}

// ---- (6) A MIGRATION ------------------------------------------------------------------------------------------
/** O que a migration nao pode tocar: toda funcao de public (menos as duas), ACL de tabela, politicas e dados. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'reply_review_atomic' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl, c.relrowsecurity
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const policies = (
    await C.query(
      `SELECT polrelid::regclass::text AS t, polname, polcmd, pg_get_expr(polqual, polrelid) AS q,
              pg_get_expr(polwithcheck, polrelid) AS wc
         FROM pg_policy WHERE polrelid IN ('public.notificacoes'::regclass, 'public.reviews'::regclass)
        ORDER BY 1, 2`,
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT tgrelid::regclass::text AS t, tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN ('public.notificacoes'::regclass, 'public.reviews'::regclass) ORDER BY 1, 2`,
    )
  ).rows;
  const dados = (
    await C.query(
      `SELECT (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.notificacoes x) AS notificacoes,
              (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.reviews x) AS reviews,
              (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.push_notifications_log x) AS log`,
    )
  ).rows[0];
  return { funcoes, tabelas, policies, gatilhos, dados };
}

prova(
  "(6) so o corpo das duas funcoes muda: nenhuma outra funcao, ACL de tabela, politica, gatilho ou dado; aplicar 2x e CRLF = igual",
  async () => {
    let base;
    await emTransacao(
      async () => {
        base = await retratoDoSchema();
      },
      { antes: true },
    );
    await emTransacao(async () => {
      assert.deepEqual(
        await retratoDoSchema(),
        base,
        "a migration tocou algo alem do corpo das duas funcoes",
      );
      // reaplicar 2x = 1x
      await C.query(MIGRATION);
      await C.query(MIGRATION);
      assert.equal(await hashVivo(F2), H_DEPOIS[F2]);
      assert.equal(await hashVivo(F3), H_DEPOIS[F3]);
      assert.deepEqual(await retratoDoSchema(), base);
      // CRLF: o corpo ganha CR, o hash (sem CR) e o mesmo e o pre-voo aceita
      await C.query(emCRLF(MIGRATION));
      assert.equal(await hashVivo(F2), H_DEPOIS[F2], "CRLF muda o hash sem CR");
      assert.equal(await hashVivo(F3), H_DEPOIS[F3]);
    });
  },
);

prova(
  "(6) a migration e o rollback sao TRANSACIONAIS (sem COMMIT escondido): um erro depois do ultimo comando desfaz tudo; o detector enxerga um COMMIT",
  async () => {
    const tentarComFalhaNoFim = async (sql) => {
      let erro;
      try {
        await C.query(`${sql}\nSELECT 1/0;`); // protocolo simples: um bloco implicito, tudo ou nada
      } catch (e) {
        erro = e;
      }
      assert.ok(erro && /division by zero/.test(erro.message), String(erro));
    };
    try {
      // estado ANTES commitado (fora de transacao); a migration + erro tem de deixar o ANTES
      await C.query(ROLLBACK);
      await tentarComFalhaNoFim(MIGRATION);
      assert.equal(
        await hashVivo(F2),
        H_ANTES[F2],
        "migration: ficou pela metade",
      );
      assert.equal(
        await hashVivo(F3),
        H_ANTES[F3],
        "migration: ficou pela metade",
      );
      // o detector: um COMMIT escondido no meio deixaria o DEPOIS gravado
      await tentarComFalhaNoFim(
        MIGRATION.replace(
          "-- CONFERÊNCIA FINAL",
          "COMMIT;\n-- CONFERÊNCIA FINAL",
        ),
      );
      assert.equal(
        await hashVivo(F2),
        H_DEPOIS[F2],
        "o detector nao enxergou o COMMIT escondido",
      );
      // o mesmo para o rollback (estado DEPOIS commitado; rollback + erro tem de deixar o DEPOIS)
      await tentarComFalhaNoFim(ROLLBACK);
      assert.equal(
        await hashVivo(F2),
        H_DEPOIS[F2],
        "rollback: ficou pela metade",
      );
      assert.equal(
        await hashVivo(F3),
        H_DEPOIS[F3],
        "rollback: ficou pela metade",
      );
    } finally {
      await C.query(MIGRATION);
    }
  },
);

prova(
  "(6) o rollback devolve os corpos de antes BYTE A BYTE; aplicar-desfazer-aplicar volta identico",
  async () => {
    await emTransacao(async () => {
      await C.query(ROLLBACK);
      for (const f of [F2, F3]) {
        assert.equal(await hashVivo(f), H_ANTES[f], `${f}: rollback`);
        // byte a byte, nao so por hash: o prosrc e' exatamente o texto do arquivo de rollback
        const { prosrc } = (
          await C.query(
            "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
            [f],
          )
        ).rows[0];
        const texto =
          f === F2
            ? ROLLBACK.split("$function$")[1]
            : ROLLBACK.split("$function$")[3];
        assert.equal(prosrc, texto, `${f}: prosrc != texto do rollback`);
      }
      await C.query(MIGRATION);
      assert.equal(await hashVivo(F2), H_DEPOIS[F2]);
      assert.equal(await hashVivo(F3), H_DEPOIS[F3]);
      await C.query(ROLLBACK);
      await C.query(ROLLBACK);
      assert.equal(
        await hashVivo(F2),
        H_ANTES[F2],
        "segundo rollback e' no-op",
      );
    });
  },
);

prova(
  "(6) o pre-voo da migration recusa SEM escrever: corpo divergente (nas duas), sobrecarga extra, atributo, funcao e coluna ausentes",
  async () => {
    const recusa = async (preparar, esperado) => {
      await C.query("BEGIN");
      try {
        await C.query(ROLLBACK); // parte do estado vigente conhecido
        await preparar();
        const antes = [await hashVivo(F2), await hashVivo(F3)];
        await C.query("SAVEPOINT migracao");
        let erro;
        try {
          await C.query(MIGRATION);
        } catch (e) {
          erro = e;
        }
        assert.ok(erro, "a migration devia recusar");
        assert.match(erro.message, esperado);
        await C.query("ROLLBACK TO SAVEPOINT migracao");
        assert.deepEqual(
          [await hashVivo(F2), await hashVivo(F3)],
          antes,
          "a recusa nao pode escrever",
        );
      } finally {
        await C.query("ROLLBACK");
      }
    };
    const editaCorpo = (indice) => {
      const p = ROLLBACK_SO_CORPOS.split("$function$");
      p[indice] = p[indice].replace(
        "-- 1. Update Review",
        "-- 1. Update Review (editado na loja)",
      );
      return p.join("$function$");
    };
    // corpo divergente na de 2 args e, separado, na de 3 args
    await recusa(
      () => C.query(editaCorpo(1)),
      /B1_BASELINE_DIVERGENT: corpo vivo de public\.reply_review_atomic\(uuid,text\) \(hash [0-9a-f]{32}\)/,
    );
    await recusa(
      () => C.query(editaCorpo(3)),
      /B1_BASELINE_DIVERGENT: corpo vivo de public\.reply_review_atomic\(uuid,text,uuid\)/,
    );
    // sobrecarga extra
    await recusa(
      () =>
        C.query(
          "CREATE FUNCTION public.reply_review_atomic(p_a uuid) RETURNS void LANGUAGE sql AS 'SELECT 1'",
        ),
      /sobrecargas conhecidas/,
    );
    // atributo trocado (SECURITY INVOKER)
    await recusa(
      () =>
        C.query(
          "ALTER FUNCTION public.reply_review_atomic(uuid,text) SECURITY INVOKER",
        ),
      /B1_BASELINE_DIVERGENT: atributos de public\.reply_review_atomic\(uuid,text\)/,
    );
    // a guarda de admin que o corpo chama nao existe
    await recusa(
      () =>
        C.query(
          "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_sumiu",
        ),
      /is_admin_atual\(\) não existe/,
    );
    // coluna que o corpo grava nao existe
    await recusa(
      () =>
        C.query(
          "ALTER TABLE public.notificacoes RENAME COLUMN dados TO dados_x",
        ),
      /colunas que o corpo lê ou grava não existem: notificacoes\.dados\b/,
    );
  },
);

prova(
  "(6) o PRE-VOO do rollback recusa SEM escrever (corpo alheio em qualquer das duas, sobrecarga extra ou ausente) e a CONFERENCIA FINAL recusa corpo que nao voltou; o corpo desta migration e o de antes passam",
  async () => {
    const editaCorpo = (indice) => {
      const p = FUNCOES_SQL.split("$function$");
      p[indice] = p[indice].replace(
        "-- 1. Update Review",
        "-- 1. Update Review (editado na loja)",
      );
      return p.join("$function$");
    };
    const recusa = async (preparar, esperado) => {
      await C.query("BEGIN");
      try {
        await C.query(MIGRATION); // parte do estado desta migration
        await preparar();
        const antes = [await hashVivo(F2), await hashVivo(F3)];
        await C.query("SAVEPOINT desfazer");
        let erro;
        try {
          await C.query(ROLLBACK);
        } catch (e) {
          erro = e;
        }
        assert.ok(erro, "o rollback devia recusar");
        assert.match(erro.message, esperado);
        await C.query("ROLLBACK TO SAVEPOINT desfazer");
        assert.deepEqual(
          [await hashVivo(F2), await hashVivo(F3)],
          antes,
          "a recusa nao pode escrever",
        );
      } finally {
        await C.query("ROLLBACK");
      }
    };
    // alguem trocou o corpo da de 2 args DEPOIS da migration
    await recusa(
      () => C.query(editaCorpo(1)),
      /^B1_BASELINE_DIVERGENT: corpo vivo de public\.reply_review_atomic\(uuid,text\) \(hash [0-9a-f]{32}\) não é o desta migration nem o de antes/,
    );
    // ... ou o da de 3 args (a de 2 passa, a de 3 e' a que recusa)
    await recusa(
      () => C.query(editaCorpo(3)),
      /^B1_BASELINE_DIVERGENT: corpo vivo de public\.reply_review_atomic\(uuid,text,uuid\)/,
    );
    // sobrecarga extra e sobrecarga ausente: nao sao as duas assinaturas esperadas
    await recusa(
      () =>
        C.query(
          "CREATE FUNCTION public.reply_review_atomic(p_a uuid) RETURNS void LANGUAGE sql AS 'SELECT 1'",
        ),
      /^B1_BASELINE_DIVERGENT: reply_review_atomic não tem exatamente as duas assinaturas/,
    );
    await recusa(
      () => C.query("DROP FUNCTION public.reply_review_atomic(uuid,text,uuid)"),
      /^B1_BASELINE_DIVERGENT: reply_review_atomic não tem exatamente as duas assinaturas/,
    );

    // passa nos dois estados conhecidos: o desta migration (desfaz) e o de antes (idempotente), e confere o resultado
    await C.query("BEGIN");
    try {
      await C.query(MIGRATION);
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(F2), H_ANTES[F2]);
      assert.equal(await hashVivo(F3), H_ANTES[F3]);
      await C.query(ROLLBACK); // ja desfeito: reescreve o mesmo texto
      assert.equal(await hashVivo(F2), H_ANTES[F2]);
      assert.equal(await hashVivo(F3), H_ANTES[F3]);
      // so uma das duas no estado de antes e a outra no desta migration tambem passa
      await C.query(MIGRATION);
      await C.query(
        `${ROLLBACK_SO_CORPOS.split("$function$").slice(0, 2).join("$function$")}$function$;`,
      ); // so a de 2 args volta
      assert.equal(await hashVivo(F2), H_ANTES[F2]);
      assert.equal(await hashVivo(F3), H_DEPOIS[F3]);
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(F3), H_ANTES[F3]);
    } finally {
      await C.query("ROLLBACK");
    }

    // CONFERENCIA FINAL: um rollback adulterado (corpo de antes com 1 byte a mais) cria o corpo errado e a conferencia recusa
    await C.query("BEGIN");
    try {
      await C.query(MIGRATION);
      let erro;
      try {
        await C.query(
          ROLLBACK.replace(
            "-- 1. Update Review",
            "-- 1. Update Review (adulterado)",
          ),
        );
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a conferencia final devia recusar");
      assert.match(
        erro.message,
        /^conferencia rollback 20261399400: corpo vivo de public\.reply_review_atomic\(uuid,text\) \(hash [0-9a-f]{32}\) não voltou ao de antes/,
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

prova(
  "(6) a CONFERENCIA FINAL da migration recusa se o corpo que ficou nao e o dela (migration adulterada)",
  async () => {
    await C.query("BEGIN");
    try {
      await C.query(ROLLBACK);
      let erro;
      try {
        await C.query(
          MIGRATION.replace(
            "-- 1. Update Review",
            "-- 1. Update Review (adulterado)",
          ),
        );
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o pos-voo devia recusar");
      assert.match(
        erro.message,
        /^POSVOO_20261399400: o corpo de public\.reply_review_atomic\(uuid,text\)/,
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

// ---- (7) MUTANTES ---------------------------------------------------------------------------------------------
const MUTANTES = [
  {
    nome: "sem o NOT EXISTS (resposta repetida duplica o aviso)",
    muda: (s) =>
      s.replace(
        /\n\s+AND NOT EXISTS \(SELECT 1 FROM (?:public\.)?notificacoes n[\s\S]*?p_review_id::text\);/g,
        ";",
      ),
    cenario: cenarioPrincipal,
    esperado: /nao duplica o aviso/,
  },
  {
    nome: "o NOT EXISTS ignora qual avaliacao (a segunda avaliacao da mesma cliente nao e avisada)",
    muda: (s) =>
      s.replaceAll(
        "AND n.dados ->> 'review_id' = p_review_id::text);",
        "AND true);",
      ),
    cenario: cenarioPrincipal,
    esperado: /outra avaliacao da mesma cliente tem o seu aviso/,
  },
  {
    nome: "o NOT EXISTS olha a chave errada (question_id): a repeticao duplica",
    muda: (s) =>
      s.replaceAll("n.dados ->> 'review_id'", "n.dados ->> 'question_id'"),
    cenario: cenarioPrincipal,
    esperado: /nao duplica o aviso/,
  },
  {
    nome: "aviso para a lojista em vez de para a cliente",
    muda: (s) =>
      s.replaceAll("SELECT v_user_id, 'info'", "SELECT auth.uid(), 'info'"),
    cenario: cenarioPrincipal,
    esperado: /o aviso e' da cliente que avaliou/,
  },
  {
    nome: "deixa de gravar a linha do log de push (a consulta 27m perderia o rastro)",
    muda: (s) =>
      s.replace(
        /\n\s+INSERT INTO (?:public\.)?push_notifications_log[\s\S]*?\n {8}\);\n/g,
        "\n",
      ),
    cenario: cenarioPrincipal,
    esperado: /a linha do log de push continua sendo gravada/,
  },
  {
    nome: "destino errado (nao abre o produto)",
    muda: (s) => s.replaceAll("'/product-detail?id='", "'/product/'"),
    cenario: cenarioPrincipal,
    esperado: /o aviso abre o produto/,
  },
  {
    nome: "sem o tratamento de falha (o aviso que falha derruba a resposta)",
    muda: (s) =>
      s.replaceAll(
        "EXCEPTION WHEN OTHERS THEN",
        "EXCEPTION WHEN no_data_found THEN",
      ),
    cenario: () => cenarioBestEffort(recusaPorCheck),
    esperado: /a falha do aviso derrubou a resposta da loja/,
  },
];
for (const m of MUTANTES) {
  prova(`(7) MUTANTE fica vermelho: ${m.nome}`, async () => {
    const mutado = m.muda(FUNCOES_SQL);
    assert.notEqual(mutado, FUNCOES_SQL, "o mutante nao mudou o texto");
    await C.query("BEGIN");
    try {
      await C.query(ROLLBACK);
      await C.query(mutado);
      assert.notEqual(
        await hashVivo(F2),
        H_DEPOIS[F2],
        "o mutante nao entrou (mesmo corpo da migration)",
      );
      // reprova PELO MOTIVO certo (a mensagem da guarda que o mutante tirou), nao por erro de SQL qualquer
      await assert.rejects(() => m.cenario(), m.esperado);
    } finally {
      await C.query("ROLLBACK");
    }
  });
}

// O mutante da corrida precisa estar COMMITADO (as outras conexoes nao enxergam transacao alheia).
prova(
  "(7) MUTANTE fica vermelho: sem o NOT EXISTS, a corrida das duas lojistas duplica o aviso",
  async () => {
    const mutado = MUTANTES[0].muda(FUNCOES_SQL);
    assert.notEqual(mutado, FUNCOES_SQL, "o mutante nao mudou o texto");
    await C.query(mutado);
    try {
      assert.notEqual(await hashVivo(F2), H_DEPOIS[F2], "o mutante nao entrou");
      await assert.rejects(
        () => cenarioCorrida(),
        /a corrida gerou aviso em dobro/,
      );
    } finally {
      // o corpo mutante e' desconhecido para o pre-voo: volta ao vigente (rollback) e reaplica a migration
      await C.query(ROLLBACK_SO_CORPOS);
      await C.query(MIGRATION);
      assert.equal(await hashVivo(F2), H_DEPOIS[F2], "a migration nao voltou");
    }
  },
);

// ---- (8) FICHAS 120a/120b e 82a -------------------------------------------------------------------------------
/** Roda a ficha como `authenticated` (numa subtransacao desfeita) e devolve as linhas. */
async function rodarFicha(sql, stem, linhasEsperadas) {
  await C.query("SAVEPOINT ficha");
  let rows;
  try {
    await C.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await C.query("SET LOCAL ROLE authenticated");
    rows = (await C.query(sql)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
    await C.query("ROLLBACK TO SAVEPOINT ficha");
    await C.query("RELEASE SAVEPOINT ficha");
  }
  assert.equal(
    rows.length,
    linhasEsperadas,
    `${stem}: rol fechado de ${linhasEsperadas}`,
  );
  assert.equal(new Set(rows.map((r) => r.item)).size, linhasEsperadas);
  assert.match(
    CONF.veredictoDaConsulta({
      consulta: stem,
      ref: "efemero",
      sha: "local",
      linhas: rows,
    }),
    /rol=ok/,
    `${stem}: o rol fechado do conferir-banco nao bate com a ficha`,
  );
  for (const incompleta of [rows.slice(1), [...rows, rows[0]]])
    assert.match(
      CONF.veredictoDaConsulta({
        consulta: stem,
        ref: "efemero",
        sha: "local",
        linhas: incompleta,
      }),
      /rol=invalido/,
    );
  return rows;
}
const reprovadas = (rows) =>
  rows
    .filter((r) => !r.ok)
    .map((r) => r.item)
    .sort();
const LINHAS_DE_CORPO = [
  "reply_review_atomic(uuid,text): corpo exato (md5)",
  "reply_review_atomic(uuid,text,uuid): corpo exato (md5)",
];

prova(
  "(8) 120a/120b: no DEPOIS a 120a e positiva e a 120b reprova SO os dois corpos; no ANTES o contrario; cada estrago reprova a linha certa",
  async () => {
    await emTransacao(async () => {
      assert.deepEqual(reprovadas(await rodarFicha(FICHA_A, STEM_A, 8)), []);
      assert.deepEqual(
        reprovadas(await rodarFicha(FICHA_B, STEM_B, 8)),
        [...LINHAS_DE_CORPO].sort(),
      );
    });
    await emTransacao(
      async () => {
        assert.deepEqual(reprovadas(await rodarFicha(FICHA_B, STEM_B, 8)), []);
        assert.deepEqual(
          reprovadas(await rodarFicha(FICHA_A, STEM_A, 8)),
          [...LINHAS_DE_CORPO].sort(),
        );
      },
      { antes: true },
    );
    // um estrago por vez, sobre o DEPOIS: so a linha esperada reprova na 120a
    const estragos = [
      {
        sql: "GRANT EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text,uuid) TO PUBLIC",
        linhas: [
          "reply_review_atomic(uuid,text,uuid): EXECUTE authenticated, sem PUBLIC ou anon",
        ],
      },
      {
        sql: "GRANT EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text) TO anon",
        linhas: [
          "reply_review_atomic(uuid,text): EXECUTE authenticated, sem PUBLIC ou anon",
        ],
      },
      {
        sql: "ALTER FUNCTION public.reply_review_atomic(uuid,text) SECURITY INVOKER",
        linhas: [
          "reply_review_atomic(uuid,text): assinatura e atributos conhecidos",
        ],
      },
      {
        sql: "ALTER FUNCTION public.reply_review_atomic(uuid,text,uuid) SET search_path = public, extensions",
        linhas: [
          "reply_review_atomic(uuid,text,uuid): assinatura e atributos conhecidos",
        ],
      },
      {
        sql: "CREATE FUNCTION public.reply_review_atomic(p_a uuid) RETURNS void LANGUAGE sql AS 'SELECT 1'",
        linhas: ["reply_review_atomic: exatamente duas sobrecargas"],
      },
      {
        sql: `CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
               RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
               AS $f$ BEGIN RAISE EXCEPTION 'corpo alheio'; END $f$`,
        linhas: ["reply_review_atomic(uuid,text): corpo exato (md5)"],
      },
      {
        sql: "DROP FUNCTION public.reply_review_atomic(uuid,text,uuid)",
        linhas: [
          "reply_review_atomic: exatamente duas sobrecargas",
          "reply_review_atomic(uuid,text,uuid): corpo exato (md5)",
          "reply_review_atomic(uuid,text,uuid): assinatura e atributos conhecidos",
          "reply_review_atomic(uuid,text,uuid): EXECUTE authenticated, sem PUBLIC ou anon",
        ],
      },
    ];
    for (const e of estragos)
      await emTransacao(async () => {
        await C.query(e.sql);
        assert.deepEqual(
          reprovadas(await rodarFicha(FICHA_A, STEM_A, 8)),
          [...e.linhas].sort(),
          e.sql,
        );
      });
  },
);

prova(
  "(8) 82a: aceita o corpo desta migration como sucessor da 20261360000000 (36 de 36) e continua reprovando qualquer outro corpo",
  async () => {
    // 1360 vigente (ANTES desta) e 1360 + esta (DEPOIS): as duas positivas
    await emTransacao(async () => {
      assert.deepEqual(
        reprovadas(await rodarFicha(FICHA_82A, STEM_82A, 36)),
        [],
      );
    });
    await emTransacao(
      async () => {
        assert.deepEqual(
          reprovadas(await rodarFicha(FICHA_82A, STEM_82A, 36)),
          [],
        );
      },
      { antes: true },
    );
    // corpo alheio em cada sobrecarga: so a linha dela reprova
    for (const [indice, linha] of [
      [1, "RPC: public.reply_review_atomic(uuid,text)"],
      [3, "RPC: public.reply_review_atomic(uuid,text,uuid)"],
    ])
      await emTransacao(async () => {
        const p = FUNCOES_SQL.split("$function$");
        p[indice] = p[indice].replace(
          "-- 1. Update Review",
          "-- 1. Update Review (alheio)",
        );
        await C.query(p.join("$function$"));
        assert.deepEqual(
          reprovadas(await rodarFicha(FICHA_82A, STEM_82A, 36)),
          [linha],
        );
      });
  },
);

// ---- (9) ENSAIO NO BANCO REAL ---------------------------------------------------------------------------------
const ENSAIO = `
DO $ensaio$
DECLARE
  v_admin uuid := '7e7e3994-0000-4000-8000-0000000000e1';
  v_cli   uuid := '7e7e3994-0000-4000-8000-0000000000e2';
  v_prod  uuid := '7e7e3994-0000-4000-8000-0000000000e3';
  v_rev   uuid := '7e7e3994-0000-4000-8000-0000000000e4';
  v_av int; v_av_outros int; v_log0 int; v_log1 int; v_msg text; v_url text;
BEGIN
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    (v_admin, 'ensaio-admin@120.teste', '{"role":"admin"}'), (v_cli, 'ensaio-cli@120.teste', '{}');
  INSERT INTO public.profiles (id, full_name, role) VALUES (v_admin, 'Ensaio Admin', 'admin'), (v_cli, 'Ensaio Cliente', 'customer');
  INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES (v_prod, 'Produto Ensaio', 10, 1, true, 1);
  INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES (v_rev, v_prod, v_cli, 2, 'Veio com defeito.', 'publicada');
  SELECT count(*) INTO v_log0 FROM public.push_notifications_log;

  PERFORM set_config('app.rpc.user_id', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.reply_review_atomic(v_rev, 'Vamos trocar!');
  PERFORM public.reply_review_atomic(v_rev, 'Vamos trocar, sem custo.');

  SELECT count(*) INTO v_av FROM public.notificacoes WHERE usuario_id = v_cli AND dados ->> 'review_id' = v_rev::text;
  SELECT count(*) INTO v_av_outros FROM public.notificacoes WHERE dados ->> 'review_id' = v_rev::text AND usuario_id IS DISTINCT FROM v_cli;
  SELECT count(*) INTO v_log1 FROM public.push_notifications_log;
  SELECT mensagem, acao ->> 'url' INTO v_msg, v_url FROM public.notificacoes WHERE usuario_id = v_cli AND dados ->> 'review_id' = v_rev::text;

  IF v_av <> 1 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: esperava 1 aviso para a cliente, achei %', v_av; END IF;
  IF v_av_outros <> 0 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: aviso para quem nao avaliou: %', v_av_outros; END IF;
  IF v_log1 <> v_log0 + 2 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: o log de push devia ganhar 2 linhas (% -> %)', v_log0, v_log1; END IF;
  IF v_msg <> 'A loja respondeu sua avaliação sobre Produto Ensaio.' THEN RAISE EXCEPTION 'ENSAIO_FALHOU: mensagem inesperada: %', v_msg; END IF;
  IF v_url <> '/product-detail?id=' || v_prod THEN RAISE EXCEPTION 'ENSAIO_FALHOU: destino inesperado: %', v_url; END IF;

  RAISE EXCEPTION 'ENSAIO_OK avisos_da_cliente=% avisos_de_outros=% linhas_novas_no_log=%', v_av, v_av_outros, v_log1 - v_log0;
END
$ensaio$;
`;
prova(
  "(9) ENSAIO: o mesmo cenario num unico bloco DO que termina em RAISE EXCEPTION (nada fica gravado)",
  async () => {
    await C.query("BEGIN");
    try {
      await C.query(MIGRATION);
      const antes = await totais();
      await C.query("SAVEPOINT ensaio");
      let erro;
      try {
        await C.query(ENSAIO);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o ensaio devia terminar em RAISE EXCEPTION");
      assert.match(
        erro.message,
        /^ENSAIO_OK avisos_da_cliente=1 avisos_de_outros=0 linhas_novas_no_log=2$/,
        erro.message,
      );
      await C.query("ROLLBACK TO SAVEPOINT ensaio");
      assert.deepEqual(await totais(), antes, "o ensaio nao deixou resto");
      assert.equal(
        await contar(
          "SELECT count(*) AS n FROM auth.users WHERE id = '7e7e3994-0000-4000-8000-0000000000e1'",
        ),
        0,
        "o ensaio nao deixou usuario",
      );
      // o MESMO ensaio no corpo de ANTES tem de falhar (controle)
      await C.query(ROLLBACK);
      await C.query("SAVEPOINT ensaio2");
      let erro2;
      try {
        await C.query(ENSAIO);
      } catch (e) {
        erro2 = e;
      }
      assert.ok(erro2);
      assert.match(erro2.message, /^ENSAIO_FALHOU: esperava 1 aviso/);
      await C.query("ROLLBACK TO SAVEPOINT ensaio2");
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  let falhas = 0;
  try {
    assert.ok(
      (
        await C.query(
          "SELECT to_regprocedure('public.reply_review_atomic(uuid,text)') IS NOT NULL AS x",
        )
      ).rows[0].x,
      "a arvore nao tem reply_review_atomic",
    );
    // a arvore sai das migrations do zero: ja tem esta migration (o clone parte do estado DEPOIS)
    await C.query(MIGRATION);
    await semear();
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`ok   ${nome}`);
      } catch (e) {
        falhas += 1;
        console.log(
          `FALHOU ${nome}\n     ${String(e.stack || e)
            .split("\n")
            .slice(0, 6)
            .join("\n     ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await limpar();
    // devolve a arvore ao estado em que a encontrou: migration aplicada
    await C.query(MIGRATION).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\n${PROVAS.length - falhas}/${PROVAS.length} provas passaram.`);
  if (falhas) falhar("REPROVADO", `${falhas} prova(s) falharam`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
