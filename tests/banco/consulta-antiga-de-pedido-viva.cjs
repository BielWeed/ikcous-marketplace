"use strict";

/**
 * Prova VIVA da migration 20261220000000 (a consulta antiga de pedido por codigo fecha para o
 * visitante e para a conta logada; auditoria de 12/10/2026, lote L1, etapa 2: achado A-1), num
 * Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o do apply concorrente usa duas conexoes
 * reais, grava de verdade e desfaz com o rollback-manual). O banco e' o clone do rodar-isolado.cjs:
 * a arvore migrada. Como a arvore pode ou nao ja ter a 20261220 (em CI ela tem), TODO caso comeca
 * pelo estado ANTES, montado com o rollback-manual (um GRANT, idempotente) e conferido contra a ACL
 * que o baseline da loja deixa (a mesma da v2 irma, criada pelas mesmas default privileges).
 *
 *  ANTES      anon, authenticated e service_role executam a v1 (controle: sem ele o "recusou depois"
 *             pode ser vacuo); o achado A-1 REPRODUZ (5 codigos errados de quem so sabe o e-mail
 *             bloqueiam o codigo CERTO da vitima).
 *  DEPOIS     anon e authenticated recebem 42501 na v1 (e o A-1 nao toca em nada: a vitima ainda
 *             confere o codigo, pela v2, e as tentativas ficam em 0); service_role e o dono seguem
 *             executando; a v2 responde ao visitante e a conta logada; so a ACL da v1 mudou (nenhuma
 *             outra funcao, nenhuma tabela, nenhum corpo); nenhuma linha de pedido ou de codigo
 *             mudou (codigo ativo que ja existia continua valendo, com as tentativas que tinha).
 *  MIGRATION  reaplicar e CRLF = mesmo estado; o rollback devolve a ACL de antes IDENTICA (aclitem a
 *             aclitem) e a ida e volta termina igual; o pre-voo recusa SEM escrever (corpo da v1
 *             diferente, v2 ausente ou fechada ao visitante, v1 sem service_role, v1 ausente); o
 *             pre-voo do rollback recusa corpo desconhecido; grant dado por OUTRO grantor faz a
 *             conferencia recusar o apply inteiro.
 *  CONCORRENCIA uma verificacao em voo (trava de linha em otp_verifications) nao segura o apply, e
 *             depois do commit a MESMA sessao ja e' recusada.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/consulta-antiga-de-pedido-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede. */

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
  "20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
// A ORDEM DE DESFAZER: o rollback da 20261217 recusa com a 20261220 aplicada.
const ARQ_217 =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const MIGRATION_217 = fs.readFileSync(path.join(MIGRATIONS, ARQ_217), "utf8");
const ROLLBACK_217 = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ_217}`),
  "utf8",
);
// md5 dos corpos de ANTES da 20261217 (os que o rollback dela devolve)
const CORPOS_DE_ANTES_217 = {
  "public.generate_order_otp_v2(text,text,text)":
    "8fab5091db4a380bf07592f7dc896856",
  "public.reivindicar_email_de_confirmacao(uuid)":
    "45be19bf714f266f8234f11df820b76b",
  "public.get_orders_by_otp_v1(text,text)": "b472f00d6b36002522b25bf04113a035",
};

const V1 = "public.get_orders_by_otp_v1(text,text)";
const V2 = "public.get_orders_by_otp_v2(text,text,text,text)";
const HASH_V1 = "277776acaf395fa864cc3e2cb0638237";
const SQL_V1 = "SELECT public.get_orders_by_otp_v1($1, $2) AS r";
const SQL_V2 = "SELECT public.get_orders_by_otp_v2($1, $2, $3, $4) AS r";
const SQL_GERAR = "SELECT public.generate_order_otp_v2($1, $2, $3) AS r";

// A ACL que o baseline deixa na v1 (default privileges: anon, authenticated e service_role) com
// PUBLIC revogado pela 20261090500000; o dono e' o postgres. A v2 irma, criada na 20261217000000 com
// REVOKE de PUBLIC e GRANT aos tres, tem o MESMO conjunto: e' o controle independente da literal.
const ACL_DE_ANTES = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];
const ACL_DE_DEPOIS = ["postgres=X/postgres", "service_role=X/postgres"];

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita, ja no estado ANTES (o rollback-manual da 20261220). */
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

const executa = async (papel, assinatura = V1) =>
  (
    await C.query(
      "SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE') AS x",
      [papel, assinatura],
    )
  ).rows[0].x;

const publicTem = async (assinatura = V1) =>
  (
    await C.query(
      `SELECT EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = to_regprocedure($1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) AS x`,
      [assinatura],
    )
  ).rows[0].x;

const md5DoCorpo = async (assinatura = V1) => {
  const r = await C.query(
    "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [assinatura],
  );
  return r.rows[0] ? r.rows[0].h : null;
};

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

/** As linhas de pedido e de codigo, byte a byte (hash do conteudo inteiro). */
async function retratoDosDados() {
  const r = await C.query(
    `SELECT (SELECT coalesce(md5(string_agg(o::text, '|' ORDER BY o.id::text)), '') FROM public.otp_verifications o) AS codigos,
            (SELECT count(*)::int FROM public.otp_verifications) AS n_codigos,
            (SELECT coalesce(md5(string_agg(m::text, '|' ORDER BY m.id::text)), '') FROM public.marketplace_orders m) AS pedidos,
            (SELECT count(*)::int FROM public.marketplace_orders) AS n_pedidos`,
  );
  return r.rows[0];
}

let seq = 0;
const novoId = () => {
  seq += 1;
  return `7e7e2200-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** Pedido de convidado com o e-mail e o WhatsApp que a pessoa digitou no checkout. */
async function pedido({ email, fone, conexao = C }) {
  const id = novoId();
  await conexao.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, payment_status)
     VALUES ($1, NULL, 'Convidado Sintetico', $2, $3::jsonb, 100, 100, 'aguardando')`,
    [id, fone, JSON.stringify({ email, whatsapp: fone })],
  );
  return id;
}

const fragmento = (id) => id.slice(-6);

/** Pedido + codigo gerado pelo servidor (service_role), como o envio de e-mail faz. */
async function pedidoComCodigo(email, fone) {
  const id = await pedido({ email, fone });
  const g = (
    await como("service_role", SQL_GERAR, [email, fone, fragmento(id)])
  ).r;
  assert.equal(g.ok, true, JSON.stringify(g));
  return { id, codigo: g.otp_code };
}

const errado = (codigo) => (codigo === "000000" ? "000001" : "000000");

const tentativas = async (orderId) =>
  (
    await C.query(
      "SELECT attempts FROM public.otp_verifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
      [orderId],
    )
  ).rows[0].attempts;

// ---------------------------------------------------------------------------
// ANTES: o controle (a porta aberta e o achado A-1 reproduzindo)
// ---------------------------------------------------------------------------

prova(
  "ANTES: a v1 esta com a ACL de antes (anon, authenticated, service_role e dono; PUBLIC nao) e igual a da v2 irma",
  () =>
    emTransacao(async () => {
      assert.deepEqual(await acl(V1), ACL_DE_ANTES);
      assert.deepEqual(await acl(V2), ACL_DE_ANTES, "controle: a v2 irma");
      assert.equal(await publicTem(V1), false);
      for (const papel of ["anon", "authenticated", "service_role"])
        assert.equal(await executa(papel), true, papel);
      assert.equal(await md5DoCorpo(V1), HASH_V1);
    }),
);

prova(
  "ANTES (CONTROLE do A-1): quem sabe so o e-mail gasta as 5 tentativas e o codigo CERTO da vitima responde bloqueado",
  () =>
    emTransacao(async () => {
      const email = "vitima.a1@teste.invalid";
      const { id, codigo } = await pedidoComCodigo(email, "11970000001");
      for (let i = 0; i < 5; i++) {
        const r = (await como("anon", SQL_V1, [email, errado(codigo)])).r;
        assert.equal(r.ok, false);
      }
      assert.equal(
        await tentativas(id),
        5,
        "o estranho gastou as 5 tentativas",
      );
      const vitima = (await como("anon", SQL_V1, [email, codigo])).r;
      assert.equal(vitima.ok, false);
      assert.match(vitima.error, /bloqueado/, JSON.stringify(vitima));
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS: o corte
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: anon e authenticated recebem 42501 na v1; service_role e o dono seguem executando; PUBLIC nao tem nada",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await acl(V1), ACL_DE_DEPOIS);
      assert.equal(await publicTem(V1), false);
      assert.equal(await executa("anon"), false);
      assert.equal(await executa("authenticated"), false);
      assert.equal(await executa("service_role"), true);
      for (const papel of ["anon", "authenticated"]) {
        const t = await tentar(papel, SQL_V1, ["x@teste.invalid", "123456"]);
        assert.equal(t.codigo, "42501", `${papel}: ${t.erro}`);
      }
      const servico = await tentar("service_role", SQL_V1, [
        "ninguem@teste.invalid",
        "123456",
      ]);
      assert.deepEqual(servico.linha.r, {
        ok: false,
        error: "Código inválido ou expirado.",
      });
      // o dono (postgres, a conexao do apply) tambem executa
      const dono = (await C.query(SQL_V1, ["ninguem@teste.invalid", "123456"]))
        .rows[0].r;
      assert.equal(dono.ok, false);
    }),
);

prova(
  "DEPOIS: o A-1 deixa de funcionar e nao toca em nada (as tentativas da vitima ficam em 0 e ela confere pela v2)",
  () =>
    emTransacao(async () => {
      const email = "vitima.depois@teste.invalid";
      const fone = "11970000002";
      const { id, codigo } = await pedidoComCodigo(email, fone);
      assert.equal(await aplicar(MIGRATION), null);
      for (let i = 0; i < 6; i++) {
        const t = await tentar("anon", SQL_V1, [email, errado(codigo)]);
        assert.equal(t.codigo, "42501");
      }
      assert.equal(await tentativas(id), 0, "o estranho nao gastou tentativa");
      const v = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), codigo])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.orders.length, 1);
      assert.equal(v.orders[0].id, id);
    }),
);

prova(
  "DEPOIS: a v2 segue como a porta do visitante E da conta logada, e continua sem PUBLIC",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await acl(V2), ACL_DE_ANTES, "a v2 nao mudou");
      for (const papel of ["anon", "authenticated"]) {
        const email = `${papel}.v2@teste.invalid`;
        const fone = papel === "anon" ? "11970000003" : "11970000004";
        const { id, codigo } = await pedidoComCodigo(email, fone);
        const v = (
          await como(papel, SQL_V2, [email, fone, fragmento(id), codigo])
        ).r;
        assert.equal(v.ok, true, `${papel}: ${JSON.stringify(v)}`);
        assert.equal(v.orders[0].id, id);
      }
    }),
);

prova(
  "DEPOIS (dado que ja existia): nenhuma linha de pedido ou de codigo muda, e o codigo ativo com tentativas continua valendo pela v2",
  () =>
    emTransacao(async () => {
      const email = "antigo@teste.invalid";
      const fone = "11970000005";
      const { id, codigo } = await pedidoComCodigo(email, fone);
      // um codigo que ja existia antes do corte, com 2 tentativas gastas, e outro ja verificado
      await como("anon", SQL_V1, [email, errado(codigo)]);
      await como("anon", SQL_V1, [email, errado(codigo)]);
      assert.equal(await tentativas(id), 2);
      const outro = await pedidoComCodigo(
        "verificado@teste.invalid",
        "11970000006",
      );
      await C.query(
        "UPDATE public.otp_verifications SET verified = true WHERE order_id = $1",
        [outro.id],
      );
      const antesDados = await retratoDosDados();
      assert.ok(antesDados.n_codigos >= 2 && antesDados.n_pedidos >= 2);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retratoDosDados(), antesDados);
      assert.equal(await tentativas(id), 2, "as tentativas que ja tinha");
      const v = (
        await como("anon", SQL_V2, [email, fone, fragmento(id), codigo])
      ).r;
      assert.equal(v.ok, true, JSON.stringify(v));
    }),
);

prova(
  "DEPOIS: SO a ACL da v1 mudou (nenhuma outra funcao nem tabela, nenhum corpo)",
  () =>
    emTransacao(async () => {
      const antes = await retratoDoSchema();
      assert.equal(await aplicar(MIGRATION), null);
      const depois = await retratoDoSchema();
      assert.deepEqual(depois.tabelas, antes.tabelas);
      assert.equal(depois.funcoes.length, antes.funcoes.length);
      const depoisPorNome = new Map(depois.funcoes.map((f) => [f.f, f]));
      const mudaram = antes.funcoes
        .filter((f) => {
          const d = depoisPorNome.get(f.f);
          return !d || f.acl !== d.acl || f.corpo !== d.corpo;
        })
        .map((f) => f.f);
      assert.deepEqual(mudaram, [V1.replace("public.", "")]);
      const so = antes.funcoes.find(
        (f) => f.f === "get_orders_by_otp_v1(text,text)",
      );
      const dep = depois.funcoes.find(
        (f) => f.f === "get_orders_by_otp_v1(text,text)",
      );
      assert.equal(so.corpo, dep.corpo, "o corpo da v1 nao muda");
    }),
);

// ---------------------------------------------------------------------------
// A MIGRATION: idempotencia, CRLF, rollback idêntico, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova("MIGRATION: reaplicar (2x) e em CRLF deixa o mesmo estado", () =>
  emTransacao(async () => {
    assert.equal(await aplicar(MIGRATION), null);
    const uma = await acl(V1);
    assert.equal(await aplicar(MIGRATION), null);
    assert.deepEqual(await acl(V1), uma);
    assert.equal(await aplicar(emCRLF(MIGRATION)), null);
    assert.deepEqual(await acl(V1), uma);
    assert.deepEqual(uma, ACL_DE_DEPOIS);
  }),
);

prova(
  "MIGRATION: o rollback devolve a ACL de antes IDENTICA (aclitem a aclitem), a ida e volta termina igual, e rodar o rollback 2x nao muda nada",
  () =>
    emTransacao(async () => {
      const aclAntes = await acl(V1);
      const brutoAntes = (
        await C.query(
          "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
          [V1],
        )
      ).rows[0].a;
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await acl(V1), ACL_DE_DEPOIS);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(await acl(V1), aclAntes);
      assert.deepEqual(await acl(V1), ACL_DE_ANTES);
      assert.equal(await executa("anon"), true);
      assert.equal(await executa("authenticated"), true);
      assert.equal(await publicTem(V1), false);
      // o mesmo conjunto de aclitem; a ordem do array pode mudar, o conjunto nao
      const brutoDepois = (
        await C.query(
          "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
          [V1],
        )
      ).rows[0].a;
      const conjunto = (t) => t.replace(/[{}]/g, "").split(",").sort();
      assert.deepEqual(conjunto(brutoDepois), conjunto(brutoAntes));
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(await acl(V1), ACL_DE_ANTES);
      // ida e volta e de novo
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await acl(V1), ACL_DE_DEPOIS);
      // o comportamento volta junto: o visitante executa a v1 de novo
      assert.equal(await aplicar(ROLLBACK), null);
      const r = await tentar("anon", SQL_V1, ["x@teste.invalid", "123456"]);
      assert.equal(r.linha.r.ok, false);
    }),
);

prova(
  "MIGRATION: o pre-voo recusa SEM escrever (corpo da v1 diferente; v2 ausente ou fechada ao visitante; ACL da v1 nao medida: sem service_role, so um dos papeis, PUBLIC aberto; v1 ausente)",
  () =>
    emTransacao(async () => {
      const intacto = async () => {
        assert.deepEqual(await acl(V1), ACL_DE_ANTES, "a ACL nao mudou");
        assert.equal(await executa("anon"), true);
      };
      // 1. corpo diferente (CREATE OR REPLACE preserva a ACL)
      await C.query("SAVEPOINT s1");
      await C.query(`CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(p_email text, p_otp text)
        RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
        AS $x$ SELECT jsonb_build_object('ok', false) $x$`);
      let e = await aplicar(MIGRATION);
      assert.match(e.erro, /B1_BASELINE_DIVERGENT.*corpo vivo/s);
      await intacto();
      await C.query("ROLLBACK TO SAVEPOINT s1");
      // 2. v2 ausente
      await C.query("SAVEPOINT s2");
      await C.query(`DROP FUNCTION ${V2}`);
      e = await aplicar(MIGRATION);
      assert.match(e.erro, /B1_BASELINE_DIVERGENT.*get_orders_by_otp_v2/s);
      await intacto();
      await C.query("ROLLBACK TO SAVEPOINT s2");
      // 3. v2 fechada ao anon, e depois so ao authenticated
      for (const papel of ["anon", "authenticated"]) {
        await C.query("SAVEPOINT s3");
        await C.query(`REVOKE EXECUTE ON FUNCTION ${V2} FROM ${papel}`);
        e = await aplicar(MIGRATION);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT.*sem EXECUTE/s, papel);
        await intacto();
        await C.query("ROLLBACK TO SAVEPOINT s3");
      }
      // 4. ACL da v1 que ninguem mediu: sem service_role; so um dos dois papeis; PUBLIC aberto
      for (const [rotulo, mutar] of [
        [
          "sem service_role",
          `REVOKE EXECUTE ON FUNCTION ${V1} FROM service_role`,
        ],
        ["so authenticated", `REVOKE EXECUTE ON FUNCTION ${V1} FROM anon`],
        ["so anon", `REVOKE EXECUTE ON FUNCTION ${V1} FROM authenticated`],
        ["PUBLIC aberto", `GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`],
      ]) {
        await C.query("SAVEPOINT s4");
        await C.query(mutar);
        const antesDaTentativa = await acl(V1);
        e = await aplicar(MIGRATION);
        assert.match(e.erro, /B1_BASELINE_DIVERGENT: ACL de/, rotulo);
        assert.deepEqual(
          await acl(V1),
          antesDaTentativa,
          `${rotulo}: nada escrito`,
        );
        await C.query("ROLLBACK TO SAVEPOINT s4");
      }
      // 5. v1 ausente
      await C.query("SAVEPOINT s5");
      await C.query(`DROP FUNCTION ${V1}`);
      e = await aplicar(MIGRATION);
      assert.match(e.erro, /B1_BASELINE_DIVERGENT.*não existe/s);
      await C.query("ROLLBACK TO SAVEPOINT s5");
      // a base sem mexida aplica
      assert.equal(await aplicar(MIGRATION), null);
    }),
);

prova(
  "MIGRATION: o pre-voo do rollback recusa corpo desconhecido e funcao ausente, sem reabrir a porta",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      await C.query("SAVEPOINT r1");
      await C.query(`CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(p_email text, p_otp text)
        RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
        AS $x$ SELECT jsonb_build_object('ok', false) $x$`);
      const e = await aplicar(ROLLBACK);
      assert.match(e.erro, /B1_BASELINE_DIVERGENT/);
      assert.equal(await executa("anon"), false, "a porta continua fechada");
      await C.query("ROLLBACK TO SAVEPOINT r1");
      await C.query("SAVEPOINT r2");
      await C.query(`DROP FUNCTION ${V1}`);
      const e2 = await aplicar(ROLLBACK);
      assert.match(e2.erro, /B1_BASELINE_DIVERGENT.*não existe/s);
      await C.query("ROLLBACK TO SAVEPOINT r2");
    }),
);

prova(
  "MIGRATION: um GRANT dado por OUTRO grantor (que o REVOKE do dono nao remove) faz a conferencia recusar o apply inteiro",
  () =>
    emTransacao(async () => {
      await C.query("CREATE ROLE zz_grantor_220 NOLOGIN");
      await C.query(
        `GRANT EXECUTE ON FUNCTION ${V1} TO zz_grantor_220 WITH GRANT OPTION`,
      );
      await C.query("SET LOCAL ROLE zz_grantor_220");
      await C.query(`GRANT EXECUTE ON FUNCTION ${V1} TO anon`);
      await C.query("RESET ROLE");
      const e = await aplicar(MIGRATION);
      assert.ok(e, "o apply tinha de recusar");
      assert.match(e.erro, /conferencia 20261220: anon ainda executa/);
      // o apply voltou inteiro: nada do REVOKE ficou (authenticated ainda executa)
      assert.equal(await executa("authenticated"), true);
    }),
);

prova(
  "ORDEM DE DESFAZER: (a) so com a 20261217 o rollback dela funciona como antes; (b) com a 20261220 aplicada ele RECUSA mandando rodar o rollback da 20261220 antes, sem escrever; (c) rollback da 20261220 e depois o da 20261217 funciona, e a 20261217 reaplica",
  () =>
    emTransacao(async () => {
      const corposAtuais = async () =>
        Object.fromEntries(
          await Promise.all(
            Object.keys(CORPOS_DE_ANTES_217).map(async (a) => [
              a,
              await md5DoCorpo(a),
            ]),
          ),
        );
      const corposDepois217 = await corposAtuais();
      // (a) estado: so a 20261217 (v1 aberta, montado por emTransacao)
      assert.equal(await executa("anon"), true);
      assert.equal(await aplicar(ROLLBACK_217), null);
      assert.deepEqual(await corposAtuais(), CORPOS_DE_ANTES_217);
      assert.equal(await aplicar(MIGRATION_217), null);
      assert.deepEqual(await corposAtuais(), corposDepois217);

      // (b) com a 20261220 aplicada o rollback da 20261217 recusa e nada muda
      assert.equal(await aplicar(MIGRATION), null);
      const aclFechada = await acl(V1);
      assert.deepEqual(aclFechada, ACL_DE_DEPOIS);
      for (const sql of [ROLLBACK_217, emCRLF(ROLLBACK_217)]) {
        const e = await aplicar(sql);
        assert.ok(e, "o rollback da 20261217 tinha de recusar");
        assert.match(e.erro, /B1_BASELINE_DIVERGENT/);
        assert.match(
          e.erro,
          /rode o rollback-manual-20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante\.sql ANTES/,
        );
        assert.deepEqual(await corposAtuais(), corposDepois217, "sem escrita");
        assert.deepEqual(await acl(V1), aclFechada);
      }
      // so um dos papeis fechado tambem recusa
      await C.query("SAVEPOINT meio");
      await C.query(`GRANT EXECUTE ON FUNCTION ${V1} TO anon`);
      const meio = await aplicar(ROLLBACK_217);
      assert.match(meio.erro, /rode o rollback-manual-20261220000000/);
      await C.query("ROLLBACK TO SAVEPOINT meio");

      // (c) a ordem certa: rollback da 20261220, depois o da 20261217
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(ROLLBACK_217), null);
      assert.deepEqual(await corposAtuais(), CORPOS_DE_ANTES_217);
      assert.deepEqual(await acl(V1), ACL_DE_ANTES);
      // e para frente: 20261217 e depois 20261220 de novo
      assert.equal(await aplicar(MIGRATION_217), null);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await corposAtuais(), corposDepois217);
      assert.deepEqual(await acl(V1), ACL_DE_DEPOIS);
    }),
);

// ---------------------------------------------------------------------------
// CONCORRENCIA: duas conexoes reais
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: uma verificacao em voo (linha do codigo travada) nao segura o apply, e a proxima chamada depois do commit e recusada",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const B = new Client({ connectionString: url });
    await B.connect();
    let criou = null;
    try {
      await C.query(ROLLBACK); // estado ANTES, de verdade (fora de transacao)
      const email = "concorrente@teste.invalid";
      const fone = "11970000007";
      // dados reais (commit) para a segunda conexao enxergar
      criou = await pedido({ email, fone });
      // `como` usa SET LOCAL: so vale dentro de transacao; gera numa transacao curta e grava
      await C.query("BEGIN");
      const gerado = (
        await como("service_role", SQL_GERAR, [email, fone, fragmento(criou)])
      ).r;
      await C.query("COMMIT");
      assert.equal(gerado.ok, true, JSON.stringify(gerado));

      // A: sessao do visitante com verificacao em voo (errou um codigo: UPDATE trava a linha)
      await C.query("BEGIN");
      await C.query("SET LOCAL ROLE anon");
      const errou = (await C.query(SQL_V1, [email, errado(gerado.otp_code)]))
        .rows[0].r;
      assert.equal(errou.ok, false);
      // B: o apply, com lock_timeout curto: se esperasse a linha travada, estouraria
      await B.query("SET lock_timeout = '3s'");
      await B.query("BEGIN");
      await B.query(MIGRATION);
      await B.query("COMMIT");
      // A termina (aqui desfaz): uma transacao que ja passou da checagem de permissao pode
      // acabar -- o Postgres so enxerga o REVOKE do outro apos processar as invalidacoes de
      // catalogo, que numa chamada de funcao sem tabela nova no meio nao acontece. NOVA
      // transacao (a proxima chamada de qualquer sessao) e' recusada.
      await C.query("ROLLBACK");
      // a tentativa de A foi desfeita junto: o codigo da vitima nao perdeu nada
      assert.equal(await tentativas(criou), 0);
      await C.query("BEGIN");
      const nova = await tentar("anon", SQL_V1, [email, gerado.otp_code]);
      await C.query("ROLLBACK");
      assert.equal(
        nova.codigo,
        "42501",
        "a proxima chamada depois do commit do apply",
      );
      assert.equal(await tentativas(criou), 0, "a recusa nao gastou tentativa");
    } finally {
      await C.query("ROLLBACK").catch(() => {});
      await B.query("ROLLBACK").catch(() => {});
      await B.end().catch(() => {});
      // limpa o que gravou de verdade e devolve o estado ANTES
      await C.query(ROLLBACK).catch(() => {});
      if (criou) {
        await C.query(
          "DELETE FROM public.otp_verifications WHERE order_id = $1",
          [criou],
        ).catch(() => {});
        await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
          criou,
        ]).catch(() => {});
      }
      await C.query("DELETE FROM public.email_da_loja_contadores").catch(
        () => {},
      );
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
      `${falhas.length} de ${PROVAS.length} provas da consulta antiga de pedido falharam.`,
    );
  }
  console.log(
    `\n[consulta-antiga-de-pedido] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
