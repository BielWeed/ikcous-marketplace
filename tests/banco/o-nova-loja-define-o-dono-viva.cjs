"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (SONDAS, MUTANTES, os ids das fixtures) ou das linhas do
 * Postgres efêmero; nunca de entrada de rede nem de payload de terceiro. */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a consulta 88c e o script do repositório), nunca de entrada de rede. */

/**
 * PROVA VIVA da escrita do passo definir-dono do nova-loja (SQL_DEFINIR_DONO, exportado de scripts/frota/nova-loja.mjs)
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci), em banco CLONADO (rodar-isolado).
 *
 * O texto vai INTEIRO, como está no script, por `client.query(sql)` sem parâmetros: a consulta simples do protocolo,
 * a mesma que o pg-meta da Management API faz (várias instruções numa mensagem só, as linhas do ÚLTIMO comando de volta,
 * o erro como SQLSTATE). Uma conexão nova por requisição. A sessão da "API" NÃO é superusuário: um papel de prova sem
 * SUPERUSER e sem BYPASSRLS, membro de postgres só com a opção SET (sem herdar nada), entra por SET SESSION
 * AUTHORIZATION. O que ele consegue fazer no banco é SÓ o que o `SET LOCAL ROLE postgres` de dentro do texto lhe dá.
 *
 * O QUE SE PROVA:
 *   (0) as fixtures e o controle da sessão: a "API" não é superusuário e só vira postgres pelo SET LOCAL ROLE;
 *   (1) sem dono e com 1 admin confirmada (nas duas fontes do cargo): resultado `gravada`, uma linha em dono_da_loja com
 *       a id dela, nada mais mudou; a consulta 88c, que antes dava "nao" nas 4 linhas do dono, passa a dar sim em TODAS;
 *   (2) repetir: `ja_era_dona`, nenhuma linha nova, nada muda, a 88c continua toda sim;
 *   (3) depois do (1), a dona chama definir_cargo e nomeia uma cliente (antes do (1) a MESMA chamada é 42501);
 *   (4) as recusas, cada uma com o seu SQLSTATE e NADA gravado: 0 admins (IKD03), 2 admins (IKD04), admin só em profiles
 *       ou só em auth.users (IKD05), e-mail não confirmado (IKD06), dono cadastrado que não é admin com a loja sem admin
 *       (IKD02) ou com outra admin (IKD01), dono admin só numa fonte (IKD01); dono admin com outras admins = ja_era_dona;
 *   (5) duas chamadas SIMULTÂNEAS (presas na mesma linha da admin até as duas esperarem): uma grava, a outra vê a dona e
 *       responde ja_era_dona (nunca 23505, nunca duas linhas);
 *   (6) CONTROLES: as sondas valem com o texto do script; sem `SET LOCAL ROLE postgres` a sessão da API recebe 42501 e
 *       nada é gravado; 8 mutantes textuais do SQL (cada guarda tirada) reprovam AO MENOS a sonda que cada um declara.
 *
 * LIMITE DECLARADO: no postgres:17 do CI o papel postgres É superusuário; no Supabase não é (é dono das tabelas de
 * public). Esta prova mostra que a sessão de fora não escreve nada sem o SET LOCAL ROLE e que, com ele, o texto faz o
 * que promete; não prova os privilégios do postgres de uma loja real (isso é a prova P5 da T1, no projeto).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-nova-loja-define-o-dono-viva.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "..", "..");
const SCRIPT = path.join(RAIZ, "scripts", "frota", "nova-loja.mjs");
const CONSULTA_88C = fs.readFileSync(
  path.join(
    RAIZ,
    "scripts",
    "publicacao",
    "consultas",
    "88c-conferir-o-dono-cadastrado.sql",
  ),
  "utf8",
);

// O papel da sessão da "API" (cluster inteiro: criado no começo e apagado no fim desta prova).
const PAPEL_API = "prova_nova_loja_define_dono_api";

const U_DONA = "d1564000-0000-4000-8000-000000000001"; // a primeira admin (a futura dona)
const U_ADM2 = "d1564000-0000-4000-8000-000000000002"; // outra admin
const U_SO_PERFIL = "d1564000-0000-4000-8000-000000000003"; // admin só em profiles
const U_SO_LOGIN = "d1564000-0000-4000-8000-000000000004"; // admin só em auth.users
const U_CLI = "d1564000-0000-4000-8000-000000000005"; // cliente (alvo do definir_cargo)
const U_EX = "d1564000-0000-4000-8000-000000000006"; // ex-admin cadastrado como dono
const TODOS = [U_DONA, U_ADM2, U_SO_PERFIL, U_SO_LOGIN, U_CLI, U_EX];
// [auth.users raw_app_meta_data.role, profiles.role]
const ADMIN = ["admin", "admin"];
const SO_PERFIL = ["customer", "admin"];
const SO_LOGIN = ["admin", "customer"];

let URL_EFEMERA = "";
let SQL = "";

/**
 * Deixa o banco (commitado) no estado pedido: todo mundo customer nas duas fontes e com e-mail confirmado, menos o que
 * `papeis` e `semConfirmar` dizem; dono_da_loja e cargo_log vazios, menos o `dono`. Como o postgres (a automação de
 * confiança): as travas de cargo leem o GUC role, que na sessão de login direto vale none.
 */
async function preparar(c, { papeis = {}, semConfirmar = [], dono = null }) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE postgres");
    await c.query("DELETE FROM public.cargo_log");
    await c.query("DELETE FROM public.dono_da_loja");
    for (const id of TODOS) {
      const [a, p] = papeis[id] ?? ["customer", "customer"];
      // profiles antes de auth.users: o gatilho de sincronia copia o papel de profiles para auth.users.
      await c.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [
        id,
        p,
      ]);
      await c.query(
        `UPDATE auth.users
            SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', $2::text),
                email_confirmed_at = CASE WHEN $3::boolean THEN NULL ELSE now() END
          WHERE id = $1`,
        [id, a, semConfirmar.includes(id)],
      );
    }
    if (dono) {
      await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
        dono,
      ]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  const f = await foto(c);
  for (const l of f.papeis) {
    const [a, p] = papeis[l.id] ?? ["customer", "customer"];
    assert.deepEqual(
      [l.a, l.p, l.conf],
      [a, p, !semConfirmar.includes(l.id)],
      `a fixture ${l.id} não ficou como pedido`,
    );
  }
  assert.deepEqual(f.donos, dono ? [dono] : []);
}

/** O que a escrita pode mudar: as linhas do dono, o papel (nas duas fontes) e a confirmação de cada fixture, o log. */
async function foto(c) {
  const donos = (
    await c.query("SELECT user_id::text AS u FROM public.dono_da_loja")
  ).rows.map((l) => l.u);
  const papeis = (
    await c.query(
      `SELECT u.id::text AS id, u.raw_app_meta_data ->> 'role' AS a, p.role AS p, u.email_confirmed_at IS NOT NULL AS conf
         FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id = ANY ($1::uuid[]) ORDER BY u.id`,
      [TODOS],
    )
  ).rows;
  const log = (await c.query("SELECT count(*)::int AS n FROM public.cargo_log"))
    .rows[0].n;
  return { donos, papeis, log };
}

/**
 * A "Management API": conexão nova, sessão de papel NÃO-superusuário, o texto inteiro numa consulta simples (sem
 * parâmetros). Devolve as linhas do último comando (e de todos), ou o SQLSTATE do erro. Nunca lança por erro de SQL.
 */
async function pelaApi(sql, nome = "prova_dono_api") {
  const k = new Client({
    connectionString: URL_EFEMERA,
    application_name: nome,
  });
  await k.connect();
  try {
    await k.query(`SET SESSION AUTHORIZATION ${PAPEL_API}`);
    try {
      const r = await k.query(sql);
      const todas = (Array.isArray(r) ? r : [r]).map((x) => x.rows);
      return { ok: true, rows: todas[todas.length - 1], todas };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await k.end().catch(() => {});
  }
}

/** A linha final da escrita: exatamente [{ resultado: "<json>" }]; devolve o JSON lido. */
function resultadoDe(r) {
  assert.ok(r.ok, `a transação falhou: ${r.code} ${r.message}`);
  assert.equal(r.rows.length, 1, "a escrita tem de devolver UMA linha");
  assert.deepEqual(Object.keys(r.rows[0]), ["resultado"]);
  assert.equal(typeof r.rows[0].resultado, "string");
  return JSON.parse(r.rows[0].resultado);
}

/** A 88c executada como está no arquivo (pelo superusuário, que enxerga tudo): item -> ok. */
async function consulta88c(c) {
  const r = await c.query(CONSULTA_88C);
  assert.equal(r.rows.length, 9, "a 88c tem um rol fechado de 9 linhas");
  return Object.fromEntries(r.rows.map((l) => [l.item, l.ok]));
}
const ITENS_DO_DONO_NA_88C = (itens) =>
  Object.keys(itens)
    .filter(
      (k) =>
        k.startsWith("dono_da_loja tem exatamente uma linha") ||
        k.startsWith("o dono cadastrado"),
    )
    .sort();

/** A dona (ou quem for) chama definir_cargo como o PostgREST chamaria; transação sempre desfeita. */
async function definirCargoComo(c, uid, alvo, cargo) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    try {
      const r = await c.query(
        "SELECT public.definir_cargo($1::uuid, $2::text) AS r",
        [alvo, cargo],
      );
      return { ok: true, r: r.rows[0].r };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// As sondas: cada uma prepara o estado, manda o texto pela "API" e confere a resposta E o banco depois. Servem ao texto
// do script e a cada mutante (a mesma régua).
// ---------------------------------------------------------------------------------------------------------------------

/** Sonda de uma chamada: `espera` (o JSON do resultado) e `dona` (a linha nova), ou `recusa` (SQLSTATE, nada muda). */
const sondaDe =
  ({ estado, espera, dona = null, recusa = null }) =>
  async (c, sql) => {
    await preparar(c, estado);
    const antes = await foto(c);
    const r = await pelaApi(sql);
    const depois = await foto(c);
    if (recusa) {
      assert.equal(
        r.ok,
        false,
        `esperava a recusa ${recusa}, veio ${JSON.stringify(r.rows)}`,
      );
      assert.equal(r.code, recusa, r.message);
      assert.deepEqual(depois, antes, "a recusa gravou alguma coisa");
      return true;
    }
    assert.deepEqual(resultadoDe(r), espera);
    assert.deepEqual(
      depois,
      dona ? { ...antes, donos: [dona] } : antes,
      "o banco mudou além do esperado",
    );
    return true;
  };

async function esperarTravados(c, nomes, n) {
  const fim = Date.now() + 5000;
  while (Date.now() < fim) {
    const r = await c.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ANY ($1::text[]) AND wait_event_type = 'Lock'",
      [nomes],
    );
    if (r.rows[0].n >= n) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

/**
 * Duas chamadas ao mesmo tempo, as duas presas (uma terceira conexão segura a linha da admin com FOR UPDATE) até as
 * duas estarem esperando uma trava; então a terceira solta. Com as travas do texto, a segunda espera a primeira
 * COMITAR e vê a dona: {gravada, ja_era_dona}. Sem elas, as duas leem "sem dono" e a segunda bate na chave: 23505.
 */
async function sondaConcorrente(c, sql) {
  await preparar(c, { papeis: { [U_DONA]: ADMIN } });
  const h = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_dono_trava",
  });
  await h.connect();
  let a;
  let b;
  try {
    await h.query("BEGIN");
    await h.query("SELECT 1 FROM public.profiles WHERE id = $1 FOR UPDATE", [
      U_DONA,
    ]);
    a = pelaApi(sql, "prova_dono_a");
    b = pelaApi(sql, "prova_dono_b");
    const travados = await esperarTravados(
      c,
      ["prova_dono_a", "prova_dono_b"],
      2,
    );
    await h.query("COMMIT");
    const rs = await Promise.all([a, b]);
    assert.ok(
      travados,
      "as duas chamadas não ficaram esperando trava ao mesmo tempo",
    );
    const acoes = rs
      .map((r) => (r.ok ? resultadoDe(r).acao : `erro ${r.code}`))
      .sort();
    assert.deepEqual(acoes, ["gravada", "ja_era_dona"]);
    assert.deepEqual((await foto(c)).donos, [U_DONA]);
    return true;
  } finally {
    await h.query("ROLLBACK").catch(() => {});
    await h.end().catch(() => {});
    await Promise.allSettled([a, b]);
  }
}

const SONDAS = {
  grava_a_admin_unica: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN } },
    espera: { acao: "gravada", donos: 1, linhas: 1, admins: 1 },
    dona: U_DONA,
  }),
  ja_era_dona: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN }, dono: U_DONA },
    espera: { acao: "ja_era_dona", donos: 1, linhas: 0, admins: 1 },
  }),
  dona_com_outras_admins: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN, [U_ADM2]: ADMIN }, dono: U_DONA },
    espera: { acao: "ja_era_dona", donos: 1, linhas: 0, admins: 2 },
  }),
  sem_admin_IKD03: sondaDe({ estado: {}, recusa: "IKD03" }),
  duas_admins_IKD04: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN, [U_ADM2]: ADMIN } },
    recusa: "IKD04",
  }),
  admin_so_em_profiles_IKD05: sondaDe({
    estado: { papeis: { [U_SO_PERFIL]: SO_PERFIL } },
    recusa: "IKD05",
  }),
  admin_so_em_auth_IKD05: sondaDe({
    estado: { papeis: { [U_SO_LOGIN]: SO_LOGIN } },
    recusa: "IKD05",
  }),
  email_nao_confirmado_IKD06: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN }, semConfirmar: [U_DONA] },
    recusa: "IKD06",
  }),
  dono_ex_sem_admin_IKD02: sondaDe({
    estado: { dono: U_EX },
    recusa: "IKD02",
  }),
  dono_ex_com_admin_IKD01: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN }, dono: U_EX },
    recusa: "IKD01",
  }),
  dono_admin_numa_fonte_IKD01: sondaDe({
    estado: { papeis: { [U_SO_PERFIL]: SO_PERFIL }, dono: U_SO_PERFIL },
    recusa: "IKD01",
  }),
  concorrente: sondaConcorrente,
};

async function rodarSondas(c, sql) {
  const out = {};
  for (const [nome, sonda] of Object.entries(SONDAS)) {
    try {
      out[nome] = Boolean(await sonda(c, sql));
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

function mutar(sql, de, para) {
  assert.equal(
    sql.split(de).length,
    2,
    `o trecho do mutante tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, para);
}

const MUTANTES = [
  {
    nome: "M1 sem SET LOCAL ROLE postgres (a sessão da API escreveria com o papel dela)",
    reprova: "grava_a_admin_unica",
    sql: () => mutar(SQL, "SET LOCAL ROLE postgres;\n", ""),
  },
  {
    nome: "M2 sem a guarda de 2+ admins (gravaria uma delas)",
    reprova: "duas_admins_IKD04",
    sql: () => mutar(SQL, "IF v_admins > 1 THEN", "IF false THEN"),
  },
  {
    nome: "M3 sem a guarda das fontes do cargo (admin numa fonte só)",
    reprova: "admin_so_em_profiles_IKD05",
    sql: () => mutar(SQL, "IF NOT FOUND THEN", "IF false THEN"),
  },
  {
    nome: "M4 sem a guarda do e-mail confirmado",
    reprova: "email_nao_confirmado_IKD06",
    sql: () => mutar(SQL, "IF NOT v_confirmada THEN", "IF false THEN"),
  },
  {
    nome: "M5 sem a guarda do dono que já existe (tentaria gravar por cima)",
    reprova: "dono_ex_com_admin_IKD01",
    sql: () => mutar(SQL, "IF v_donos > 0 THEN", "IF false THEN"),
  },
  {
    nome: "M6 sem as travas (advisory locks e LOCK TABLE): a segunda chamada simultânea bate na chave",
    reprova: "concorrente",
    sql: () =>
      mutar(
        SQL,
        "  PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));\n  PERFORM pg_advisory_xact_lock(hashtext('ikcous.definir_dono'));\n  LOCK TABLE public.dono_da_loja IN SHARE ROW EXCLUSIVE MODE;\n",
        "",
      ),
  },
  {
    nome: "M7 o dono 'admin' só em profiles conta como admin (ja_era_dona com o dono numa fonte só)",
    reprova: "dono_admin_numa_fonte_IKD01",
    sql: () =>
      mutar(
        SQL,
        "WHERE p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin') THEN",
        "WHERE p.role = 'admin') THEN",
      ),
  },
  {
    nome: "M8 sem a guarda de 0 admins",
    reprova: "sem_admin_IKD03",
    sql: () =>
      mutar(
        SQL,
        "IF v_admins = 0 THEN\n    RAISE EXCEPTION 'definir-dono: a loja nao tem admin'",
        "IF false THEN\n    RAISE EXCEPTION 'definir-dono: a loja nao tem admin'",
      ),
  },
];

const PROVAS = [];

// ---------------------------------------------------------------------------------------------------------------------
// (0) fixtures e o controle da sessão da API
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(0) fixtures (6 pessoas, e-mail confirmado) e a sessão da API: NÃO é superusuário, não escreve em dono_da_loja, e só vira postgres pelo SET LOCAL ROLE",
  corpo: async (c) => {
    // O texto do script é o de uma transação com o papel preso: a forma que esta prova supõe.
    assert.ok(SQL.startsWith("BEGIN ISOLATION LEVEL READ COMMITTED;\n"));
    assert.ok(SQL.includes("\nSET LOCAL ROLE postgres;\n"));
    assert.ok(
      SQL.endsWith(
        "\nCOMMIT;\nSELECT current_setting('ikcous.definir_dono_resultado', true) AS resultado;",
      ),
    );
    // O clone vem das migrations: nenhum dono e nenhuma admin de outra prova (senão a contagem não é a das fixtures).
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.dono_da_loja"))
        .rows[0].n,
      0,
      "o clone já tinha dono cadastrado",
    );
    assert.equal(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
             UNION SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a`,
        )
      ).rows[0].n,
      0,
      "o clone já tinha admin fora das fixtures",
    );

    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    // O auth.role() REAL (lê o 'role' do JWT), como na prova da migration 20261383000000.
    await c.query(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text $$`);
    // A coluna da plataforma que o SQL lê (o auth.users emulado do provisionar não a tem).
    await c.query(
      "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz",
    );
    for (const id of TODOS) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data, email_confirmed_at)
         VALUES ($1::uuid, $1::text || '@dono.teste', '{}'::jsonb, now())`,
        [id],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Dona', 'customer'), ($2, 'Admin dois', 'customer'), ($3, 'So perfil', 'customer'),
         ($4, 'So login', 'customer'), ($5, 'Cliente', 'customer'), ($6, 'Ex admin', 'customer')`,
      TODOS,
    );
    await preparar(c, {});

    // O papel da "API": sem superusuário, sem BYPASSRLS, membro de postgres só para o SET (não herda nada dele).
    await c.query(`DROP ROLE IF EXISTS ${PAPEL_API}`);
    await c.query(
      `CREATE ROLE ${PAPEL_API} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    await c.query(
      `GRANT postgres TO ${PAPEL_API} WITH INHERIT FALSE, SET TRUE`,
    );
    const quem = await pelaApi(
      `SELECT current_setting('is_superuser') AS su, session_user::text AS s, current_user::text AS u,
              (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user) AS forte;`,
    );
    assert.ok(quem.ok, quem.message);
    assert.deepEqual(quem.rows, [
      { su: "off", s: PAPEL_API, u: PAPEL_API, forte: false },
    ]);
    // Sem o SET LOCAL ROLE a sessão não lê nem trava a tabela do dono.
    const semPapel = await pelaApi("SELECT count(*) FROM public.dono_da_loja;");
    assert.equal(semPapel.ok, false);
    assert.equal(semPapel.code, "42501", semPapel.message);
    // Com ele, dentro da transação, o papel é postgres (o GUC role também: as travas de cargo leem o GUC).
    const comPapel = await pelaApi(
      "BEGIN; SET LOCAL ROLE postgres; SELECT current_user::text AS u, current_setting('role') AS r; ROLLBACK;",
    );
    assert.ok(comPapel.ok, comPapel.message);
    assert.deepEqual(comPapel.todas[2], [{ u: "postgres", r: "postgres" }]);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (1) a) grava a admin única; a 88c passa a dar sim
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(1) sem dono e 1 admin confirmada: `gravada`, uma linha em dono_da_loja com a id dela, nada mais muda; a 88c vai de 4 'nao' (as linhas do dono) para TODA sim",
  corpo: async (c) => {
    await preparar(c, { papeis: { [U_DONA]: ADMIN } });
    const antes88 = await consulta88c(c);
    const doDono = ITENS_DO_DONO_NA_88C(antes88);
    assert.equal(doDono.length, 4, "a 88c tem 4 linhas sobre o dono");
    assert.deepEqual(
      Object.keys(antes88)
        .filter((k) => !antes88[k])
        .sort(),
      doDono,
      "antes da escrita só as 4 linhas do dono reprovam (o controle da 88c não é trivialmente sim)",
    );
    const antes = await foto(c);
    const r = await pelaApi(SQL);
    assert.deepEqual(resultadoDe(r), {
      acao: "gravada",
      donos: 1,
      linhas: 1,
      admins: 1,
    });
    assert.deepEqual(await foto(c), { ...antes, donos: [U_DONA] });
    const depois88 = await consulta88c(c);
    assert.deepEqual(
      Object.keys(depois88).filter((k) => !depois88[k]),
      [],
      `a 88c tem de dar sim em tudo depois da escrita: ${JSON.stringify(depois88)}`,
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) b) repetir
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(2) repetir a MESMA escrita: `ja_era_dona`, nenhuma linha nova, nada muda; a 88c continua toda sim",
  corpo: async (c) => {
    const antes = await foto(c);
    assert.deepEqual(antes.donos, [U_DONA], "a (1) deixa a dona cadastrada");
    const r = await pelaApi(SQL);
    assert.deepEqual(resultadoDe(r), {
      acao: "ja_era_dona",
      donos: 1,
      linhas: 0,
      admins: 1,
    });
    assert.deepEqual(await foto(c), antes);
    const d = await consulta88c(c);
    assert.deepEqual(
      Object.keys(d).filter((k) => !d[k]),
      [],
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (3) g) a dona nova usa definir_cargo
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(3) depois da escrita a dona nomeia pela definir_cargo (antes dela, a MESMA chamada é 42501 'só o dono')",
  corpo: async (c) => {
    const depois = await definirCargoComo(c, U_DONA, U_CLI, "admin");
    assert.ok(depois.ok, `${depois.code} ${depois.message}`);
    assert.deepEqual(depois.r, {
      user_id: U_CLI,
      de: "customer",
      para: "admin",
      mudou: true,
    });
    // o controle: o mesmo estado SEM a linha do dono
    await preparar(c, { papeis: { [U_DONA]: ADMIN } });
    const antes = await definirCargoComo(c, U_DONA, U_CLI, "admin");
    assert.equal(antes.ok, false, "sem dono cadastrado a admin nomeou");
    assert.equal(antes.code, "42501", antes.message);
    assert.match(antes.message, /só o dono da loja define cargos/);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (4) e (5) as recusas e a concorrência: as sondas no texto do script
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(4)+(5) com o texto do script TODAS as sondas valem: 0/2 admins, fontes discordantes, e-mail sem confirmar, dono que não é admin (IKD01..IKD06, nada gravado), dona com outras admins, duas chamadas simultâneas",
  corpo: async (c) => {
    const s = await rodarSondas(c, SQL);
    // a sonda reprovada roda de novo, agora lançando: a mensagem dela vai para o log
    for (const nome of falhas(s)) await SONDAS[nome](c, SQL);
    assert.deepEqual(falhas(s), [], `sondas reprovadas: ${falhas(s)}`);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (6) os controles: cada guarda tirada reprova a sua sonda
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(6) 8 mutantes textuais do SQL (sem SET LOCAL ROLE, sem cada guarda, sem as travas) reprovam AO MENOS a sonda que declaram",
  corpo: async (c) => {
    for (const m of MUTANTES) {
      const s = await rodarSondas(c, m.sql());
      assert.ok(
        falhas(s).includes(m.reprova),
        `${m.nome}: a sonda ${m.reprova} deveria reprovar, falhas = ${falhas(s).join(",") || "(nenhuma)"}`,
      );
    }
    // M1 em detalhe: a sessão da API sem o SET LOCAL ROLE é recusada por permissão e nada fica gravado.
    await preparar(c, { papeis: { [U_DONA]: ADMIN } });
    const antes = await foto(c);
    const r = await pelaApi(MUTANTES[0].sql());
    assert.equal(r.ok, false);
    assert.equal(r.code, "42501", r.message);
    assert.deepEqual(await foto(c), antes);
  },
});

async function main() {
  URL_EFEMERA = lerDatabaseUrlEfemera();
  ({ SQL_DEFINIR_DONO: SQL } = await import(pathToFileURL(SCRIPT).href));
  assert.equal(typeof SQL, "string", "SQL_DEFINIR_DONO não é exportado");
  const cliente = new Client({ connectionString: URL_EFEMERA });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva: o nova-loja define o dono da loja (rpc-ci)";
  let falhou = false;
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
        falhou = true;
        break;
      }
    }
  } finally {
    await cliente.query(`DROP ROLE IF EXISTS ${PAPEL_API}`).catch(() => {});
    await cliente.end().catch(() => {});
  }
  if (falhou) {
    anexarAoSummary(titulo, linhas.join("\n"));
    falhar(
      "FALHOU",
      "Uma regra do definir-dono foi quebrada — ver acima qual.",
    );
  }
  console.log(
    `\n[definir-dono] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
