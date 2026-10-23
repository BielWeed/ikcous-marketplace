"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, SONDAS, MUTANTES, fx) ou do catálogo do Postgres
 * efêmero; nunca de entrada de rede nem de payload de terceiro. */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a pasta de migrations do repositório), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261383000000_so_o_dono_da_loja_define_cargo.sql contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: a política profiles_update_policy deixa QUALQUER admin atual alterar profiles.role de QUALQUER pessoa por um
 * PATCH (inclusive rebaixar o dono, ou nomear administradores que nomeiam outros). Decisão de produto: só o DONO da loja
 * nomeia e remove administradores; administrador nomeado NÃO nomeia ninguém; ninguém rebaixa o dono.
 *
 * O QUE SE PROVA (cada item, no estado real do banco, com o `role` do Postgres que o PostgREST usa, não no texto):
 *   (1) o dono nomeia e remove (as duas fontes do papel, auth.users e profiles, mudam juntas e o log registra);
 *   (2) o nomeado NÃO nomeia: admin atual, o recém-promovido, ex-admin, cliente, anon, service_role e até o dono do
 *       Postgres (sem sessão de dono) recebem recusa e nada muda;
 *   (3) ninguém rebaixa o dono: nem pela função, nem por PATCH, nem ele mesmo;
 *   (4) PATCH direto em profiles.role falha para o admin atual e para o próprio dono; o PATCH de cliente continua
 *       desfeito EM SILÊNCIO (a ordem alfabética dos gatilhos); o resto do perfil segue editável; o gatilho não se deixa
 *       enganar por quem grava o GUC da janela; a automação de confiança segue podendo (decisão declarada);
 *   (5) o log: uma linha por mudança, nenhuma para repetição, a divergência entre as duas fontes é corrigida e registrada;
 *       leitura só do dono e do admin atual; escrita por ninguém de aplicação (as duas tabelas);
 *   (6) EXECUTE: anon, PUBLIC e service_role sem; só authenticated; o gatilho não é executável por ninguém;
 *   (7) as bordas: cargo inválido, pessoa inexistente, ordem sem oráculo, dono não cadastrado, dono que não é admin
 *       (a função aborta e a janela do gatilho NÃO fica aberta), singleton e FK da tabela do dono, transação desfeita,
 *       cargo antigo 'gerente', duas chamadas simultâneas sobre a mesma pessoa (a segunda espera a primeira);
 *   (8) reaplicar 2x não muda nada; o rollback comum devolve o catálogo (só os 5 objetos saem) e PRESERVA as linhas; o
 *       destrutivo exige confirmação e o rollback comum antes; o pré-voo recusa 8 estados desconhecidos sem escrever;
 *       o pós-voo que falha desfaz tudo numa conexão SEM BEGIN (como o aplicador);
 *   (9) CONTROLES: sem a migration (rollback) as sondas reprovam; 11 mutantes (cada guarda tirada) reprovam a SUA sonda.
 *
 * Toda chamada de teste roda numa transação DESFEITA no fim; as exceções (escrita real) restauram as fixtures.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/definir-cargo-so-o-dono-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const NOME = "20261383000000_so_o_dono_da_loja_define_cargo.sql";
const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const MIGRATION = fs.readFileSync(path.join(DIR, NOME), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(DIR, `rollback-manual-${NOME}`),
  "utf8",
);
const DESTRUTIVO = fs.readFileSync(
  path.join(DIR, `rollback-manual-destrutivo-${NOME}`),
  "utf8",
);

const U_DONO = "d1383000-0000-4000-8000-000000000001";
const U_ADM = "d1383000-0000-4000-8000-000000000002"; // admin nomeado antes (não é o dono)
const U_ADM2 = "d1383000-0000-4000-8000-000000000003"; // outro admin (alvo de remoção)
const U_ALVO = "d1383000-0000-4000-8000-000000000004"; // cliente
const U_CLI = "d1383000-0000-4000-8000-000000000005"; // cliente
const U_REB_PERFIL = "d1383000-0000-4000-8000-000000000006"; // profiles customer, auth.users admin
const U_REB_AUTH = "d1383000-0000-4000-8000-000000000007"; // profiles admin, auth.users customer
const U_DONO_FRACO = "d1383000-0000-4000-8000-000000000008"; // cliente (dono que não é admin)
const U_FANTASMA = "d1383000-0000-4000-8000-0000000000ff"; // não existe

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (auth.uid() desta suíte lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: {
    papel: "authenticated",
    uid: U_CLI,
    jwt: claims(U_CLI, null),
  },
  dono: { papel: "authenticated", uid: U_DONO, jwt: claims(U_DONO, "admin") },
  adm: { papel: "authenticated", uid: U_ADM, jwt: claims(U_ADM, "admin") },
  adm2: { papel: "authenticated", uid: U_ADM2, jwt: claims(U_ADM2, "admin") },
  // O recém-promovido: o JWT dele ainda diz customer (vale ~1 h), o banco já diz admin.
  alvo: { papel: "authenticated", uid: U_ALVO, jwt: claims(U_ALVO, null) },
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: U_REB_PERFIL,
    jwt: claims(U_REB_PERFIL, "admin"),
  },
  rebaixadoAuth: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "admin"),
  },
  donoFraco: {
    papel: "authenticated",
    uid: U_DONO_FRACO,
    jwt: claims(U_DONO_FRACO, null),
  },
  service: {
    papel: "service_role",
    uid: "",
    jwt: JSON.stringify({ role: "service_role" }),
  },
  postgres: { papel: "postgres", uid: "", jwt: "" },
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}

const CALL = (id, cargo) => [
  "SELECT public.definir_cargo($1::uuid, $2::text) AS r",
  [id, cargo],
];
const PATCH = (id, cargo) => [
  "UPDATE public.profiles SET role = $2 WHERE id = $1",
  [id, cargo],
];
const P = (q, [sql, params]) => ({ q, sql, params });

/**
 * Roda os passos, cada um como seu ator, numa transação SEMPRE desfeita. `antes`: SQL rodado antes, como superusuário
 * (a sessão de login direto, GUC role = none). Devolve o resultado de cada passo e, ANTES de desfazer, o papel de `ids`
 * nas duas fontes e o log.
 */
async function rodar(c, passos, { ids = [], antes = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of antes) await c.query(s);
    const resultados = [];
    for (const p of passos) {
      await c.query("RESET ROLE");
      await entrar(c, p.q);
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(p.sql, p.params || []);
        resultados.push({ ok: true, rows: r.rows, n: r.rowCount });
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        resultados.push({ ok: false, code: e.code, message: e.message });
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    await c.query("RESET ROLE");
    const estado = {};
    for (const id of ids) {
      const l = (
        await c.query(
          `SELECT u.raw_app_meta_data ->> 'role' AS a, p.role AS p
             FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = $1`,
          [id],
        )
      ).rows[0];
      estado[id] = [l.a, l.p];
    }
    const log = (
      await c.query(
        "SELECT quem, alvo, de_cargo, para_cargo FROM public.cargo_log ORDER BY alvo, para_cargo, de_cargo",
      )
    ).rows;
    return { resultados, estado, log };
  } finally {
    await c.query("ROLLBACK");
  }
}

// O papel (auth.users, profiles) de cada fixture FORA de qualquer transação de teste.
async function papeisCommitados(c, ids) {
  const out = {};
  for (const id of ids) {
    const l = (
      await c.query(
        `SELECT u.raw_app_meta_data ->> 'role' AS a, p.role AS p
           FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = $1`,
        [id],
      )
    ).rows[0];
    out[id] = [l.a, l.p];
  }
  return out;
}

const ESTADO_INICIAL = {
  [U_DONO]: ["admin", "admin"],
  [U_ADM]: ["admin", "admin"],
  [U_ADM2]: ["admin", "admin"],
  [U_ALVO]: ["customer", "customer"],
  [U_CLI]: ["customer", "customer"],
  [U_REB_PERFIL]: ["admin", "customer"],
  [U_REB_AUTH]: ["customer", "admin"],
  [U_DONO_FRACO]: ["customer", "customer"],
};
const TODOS = Object.keys(ESTADO_INICIAL);

// Devolve as fixtures ao estado inicial (as poucas provas que gravam de verdade chamam isto no fim).
async function restaurarFixtures(c) {
  // Como o postgres (a automação de confiança): o prevent_role_change da 20261199 não deixa a sessão de login direto
  // (GUC role = none, sem JWT nem uid) mudar papel.
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE postgres");
    for (const [id, [a, p]] of Object.entries(ESTADO_INICIAL)) {
      await c.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [
        id,
        p,
      ]);
      await c.query(
        `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', $2::text) WHERE id = $1`,
        [id, a],
      );
    }
    await c.query("DELETE FROM public.cargo_log");
    await c.query("DELETE FROM public.dono_da_loja");
    await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
      U_DONO,
    ]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  assert.deepEqual(await papeisCommitados(c, TODOS), ESTADO_INICIAL);
}

// O CREATE OR REPLACE de uma função como está na migration.
function ddlFuncao(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `${nome} não está no arquivo`);
  const abre = sql.indexOf("$function$", i);
  const fecha = sql.indexOf("$function$;", abre + 10) + "$function$;".length;
  return sql.slice(i, fecha);
}
function mutar(ddl, de, para) {
  assert.ok(
    ddl.includes(de),
    `trecho do mutante não achado: ${de.slice(0, 60)}`,
  );
  return ddl.replace(de, para);
}
// O texto dos mutantes sai do arquivo normalizado para LF (o checkout do Windows pode trazer CRLF).
const MIGRATION_LF = MIGRATION.replace(/\r\n/g, "\n");
const DDL_DEFINIR = ddlFuncao(MIGRATION_LF, "definir_cargo");
const DDL_GATILHO = ddlFuncao(MIGRATION_LF, "papel_so_pelo_definir_cargo");

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de tabela/coluna, deparseadas com
// search_path = pg_catalog.
async function digital(c) {
  await c.query("SET search_path = pg_catalog");
  try {
    const r = await c.query(`
      SELECT 'fn ' || p.oid::regprocedure::text AS k,
             concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                       p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                       p.provolatile::text, p.proowner::regrole::text,
                       pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS v
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'tg ' || c.oid::regclass::text || '.' || t.tgname,
             concat_ws(' | ', pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgtype::text)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
             concat_ws(' | ', coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
                       pol.polroles::regrole[]::text, pol.polcmd::text, pol.polpermissive::text)
        FROM pg_policy pol
      UNION ALL
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '') || ' rls=' || c.relrowsecurity::text
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname,
             concat_ws(' | ', coalesce(a.attacl::text, ''), format_type(a.atttypid, a.atttypmod), a.attnotnull::text)
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('dono_da_loja', 'cargo_log') AND a.attnum > 0 AND NOT a.attisdropped`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

function diferencas(antes, depois) {
  const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  return [...chaves].filter((k) => antes[k] !== depois[k]).sort();
}

const fx = {};
const PROVAS = [];

// ---------------------------------------------------------------------------------------------------------------------
// (0) fixtures
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(0) fixtures: dono cadastrado pelo comando EXATO do comentário da migration, admins, cliente, contradições e auth.role() como o do Supabase",
  corpo: async (c) => {
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    // O auth.role() REAL (lê o 'role' do JWT). O stub do provisionar devolve NULL e o ensure_role_protection nunca age.
    await c.query(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text $$`);
    for (const id of [...TODOS]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@cargo.teste', '{}'::jsonb)`,
        [id],
      );
    }
    // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia).
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Dono', 'admin'), ($2, 'Admin', 'admin'), ($3, 'Admin dois', 'admin'), ($4, 'Alvo', 'customer'),
         ($5, 'Cliente', 'customer'), ($6, 'Rebaixado perfil', 'customer'), ($7, 'Rebaixado auth', 'admin'),
         ($8, 'Dono fraco', 'customer')`,
      [
        U_DONO,
        U_ADM,
        U_ADM2,
        U_ALVO,
        U_CLI,
        U_REB_PERFIL,
        U_REB_AUTH,
        U_DONO_FRACO,
      ],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_REB_PERFIL],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
      [U_REB_AUTH],
    );
    assert.deepEqual(await papeisCommitados(c, TODOS), ESTADO_INICIAL);

    // O comando de cadastro que a migration e o rollback anunciam, executado como está escrito (só o uuid é trocado).
    for (const [onde, texto] of [
      ["migration", MIGRATION],
      ["rollback", ROLLBACK],
    ]) {
      const m = texto.match(
        /INSERT INTO public\.dono_da_loja \(user_id\) VALUES \('<uuid-do-dono-em-auth\.users>'\);/,
      );
      assert.ok(
        m,
        `o comando de cadastro do dono não está no comentário da ${onde}`,
      );
    }
    const cmd = MIGRATION.match(
      /INSERT INTO public\.dono_da_loja \(user_id\) VALUES \('<uuid-do-dono-em-auth\.users>'\);/,
    )[0].replace("<uuid-do-dono-em-auth.users>", U_DONO);
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.dono_da_loja"))
        .rows[0].n,
      0,
      "a migration nasce com a tabela do dono VAZIA (sem seed)",
    );
    await c.query(cmd);
    assert.equal(
      (await c.query("SELECT user_id FROM public.dono_da_loja")).rows[0]
        .user_id,
      U_DONO,
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.cargo_log")).rows[0]
        .n,
      0,
    );
    fx.digitalInicial = await digital(c);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (1) o dono nomeia e remove
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(1) o dono nomeia e remove: as duas fontes mudam juntas, o recém-nomeado passa a ser admin ATUAL, o removido deixa de ser, e cada mudança vira uma linha de log",
  corpo: async (c) => {
    const r = await rodar(
      c,
      [
        P("dono", CALL(U_ALVO, "admin")),
        P("alvo", ["SELECT public.rls_admin_atual() AS r"]),
        P("dono", CALL(U_ADM2, "customer")),
        P("dono", CALL(U_ALVO, "customer")),
        P("alvo", ["SELECT public.rls_admin_atual() AS r"]),
      ],
      { ids: [U_ALVO, U_ADM2] },
    );
    const [nomeia, alvoAdmin, remove, tira, alvoSemAdmin] = r.resultados;
    assert.ok(nomeia.ok, nomeia.message);
    assert.deepEqual(nomeia.rows[0].r, {
      user_id: U_ALVO,
      de: "customer",
      para: "admin",
      mudou: true,
    });
    assert.equal(alvoAdmin.rows[0].r, true, "o nomeado não virou admin ATUAL");
    assert.ok(remove.ok, remove.message);
    assert.deepEqual(remove.rows[0].r, {
      user_id: U_ADM2,
      de: "admin",
      para: "customer",
      mudou: true,
    });
    assert.ok(tira.ok, tira.message);
    assert.equal(
      alvoSemAdmin.rows[0].r,
      false,
      "o removido continua admin ATUAL",
    );
    assert.deepEqual(r.estado[U_ALVO], ["customer", "customer"]);
    assert.deepEqual(r.estado[U_ADM2], ["customer", "customer"]);
    assert.deepEqual(r.log, [
      { quem: U_DONO, alvo: U_ADM2, de_cargo: "admin", para_cargo: "customer" },
      { quem: U_DONO, alvo: U_ALVO, de_cargo: "customer", para_cargo: "admin" },
      { quem: U_DONO, alvo: U_ALVO, de_cargo: "admin", para_cargo: "customer" },
    ]);
    // Só a nomeação (sem a remoção): as duas fontes dizem admin ao mesmo tempo.
    const so = await rodar(c, [P("dono", CALL(U_ALVO, "admin"))], {
      ids: [U_ALVO],
    });
    assert.deepEqual(so.estado[U_ALVO], ["admin", "admin"]);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) o nomeado NÃO nomeia
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(2) quem não é o dono não define cargo: admin atual, o recém-nomeado, ex-admin nas duas direções, cliente, anon, service_role e o dono do Postgres sem sessão são recusados e NADA muda",
  corpo: async (c) => {
    const tentativas = [
      ["adm", U_ALVO, "admin"],
      ["adm", U_ADM2, "customer"],
      ["adm", U_DONO, "customer"],
      ["adm2", U_ALVO, "admin"],
      ["rebaixadoPerfil", U_ALVO, "admin"],
      ["rebaixadoAuth", U_ALVO, "admin"],
      ["cliente", U_ALVO, "admin"],
      ["cliente", U_CLI, "admin"],
      ["donoFraco", U_ALVO, "admin"],
    ];
    for (const [quem, alvo, cargo] of tentativas) {
      const r = await rodar(c, [P(quem, CALL(alvo, cargo))], { ids: TODOS });
      const x = r.resultados[0];
      assert.equal(x.ok, false, `${quem} definiu cargo`);
      assert.equal(x.code, "42501", `${quem}: ${x.message}`);
      assert.match(x.message, /dono da loja/, quem);
      assert.deepEqual(r.estado, ESTADO_INICIAL, `${quem} mudou algum papel`);
      assert.deepEqual(r.log, [], `${quem} deixou log`);
    }
    // O recém-promovido (banco diz admin, JWT diz customer) também não nomeia, e a remoção por ele também não vale.
    const promovido = await rodar(
      c,
      [
        P("dono", CALL(U_ALVO, "admin")),
        P("alvo", CALL(U_CLI, "admin")),
        P("alvo", CALL(U_ADM, "customer")),
      ],
      { ids: [U_CLI, U_ADM] },
    );
    assert.equal(promovido.resultados[1].ok, false);
    assert.equal(promovido.resultados[1].code, "42501");
    assert.equal(promovido.resultados[2].ok, false);
    assert.deepEqual(promovido.estado[U_CLI], ["customer", "customer"]);
    assert.deepEqual(promovido.estado[U_ADM], ["admin", "admin"]);
    // Papéis sem EXECUTE: o Postgres recusa antes de chegar ao corpo.
    for (const quem of ["anon", "service"]) {
      const r = await rodar(c, [P(quem, CALL(U_ALVO, "admin"))], {
        ids: [U_ALVO],
      });
      assert.equal(r.resultados[0].ok, false, quem);
      assert.equal(
        r.resultados[0].code,
        "42501",
        `${quem}: ${r.resultados[0].message}`,
      );
      assert.match(
        r.resultados[0].message,
        /permission denied for function definir_cargo/,
        quem,
      );
      assert.deepEqual(r.estado[U_ALVO], ["customer", "customer"]);
    }
    // O dono do Postgres executa a função, mas não tem sessão (auth.uid() nulo): recusa.
    const pg = await rodar(c, [P("postgres", CALL(U_ALVO, "admin"))], {
      ids: [U_ALVO],
    });
    assert.equal(pg.resultados[0].code, "42501");
    assert.match(pg.resultados[0].message, /dono da loja/);
    assert.deepEqual(pg.estado[U_ALVO], ["customer", "customer"]);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (3) ninguém rebaixa o dono
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(3) ninguém rebaixa o dono: nem o próprio dono pela função, nem admin por PATCH, nem o dono por PATCH; auth.users não é gravável por aplicação",
  corpo: async (c) => {
    const r = await rodar(
      c,
      [
        P("dono", CALL(U_DONO, "customer")),
        P("dono", CALL(U_DONO, "admin")),
        P("adm", PATCH(U_DONO, "customer")),
        P("dono", PATCH(U_DONO, "customer")),
        P("adm", [
          'UPDATE auth.users SET raw_app_meta_data = \'{"role":"customer"}\'::jsonb WHERE id = $1',
          [U_DONO],
        ]),
        P("adm", CALL(U_DONO, "customer")),
      ],
      { ids: [U_DONO] },
    );
    const [funcao, funcaoIgual, patch, patchDono, authDireto, nomeado] =
      r.resultados;
    assert.equal(funcao.ok, false);
    assert.equal(funcao.code, "42501");
    assert.match(funcao.message, /dono da loja não muda/);
    assert.equal(
      funcaoIgual.ok,
      false,
      "até o 'cargo igual' no dono é recusado (resposta uniforme)",
    );
    assert.equal(patch.ok, false);
    assert.equal(patch.code, "42501");
    assert.match(patch.message, /definir_cargo/);
    assert.equal(patchDono.ok, false);
    assert.equal(patchDono.code, "42501");
    assert.equal(authDireto.ok, false);
    assert.equal(authDireto.code, "42501", authDireto.message);
    assert.equal(nomeado.ok, false);
    assert.deepEqual(r.estado[U_DONO], ["admin", "admin"]);
    assert.deepEqual(r.log, []);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (4) PATCH direto em profiles.role
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(4) PATCH direto em profiles.role: admin atual e o próprio dono recebem 42501 (statement inteiro desfeito); cliente continua desfeito EM SILÊNCIO; o resto do perfil segue editável; GUC forjado não abre a janela",
  corpo: async (c) => {
    const r = await rodar(
      c,
      [
        P("adm", PATCH(U_ALVO, "admin")), // 0 admin atual promove
        P("adm", PATCH(U_ADM2, "customer")), // 1 admin atual rebaixa outro admin
        P("dono", PATCH(U_ALVO, "admin")), // 2 o próprio dono por PATCH
        P("adm", [
          "UPDATE public.profiles SET role = 'admin' WHERE id = ANY($1::uuid[])",
          [[U_ALVO, U_CLI]],
        ]), // 3 varios
        P("cliente", PATCH(U_CLI, "admin")), // 4 cliente se promove: silêncio
        P("rebaixadoAuth", PATCH(U_ALVO, "admin")), // 5 ex-admin promove cúmplice
        P("adm", [
          "UPDATE public.profiles SET full_name = 'Nome novo' WHERE id = $1",
          [U_ALVO],
        ]), // 6 resto do perfil
        P("alvo", [
          "UPDATE public.profiles SET full_name = 'Eu mesmo' WHERE id = $1",
          [U_ALVO],
        ]), // 7 o próprio perfil
        P("adm", PATCH(U_ALVO, "customer")), // 8 regravar o MESMO papel não é mudança
        // 9-10 GUC da janela forjado por quem tem SQL: current_user continua authenticated, não vale
        P("adm", [
          "SELECT set_config('ikcous.definir_cargo', $1::text || ':admin', true)",
          [U_ALVO],
        ]),
        P("adm", PATCH(U_ALVO, "admin")),
      ],
      { ids: [U_ALVO, U_ADM2, U_CLI] },
    );
    const x = r.resultados;
    for (const i of [0, 1, 2, 3]) {
      assert.equal(x[i].ok, false, `passo ${i}: PATCH de papel passou`);
      assert.equal(x[i].code, "42501", `passo ${i}: ${x[i].message}`);
      assert.match(x[i].message, /definir_cargo/);
    }
    assert.equal(x[4].ok, true, `cliente: ${x[4].message}`);
    assert.equal(x[4].n, 1, "o UPDATE do cliente em si atingiu a linha");
    assert.equal(
      x[5].ok,
      true,
      "o ex-admin com JWT velho nem alcança a linha do alvo ou é desfeito em silêncio",
    );
    assert.equal(x[6].ok, true, x[6].message);
    assert.equal(x[7].ok, true, x[7].message);
    assert.equal(x[8].ok, true, x[8].message);
    assert.equal(x[10].ok, false, "GUC forjado abriu a janela do gatilho");
    assert.equal(x[10].code, "42501");
    assert.deepEqual(r.estado[U_ALVO], ["customer", "customer"]);
    assert.deepEqual(r.estado[U_ADM2], ["admin", "admin"]);
    assert.deepEqual(r.estado[U_CLI], ["customer", "customer"]);
    assert.deepEqual(r.log, []);

    // CONTROLE: sem o gatilho novo o PATCH do admin atual passa (é ELE que fecha a porta).
    const sem = await rodar(c, [P("adm", PATCH(U_ALVO, "admin"))], {
      ids: [U_ALVO],
      antes: ["DROP TRIGGER tr_papel_so_pelo_definir_cargo ON public.profiles"],
    });
    assert.equal(
      sem.resultados[0].ok,
      true,
      "CONTROLE FALHOU: sem o gatilho o PATCH deveria passar",
    );
    assert.deepEqual(
      sem.estado[U_ALVO][1],
      "admin",
      "CONTROLE: sem o gatilho o papel muda",
    );

    // A automação de confiança segue podendo (decisão declarada na migration): service_role, postgres e a sessão de login
    // direto. Elas já escrevem auth.users e qualquer tabela; o que se fecha aqui é o papel de APLICAÇÃO.
    // (No Supabase real o service_role tem BYPASSRLS; o papel emulado do provisionar não tem, então a prova o concede
    // dentro da transação desfeita para o UPDATE chegar à linha e ao gatilho.)
    for (const quem of ["service", "postgres"]) {
      const a = await rodar(c, [P(quem, PATCH(U_ALVO, "admin"))], {
        ids: [U_ALVO],
        antes: ["ALTER ROLE service_role BYPASSRLS"],
      });
      assert.equal(
        a.resultados[0].ok,
        true,
        `${quem}: ${a.resultados[0].message}`,
      );
      assert.deepEqual(
        a.estado[U_ALVO],
        ["admin", "admin"],
        `${quem}: o gatilho de sincronia leva ao auth.users`,
      );
    }
    // A sessão de login direto (GUC role = none) não ganha restrição NOVA: quem decide por ela segue sendo o
    // prevent_role_change (is_admin() é falso sem JWT nem uid), como antes da migration. O gatilho novo não a recusa
    // por conta própria: com ele fora do caminho o resultado é o MESMO.
    const mensagemDireta = async (antes) => {
      await c.query("BEGIN");
      try {
        for (const s of antes) await c.query(s);
        await c.query("SAVEPOINT s");
        try {
          await c.query(
            "UPDATE public.profiles SET role = 'admin' WHERE id = $1",
            [U_ALVO],
          );
          return "passou";
        } catch (e) {
          return e.message;
        }
      } finally {
        await c.query("ROLLBACK");
      }
    };
    const comGatilho = await mensagemDireta([]);
    const semGatilho = await mensagemDireta([
      "DROP TRIGGER tr_papel_so_pelo_definir_cargo ON public.profiles",
    ]);
    assert.equal(
      comGatilho,
      semGatilho,
      "o gatilho novo mudou o que a sessão de login direto já via",
    );
    assert.match(comGatilho, /Unauthorized: You cannot change your own role/);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (5) o log e a leitura/escrita das duas tabelas
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(5) cargo_log e dono_da_loja: uma linha por mudança (nenhuma por repetição), divergência entre as fontes corrigida e registrada; leitura só do dono e do admin atual; escrita por ninguém de aplicação",
  corpo: async (c) => {
    // Repetir o mesmo cargo é no-op.
    const rep = await rodar(
      c,
      [
        P("dono", CALL(U_ALVO, "admin")),
        P("dono", CALL(U_ALVO, "admin")),
        P("dono", CALL(U_CLI, "customer")),
      ],
      { ids: [U_ALVO, U_CLI] },
    );
    assert.equal(rep.resultados[0].rows[0].r.mudou, true);
    assert.deepEqual(rep.resultados[1].rows[0].r, {
      user_id: U_ALVO,
      de: "admin",
      para: "admin",
      mudou: false,
    });
    assert.deepEqual(rep.resultados[2].rows[0].r, {
      user_id: U_CLI,
      de: "customer",
      para: "customer",
      mudou: false,
    });
    assert.deepEqual(rep.log, [
      { quem: U_DONO, alvo: U_ALVO, de_cargo: "customer", para_cargo: "admin" },
    ]);

    // A divergência entre as fontes: a trava da 20261199 (so sincroniza quando profiles.role MUDA) deixaria o auth.users
    // como estava; a função força a escrita e registra.
    const div = await rodar(
      c,
      [
        P("dono", CALL(U_REB_PERFIL, "customer")),
        P("dono", CALL(U_REB_AUTH, "admin")),
      ],
      { ids: [U_REB_PERFIL, U_REB_AUTH] },
    );
    assert.deepEqual(div.resultados[0].rows[0].r, {
      user_id: U_REB_PERFIL,
      de: "admin",
      para: "customer",
      mudou: true,
    });
    assert.deepEqual(div.resultados[1].rows[0].r, {
      user_id: U_REB_AUTH,
      de: "customer",
      para: "admin",
      mudou: true,
    });
    assert.deepEqual(
      div.estado[U_REB_PERFIL],
      ["customer", "customer"],
      "o rebaixado só no profiles seguia admin em auth.users",
    );
    assert.deepEqual(div.estado[U_REB_AUTH], ["admin", "admin"]);
    assert.deepEqual(div.log, [
      {
        quem: U_DONO,
        alvo: U_REB_PERFIL,
        de_cargo: "admin",
        para_cargo: "customer",
      },
      {
        quem: U_DONO,
        alvo: U_REB_AUTH,
        de_cargo: "customer",
        para_cargo: "admin",
      },
    ]);

    // Leitura.
    const linha = `INSERT INTO public.cargo_log (quem, alvo, de_cargo, para_cargo) VALUES ('${U_DONO}', '${U_ALVO}', 'customer', 'admin')`;
    const contar = (t) => [`SELECT count(*)::int AS n FROM public.${t}`];
    const leitura = await rodar(
      c,
      [
        ...["dono", "adm", "cliente", "alvo", "rebaixadoAuth"].flatMap((q) => [
          P(q, contar("cargo_log")),
          P(q, contar("dono_da_loja")),
        ]),
        P("anon", contar("cargo_log")),
        P("anon", contar("dono_da_loja")),
      ],
      { antes: [linha] },
    );
    const n = (i) => leitura.resultados[i].rows[0].n;
    assert.deepEqual([n(0), n(1)], [1, 1], "o dono lê o log e a própria linha");
    assert.deepEqual(
      [n(2), n(3)],
      [1, 1],
      "o admin atual lê o log e a linha do dono",
    );
    assert.deepEqual([n(4), n(5)], [0, 0], "cliente não lê nada");
    assert.deepEqual(
      [n(6), n(7)],
      [0, 0],
      "o recém-sem-cargo (JWT velho) não lê nada",
    );
    assert.deepEqual(
      [n(8), n(9)],
      [0, 0],
      "o ex-admin (so no profiles) não lê nada",
    );
    for (const i of [10, 11]) {
      assert.equal(leitura.resultados[i].ok, false);
      assert.equal(leitura.resultados[i].code, "42501", "anon sem SELECT");
    }

    // Escrita: nenhum papel de aplicação, nem o dono, nem o admin atual, nem service_role.
    const escritas = [
      [
        "INSERT INTO public.cargo_log (quem, alvo, para_cargo) VALUES ($1, $2, 'admin')",
        [U_DONO, U_ALVO],
      ],
      ["UPDATE public.cargo_log SET para_cargo = 'customer'", []],
      ["DELETE FROM public.cargo_log", []],
      ["TRUNCATE public.cargo_log", []],
      ["INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [U_ALVO]],
      ["UPDATE public.dono_da_loja SET user_id = $1", [U_ALVO]],
      ["DELETE FROM public.dono_da_loja", []],
      ["TRUNCATE public.dono_da_loja", []],
    ];
    for (const quem of ["dono", "adm", "cliente", "service", "anon"]) {
      for (const [sql, params] of escritas) {
        const r = await rodar(c, [P(quem, [sql, params])], { antes: [linha] });
        assert.equal(r.resultados[0].ok, false, `${quem} conseguiu: ${sql}`);
        assert.equal(
          r.resultados[0].code,
          "42501",
          `${quem}: ${sql} -> ${r.resultados[0].message}`,
        );
      }
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (6) EXECUTE
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(6) EXECUTE: definir_cargo só para authenticated (anon, PUBLIC e service_role sem); o gatilho não é executável por ninguém de aplicação; ambas SECURITY como o desenho manda",
  corpo: async (c) => {
    const f = (
      await c.query(`
        SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS dono,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
               EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
          FROM pg_proc p WHERE p.oid = 'public.definir_cargo(uuid,text)'::regprocedure`)
    ).rows[0];
    assert.deepEqual(
      [f.prosecdef, f.anon, f.authenticated, f.service, f.publico],
      [true, false, true, false, false],
    );
    assert.deepEqual(
      f.proconfig,
      ["search_path=pg_catalog, pg_temp"],
      "search_path fixo, sem public",
    );
    const g = (
      await c.query(`
        SELECT p.prosecdef,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
               EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
          FROM pg_proc p WHERE p.oid = 'public.papel_so_pelo_definir_cargo()'::regprocedure`)
    ).rows[0];
    assert.deepEqual(
      [g.prosecdef, g.anon, g.authenticated, g.service, g.publico],
      [false, false, false, false, false],
    );
    // E o gatilho dispara para quem não tem EXECUTE nele (o Postgres só confere o privilégio ao criar o gatilho).
    const r = await rodar(c, [P("adm", PATCH(U_ALVO, "admin"))], {
      ids: [U_ALVO],
    });
    assert.equal(r.resultados[0].code, "42501");
    assert.match(
      r.resultados[0].message,
      /definir_cargo/,
      "o gatilho tem de ter disparado (não 'permission denied for function')",
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (7) bordas
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(7a) entradas: cargo inválido, pessoa inexistente e nula; quem não é o dono recebe a recusa de dono ANTES de qualquer validação (sem oráculo)",
  corpo: async (c) => {
    for (const cargo of [
      "gerente",
      "vendedor",
      "Admin",
      "administrador",
      "cliente",
      "",
      null,
    ]) {
      const r = await rodar(c, [P("dono", CALL(U_ALVO, cargo))], {
        ids: [U_ALVO],
      });
      assert.equal(
        r.resultados[0].ok,
        false,
        `cargo ${JSON.stringify(cargo)} passou`,
      );
      assert.equal(
        r.resultados[0].code,
        "22023",
        `${cargo}: ${r.resultados[0].message}`,
      );
      assert.deepEqual(r.estado[U_ALVO], ["customer", "customer"]);
      assert.deepEqual(r.log, []);
    }
    const nula = await rodar(c, [
      P("dono", ["SELECT public.definir_cargo(NULL::uuid, 'admin')"]),
    ]);
    assert.equal(nula.resultados[0].code, "22023");
    const fantasma = await rodar(c, [P("dono", CALL(U_FANTASMA, "admin"))]);
    assert.equal(fantasma.resultados[0].code, "P0002");
    assert.match(fantasma.resultados[0].message, /não encontrada/);
    // Sem oráculo: o cliente com entrada inválida e pessoa inexistente recebe a MESMA recusa de dono.
    for (const [alvo, cargo] of [
      [U_FANTASMA, "admin"],
      [U_ALVO, "gerente"],
      [U_ALVO, null],
    ]) {
      const r = await rodar(c, [P("cliente", CALL(alvo, cargo))]);
      assert.equal(
        r.resultados[0].code,
        "42501",
        `${alvo}/${cargo}: ${r.resultados[0].message}`,
      );
      assert.match(r.resultados[0].message, /dono da loja/);
    }
    // O cargo antigo 'gerente' (existe no CHECK, nenhuma regra o usa): sai e entra pelos dois cargos reais.
    const g = await rodar(
      c,
      [P("dono", CALL(U_ALVO, "customer")), P("dono", CALL(U_ALVO, "admin"))],
      {
        ids: [U_ALVO],
        antes: [
          "SET LOCAL ROLE postgres",
          `UPDATE public.profiles SET role = 'gerente' WHERE id = '${U_ALVO}'`,
          "RESET ROLE",
        ],
      },
    );
    assert.deepEqual(g.resultados[0].rows[0].r, {
      user_id: U_ALVO,
      de: "gerente",
      para: "customer",
      mudou: true,
    });
    assert.deepEqual(g.resultados[1].rows[0].r, {
      user_id: U_ALVO,
      de: "customer",
      para: "admin",
      mudou: true,
    });
    assert.deepEqual(g.estado[U_ALVO], ["admin", "admin"]);
  },
});

PROVAS.push({
  nome: "(7b) dono não cadastrado: NINGUÉM define cargo (nem quem seria o dono) e o PATCH continua fechado; singleton, FK e RESTRICT da tabela do dono",
  corpo: async (c) => {
    const sem = await rodar(
      c,
      [
        P("dono", CALL(U_ALVO, "admin")),
        P("adm", CALL(U_ALVO, "admin")),
        P("adm", PATCH(U_ALVO, "admin")),
        P("dono", PATCH(U_ALVO, "admin")),
      ],
      { ids: [U_ALVO], antes: ["DELETE FROM public.dono_da_loja"] },
    );
    for (const i of [0, 1, 2, 3]) {
      assert.equal(sem.resultados[i].ok, false, `passo ${i}`);
      assert.equal(sem.resultados[i].code, "42501");
    }
    assert.deepEqual(sem.estado[U_ALVO], ["customer", "customer"]);

    // Singleton: uma linha por banco.
    for (const [sql, code, rotulo] of [
      [
        `INSERT INTO public.dono_da_loja (user_id) VALUES ('${U_ADM}')`,
        "23505",
        "segunda linha",
      ],
      [
        `INSERT INTO public.dono_da_loja (loja, user_id) VALUES (false, '${U_ADM}')`,
        "23514",
        "loja=false",
      ],
      [
        `INSERT INTO public.dono_da_loja (user_id) VALUES ('${U_FANTASMA}')`,
        "23505",
        "segunda linha (a PK barra antes da FK)",
      ],
      [
        `DELETE FROM auth.users WHERE id = '${U_DONO}'`,
        "23503",
        "apagar a conta do dono (RESTRICT)",
      ],
    ]) {
      await c.query("BEGIN");
      try {
        await assert.rejects(c.query(sql), (e) => e.code === code, rotulo);
      } finally {
        await c.query("ROLLBACK");
      }
    }
    await c.query("BEGIN");
    try {
      await c.query("DELETE FROM public.dono_da_loja");
      await assert.rejects(
        c.query(
          `INSERT INTO public.dono_da_loja (user_id) VALUES ('${U_FANTASMA}')`,
        ),
        (e) => e.code === "23503",
        "dono que não é conta",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(7c) dono que não é admin nas duas fontes: a função ABORTA (o papel não grava), nada fica pela metade e a janela do gatilho NÃO fica aberta; transação desfeita não deixa nada",
  corpo: async (c) => {
    const trocar = [
      "DELETE FROM public.dono_da_loja",
      `INSERT INTO public.dono_da_loja (user_id) VALUES ('${U_DONO_FRACO}')`,
    ];
    const r = await rodar(
      c,
      [
        P("donoFraco", CALL(U_ALVO, "admin")),
        P("donoFraco", [
          "SELECT coalesce(current_setting('ikcous.definir_cargo', true), '') AS flag",
        ]),
        P("adm", PATCH(U_ALVO, "admin")),
      ],
      { ids: [U_ALVO], antes: trocar },
    );
    assert.equal(r.resultados[0].ok, false);
    assert.equal(r.resultados[0].code, "42501");
    assert.match(r.resultados[0].message, /não foi gravado/);
    assert.equal(
      r.resultados[1].rows[0].flag,
      "",
      "a janela do gatilho ficou aberta depois do erro",
    );
    assert.equal(
      r.resultados[2].code,
      "42501",
      "com a janela aberta o admin atual teria promovido por PATCH",
    );
    assert.deepEqual(r.estado[U_ALVO], ["customer", "customer"]);
    assert.deepEqual(r.log, []);

    // Transação interrompida: a função funciona e a transação é desfeita; nada vaza para o banco real.
    await c.query("BEGIN");
    await entrar(c, "dono");
    const ok = await c.query(...CALL(U_ALVO, "admin"));
    assert.equal(ok.rows[0].r.mudou, true);
    await c.query("ROLLBACK");
    assert.deepEqual(await papeisCommitados(c, [U_ALVO]), {
      [U_ALVO]: ["customer", "customer"],
    });
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.cargo_log")).rows[0]
        .n,
      0,
    );
    // E o erro dentro de uma transação maior desfaz só o savepoint: a janela é local à transação.
    const flag = await rodar(c, [
      P("dono", [
        "SELECT current_setting('ikcous.definir_cargo', true) AS flag",
      ]),
    ]);
    assert.ok([null, ""].includes(flag.resultados[0].rows[0].flag));
  },
});

PROVAS.push({
  nome: "(7d) duas chamadas simultâneas sobre a MESMA pessoa se enfileiram (a segunda espera o COMMIT da primeira e vê o resultado dela); sobre pessoas diferentes não se esperam",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();
    try {
      await restaurarFixtures(c);
      const esperando = async (cliente) => {
        for (let i = 0; i < 100; i++) {
          const r = await c.query(
            `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`,
            [cliente.processID],
          );
          if (r.rowCount === 1) return true;
          await new Promise((res) => setTimeout(res, 50));
        }
        return false;
      };
      await a.query("BEGIN");
      await entrar(a, "dono");
      const primeira = await a.query(...CALL(U_ALVO, "admin"));
      assert.equal(primeira.rows[0].r.mudou, true);
      // B: outra pessoa NÃO espera.
      await b.query("BEGIN");
      await entrar(b, "dono");
      const outra = await b.query(...CALL(U_CLI, "admin"));
      assert.equal(
        outra.rows[0].r.mudou,
        true,
        "pessoas diferentes não se esperam",
      );
      await b.query("ROLLBACK");
      // B: a MESMA pessoa espera.
      await b.query("BEGIN");
      await entrar(b, "dono");
      const segunda = b.query(...CALL(U_ALVO, "customer"));
      assert.equal(
        await esperando(b),
        true,
        "a segunda chamada não esperou a trava da pessoa",
      );
      await a.query("COMMIT");
      const dois = await segunda;
      await b.query("COMMIT");
      assert.deepEqual(
        dois.rows[0].r,
        { user_id: U_ALVO, de: "admin", para: "customer", mudou: true },
        "a segunda não viu o resultado da primeira",
      );
      assert.deepEqual(await papeisCommitados(c, [U_ALVO]), {
        [U_ALVO]: ["customer", "customer"],
      });
      const log = (
        await c.query(
          "SELECT de_cargo, para_cargo FROM public.cargo_log ORDER BY em, para_cargo",
        )
      ).rows;
      assert.equal(log.length, 2);
      assert.deepEqual(log.map((l) => `${l.de_cargo}>${l.para_cargo}`).sort(), [
        "admin>customer",
        "customer>admin",
      ]);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await restaurarFixtures(c);
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (8) ordem dos gatilhos, reaplicar, rollback, pré-voo, pós-voo
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(8a) ordem dos gatilhos BEFORE UPDATE de profiles: tr_ensure_role_protection < tr_papel_so_pelo_definir_cargo < tr_perfil_recusa_imagem_grande < tr_prevent_role_change",
  corpo: async (c) => {
    const r = await c.query(`
      SELECT array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C") AS ordem FROM pg_trigger t
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
         AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16`);
    assert.deepEqual(r.rows[0].ordem, [
      "tr_ensure_role_protection",
      "tr_papel_so_pelo_definir_cargo",
      "tr_perfil_recusa_imagem_grande",
      "tr_prevent_role_change",
    ]);
  },
});

PROVAS.push({
  nome: "(8b) reaplicar a migration 2x não muda a impressão digital nem as linhas (dono e log que já estavam lá)",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        "INSERT INTO public.cargo_log (quem, alvo, de_cargo, para_cargo) VALUES ($1, $2, 'customer', 'admin')",
        [U_DONO, U_ALVO],
      );
      const antes = await digital(c);
      assert.deepEqual(
        antes,
        fx.digitalInicial,
        "a árvore não é o estado que a prova (0) mediu",
      );
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), antes);
      assert.deepEqual(
        (await c.query("SELECT user_id FROM public.dono_da_loja")).rows,
        [{ user_id: U_DONO }],
      );
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.cargo_log"))
          .rows[0].n,
        1,
      );
      // CRLF (checkout do Windows) é aceito: o corpo é comparado sem CR.
      await c.query(MIGRATION.replace(/\r?\n/g, "\r\n"));
      assert.deepEqual(await digital(c), antes);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(8c) rollback comum: só os 5 objetos saem (gatilho, 2 funções, 2 políticas), as tabelas e as LINHAS ficam seladas, repetir é no-op, reaplicar volta ao estado; o destrutivo exige a confirmação e o rollback comum antes",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        "INSERT INTO public.cargo_log (quem, alvo, de_cargo, para_cargo) VALUES ($1, $2, 'customer', 'admin')",
        [U_DONO, U_ALVO],
      );
      const d0 = await digital(c);
      await c.query(ROLLBACK);
      const d1 = await digital(c);
      assert.deepEqual(diferencas(d0, d1), [
        "fn public.definir_cargo(uuid,text)",
        "fn public.papel_so_pelo_definir_cargo()",
        "pol public.cargo_log.cargo_log_select_policy",
        "pol public.dono_da_loja.dono_da_loja_select_policy",
        "tg public.profiles.tr_papel_so_pelo_definir_cargo",
      ]);
      assert.deepEqual(
        (await c.query("SELECT user_id FROM public.dono_da_loja")).rows,
        [{ user_id: U_DONO }],
      );
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.cargo_log"))
          .rows[0].n,
        1,
      );
      // Sem o gatilho a porta de antes volta (o efeito pretendido do rollback).
      await entrar(c, "adm");
      await c.query(...PATCH(U_ALVO, "admin"));
      await c.query("RESET ROLE");
      assert.equal(
        (
          await c.query("SELECT role FROM public.profiles WHERE id = $1", [
            U_ALVO,
          ])
        ).rows[0].role,
        "admin",
      );
      await c.query(
        "UPDATE public.profiles SET role = 'customer' WHERE id = $1",
        [U_ALVO],
      );
      // Repetir é no-op.
      await c.query(ROLLBACK);
      assert.deepEqual(await digital(c), d1);

      // O destrutivo: sem confirmação recusa; com confirmação mas ANTES do rollback comum, recusa.
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(DESTRUTIVO), /CARGOS_SO_COM_O_DONO/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query("SET LOCAL app.confirmo_apagar_cargos = 'APAGAR'");

      // Reaplicar sobre o estado de rollback (tabelas com linhas): volta exatamente ao da árvore, as linhas intactas.
      await c.query("SAVEPOINT r");
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), d0);
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.cargo_log"))
          .rows[0].n,
        1,
      );
      assert.deepEqual(
        (await c.query("SELECT user_id FROM public.dono_da_loja")).rows,
        [{ user_id: U_DONO }],
      );
      await assert.rejects(
        c.query(DESTRUTIVO),
        /CARGOS_ROLLBACK_COMUM_PRIMEIRO/,
      );
      await c.query("ROLLBACK TO SAVEPOINT r");

      // Depois do comum + confirmação: as duas tabelas saem (e só elas).
      await c.query(DESTRUTIVO);
      const d2 = await digital(c);
      assert.deepEqual(diferencas(d1, d2), [
        "acl public.cargo_log",
        "acl public.dono_da_loja",
        "col public.cargo_log.alvo",
        "col public.cargo_log.de_cargo",
        "col public.cargo_log.em",
        "col public.cargo_log.id",
        "col public.cargo_log.para_cargo",
        "col public.cargo_log.quem",
        "col public.dono_da_loja.desde",
        "col public.dono_da_loja.loja",
        "col public.dono_da_loja.user_id",
      ]);
      assert.equal(
        await c
          .query("SELECT to_regclass('public.cargo_log') IS NULL AS n")
          .then((x) => x.rows[0].n),
        true,
      );
      // E a migration reaplicada nasce com as tabelas VAZIAS (dado apagado não volta) e o resto igual à árvore.
      await c.query(MIGRATION);
      const d3 = await digital(c);
      assert.deepEqual(d3, d0);
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.dono_da_loja"))
          .rows[0].n,
        0,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(8d) pré-voo: 8 estados desconhecidos recusam com B1_BASELINE_DIVERGENT SEM escrever nada; rollback sobre corpo desconhecido recusa",
  corpo: async (c) => {
    const sabotagens = [
      [
        "rls_admin_atual sem EXECUTE para authenticated",
        "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
      ],
      [
        "tr_ensure_role_protection desligado",
        "ALTER TABLE public.profiles DISABLE TRIGGER tr_ensure_role_protection",
      ],
      [
        "ensure_role_protection com corpo diferente",
        "CREATE OR REPLACE FUNCTION public.ensure_role_protection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN RETURN NEW; END; $$",
      ],
      [
        "tr_prevent_role_change renomeado",
        "ALTER TRIGGER tr_prevent_role_change ON public.profiles RENAME TO tr_pa_prevent_role_change",
      ],
      [
        "dono_da_loja com coluna a mais",
        "ALTER TABLE public.dono_da_loja ADD COLUMN extra text",
      ],
      [
        "cargo_log sem a coluna de_cargo",
        "ALTER TABLE public.cargo_log DROP COLUMN de_cargo",
      ],
      [
        "definir_cargo com sobrecarga",
        "CREATE FUNCTION public.definir_cargo(uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
      ],
      [
        "gatilho nosso apontando para outra função",
        "CREATE OR REPLACE FUNCTION public.papel_so_pelo_definir_cargo() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$ BEGIN RETURN NEW; END; $$",
      ],
    ];
    for (const [rotulo, sql] of sabotagens) {
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query("SAVEPOINT s");
        await assert.rejects(
          c.query(MIGRATION),
          /B1_BASELINE_DIVERGENT/,
          rotulo,
        );
        await c.query("ROLLBACK TO SAVEPOINT s");
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // Pré-voo sem NADA escrito: no estado de rollback (objetos ausentes), a sabotagem faz o apply recusar e os objetos
    // continuam ausentes.
    await c.query("BEGIN");
    try {
      await c.query(ROLLBACK);
      await c.query(
        "ALTER TABLE public.profiles DISABLE TRIGGER tr_ensure_role_protection",
      );
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      assert.equal(
        (
          await c.query(
            "SELECT to_regprocedure('public.definir_cargo(uuid,text)') IS NULL AS n",
          )
        ).rows[0].n,
        true,
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_papel_so_pelo_definir_cargo'",
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // Rollback sobre corpo desconhecido (sucessora no ar): recusa e nada é apagado.
    await c.query("BEGIN");
    try {
      await c.query(
        DDL_DEFINIR.replace(
          "RETURN jsonb_build_object(",
          "RETURN jsonb_build_object('x', 1) || jsonb_build_object(",
        ),
      );
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_papel_so_pelo_definir_cargo'",
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(8e) pós-voo que falha desfaz TUDO numa conexão SEM BEGIN (como o aplicador): nada fica aplicado; depois de consertar, o apply fecha igual à árvore",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const cliente = new Client({ connectionString: url });
    await cliente.connect();
    try {
      // Estado de rollback (committed), com uma política a mais em cargo_log: o pré-voo não olha políticas, o pós-voo sim.
      await c.query(ROLLBACK);
      await c.query(
        "CREATE POLICY cargo_log_intrusa ON public.cargo_log FOR SELECT TO authenticated USING (true)",
      );
      await assert.rejects(cliente.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
      const depois = await c.query(`
        SELECT to_regprocedure('public.definir_cargo(uuid,text)') IS NULL AS sem_funcao,
               to_regprocedure('public.papel_so_pelo_definir_cargo()') IS NULL AS sem_gatilho_fn,
               NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_papel_so_pelo_definir_cargo') AS sem_gatilho,
               NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname IN ('dono_da_loja_select_policy', 'cargo_log_select_policy')) AS sem_politicas`);
      assert.deepEqual(
        depois.rows[0],
        {
          sem_funcao: true,
          sem_gatilho_fn: true,
          sem_gatilho: true,
          sem_politicas: true,
        },
        "o pós-voo falhou mas algo ficou gravado",
      );
    } finally {
      await cliente.end().catch(() => {});
      await c.query(
        "DROP POLICY IF EXISTS cargo_log_intrusa ON public.cargo_log",
      );
      await c.query(MIGRATION);
    }
    assert.deepEqual(
      await digital(c),
      fx.digitalInicial,
      "o apply final não fechou igual à árvore",
    );
    await restaurarFixtures(c);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (9) CONTROLES: sondas, o estado SEM a migration e os mutantes
// ---------------------------------------------------------------------------------------------------------------------
const SONDAS = {
  async dono_nomeia(c, antes) {
    const r = await rodar(c, [P("dono", CALL(U_ALVO, "admin"))], {
      ids: [U_ALVO],
      antes,
    });
    return r.resultados[0].ok && r.estado[U_ALVO].join() === "admin,admin";
  },
  async nomeado_nao_nomeia(c, antes) {
    const r = await rodar(c, [P("adm", CALL(U_ALVO, "admin"))], {
      ids: [U_ALVO],
      antes,
    });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.estado[U_ALVO].join() === "customer,customer"
    );
  },
  async dono_intocavel(c, antes) {
    const r = await rodar(
      c,
      [
        P("dono", CALL(U_DONO, "customer")),
        P("adm", PATCH(U_DONO, "customer")),
      ],
      { ids: [U_DONO], antes },
    );
    return (
      !r.resultados[0].ok &&
      !r.resultados[1].ok &&
      r.estado[U_DONO].join() === "admin,admin"
    );
  },
  async patch_admin_falha(c, antes) {
    const r = await rodar(c, [P("adm", PATCH(U_ALVO, "admin"))], {
      ids: [U_ALVO],
      antes,
    });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.estado[U_ALVO].join() === "customer,customer"
    );
  },
  async patch_cliente_em_silencio(c, antes) {
    const r = await rodar(c, [P("cliente", PATCH(U_CLI, "admin"))], {
      ids: [U_CLI],
      antes,
    });
    return r.resultados[0].ok && r.estado[U_CLI].join() === "customer,customer";
  },
  async guc_forjado_nao_vale(c, antes) {
    const r = await rodar(
      c,
      [
        P("adm", [
          "SELECT set_config('ikcous.definir_cargo', $1::text || ':admin', true)",
          [U_ALVO],
        ]),
        P("adm", PATCH(U_ALVO, "admin")),
      ],
      { ids: [U_ALVO], antes },
    );
    return (
      !r.resultados[1].ok && r.estado[U_ALVO].join() === "customer,customer"
    );
  },
  async auth_users_forcado(c, antes) {
    const r = await rodar(c, [P("dono", CALL(U_REB_PERFIL, "customer"))], {
      ids: [U_REB_PERFIL],
      antes,
    });
    return (
      r.resultados[0].ok &&
      r.estado[U_REB_PERFIL].join() === "customer,customer"
    );
  },
  async log_gravado(c, antes) {
    const r = await rodar(c, [P("dono", CALL(U_ALVO, "admin"))], { antes });
    return (
      r.log.length === 1 &&
      r.log[0].quem === U_DONO &&
      r.log[0].alvo === U_ALVO &&
      r.log[0].de_cargo === "customer" &&
      r.log[0].para_cargo === "admin"
    );
  },
  async cargo_invalido_recusado(c, antes) {
    const r = await rodar(c, [P("dono", CALL(U_ALVO, "gerente"))], {
      ids: [U_ALVO],
      antes,
    });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "22023" &&
      r.estado[U_ALVO].join() === "customer,customer"
    );
  },
  async anon_sem_execute(c, antes) {
    const r = await rodar(c, [P("anon", CALL(U_ALVO, "admin"))], {
      ids: [U_ALVO],
      antes,
    });
    return (
      !r.resultados[0].ok &&
      /permission denied/.test(r.resultados[0].message) &&
      r.estado[U_ALVO].join() === "customer,customer"
    );
  },
  async repetir_nao_suja_o_log(c, antes) {
    const r = await rodar(
      c,
      [P("dono", CALL(U_ALVO, "admin")), P("dono", CALL(U_ALVO, "admin"))],
      { antes },
    );
    return (
      r.resultados[1].ok &&
      r.resultados[1].rows[0].r.mudou === false &&
      r.log.length === 1
    );
  },
};

async function rodarSondas(c, antes = []) {
  const out = {};
  for (const [nome, sonda] of Object.entries(SONDAS)) {
    try {
      out[nome] = Boolean(await sonda(c, antes));
    } catch (_e) {
      out[nome] = false;
    }
  }
  return out;
}
const falhas = (s) =>
  Object.keys(s)
    .filter((k) => !s[k])
    .sort();

PROVAS.push({
  nome: "(9a) as 11 sondas valem no estado da árvore; SEM a migration (rollback) as que dependem dela REPROVAM — cada prova nova falha sem a mudança",
  corpo: async (c) => {
    assert.deepEqual(
      falhas(await rodarSondas(c)),
      [],
      "no estado da árvore todas as sondas valem",
    );
    const sem = await rodarSondas(c, [ROLLBACK]);
    // Sem a migration: ninguém nomeia pela função (ela não existe: 42883, não a recusa de dono), o PATCH do admin passa, o
    // dono é rebaixável por PATCH, o GUC forjado nem é lido, o log não existe e o anon não chega a uma porta que não existe.
    // A única sonda que vale dos dois lados é a da ORDEM (cliente desfeito em silêncio): só a regressão de nome a pega (M7).
    assert.deepEqual(
      falhas(sem),
      Object.keys(SONDAS)
        .filter((k) => k !== "patch_cliente_em_silencio")
        .sort(),
      "sem a migration todas as sondas (menos a da ordem) deveriam reprovar",
    );
    const nomeadoSem = await rodar(c, [P("adm", CALL(U_ALVO, "admin"))], {
      antes: [ROLLBACK],
    });
    assert.equal(
      nomeadoSem.resultados[0].code,
      "42883",
      "sem a migration o erro é função inexistente",
    );
  },
});

const MUTANTES = [
  {
    nome: "M1 o gate vira is_admin_atual() em vez do dono do banco",
    reprova: "nomeado_nao_nomeia",
    sql: () =>
      mutar(
        DDL_DEFINIR,
        "IF v_quem IS NULL OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem) THEN",
        "IF v_quem IS NULL OR NOT public.is_admin_atual() THEN",
      ),
  },
  {
    nome: "M2 sem a proteção do dono",
    reprova: "dono_intocavel",
    sql: () =>
      mutar(
        DDL_DEFINIR,
        "IF EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = p_user_id) THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M3 auth.users só é gravado se profiles mudou (a trava da 20261199)",
    reprova: "auth_users_forcado",
    sql: () =>
      mutar(
        DDL_DEFINIR,
        "     WHERE id = p_user_id\n       AND (raw_app_meta_data ->> 'role') IS DISTINCT FROM p_cargo;",
        "     WHERE id = p_user_id\n       AND false;",
      ),
  },
  {
    nome: "M4 sem o registro em cargo_log",
    reprova: "log_gravado",
    sql: () => mutar(DDL_DEFINIR, "IF v_mudou THEN", "IF false THEN"),
  },
  {
    nome: "M5 aceita qualquer cargo do CHECK (gerente, vendedor)",
    reprova: "cargo_invalido_recusado",
    sql: () =>
      mutar(
        DDL_DEFINIR,
        "OR p_cargo NOT IN ('admin', 'customer') THEN",
        "OR p_cargo NOT IN ('admin', 'customer', 'gerente', 'vendedor') THEN",
      ),
  },
  {
    nome: "M6 o gatilho deixa tudo passar",
    reprova: "patch_admin_falha",
    sql: () =>
      mutar(
        DDL_GATILHO,
        "    -- Nada a vigiar:",
        "    RETURN NEW;\n    -- Nada a vigiar:",
      ),
  },
  {
    nome: "M7 o gatilho com nome ANTES do tr_ensure_role_protection (a ordem alfabética)",
    reprova: "patch_cliente_em_silencio",
    sql: () =>
      "ALTER TRIGGER tr_papel_so_pelo_definir_cargo ON public.profiles RENAME TO tr_aaa_papel_so_pelo_definir_cargo",
  },
  {
    nome: "M8 o gatilho ignora a janela da função",
    reprova: "dono_nomeia",
    sql: () =>
      mutar(
        DDL_GATILHO,
        "    IF current_setting('ikcous.definir_cargo', true) = NEW.id::text",
        "    IF false AND current_setting('ikcous.definir_cargo', true) = NEW.id::text",
      ),
  },
  {
    nome: "M9 o gatilho confia só no GUC (sem conferir quem executa)",
    reprova: "guc_forjado_nao_vale",
    sql: () =>
      mutar(
        DDL_GATILHO,
        "       AND current_user = (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.definir_cargo(uuid,text)')) THEN",
        "       THEN",
      ),
  },
  {
    nome: "M10 anon recebe EXECUTE",
    reprova: "anon_sem_execute",
    sql: () =>
      "GRANT EXECUTE ON FUNCTION public.definir_cargo(uuid, text) TO anon",
  },
  {
    nome: "M11 sem a janela (a função nem tenta; o gatilho recusa a própria função)",
    reprova: "dono_nomeia",
    sql: () =>
      mutar(
        DDL_DEFINIR,
        "PERFORM set_config('ikcous.definir_cargo', p_user_id::text || ':' || p_cargo, true);",
        "NULL;",
      ),
  },
];

PROVAS.push({
  nome: "(9b) 11 mutantes (cada guarda tirada) deixam a SUA sonda vermelha; o resto das sondas segue verde onde a guarda não é a dele",
  corpo: async (c) => {
    for (const m of MUTANTES) {
      const sondas = await rodarSondas(c, [m.sql()]);
      assert.ok(
        falhas(sondas).includes(m.reprova),
        `${m.nome}: a sonda ${m.reprova} deveria reprovar, falhas = ${falhas(sondas).join(",") || "(nenhuma)"}`,
      );
    }
  },
});

PROVAS.push({
  nome: "(9c) mutante da trava de linha: sem o FOR UPDATE a segunda chamada simultânea NÃO espera (a prova (7d) reprovaria)",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();
    const mutado = mutar(
      DDL_DEFINIR,
      "SELECT p.role INTO v_de FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;",
      "SELECT p.role INTO v_de FROM public.profiles p WHERE p.id = p_user_id;",
    );
    try {
      await restaurarFixtures(c);
      await c.query(mutado);
      await a.query("BEGIN");
      await entrar(a, "dono");
      await a.query(...CALL(U_ALVO, "admin"));
      await b.query("BEGIN");
      await entrar(b, "dono");
      // Com o corpo mutado a leitura não trava, mas o UPDATE de profiles ainda espera a linha de A: o que muda é o que B
      // LEU (customer, o estado de antes de A): a segunda vê o papel velho e responde "customer>customer: mudou=false".
      const segunda = b.query(...CALL(U_ALVO, "customer"));
      await new Promise((res) => setTimeout(res, 300));
      await a.query("COMMIT");
      const dois = await segunda;
      await b.query("COMMIT");
      assert.deepEqual(
        dois.rows[0].r,
        { user_id: U_ALVO, de: "customer", para: "customer", mudou: false },
        "o mutante tinha de reproduzir a atualização perdida (a segunda chamada ler o estado velho)",
      );
      assert.deepEqual(
        await papeisCommitados(c, [U_ALVO]),
        { [U_ALVO]: ["admin", "admin"] },
        "o mutante tinha de deixar o admin que a segunda chamada achava ter removido",
      );
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await c.query(DDL_DEFINIR);
      await restaurarFixtures(c);
    }
    assert.deepEqual(
      await digital(c),
      fx.digitalInicial,
      "a função original não foi restaurada",
    );
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva: só o dono da loja define cargo (rpc-ci)";
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma regra do cargo do dono foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[definir-cargo] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
