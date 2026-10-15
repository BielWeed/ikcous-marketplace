"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

/**
 * PROVA VIVA da migration 20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql
 * (public.answer_question_atomic, as DUAS sobrecargas) contra o Postgres EFEMERO com as migrations aplicadas
 * do zero (rpc-ci). O defeito: a loja responde a pergunta, a tela promete "Notificar Cliente", mas a cliente
 * nunca e avisada (zero linhas em `notificacoes`) e a RPC grava uma linha FALSA em push_notifications_log.
 *
 *   (0) CONTROLE: o corpo de antes (o rollback-manual aplicado numa transacao desfeita) reproduz o defeito:
 *       resposta gravada, nenhum aviso para a cliente, uma linha falsa no log de push.
 *   (1) DEPOIS: a loja responde e nasce UM aviso no sino da cliente que perguntou (e so dela): tipo, titulo,
 *       mensagem com o nome do produto, destino que abre o produto, nao lido; nenhuma linha no log de push; o
 *       sino da outra cliente continua vazio. Nas duas sobrecargas.
 *   (2) UM aviso por pergunta: resposta repetida e resposta EDITADA nao duplicam; outra pergunta da mesma
 *       cliente tem o seu aviso; dispensado o aviso, a edicao da resposta avisa de novo (decisao declarada);
 *       pergunta respondida ANTES da migration nao ganha aviso em massa, so se a loja editar a resposta.
 *   (3) PERMISSAO: quem nao e admin e recusado sem escrever nada; o visitante (anon) nao executa; a ACL, o
 *       dono, SECURITY DEFINER e o search_path das duas sobrecargas sao iguais antes e depois.
 *   (4) o aviso e best-effort: se o INSERT do aviso falhar, a RESPOSTA da loja e gravada mesmo assim.
 *   (5) CORRIDA: duas lojistas respondendo a MESMA pergunta ao mesmo tempo (duas conexoes reais) geram um aviso.
 *   (6) a MIGRATION: so o corpo das duas funcoes muda (nenhuma outra funcao, ACL de tabela ou dado); aplicar
 *       2x e em CRLF = mesmo estado; o rollback devolve o corpo de antes BYTE A BYTE; o pre-voo recusa sem
 *       escrever (corpo divergente, sobrecarga extra, indice unico ausente).
 *   (7) MUTANTES: cada guarda tirada do corpo novo deixa a prova vermelha.
 *   (8) ENSAIO NO BANCO REAL: o mesmo cenario, em um unico bloco DO que termina em RAISE EXCEPTION (nada
 *       fica gravado), reaproveitavel numa loja real.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/pergunta-respondida-avisa-viva.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ =
  "20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const F2 = "public.answer_question_atomic(uuid,text)";
const F3 = "public.answer_question_atomic(uuid,text,uuid)";
// Os corpos de ANTES, escritos por extenso: o teste NUNCA os le do arquivo da migration (um erro de
// digitacao na migration passaria pela prova). Sao os hashes medidos nas duas lojas em 14/10/2026.
const H_ANTES = {
  [F2]: "8cf000b6c9ed27f482906752469f08ff",
  [F3]: "ad99d54575ac95445103ea5b78e4a1e8",
};
const H_DEPOIS = {
  [F2]: "1268df6cb364dfb46b5c535e007bb2d0",
  [F3]: "b62a4186ff8d58955973f53d6c0f302b",
};

/** Os dois CREATE OR REPLACE da migration, sem o pre-voo nem a conferencia final (para os mutantes). */
const FUNCOES_SQL = MIGRATION.slice(
  MIGRATION.indexOf("CREATE OR REPLACE FUNCTION"),
  MIGRATION.indexOf("-- CONFERÊNCIA FINAL"),
);

/**
 * Os dois CREATE OR REPLACE do rollback, SEM o pre-voo nem a conferencia final: monta o corpo de antes por cima de um
 * corpo DESCONHECIDO (mutante, corpo alheio), que o pre-voo do rollback recusaria de proposito.
 */
const ROLLBACK_SO_CORPOS = ROLLBACK.slice(
  ROLLBACK.indexOf("CREATE OR REPLACE FUNCTION"),
  ROLLBACK.indexOf("-- CONFERÊNCIA FINAL"),
);

const U = {
  admin: "7e7e2400-0000-4000-8000-0000000000a1",
  admin2: "7e7e2400-0000-4000-8000-0000000000a2",
  cliente: "7e7e2400-0000-4000-8000-0000000000c1",
  outra: "7e7e2400-0000-4000-8000-0000000000c2",
};
const PROD = "7e7e2400-0000-4000-8000-0000000000f1";
const PROD2 = "7e7e2400-0000-4000-8000-0000000000f2";
const Q = {
  q1: "7e7e2400-0000-4000-8000-0000000000b1", // cliente -> PROD
  q2: "7e7e2400-0000-4000-8000-0000000000b2", // outra -> PROD
  q3: "7e7e2400-0000-4000-8000-0000000000b3", // cliente -> PROD2
  q4: "7e7e2400-0000-4000-8000-0000000000b4", // cliente -> PROD (ja respondida ANTES da migration)
};
const NOME_PROD = "Camiseta Azul 40";
const NOME_PROD2 = "Calça Preta 42";
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
const responder = (qid, texto, { tres = false, uid = U.admin } = {}) =>
  tentar(
    "authenticated",
    tres
      ? "SELECT public.answer_question_atomic($1::uuid, $2::text, $3::uuid)"
      : "SELECT public.answer_question_atomic($1::uuid, $2::text)",
    tres ? [qid, texto, uid] : [qid, texto],
    { uid, claims: JWT_ADMIN },
  );

const contar = async (sql, params = []) =>
  Number((await C.query(sql, params)).rows[0].n);
const totais = async () => ({
  respostas: await contar("SELECT count(*) AS n FROM public.answers"),
  avisos: await contar("SELECT count(*) AS n FROM public.notificacoes"),
  log: await contar("SELECT count(*) AS n FROM public.push_notifications_log"),
});
/** Os avisos de uma pergunta, lidos como dono (por cima da RLS). */
const avisosDa = async (qid) =>
  (
    await C.query(
      `SELECT usuario_id::text AS usuario_id, tipo, titulo, mensagem, dados, acao, lida
         FROM public.notificacoes WHERE dados ->> 'question_id' = $1 ORDER BY created_at, id`,
      [qid],
    )
  ).rows;

/** Pessoas, produtos e perguntas (commitado: o clone e descartavel; o finally limpa). */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@40.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 40', 'admin'), ($2, 'Admin Dois 40', 'admin'),
       ($3, 'Cliente 40', 'customer'), ($4, 'Outra 40', 'customer')`,
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
    `INSERT INTO public.questions (id, product_id, user_id, question) VALUES
       ($1, $2, $3, 'Tem no M?'), ($4, $2, $5, 'Serve no G?'),
       ($6, $7, $3, 'Tem na cor preta?'), ($8, $2, $3, 'Lava na maquina?')`,
    [Q.q1, PROD, U.cliente, Q.q2, U.outra, Q.q3, PROD2, Q.q4],
  );
  // A pergunta 4 foi respondida ANTES da migration: resposta gravada direto, sem aviso nenhum.
  await C.query(
    "INSERT INTO public.answers (question_id, user_id, answer) VALUES ($1, $2, 'Lava sim, a 30 graus.')",
    [Q.q4, U.admin],
  );
}

async function limpar() {
  const qs = Object.values(Q);
  await C.query(
    "DELETE FROM public.notificacoes WHERE dados ->> 'question_id' = ANY($1::text[])",
    [qs],
  ).catch(() => {});
  await C.query(
    "DELETE FROM public.answers WHERE question_id = ANY($1::uuid[])",
    [qs],
  ).catch(() => {});
  await C.query("DELETE FROM public.questions WHERE id = ANY($1::uuid[])", [
    qs,
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

  // (1) 2 args: nasce UM aviso, so para a cliente que perguntou
  const r = await responder(Q.q1, "Tem sim, em estoque!");
  assert.ok(r.linhas, `a loja foi recusada: ${r.erro}`);
  let avisos = await avisosDa(Q.q1);
  assert.equal(avisos.length, 1, "esperava UM aviso para a pergunta 1");
  const a = avisos[0];
  assert.equal(a.usuario_id, U.cliente, "o aviso e' da cliente que perguntou");
  assert.equal(a.tipo, "info");
  assert.equal(a.titulo, "Sua pergunta foi respondida");
  assert.equal(a.mensagem, `A loja respondeu sua pergunta sobre ${NOME_PROD}.`);
  assert.deepEqual(a.dados, { question_id: Q.q1, product_id: PROD });
  assert.deepEqual(
    a.acao,
    { url: `/product-detail?id=${PROD}` },
    "o aviso abre o produto",
  );
  assert.equal(a.lida, false);
  const depois = await totais();
  assert.equal(depois.respostas, antes.respostas + 1, "a resposta e' gravada");
  assert.equal(depois.avisos, antes.avisos + 1, "nasce exatamente 1 aviso");
  assert.equal(
    depois.log,
    antes.log,
    "nenhuma linha FALSA no log de push de campanhas",
  );

  // o sino e' so dela: a RLS mostra a linha para a dona e esconde da outra cliente
  const dela = await como(
    "authenticated",
    "SELECT count(*)::int AS n FROM public.notificacoes WHERE dados ->> 'question_id' = $1",
    [Q.q1],
    { uid: U.cliente, claims: JWT_CLIENTE },
  );
  assert.equal(dela[0].n, 1, "a dona ve o aviso no proprio sino");
  const alheia = await como(
    "authenticated",
    "SELECT count(*)::int AS n FROM public.notificacoes WHERE dados ->> 'question_id' = $1",
    [Q.q1],
    { uid: U.outra, claims: JWT_CLIENTE },
  );
  assert.equal(alheia[0].n, 0, "a outra cliente NAO ve o aviso da dona");

  // (1b) 3 args: mesmo comportamento, para a cliente da pergunta 2
  const r3 = await responder(Q.q2, "Serve sim.", { tres: true });
  assert.ok(r3.linhas, `a sobrecarga de 3 args foi recusada: ${r3.erro}`);
  avisos = await avisosDa(Q.q2);
  assert.equal(avisos.length, 1, "3 args: esperava UM aviso");
  assert.equal(avisos[0].usuario_id, U.outra, "3 args: aviso da outra cliente");
  assert.equal(
    avisos[0].mensagem,
    `A loja respondeu sua pergunta sobre ${NOME_PROD}.`,
  );
  assert.deepEqual(avisos[0].acao, { url: `/product-detail?id=${PROD}` });
  assert.equal((await totais()).log, antes.log, "3 args: log de push intacto");

  // (2) UM aviso por pergunta: repetir e EDITAR a resposta nao duplica
  for (const texto of [
    "Tem sim, em estoque!",
    "Corrigindo: so no tamanho G.",
  ]) {
    const rr = await responder(Q.q1, texto);
    assert.ok(rr.linhas, `reenvio recusado: ${rr.erro}`);
  }
  const rr3 = await responder(Q.q1, "De novo pela de 3 args.", { tres: true });
  assert.ok(rr3.linhas, `reenvio (3 args) recusado: ${rr3.erro}`);
  assert.equal(
    (await avisosDa(Q.q1)).length,
    1,
    "repetir e editar a resposta (2 e 3 args) nao duplica o aviso",
  );
  const respostas = await C.query(
    "SELECT answer FROM public.answers WHERE question_id = $1",
    [Q.q1],
  );
  assert.equal(respostas.rowCount, 1, "continua uma resposta por pergunta");
  assert.equal(respostas.rows[0].answer, "De novo pela de 3 args.");

  // outra pergunta da MESMA cliente tem o seu proprio aviso, com o nome do outro produto
  const r2 = await responder(Q.q3, "Tem sim, em preto.");
  assert.ok(r2.linhas);
  const av3 = await avisosDa(Q.q3);
  assert.equal(av3.length, 1);
  assert.equal(av3[0].usuario_id, U.cliente);
  assert.equal(
    av3[0].mensagem,
    `A loja respondeu sua pergunta sobre ${NOME_PROD2}.`,
  );
  assert.deepEqual(av3[0].acao, { url: `/product-detail?id=${PROD2}` });
  assert.equal(
    await contar(
      "SELECT count(*) AS n FROM public.notificacoes WHERE usuario_id = $1",
      [U.cliente],
    ),
    2,
    "a cliente tem os 2 avisos das 2 perguntas dela",
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
  "(0) CONTROLE: o corpo de ANTES reproduz o defeito (resposta gravada, cliente no escuro, linha falsa no log)",
  () =>
    emTransacao(
      async () => {
        for (const tres of [false, true]) {
          const antes = await totais();
          const q = tres ? Q.q2 : Q.q1;
          const r = await responder(q, "Tem sim!", { tres });
          assert.ok(r.linhas, `controle recusado: ${r.erro}`);
          const depois = await totais();
          assert.equal(depois.respostas, antes.respostas + 1);
          assert.equal(
            depois.avisos,
            antes.avisos,
            `ANTES${tres ? " (3 args)" : ""}: a cliente nao ganha aviso nenhum`,
          );
          assert.equal(
            depois.log,
            antes.log + 1,
            `ANTES${tres ? " (3 args)" : ""}: nasce a linha falsa no log de push`,
          );
        }
        const falsa = await C.query(
          "SELECT title, recipient_count, status FROM public.push_notifications_log WHERE title = 'Sua pergunta foi respondida!' ORDER BY sent_at DESC LIMIT 1",
        );
        assert.equal(falsa.rows[0].recipient_count, 0);
        assert.equal(falsa.rows[0].status, "sent");
      },
      { antes: true },
    ),
);

// ---- (1) e (2) DEPOIS -----------------------------------------------------------------------------------------
prova(
  "(1)(2) DEPOIS: aviso so para quem perguntou (2 e 3 args), nenhum log falso, repetir/editar nao duplica",
  () => emTransacao(cenarioPrincipal),
);

prova(
  "(2) dispensado o aviso, editar a resposta avisa de novo; pergunta antiga so ganha aviso se a loja editar",
  () =>
    emTransacao(async () => {
      assert.ok((await responder(Q.q1, "Tem sim!")).linhas);
      assert.equal((await avisosDa(Q.q1)).length, 1);
      // a cliente dispensa o aviso (o sino dela deixa apagar o proprio aviso)
      const del = await como(
        "authenticated",
        "DELETE FROM public.notificacoes WHERE dados ->> 'question_id' = $1 RETURNING id",
        [Q.q1],
        { uid: U.cliente, claims: JWT_CLIENTE },
      );
      assert.equal(del.length, 1);
      assert.equal((await avisosDa(Q.q1)).length, 0);
      assert.ok((await responder(Q.q1, "Corrigindo: so no G.")).linhas);
      assert.equal(
        (await avisosDa(Q.q1)).length,
        1,
        "a correcao da resposta avisa a cliente de novo",
      );

      // a pergunta 4 foi respondida antes da migration: aplicar a migration nao criou aviso nenhum...
      assert.equal(
        (await avisosDa(Q.q4)).length,
        0,
        "nada em massa: a pergunta antiga segue sem aviso",
      );
      // ... e so uma edicao da loja faz nascer o aviso que ela nunca recebeu
      assert.ok((await responder(Q.q4, "Lava sim, a 30 graus.")).linhas);
      const av = await avisosDa(Q.q4);
      assert.equal(av.length, 1);
      assert.equal(av[0].usuario_id, U.cliente);
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
                  pg_get_function_result(p.oid) AS retorno
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'answer_question_atomic' ORDER BY 1`,
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
        "ACL, dono, SECURITY DEFINER, search_path e retorno iguais antes e depois",
      );
      assert.equal(retratoAntes.length, 2);
      const antes = await totais();
      // cliente comum (nem profiles admin, nem JWT admin)
      for (const tres of [false, true]) {
        const r = await tentar(
          "authenticated",
          tres
            ? "SELECT public.answer_question_atomic($1::uuid, $2::text, $3::uuid)"
            : "SELECT public.answer_question_atomic($1::uuid, $2::text)",
          tres
            ? [Q.q1, "tomei a voz da loja", U.outra]
            : [Q.q1, "tomei a voz da loja"],
          { uid: U.outra, claims: JWT_CLIENTE },
        );
        assert.ok(
          r.erro,
          `${tres ? "3" : "2"} args: cliente comum devia ser recusada`,
        );
        assert.match(r.erro, /Unauthorized/);
      }
      // o visitante (anon) nem chega ao corpo
      for (const tres of [false, true]) {
        const r = await tentar(
          "anon",
          tres
            ? "SELECT public.answer_question_atomic($1::uuid, $2::text, $3::uuid)"
            : "SELECT public.answer_question_atomic($1::uuid, $2::text)",
          tres ? [Q.q1, "x", U.admin] : [Q.q1, "x"],
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
async function cenarioBestEffort() {
  // um CHECK novo (so nesta transacao) recusa o aviso: a RESPOSTA tem de ser gravada mesmo assim
  await C.query(
    "ALTER TABLE public.notificacoes ADD CONSTRAINT prova_recusa_aviso CHECK (titulo <> 'Sua pergunta foi respondida')",
  );
  const avisosDoBanco = [];
  const ouvinte = (n) => avisosDoBanco.push(n.message);
  C.on("notice", ouvinte);
  try {
    const antes = await totais();
    const r = await responder(Q.q1, "Tem sim!");
    assert.ok(
      r.linhas,
      `a falha do aviso derrubou a resposta da loja: ${r.erro}`,
    );
    const depois = await totais();
    assert.equal(
      depois.respostas,
      antes.respostas + 1,
      "a resposta foi gravada",
    );
    assert.equal(depois.avisos, antes.avisos, "o aviso nao nasceu");
    assert.ok(
      avisosDoBanco.some((m) => m.includes("aviso da pergunta")),
      `a falha tem de ficar logada como WARNING: ${JSON.stringify(avisosDoBanco)}`,
    );
  } finally {
    C.off("notice", ouvinte);
  }
}
prova(
  "(4) o aviso e best-effort: se ele falhar, a resposta da loja e gravada e a falha fica logada",
  () => emTransacao(cenarioBestEffort),
);

// ---- (5) CORRIDA ----------------------------------------------------------------------------------------------
prova(
  "(5) duas lojistas respondendo a MESMA pergunta ao mesmo tempo geram UM aviso (duas conexoes reais)",
  async () => {
    await C.query(MIGRATION);
    await cenarioCorrida();
  },
);

/** As funcoes vivas (commitadas) fazem o trabalho: nao roda dentro de transacao. */
async function cenarioCorrida() {
  {
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
      await c1.query(
        "SELECT public.answer_question_atomic($1::uuid, $2::text)",
        [Q.q1, "Resposta da lojista 1"],
      );
      // a segunda espera o commit da primeira (mesmo indice unico de answers)
      const segunda = c2
        .query("SELECT public.answer_question_atomic($1::uuid, $2::text)", [
          Q.q1,
          "Resposta da lojista 2",
        ])
        .then(() => "ok");
      await new Promise((r) => setTimeout(r, 400));
      await c1.query("COMMIT");
      assert.equal(await segunda, "ok");
      await c2.query("COMMIT");
      assert.equal(
        (await avisosDa(Q.q1)).length,
        1,
        "a corrida gerou aviso em dobro",
      );
      const resp = await C.query(
        "SELECT count(*)::int AS n, max(answer) AS a FROM public.answers WHERE question_id = $1",
        [Q.q1],
      );
      assert.equal(resp.rows[0].n, 1);
      assert.equal(resp.rows[0].a, "Resposta da lojista 2");
    } finally {
      await c1.query("ROLLBACK").catch(() => {});
      await c2.query("ROLLBACK").catch(() => {});
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
      await C.query(
        "DELETE FROM public.notificacoes WHERE dados ->> 'question_id' = $1",
        [Q.q1],
      );
      await C.query("DELETE FROM public.answers WHERE question_id = $1", [
        Q.q1,
      ]);
    }
  }
}

// ---- (6) A MIGRATION ------------------------------------------------------------------------------------------
/** O que a migration nao pode tocar: toda funcao de public (menos as duas), ACL de tabela, dados. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'answer_question_atomic' ORDER BY 1`,
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
         FROM pg_policy WHERE polrelid IN ('public.notificacoes'::regclass, 'public.answers'::regclass, 'public.questions'::regclass)
        ORDER BY 1, 2`,
    )
  ).rows;
  const dados = (
    await C.query(
      `SELECT (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.notificacoes x) AS notificacoes,
              (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.answers x) AS answers,
              (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.push_notifications_log x) AS log,
              (SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x.id::text), '')) FROM public.questions x) AS questions`,
    )
  ).rows[0];
  return { funcoes, tabelas, policies, dados };
}

prova(
  "(6) so o corpo das duas funcoes muda: nenhuma outra funcao, ACL de tabela, politica ou dado; aplicar 2x e CRLF = igual",
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
  "(6) o pre-voo recusa SEM escrever: corpo divergente, sobrecarga extra, indice unico ausente",
  async () => {
    const recusa = async (preparar, esperado) => {
      await C.query("BEGIN");
      try {
        await C.query(ROLLBACK); // parte do estado vigente conhecido
        await preparar();
        const antes = await hashVivo(F2);
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
        assert.equal(await hashVivo(F2), antes, "a recusa nao pode escrever");
      } finally {
        await C.query("ROLLBACK");
      }
    };
    // corpo divergente (1 byte a mais)
    await recusa(async () => {
      await C.query(
        ROLLBACK_SO_CORPOS.replace(
          "-- 2. Get Question Info",
          "-- 2. Get Question Info (editado na loja)",
        ),
      );
    }, /B1_BASELINE_DIVERGENT: corpo vivo de public\.answer_question_atomic\(uuid,text\)/);
    // sobrecarga extra
    await recusa(async () => {
      await C.query(
        `CREATE FUNCTION public.answer_question_atomic(p_a uuid) RETURNS void LANGUAGE sql AS 'SELECT 1'`,
      );
    }, /sobrecargas conhecidas/);
    // indice unico do upsert ausente
    await recusa(async () => {
      await C.query(
        `DO $$ DECLARE v text; BEGIN
           FOR v IN SELECT i.indexrelid::regclass::text FROM pg_index i
                     WHERE i.indrelid = 'public.answers'::regclass AND i.indisunique AND NOT i.indisprimary
           LOOP EXECUTE 'DROP INDEX ' || v; END LOOP; END $$`,
      );
    }, /indice unico|índice único/);
  },
);

prova(
  "(6) o PRE-VOO do rollback recusa SEM escrever (corpo alheio em qualquer das duas, sobrecarga extra ou ausente) e a CONFERENCIA FINAL recusa corpo que nao voltou; o corpo desta migration e o de antes passam",
  async () => {
    const alheioNaDeTres = () => {
      const p = ROLLBACK_SO_CORPOS.split("$function$");
      p[3] = `${p[3]}    -- editado na loja\n`;
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
    await recusa(async () => {
      await C.query(
        ROLLBACK_SO_CORPOS.replace(
          "-- 2. Get Question Info",
          "-- 2. Get Question Info (editado na loja)",
        ),
      );
    }, /^B1_BASELINE_DIVERGENT: corpo vivo de public\.answer_question_atomic\(uuid,text\) \(hash [0-9a-f]{32}\) não é o desta migration nem o de antes/);
    // ... ou o da de 3 args (a de 2 passa, a de 3 e' a que recusa)
    await recusa(async () => {
      await C.query(alheioNaDeTres());
    }, /^B1_BASELINE_DIVERGENT: corpo vivo de public\.answer_question_atomic\(uuid,text,uuid\)/);
    // sobrecarga extra e sobrecarga ausente: nao sao as duas assinaturas esperadas
    await recusa(async () => {
      await C.query(
        `CREATE FUNCTION public.answer_question_atomic(p_a uuid) RETURNS void LANGUAGE sql AS 'SELECT 1'`,
      );
    }, /^B1_BASELINE_DIVERGENT: answer_question_atomic não tem exatamente as duas assinaturas/);
    await recusa(async () => {
      await C.query(
        "DROP FUNCTION public.answer_question_atomic(uuid,text,uuid)",
      );
    }, /^B1_BASELINE_DIVERGENT: answer_question_atomic não tem exatamente as duas assinaturas/);

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
            "-- 2. Get Question Info",
            "-- 2. Get Question Info (adulterado)",
          ),
        );
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a conferencia final devia recusar");
      assert.match(
        erro.message,
        /^conferencia rollback 20261240: corpo vivo de public\.answer_question_atomic\(uuid,text\) \(hash [0-9a-f]{32}\) não voltou ao de antes/,
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
        /\n\s+AND NOT EXISTS \(SELECT 1 FROM (?:public\.)?notificacoes n[\s\S]*?p_question_id::text\);/g,
        ";",
      ),
    cenario: cenarioPrincipal,
    esperado: /nao duplica o aviso/,
  },
  {
    nome: "aviso para a lojista em vez de para a cliente",
    muda: (s) =>
      s.replaceAll("SELECT v_user_id, 'info'", "SELECT auth.uid(), 'info'"),
    cenario: cenarioPrincipal,
    esperado: /o aviso e' da cliente que perguntou/,
  },
  {
    nome: "volta a gravar a linha falsa no log de push",
    muda: (s) =>
      s.replaceAll(
        "    END IF;\nEND;\n$function$",
        "        INSERT INTO public.push_notifications_log (title, body, recipient_count) VALUES ('Sua pergunta foi respondida!', 'x', 0);\n    END IF;\nEND;\n$function$",
      ),
    cenario: cenarioPrincipal,
    esperado: /nenhuma linha FALSA no log de push/,
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
    cenario: cenarioBestEffort,
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

// ---- (8) ENSAIO NO BANCO REAL ---------------------------------------------------------------------------------
const ENSAIO = `
DO $ensaio$
DECLARE
  v_admin uuid := '7e7e2400-0000-4000-8000-0000000000e1';
  v_cli   uuid := '7e7e2400-0000-4000-8000-0000000000e2';
  v_prod  uuid := '7e7e2400-0000-4000-8000-0000000000e3';
  v_q     uuid := '7e7e2400-0000-4000-8000-0000000000e4';
  v_av int; v_av_outros int; v_log0 int; v_log1 int; v_msg text; v_url text;
BEGIN
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    (v_admin, 'ensaio-admin@40.teste', '{"role":"admin"}'), (v_cli, 'ensaio-cli@40.teste', '{}');
  INSERT INTO public.profiles (id, full_name, role) VALUES (v_admin, 'Ensaio Admin', 'admin'), (v_cli, 'Ensaio Cliente', 'customer');
  INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES (v_prod, 'Produto Ensaio', 10, 1, true, 1);
  INSERT INTO public.questions (id, product_id, user_id, question) VALUES (v_q, v_prod, v_cli, 'Tem no M?');
  SELECT count(*) INTO v_log0 FROM public.push_notifications_log;

  PERFORM set_config('app.rpc.user_id', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', true);
  PERFORM public.answer_question_atomic(v_q, 'Tem sim!');
  PERFORM public.answer_question_atomic(v_q, 'Tem sim, corrigido.');

  SELECT count(*) INTO v_av FROM public.notificacoes WHERE usuario_id = v_cli AND dados ->> 'question_id' = v_q::text;
  SELECT count(*) INTO v_av_outros FROM public.notificacoes WHERE dados ->> 'question_id' = v_q::text AND usuario_id IS DISTINCT FROM v_cli;
  SELECT count(*) INTO v_log1 FROM public.push_notifications_log;
  SELECT mensagem, acao ->> 'url' INTO v_msg, v_url FROM public.notificacoes WHERE usuario_id = v_cli AND dados ->> 'question_id' = v_q::text;

  IF v_av <> 1 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: esperava 1 aviso para a cliente, achei %', v_av; END IF;
  IF v_av_outros <> 0 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: aviso para quem nao perguntou: %', v_av_outros; END IF;
  IF v_log1 <> v_log0 THEN RAISE EXCEPTION 'ENSAIO_FALHOU: o log de push mudou (% -> %)', v_log0, v_log1; END IF;
  IF v_msg <> 'A loja respondeu sua pergunta sobre Produto Ensaio.' THEN RAISE EXCEPTION 'ENSAIO_FALHOU: mensagem inesperada: %', v_msg; END IF;
  IF v_url <> '/product-detail?id=' || v_prod THEN RAISE EXCEPTION 'ENSAIO_FALHOU: destino inesperado: %', v_url; END IF;

  RAISE EXCEPTION 'ENSAIO_OK avisos_da_cliente=% avisos_de_outros=% linhas_novas_no_log=%', v_av, v_av_outros, v_log1 - v_log0;
END
$ensaio$;
`;
prova(
  "(8) ENSAIO: o mesmo cenario num unico bloco DO que termina em RAISE EXCEPTION (nada fica gravado)",
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
        /^ENSAIO_OK avisos_da_cliente=1 avisos_de_outros=0 linhas_novas_no_log=0$/,
        erro.message,
      );
      await C.query("ROLLBACK TO SAVEPOINT ensaio");
      assert.deepEqual(await totais(), antes, "o ensaio nao deixou resto");
      assert.equal(
        await contar(
          "SELECT count(*) AS n FROM auth.users WHERE id = '7e7e2400-0000-4000-8000-0000000000e1'",
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
          "SELECT to_regprocedure('public.answer_question_atomic(uuid,text)') IS NOT NULL AS x",
        )
      ).rows[0].x,
      "a arvore nao tem answer_question_atomic",
    );
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
