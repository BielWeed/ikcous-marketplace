"use strict";

/**
 * Prova VIVA da migration 20261221000000 (a media de avaliacoes e o voto "util" fecham para o
 * visitante sem login; menor privilegio, ordem do dono de 14/10/2026), num Postgres EFEMERO local,
 * sem rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da concorrencia usa duas conexoes reais,
 * grava de verdade e desfaz com o rollback-manual). O banco e' o clone do rodar-isolado.cjs: a arvore
 * migrada. Como a arvore pode ou nao ja ter a 20261221 (em CI ela tem), TODO caso comeca pelo estado
 * ANTES, montado com o rollback-manual (um GRANT, idempotente) e conferido contra a ACL que o baseline
 * deixa (default privileges: anon, authenticated, service_role; PUBLIC revogado pela 20261090500000).
 *
 *  ANTES      as duas funcoes sao executaveis por anon, authenticated e service_role (controle: sem ele
 *             o "recusou depois" pode ser vacuo); a chamada do visitante CHEGA ao corpo (a media volta
 *             uma linha; o voto e' recusado pelo corpo com P0001 "Acesso negado", nao pelo banco).
 *  DEPOIS     anon recebe 42501 (permissao negada pelo banco, antes do corpo) nas duas; authenticated
 *             chega ao corpo e funciona (a media volta; o voto de um logado sem avaliacao e' no-op;
 *             sem auth.uid() o corpo recusa com P0001); service_role e o dono seguem executando;
 *             PUBLIC fechado; a ACL fica EXATAMENTE a do rol; so a ACL das duas mudou (nenhuma outra
 *             funcao, nenhuma tabela, nenhum corpo); nenhuma linha de reviews/review_votes mudou.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve a ACL de antes IDENTICA (o
 *             mesmo conjunto de aclitem) e a ida e volta termina igual; o pre-voo recusa SEM escrever
 *             (PUBLIC aberto, so um dos papeis, sem service_role, funcao ausente) e, falhando na
 *             SEGUNDA funcao, a PRIMEIRA nao fica fechada (atomicidade); um GRANT dado por OUTRO
 *             grantor faz a conferencia recusar o apply inteiro; o pre-voo do rollback recusa funcao
 *             ausente.
 *  CONCORRENCIA uma chamada em voo do visitante (transacao aberta) nao segura o apply, e depois do
 *             commit a MESMA conexao, em transacao nova, e' recusada (a transacao ja em voo pode
 *             ainda terminar: limite documentado do Postgres).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/avaliacoes-fechadas-ao-visitante-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

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
  "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const METRICAS = "public.get_reviews_metrics(text,integer)";
const VOTO = "public.increment_helpful(uuid)";
const AS_DUAS = [METRICAS, VOTO];
const SQL_METRICAS = "SELECT * FROM public.get_reviews_metrics(NULL, NULL)";
const SQL_VOTO = "SELECT public.increment_helpful($1::uuid)";
const UUID_QUE_NAO_EXISTE = "7e7e2210-0000-4000-8000-000000000001";

// A ACL que o baseline deixa (default privileges: anon, authenticated e service_role) com PUBLIC
// revogado pela 20261090500000; o dono e' o postgres. O DEPOIS e' o do corte.
const ACL_DE_ANTES = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];
const ACL_DE_DEPOIS = [
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita, ja no estado ANTES (o rollback-manual da 20261221). */
async function emTransacao(fn, { antes = true } = {}) {
  await C.query("BEGIN");
  try {
    if (antes) await C.query(ROLLBACK);
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` e devolve a 1a linha (o erro sobe). */
async function como(papel, sql, params = [], conexao = C) {
  await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    const r = await conexao.query(sql, params);
    return r.rows[0];
  } finally {
    // transacao abortada nao aceita RESET ROLE e o erro dela esconderia o original
    await conexao.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linha} ou {erro, codigo}. */
async function tentar(papel, sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linha = await como(papel, sql, params);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linha };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/**
 * "Chegou ao corpo" = o banco NAO recusou antes (nada de 42501). Desde a 20261222000000 o corpo de
 * get_reviews_metrics tem a guarda de admin: quem nao e' admin chega a ele e recebe a excecao da guarda
 * (P0001), e quem e' admin recebe a linha. Numa arvore sem a 20261222 o corpo antigo devolve a linha.
 * As duas respostas provam o mesmo que esta prova quer: a ACL nao barrou. (O comportamento da guarda e'
 * de tests/banco/media-de-avaliacoes-so-admin-viva.cjs.)
 */
const chegouAoCorpo = (r) =>
  r.linha !== undefined ||
  (r.codigo === "P0001" &&
    /Acesso negado: privilégios de administrador necessários/.test(r.erro));

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** A ACL de uma funcao como lista ordenada de aclitem (texto), com o default do dono se nula. */
async function acl(assinatura, conexao = C) {
  const r = await conexao.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0].a;
}

const executa = async (papel, assinatura) =>
  (
    await C.query(
      "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS x",
      [papel, assinatura],
    )
  ).rows[0].x;

const publicTem = async (assinatura) =>
  (
    await C.query(
      `SELECT EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = to_regprocedure($1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS x`,
      [assinatura],
    )
  ).rows[0].x;

const aclBruto = async (assinatura) =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [assinatura],
    )
  ).rows[0].a;

const conjunto = (t) => t.replace(/[{}]/g, "").split(",").sort();

/** O que a migration nao pode tocar: ACL de TODA funcao e tabela de public, e o corpo de toda funcao. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl, md5(p.prosrc) AS corpo
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  return { funcoes, tabelas };
}

/** As linhas de avaliacao e de voto, byte a byte (hash do conteudo inteiro). */
async function retratoDosDados() {
  const r = await C.query(
    `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.reviews x) AS avaliacoes,
            (SELECT count(*)::int FROM public.reviews) AS n_avaliacoes,
            (SELECT coalesce(md5(string_agg(v::text, '|' ORDER BY v.id::text)), '') FROM public.review_votes v) AS votos,
            (SELECT count(*)::int FROM public.review_votes) AS n_votos`,
  );
  return r.rows[0];
}

/** Loga um usuario na emulacao de auth do efemero (auth.uid() le o GUC app.rpc.user_id). */
const logar = (uid) =>
  C.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);

// ---------------------------------------------------------------------------
// ANTES: o controle (a porta aberta de fato chega ao corpo)
// ---------------------------------------------------------------------------

prova(
  "ANTES: as duas funcoes estao com a ACL de antes (anon, authenticated, service_role e dono; PUBLIC nao) e o visitante CHEGA ao corpo",
  () =>
    emTransacao(async () => {
      for (const f of AS_DUAS) {
        assert.deepEqual(await acl(f), ACL_DE_ANTES, f);
        assert.equal(await publicTem(f), false, `${f}: PUBLIC fechado`);
        for (const papel of ["anon", "authenticated", "service_role"])
          assert.equal(await executa(papel, f), true, `${f}: ${papel}`);
      }
      // o visitante chega ao corpo da media (uma linha com a media) ...
      const m = await tentar("anon", SQL_METRICAS);
      assert.ok(chegouAoCorpo(m), `anon devia chegar ao corpo: ${m.erro}`);
      if (m.linha) assert.equal(Number(m.linha.average_rating) >= 0, true);
      // ... e o voto dele e' recusado PELO CORPO (P0001), nao pelo banco (42501)
      const v = await tentar("anon", SQL_VOTO, [UUID_QUE_NAO_EXISTE]);
      assert.equal(v.codigo, "P0001", v.erro);
      assert.match(v.erro, /Acesso negado: usuário não autenticado/);
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: anon recebe 42501 nas duas (antes do corpo); authenticated chega ao corpo e funciona; service_role e dono seguem; PUBLIC fechado; ACL exatamente a do corte",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      for (const f of AS_DUAS) {
        assert.deepEqual(await acl(f), ACL_DE_DEPOIS, f);
        assert.equal(await publicTem(f), false, `${f}: PUBLIC`);
        assert.equal(await executa("anon", f), false, `${f}: anon`);
        assert.equal(await executa("authenticated", f), true, `${f}: auth`);
        assert.equal(await executa("service_role", f), true, `${f}: service`);
        assert.equal(await executa("postgres", f), true, `${f}: dono`);
      }
      const m = await tentar("anon", SQL_METRICAS);
      assert.equal(m.codigo, "42501", m.erro);
      const v = await tentar("anon", SQL_VOTO, [UUID_QUE_NAO_EXISTE]);
      assert.equal(v.codigo, "42501", v.erro);

      // authenticated: a media volta; sem auth.uid() o CORPO recusa (P0001, nao 42501) ...
      const mm = await tentar("authenticated", SQL_METRICAS);
      assert.ok(
        chegouAoCorpo(mm),
        `authenticated devia chegar ao corpo: ${mm.erro}`,
      );
      // e o authenticated ADMIN recebe a linha (JWT com app_metadata.role = admin), com ou sem a guarda no corpo
      await C.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ app_metadata: { role: "admin" } }),
      ]);
      const admin = await tentar("authenticated", SQL_METRICAS);
      assert.ok(admin.linha, `admin devia ler a media: ${admin.erro}`);
      await C.query("SELECT set_config('request.jwt.claims', '', true)");
      const semUid = await tentar("authenticated", SQL_VOTO, [
        UUID_QUE_NAO_EXISTE,
      ]);
      assert.equal(semUid.codigo, "P0001", semUid.erro);
      // ... e com um usuario logado (emulacao de auth) a avaliacao inexistente e' no-op silencioso
      await logar("7e7e2210-0000-4000-8000-0000000000aa");
      const logado = await tentar("authenticated", SQL_VOTO, [
        UUID_QUE_NAO_EXISTE,
      ]);
      assert.ok(logado.linha, `logado devia passar: ${logado.erro}`);

      // service_role segue chamando
      const s = await tentar("service_role", SQL_METRICAS);
      assert.ok(s.linha, `service_role: ${s.erro}`);
    }),
);

prova(
  "DEPOIS: so a ACL das duas funcoes mudou (nenhuma outra funcao, nenhuma tabela, nenhum corpo) e nenhuma linha de avaliacao ou voto mudou",
  () =>
    emTransacao(async () => {
      const esquemaAntes = await retratoDoSchema();
      const dadosAntes = await retratoDosDados();
      assert.equal(await aplicar(MIGRATION), null);
      const esquemaDepois = await retratoDoSchema();
      assert.deepEqual(await retratoDosDados(), dadosAntes, "dados intactos");
      assert.deepEqual(esquemaDepois.tabelas, esquemaAntes.tabelas);
      assert.equal(esquemaDepois.funcoes.length, esquemaAntes.funcoes.length);
      const mudaram = esquemaDepois.funcoes
        .filter(
          (f, i) =>
            JSON.stringify(f) !== JSON.stringify(esquemaAntes.funcoes[i]),
        )
        .map((f) => f.f)
        .sort();
      assert.deepEqual(mudaram, [
        "get_reviews_metrics(text,integer)",
        "increment_helpful(uuid)",
      ]);
      // e dessas duas mudou so a ACL, nunca o corpo
      for (const f of mudaram) {
        const a = esquemaAntes.funcoes.find((x) => x.f === f);
        const d = esquemaDepois.funcoes.find((x) => x.f === f);
        assert.equal(d.corpo, a.corpo, `${f}: corpo intacto`);
        assert.notEqual(d.acl, a.acl, `${f}: ACL mudou`);
      }
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, rollback, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova("MIGRATION: reaplicar (2x) e em CRLF deixa o mesmo estado", () =>
  emTransacao(async () => {
    assert.equal(await aplicar(MIGRATION), null);
    const uma = [await aclBruto(METRICAS), await aclBruto(VOTO)];
    assert.equal(await aplicar(MIGRATION), null);
    assert.equal(await aplicar(emCRLF(MIGRATION)), null);
    assert.deepEqual([await aclBruto(METRICAS), await aclBruto(VOTO)], uma);
    for (const f of AS_DUAS) assert.deepEqual(await acl(f), ACL_DE_DEPOIS);
  }),
);

prova(
  "MIGRATION: o rollback devolve a ACL de antes IDENTICA (mesmo conjunto de aclitem), a ida e volta termina igual, e rodar o rollback 2x (e em CRLF) nao muda nada",
  () =>
    emTransacao(async () => {
      const brutoAntes = [await aclBruto(METRICAS), await aclBruto(VOTO)];
      assert.equal(await aplicar(MIGRATION), null);
      for (const f of AS_DUAS) assert.deepEqual(await acl(f), ACL_DE_DEPOIS);
      assert.equal(await aplicar(ROLLBACK), null);
      for (const [i, f] of AS_DUAS.entries()) {
        assert.deepEqual(await acl(f), ACL_DE_ANTES, f);
        assert.deepEqual(
          conjunto(await aclBruto(f)),
          conjunto(brutoAntes[i]),
          `${f}: mesmo conjunto de aclitem`,
        );
        assert.equal(await publicTem(f), false);
      }
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      for (const f of AS_DUAS) assert.deepEqual(await acl(f), ACL_DE_ANTES);
      // ida e volta e de novo
      assert.equal(await aplicar(MIGRATION), null);
      for (const f of AS_DUAS) assert.deepEqual(await acl(f), ACL_DE_DEPOIS);
      // o comportamento volta junto: o visitante chega ao corpo de novo
      assert.equal(await aplicar(ROLLBACK), null);
      const m = await tentar("anon", SQL_METRICAS);
      assert.ok(chegouAoCorpo(m), m.erro);
    }),
);

prova(
  "MIGRATION: o pre-voo recusa SEM escrever (PUBLIC aberto, so um dos papeis, sem service_role, funcao ausente) e falhando na SEGUNDA funcao a PRIMEIRA nao fica fechada",
  () =>
    emTransacao(async () => {
      const intacto = async (rotulo) => {
        for (const f of AS_DUAS) {
          if (rotulo.alvo === f) continue;
          assert.deepEqual(await acl(f), ACL_DE_ANTES, `${f}: nada escrito`);
        }
      };
      // ACL que ninguem mediu, em cada uma das duas funcoes (a segunda prova a atomicidade)
      for (const alvo of AS_DUAS) {
        for (const [rotulo, mutar] of [
          ["PUBLIC aberto", `GRANT EXECUTE ON FUNCTION ${alvo} TO PUBLIC`],
          [
            "sem authenticated",
            `REVOKE EXECUTE ON FUNCTION ${alvo} FROM authenticated`,
          ],
          [
            "sem service_role",
            `REVOKE EXECUTE ON FUNCTION ${alvo} FROM service_role`,
          ],
        ]) {
          await C.query("SAVEPOINT s1");
          await C.query(mutar);
          const antesDaTentativa = [
            await aclBruto(METRICAS),
            await aclBruto(VOTO),
          ];
          const e = await aplicar(MIGRATION);
          assert.ok(e, `${alvo} ${rotulo}: o apply tinha de recusar`);
          assert.match(e.erro, /B1_BASELINE_DIVERGENT: ACL de/, rotulo);
          assert.ok(e.erro.includes(alvo), `a recusa nomeia ${alvo}`);
          assert.deepEqual(
            [await aclBruto(METRICAS), await aclBruto(VOTO)],
            antesDaTentativa,
            `${alvo} ${rotulo}: nada escrito (nenhuma das duas fechou)`,
          );
          await C.query("ROLLBACK TO SAVEPOINT s1");
        }
      }
      // funcao ausente (qualquer uma das duas)
      for (const [alvo, drop] of [
        [METRICAS, `DROP FUNCTION ${METRICAS}`],
        [VOTO, `DROP FUNCTION ${VOTO}`],
      ]) {
        await C.query("SAVEPOINT s2");
        await C.query(drop);
        const e = await aplicar(MIGRATION);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT.*não existe/s, alvo);
        const outra = AS_DUAS.find((f) => f !== alvo);
        assert.deepEqual(await acl(outra), ACL_DE_ANTES, "a outra nao fechou");
        await C.query("ROLLBACK TO SAVEPOINT s2");
      }
      await intacto({});
      // a base sem mexida aplica
      assert.equal(await aplicar(MIGRATION), null);
    }),
);

prova(
  "MIGRATION: reaplicar sobre o estado DEPOIS passa; o DEPOIS com authenticated fechado (ninguem mediu) recusa e nao reabre nada",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      // DEPOIS conhecido: reaplicar passa (idempotencia ja provada) e nao reabre nada
      assert.equal(await aplicar(MIGRATION), null);
      // DEPOIS com authenticated fechado: ninguem mediu isto, o apply recusa e nada muda
      await C.query("SAVEPOINT d1");
      await C.query(`REVOKE EXECUTE ON FUNCTION ${VOTO} FROM authenticated`);
      const e = await aplicar(MIGRATION);
      assert.match(e.erro, /B1_BASELINE_DIVERGENT: ACL de/);
      assert.equal(await executa("authenticated", VOTO), false, "nao reabriu");
      assert.equal(await executa("anon", VOTO), false, "anon continua fechado");
      await C.query("ROLLBACK TO SAVEPOINT d1");
    }),
);

prova(
  "MIGRATION: um GRANT dado por OUTRO grantor (que o REVOKE do dono nao remove) faz a conferencia recusar o apply inteiro, nas duas funcoes",
  () =>
    emTransacao(async () => {
      await C.query("CREATE ROLE zz_grantor_221 NOLOGIN");
      for (const alvo of AS_DUAS) {
        await C.query("SAVEPOINT g1");
        await C.query(
          `GRANT EXECUTE ON FUNCTION ${alvo} TO zz_grantor_221 WITH GRANT OPTION`,
        );
        await C.query("SET LOCAL ROLE zz_grantor_221");
        await C.query(`GRANT EXECUTE ON FUNCTION ${alvo} TO anon`);
        await C.query("RESET ROLE");
        const e = await aplicar(MIGRATION);
        assert.ok(e, `${alvo}: o apply tinha de recusar`);
        assert.match(e.erro, /conferencia 20261221: anon ainda executa/);
        assert.ok(e.erro.includes(alvo));
        // o apply voltou inteiro: nada do REVOKE ficou nas DUAS funcoes
        assert.equal(await executa("authenticated", METRICAS), true);
        assert.equal(await executa("authenticated", VOTO), true);
        assert.deepEqual(
          await acl(AS_DUAS.find((f) => f !== alvo)),
          ACL_DE_ANTES,
          "a outra funcao nao ficou fechada pela metade",
        );
        await C.query("ROLLBACK TO SAVEPOINT g1");
      }
    }),
);

prova(
  "MIGRATION: o pre-voo do rollback recusa funcao ausente, sem escrever",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      for (const alvo of AS_DUAS) {
        await C.query("SAVEPOINT r1");
        await C.query(`DROP FUNCTION ${alvo}`);
        const outra = AS_DUAS.find((f) => f !== alvo);
        const e = await aplicar(ROLLBACK);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT.*não existe/s);
        assert.equal(
          await executa("anon", outra),
          false,
          "a porta continua fechada",
        );
        await C.query("ROLLBACK TO SAVEPOINT r1");
      }
    }),
);

prova(
  "MIGRATION: a conferencia do rollback recusa se PUBLIC ficou aberto (o estado de antes nao tinha PUBLIC)",
  () =>
    emTransacao(async () => {
      // PUBLIC aberto antes do rollback: o GRANT dele nao remove PUBLIC, a conferencia recusa
      assert.equal(await aplicar(MIGRATION), null);
      await C.query(`GRANT EXECUTE ON FUNCTION ${METRICAS} TO PUBLIC`);
      const e = await aplicar(ROLLBACK);
      assert.ok(e, "o rollback tinha de recusar");
      assert.match(
        e.erro,
        /conferencia rollback 20261221: .* aberta para PUBLIC/,
      );
    }),
);

// ---------------------------------------------------------------------------
// CONCORRENCIA
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: uma chamada em voo do visitante (transacao aberta) nao segura o apply, e depois do commit a MESMA sessao ja e' recusada",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    try {
      await C.query(ROLLBACK); // estado ANTES, commitado
      await B.query("BEGIN");
      // a chamada CHEGA ao corpo (linha, ou a excecao da guarda de admin da 20261222000000 quando ela esta na arvore)
      // (o SAVEPOINT mantem a transacao do visitante EM VOO mesmo quando a guarda levanta a excecao)
      let antes;
      await B.query("SAVEPOINT chamada");
      try {
        antes = { linha: await como("anon", SQL_METRICAS, [], B) };
      } catch (e) {
        await B.query("ROLLBACK TO SAVEPOINT chamada");
        antes = { codigo: e.code, erro: e.message };
      }
      assert.ok(
        chegouAoCorpo(antes),
        `a sessao do visitante chama a media ANTES do apply: ${antes.erro}`,
      );
      // o apply (commit de verdade) nao pode ficar preso atras da transacao do visitante
      await C.query("SET statement_timeout = '8s'");
      await C.query(MIGRATION);
      await C.query("RESET statement_timeout");
      for (const f of AS_DUAS) assert.deepEqual(await acl(f), ACL_DE_DEPOIS);
      // Uma transacao que JA passou da checagem de permissao pode ainda chamar de novo: o Postgres
      // so enxerga o REVOKE do outro depois de processar as invalidacoes de catalogo, o que numa
      // chamada de funcao sem tabela nova no meio nao acontece (medido; mesma nota da prova da
      // 20261220). O corte vale na FRONTEIRA DA TRANSACAO: a MESMA conexao, em transacao NOVA, e'
      // recusada.
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      await B.query("SET LOCAL ROLE anon");
      await assert.rejects(
        () => B.query(SQL_METRICAS),
        (e) => e.code === "42501",
      );
      await B.query("ROLLBACK");
      await B.query("BEGIN");
      await B.query("SET LOCAL ROLE anon");
      await assert.rejects(
        () => B.query(SQL_VOTO, [UUID_QUE_NAO_EXISTE]),
        (e) => e.code === "42501",
      );
    } finally {
      await B.query("ROLLBACK").catch(() => {});
      await B.end().catch(() => {});
      // devolve o estado ANTES (o rollback-manual) e depois o do corte, como a arvore migrada
      await C.query("RESET statement_timeout").catch(() => {});
      await C.query(ROLLBACK).catch(() => {});
      await C.query(MIGRATION).catch(() => {});
    }
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.message).split("\n").join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas das avaliacoes fechadas ao visitante falharam.`,
    );
  }
  console.log(
    `\n[avaliacoes-fechadas-ao-visitante] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
