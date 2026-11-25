"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, SONDAS, MUTANTES, fx) ou do catálogo do Postgres
 * efêmero; nunca de entrada de rede nem de payload de terceiro. */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a pasta de migrations do repositório), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261440000000_a_loja_guarda_o_cadastro_fiscal.sql contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rpc-ci).
 *
 * O QUE A MIGRATION ENTREGA: o cadastro fiscal da loja (regime, atividade, datas) numa tabela de UMA linha que nasce VAZIA, a
 * trilha de quem mudou o quê (antes/depois) e a ÚNICA porta que grava: public.fiscal_cadastro_salvar(jsonb), SECURITY
 * DEFINER, só para o DONO da loja (conferido na tabela dono_da_loja, nunca no JWT) que seja admin ATUAL. Admin que não é o
 * dono lê, não altera.
 *
 * O QUE SE PROVA (cada item no estado real do banco, com o `role` do Postgres que o PostgREST usa, não no texto):
 *   (0) as duas tabelas nascem VAZIAS (sem semente, sem regime padrão) e a loja nasce sem dono;
 *   (1) sem dono cadastrado NINGUÉM grava, nem o admin atual (42501), e nada é escrito;
 *   (2) o dono admin atual grava; o log ganha UMA linha com antes/depois; repetir os mesmos dados não gera log nem toca a
 *       linha; mudar um campo gera outra linha; campo desconhecido (cnpj) é ignorado e nunca vira coluna;
 *   (3) recusas (42501, nada gravado): admin atual que não é o dono, dono rebaixado (nas duas fontes e em cada uma só),
 *       cliente, anon, service_role e o postgres sem sessão de dono; quem não é o dono recebe a recusa de dono ANTES de
 *       qualquer validação (sem oráculo);
 *   (4) leitura: admin atual lê as duas tabelas, cliente e ex-admin leem vazio, anon é negado;
 *   (5) INSERT, UPDATE, DELETE e TRUNCATE diretos negados a todo papel de aplicação, e a sequência do log não é de ninguém;
 *   (6) atributos: SECURITY DEFINER, search_path = public, EXECUTE só para authenticated; RLS ligada e uma política SELECT
 *       por tabela;
 *   (7) validação (22023): regime, atividade e datas fora do contrato, payload que não é objeto, e a FAIXA plausível das datas
 *       (abertura entre 1900-01-01 e hoje em São Paulo; início das vendas não antes de 2020-01-01, não no futuro e não antes do
 *       mês da abertura; limites exatos aceitos); nada fica gravado; os CHECKs da tabela seguem de pé como defesa em
 *       profundidade (23514/23505/23502);
 *   (8) concorrência: duas chamadas simultâneas se enfileiram e a trilha encadeia (o "antes" da segunda é o "depois" da
 *       primeira); falha no log desfaz a linha também (uma chamada, uma transação); transação desfeita não deixa nada;
 *   (9) fin_dre intocado (o md5 do corpo é o mesmo antes e depois de aplicar, sem constante), reaplicar 2x não muda nada
 *       (nem as linhas que já estavam lá), rollback comum
 *       preserva as tabelas e as linhas, destrutivo exige confirmação e o rollback comum antes, pré-voo recusa 11 estados
 *       desconhecidos sem escrever, pós-voo que falha desfaz tudo numa conexão SEM BEGIN (como o aplicador);
 *   (10) CONTROLES: sem a migration (rollback) as sondas reprovam; 15 mutantes (cada guarda tirada, inclusive os 3 do
 *       desenho: sem conferir o dono, sem is_admin_atual, política `true`, e cada regra da faixa das datas) reprovam EXATAMENTE
 *       as sondas que cada um declara, com a sonda de controle dono_grava verde (o DDL do mutante aplicou); e o mutante sem a
 *       trava de tabela reproduz a atualização perdida.
 *
 * Toda chamada de teste roda numa transação DESFEITA no fim; as exceções (escrita real) limpam as tabelas fiscais.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-cadastro-fiscal-so-o-dono-altera-viva.cjs
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

const NOME = "20261440000000_a_loja_guarda_o_cadastro_fiscal.sql";
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

// Fixtures inventadas (repositório público): nenhum id, nome ou e-mail de pessoa ou loja real.
const U_DONO = "f1440000-0000-4000-8000-000000000001"; // admin nas duas fontes, cadastrado como dono
const U_ADM = "f1440000-0000-4000-8000-000000000002"; // admin nas duas fontes, NÃO é o dono
const U_CLI = "f1440000-0000-4000-8000-000000000003"; // cliente
const U_DONO_REB = "f1440000-0000-4000-8000-000000000004"; // cliente nas duas fontes (dono rebaixado)
const U_REB_PERFIL = "f1440000-0000-4000-8000-000000000005"; // profiles customer, auth.users admin
const U_REB_AUTH = "f1440000-0000-4000-8000-000000000006"; // profiles admin, auth.users customer
const TODOS = [U_DONO, U_ADM, U_CLI, U_DONO_REB, U_REB_PERFIL, U_REB_AUTH];

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (auth.uid() desta suíte lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: { papel: "authenticated", uid: U_CLI, jwt: claims(U_CLI, null) },
  dono: { papel: "authenticated", uid: U_DONO, jwt: claims(U_DONO, "admin") },
  adm: { papel: "authenticated", uid: U_ADM, jwt: claims(U_ADM, "admin") },
  donoRebaixado: {
    papel: "authenticated",
    uid: U_DONO_REB,
    jwt: claims(U_DONO_REB, "admin"), // o JWT velho ainda diz admin (vale ~1 h); o banco já diz customer
  },
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

// Dados de teste (contrato do payload: regime, atividade, aberta_em e vende_no_app_desde como 'AAAA-MM-DD' ou null).
const OK1 = {
  regime: "simples",
  atividade: "comercio",
  aberta_em: "2021-03-15",
  vende_no_app_desde: "2026-02-01",
};
const OK2 = {
  regime: "mei",
  atividade: "com_servico",
  aberta_em: null,
  vende_no_app_desde: null,
};
const SO_OBRIGATORIOS = { regime: "real", atividade: "comercio" };
// O que a trilha guarda: os quatro campos do cadastro, na forma que o jsonb do Postgres devolve.
const CAMPOS = (o) => ({
  regime: o.regime,
  atividade: o.atividade,
  aberta_em: o.aberta_em ?? null,
  vende_no_app_desde: o.vende_no_app_desde ?? null,
});

// O "hoje" da faixa das datas, calculado FORA do Postgres (o ICU do Node), para não repetir na prova a conta que a função faz.
function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const somaDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Dia 1 do mês de `iso`, deslocado `meses` meses.
const dia1 = (iso, meses = 0) => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + meses, 1)).toISOString().slice(0, 10);
};

const SALVAR = (obj) => [
  "SELECT public.fiscal_cadastro_salvar($1::jsonb) AS r",
  [JSON.stringify(obj)],
];
const SALVAR_NULO = ["SELECT public.fiscal_cadastro_salvar(NULL::jsonb) AS r"];
const P = (q, [sql, params]) => ({ q, sql, params });

// SQL de apoio (rodado como a sessão de login direto, GUC role = none, dentro da transação desfeita do teste).
const SEM_DONO = "DELETE FROM public.dono_da_loja";
const DONO_E = (id) => [
  SEM_DONO,
  `INSERT INTO public.dono_da_loja (user_id) VALUES ('${id}')`,
];
const LINHA_ANTIGA = (por) =>
  `INSERT INTO public.fiscal_cadastro (regime, atividade, aberta_em, vende_no_app_desde, atualizado_em, atualizado_por)
   VALUES ('simples', 'comercio', '2021-03-15', '2026-02-01', '2020-01-01T00:00:00Z', '${por}')`;
const LOG_ANTIGO = `INSERT INTO public.fiscal_cadastro_log (quem, antes, depois)
   VALUES ('${U_ADM}', NULL, '{"regime":"simples","atividade":"comercio","aberta_em":"2021-03-15","vende_no_app_desde":"2026-02-01"}'::jsonb)`;

/**
 * Roda os passos, cada um como seu ator, numa transação SEMPRE desfeita. `antes`: SQL rodado antes, como superusuário
 * (a sessão de login direto, GUC role = none). Devolve o resultado de cada passo e, ANTES de desfazer, as linhas das duas
 * tabelas fiscais.
 */
async function rodar(c, passos, { antes = [] } = {}) {
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
    return { resultados, ...(await fiscal(c)) };
  } finally {
    await c.query("ROLLBACK");
  }
}

// As linhas das duas tabelas fiscais, como superusuário (datas como texto: o driver converteria para Date no fuso local).
async function fiscal(c) {
  const cadastro = (
    await c.query(
      `SELECT id, regime, atividade, aberta_em::text AS aberta_em, vende_no_app_desde::text AS vende_no_app_desde,
              atualizado_em::text AS atualizado_em, atualizado_por
         FROM public.fiscal_cadastro ORDER BY id`,
    )
  ).rows;
  const log = (
    await c.query(
      "SELECT quem, antes, depois FROM public.fiscal_cadastro_log ORDER BY id",
    )
  ).rows;
  return { cadastro, log };
}

// Esvazia as duas tabelas (as poucas provas que gravam de verdade chamam isto no fim).
async function limparFiscal(c) {
  await c.query("DELETE FROM public.fiscal_cadastro_log");
  await c.query("DELETE FROM public.fiscal_cadastro");
}

// O cadeado da trilha: o primeiro "antes" é nulo e cada "antes" é o "depois" da linha anterior.
function trilhaEncadeia(log) {
  return log.every((l, i) =>
    i === 0
      ? l.antes === null
      : JSON.stringify(l.antes) === JSON.stringify(log[i - 1].depois),
  );
}

// O CREATE OR REPLACE da função como está na migration.
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
const DDL_SALVAR = ddlFuncao(MIGRATION_LF, "fiscal_cadastro_salvar");
// Uma "sucessora no ar": a mesma função com o corpo diferente (o md5 não bate).
const DDL_SUCESSORA = mutar(
  DDL_SALVAR,
  "RETURN v_resultado;",
  "RETURN jsonb_build_object('x', 1) || v_resultado;",
);

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
       WHERE n.nspname = 'public' AND c.relname IN ('fiscal_cadastro', 'fiscal_cadastro_log')
         AND a.attnum > 0 AND NOT a.attisdropped`);
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
// (0) fixtures e o estado em que a migration deixa a loja
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(0) as duas tabelas nascem VAZIAS (sem semente, sem regime padrão) e a loja nasce sem dono; fixtures: dono, admin, cliente e os papéis contraditórios",
  corpo: async (c) => {
    const n = async (t) =>
      (await c.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n;
    assert.equal(await n("fiscal_cadastro"), 0, "fiscal_cadastro nasce vazia");
    assert.equal(
      await n("fiscal_cadastro_log"),
      0,
      "fiscal_cadastro_log nasce vazia",
    );
    assert.equal(await n("dono_da_loja"), 0, "a loja nasce sem dono");

    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    // O gatilho on_auth_user_created (handle_new_user) criaria o perfil sozinho e o INSERT abaixo
    // bateria em profiles_pkey; desligado so durante a montagem dos usuarios de teste.
    await c.query(
      "ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created",
    );
    for (const id of TODOS) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@fiscal.teste', '{}'::jsonb)`,
        [id],
      );
    }
    // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia).
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Dono', 'admin'), ($2, 'Admin', 'admin'), ($3, 'Cliente', 'customer'),
         ($4, 'Dono rebaixado', 'customer'), ($5, 'Rebaixado perfil', 'customer'), ($6, 'Rebaixado auth', 'admin')`,
      TODOS,
    );
    await c.query("ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created");
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_REB_PERFIL],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
      [U_REB_AUTH],
    );
    const papeis = (
      await c.query(
        `SELECT u.id, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
           FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id = ANY($1::uuid[]) ORDER BY u.id`,
        [TODOS],
      )
    ).rows.map((l) => `${l.id}:${l.a}/${l.p}`);
    assert.deepEqual(papeis, [
      `${U_DONO}:admin/admin`,
      `${U_ADM}:admin/admin`,
      `${U_CLI}:customer/customer`,
      `${U_DONO_REB}:customer/customer`,
      `${U_REB_PERFIL}:admin/customer`,
      `${U_REB_AUTH}:customer/admin`,
    ]);

    // O dono é cadastrado pelo comando que o runbook anuncia (uma linha por banco).
    await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
      U_DONO,
    ]);
    fx.digitalInicial = await digital(c);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (1) sem dono cadastrado
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(1) loja sem dono cadastrado: NINGUÉM grava (nem o admin atual, nem quem seria o dono), 42501, e nada é escrito; com o dono de volta o mesmo chamador grava",
  corpo: async (c) => {
    const quem = ["dono", "adm", "cliente", "rebaixadoAuth"];
    const sem = await rodar(
      c,
      quem.map((q) => P(q, SALVAR(OK1))),
      { antes: [SEM_DONO] },
    );
    sem.resultados.forEach((r, i) => {
      assert.equal(r.ok, false, `${quem[i]} gravou sem dono cadastrado`);
      assert.equal(r.code, "42501", `${quem[i]}: ${r.message}`);
      assert.match(r.message, /dono da loja/);
    });
    assert.deepEqual(sem.cadastro, []);
    assert.deepEqual(sem.log, []);
    // Controle: com o dono cadastrado, o mesmo chamador grava (a recusa de cima era mesmo a falta do dono).
    const com = await rodar(c, [P("dono", SALVAR(OK1))]);
    assert.equal(com.resultados[0].ok, true, com.resultados[0].message);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) o dono grava
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(2a) o dono admin atual grava: a linha nasce com quem e quando, devolvida pela função, e o log ganha UMA linha com antes nulo e depois = os 4 campos",
  corpo: async (c) => {
    const r = await rodar(c, [P("dono", SALVAR(OK1))]);
    const [g] = r.resultados;
    assert.ok(g.ok, g.message);
    assert.equal(g.rows[0].r.id, true);
    assert.deepEqual(
      {
        regime: g.rows[0].r.regime,
        atividade: g.rows[0].r.atividade,
        aberta_em: g.rows[0].r.aberta_em,
        vende_no_app_desde: g.rows[0].r.vende_no_app_desde,
      },
      CAMPOS(OK1),
    );
    assert.equal(g.rows[0].r.atualizado_por, U_DONO);
    assert.equal(r.cadastro.length, 1);
    assert.equal(r.cadastro[0].atualizado_por, U_DONO);
    assert.equal(r.cadastro[0].regime, "simples");
    assert.equal(r.cadastro[0].aberta_em, "2021-03-15");
    assert.equal(r.cadastro[0].vende_no_app_desde, "2026-02-01");
    assert.deepEqual(r.log, [
      { quem: U_DONO, antes: null, depois: CAMPOS(OK1) },
    ]);

    // Só os dois campos obrigatórios: as datas ficam vazias (null), nunca inventadas.
    const min = await rodar(c, [P("dono", SALVAR(SO_OBRIGATORIOS))]);
    assert.ok(min.resultados[0].ok, min.resultados[0].message);
    assert.deepEqual(min.cadastro[0].aberta_em, null);
    assert.deepEqual(min.cadastro[0].vende_no_app_desde, null);
    assert.deepEqual(min.log[0].depois, CAMPOS(SO_OBRIGATORIOS));
  },
});

PROVAS.push({
  nome: "(2b) repetir os MESMOS dados não gera log e não toca a linha (atualizado_em e atualizado_por ficam); mudar um campo gera outra linha, encadeada",
  corpo: async (c) => {
    // A linha já existia, gravada por outra pessoa em 2020; os mesmos dados não a reescrevem.
    const igual = await rodar(c, [P("dono", SALVAR(OK1))], {
      antes: [LINHA_ANTIGA(U_ADM)],
    });
    assert.ok(igual.resultados[0].ok, igual.resultados[0].message);
    assert.equal(igual.resultados[0].rows[0].r.atualizado_por, U_ADM);
    assert.deepEqual(igual.log, [], "dados iguais não geram log");
    assert.equal(igual.cadastro[0].atualizado_por, U_ADM);
    assert.match(igual.cadastro[0].atualizado_em, /^2020-01-01/);

    // Um campo muda: a linha é reescrita, o log guarda o antes (o que já estava lá) e o depois.
    const muda = await rodar(
      c,
      [
        P("dono", SALVAR({ ...OK1, regime: "presumido" })),
        P("dono", SALVAR({ ...OK1, regime: "presumido" })),
        P("dono", SALVAR({ ...OK1, regime: "presumido", aberta_em: null })),
        P("dono", SALVAR(OK1)),
      ],
      { antes: [LINHA_ANTIGA(U_ADM)] },
    );
    muda.resultados.forEach((r, i) => assert.ok(r.ok, `${i}: ${r.message}`));
    assert.equal(muda.cadastro.length, 1);
    assert.equal(muda.cadastro[0].atualizado_por, U_DONO);
    assert.doesNotMatch(muda.cadastro[0].atualizado_em, /^2020-01-01/);
    assert.deepEqual(
      muda.log.map((l) => [l.quem, l.antes, l.depois]),
      [
        [U_DONO, CAMPOS(OK1), CAMPOS({ ...OK1, regime: "presumido" })],
        [
          U_DONO,
          CAMPOS({ ...OK1, regime: "presumido" }),
          CAMPOS({ ...OK1, regime: "presumido", aberta_em: null }),
        ],
        [
          U_DONO,
          CAMPOS({ ...OK1, regime: "presumido", aberta_em: null }),
          CAMPOS(OK1),
        ],
      ],
      "3 mudanças reais (a repetição do meio não conta), encadeadas",
    );
  },
});

PROVAS.push({
  nome: "(2c) campo desconhecido é ignorado: o CNPJ nunca é gravado (nem na linha, nem na trilha), e mandar só o CNPJ a mais não conta como mudança",
  corpo: async (c) => {
    const r = await rodar(c, [
      P("dono", SALVAR({ ...OK1, cnpj: "00.000.000/0001-00", extra: 1 })),
      P("dono", SALVAR({ ...OK1, cnpj: "11.111.111/0001-11" })),
    ]);
    r.resultados.forEach((x, i) => assert.ok(x.ok, `${i}: ${x.message}`));
    for (const x of r.resultados) {
      assert.deepEqual(Object.keys(x.rows[0].r).sort(), [
        "aberta_em",
        "atividade",
        "atualizado_em",
        "atualizado_por",
        "id",
        "regime",
        "vende_no_app_desde",
      ]);
    }
    assert.equal(r.log.length, 1, "só o CNPJ a mais não é mudança");
    assert.deepEqual(r.log[0].depois, CAMPOS(OK1));
    assert.ok(
      !JSON.stringify(r).includes("/0001-"),
      "o CNPJ apareceu na linha ou na trilha",
    );
    const colunas = (
      await c.query(
        `SELECT attname FROM pg_attribute
          WHERE attrelid IN ('public.fiscal_cadastro'::regclass, 'public.fiscal_cadastro_log'::regclass)
            AND attnum > 0 AND NOT attisdropped AND (attname ILIKE '%cnpj%' OR attname ILIKE '%documento%')`,
      )
    ).rows;
    assert.deepEqual(colunas, [], "nenhuma coluna de CNPJ nas tabelas fiscais");
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (3) as recusas
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(3a) quem não é o dono recebe 42501 e nada é gravado: admin atual que não é o dono, cliente, anon (sem EXECUTE), service_role (sem EXECUTE) e o postgres sem sessão de dono",
  corpo: async (c) => {
    const quem = ["adm", "cliente", "anon", "service", "postgres"];
    const r = await rodar(
      c,
      quem.map((q) => P(q, SALVAR(OK1))),
    );
    r.resultados.forEach((x, i) => {
      assert.equal(x.ok, false, `${quem[i]} gravou`);
      assert.equal(x.code, "42501", `${quem[i]}: ${x.message}`);
    });
    assert.match(r.resultados[0].message, /dono da loja/);
    assert.match(r.resultados[1].message, /dono da loja/);
    assert.match(r.resultados[2].message, /permission denied/);
    assert.match(r.resultados[3].message, /permission denied/);
    assert.match(r.resultados[4].message, /dono da loja/);
    assert.deepEqual(r.cadastro, []);
    assert.deepEqual(r.log, []);

    // Sem oráculo: quem não é o dono recebe a MESMA recusa de dono com payload inválido ou nulo.
    const invalidos = [
      { regime: "xyz", atividade: "comercio" },
      { atividade: "comercio" },
      {},
      [],
      "texto",
      5,
    ];
    const sem = await rodar(c, [
      ...invalidos.flatMap((p) => [
        P("adm", SALVAR(p)),
        P("cliente", SALVAR(p)),
      ]),
      P("adm", SALVAR_NULO),
      P("cliente", SALVAR_NULO),
    ]);
    for (const x of sem.resultados) {
      assert.equal(x.code, "42501", x.message);
      assert.match(x.message, /dono da loja/);
    }
  },
});

PROVAS.push({
  nome: "(3b) dono REBAIXADO recusa (42501): cadastrado como dono mas cliente nas duas fontes, ou admin só em uma delas (papéis contraditórios não autorizam); o JWT velho que ainda diz admin não vale; nada gravado",
  corpo: async (c) => {
    const casos = [
      ["donoRebaixado", U_DONO_REB],
      ["rebaixadoPerfil", U_REB_PERFIL],
      ["rebaixadoAuth", U_REB_AUTH],
    ];
    for (const [quem, id] of casos) {
      const r = await rodar(c, [P(quem, SALVAR(OK1))], { antes: DONO_E(id) });
      assert.equal(r.resultados[0].ok, false, `${quem} gravou`);
      assert.equal(r.resultados[0].code, "42501", r.resultados[0].message);
      assert.match(r.resultados[0].message, /administrador/);
      assert.deepEqual(r.cadastro, []);
      assert.deepEqual(r.log, []);
    }
    // Controle: o mesmo cadastro com o dono de verdade (admin nas duas fontes) grava.
    const ok = await rodar(c, [P("dono", SALVAR(OK1))]);
    assert.ok(ok.resultados[0].ok, ok.resultados[0].message);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (4) leitura
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(4) SELECT: admin atual (dono ou não) lê as duas tabelas; cliente e ex-admin leem VAZIO; anon é negado (42501)",
  corpo: async (c) => {
    const contar = (t) => [`SELECT count(*)::int AS n FROM public.${t}`];
    const leitores = [
      "dono",
      "adm",
      "cliente",
      "donoRebaixado",
      "rebaixadoPerfil",
      "rebaixadoAuth",
    ];
    const r = await rodar(
      c,
      [
        ...leitores.flatMap((q) => [
          P(q, contar("fiscal_cadastro")),
          P(q, contar("fiscal_cadastro_log")),
        ]),
        P("anon", contar("fiscal_cadastro")),
        P("anon", contar("fiscal_cadastro_log")),
      ],
      { antes: [LINHA_ANTIGA(U_ADM), LOG_ANTIGO] },
    );
    const n = (i) => r.resultados[i].rows[0].n;
    assert.deepEqual([n(0), n(1)], [1, 1], "o dono lê as duas");
    assert.deepEqual([n(2), n(3)], [1, 1], "o admin atual que não é o dono lê");
    assert.deepEqual([n(4), n(5)], [0, 0], "cliente lê vazio");
    assert.deepEqual([n(6), n(7)], [0, 0], "o dono rebaixado lê vazio");
    assert.deepEqual([n(8), n(9)], [0, 0], "ex-admin só no profiles lê vazio");
    assert.deepEqual([n(10), n(11)], [0, 0], "ex-admin só no auth lê vazio");
    for (const i of [12, 13]) {
      assert.equal(r.resultados[i].ok, false);
      assert.equal(r.resultados[i].code, "42501", "anon sem SELECT");
    }
    // O service_role tem o SELECT concedido (no Supabase ele ignora a RLS); a escrita não (5).
    const g = (
      await c.query(
        `SELECT has_table_privilege('service_role', 'public.fiscal_cadastro', 'SELECT') AS a,
                has_table_privilege('service_role', 'public.fiscal_cadastro_log', 'SELECT') AS b`,
      )
    ).rows[0];
    assert.deepEqual(g, { a: true, b: true });
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (5) escrita direta
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(5) INSERT, UPDATE, DELETE e TRUNCATE direto nas duas tabelas: negados (42501) a dono, admin, cliente, service_role e anon, sem privilégio nenhum de escrita; a sequência do log não é de ninguém de aplicação",
  corpo: async (c) => {
    const escritas = [
      [
        "INSERT INTO public.fiscal_cadastro (regime, atividade, atualizado_por) VALUES ('mei', 'comercio', $1)",
        [U_DONO],
      ],
      ["UPDATE public.fiscal_cadastro SET regime = 'mei'", []],
      ["DELETE FROM public.fiscal_cadastro", []],
      ["TRUNCATE public.fiscal_cadastro", []],
      [
        "INSERT INTO public.fiscal_cadastro_log (quem, depois) VALUES ($1, '{}'::jsonb)",
        [U_DONO],
      ],
      ["UPDATE public.fiscal_cadastro_log SET quem = quem", []],
      ["DELETE FROM public.fiscal_cadastro_log", []],
      ["TRUNCATE public.fiscal_cadastro_log", []],
    ];
    for (const quem of ["dono", "adm", "cliente", "service", "anon"]) {
      for (const [sql, params] of escritas) {
        const r = await rodar(c, [P(quem, [sql, params])], {
          antes: [LINHA_ANTIGA(U_ADM), LOG_ANTIGO],
        });
        assert.equal(r.resultados[0].ok, false, `${quem} conseguiu: ${sql}`);
        assert.equal(
          r.resultados[0].code,
          "42501",
          `${quem}: ${sql} -> ${r.resultados[0].message}`,
        );
        assert.equal(r.cadastro.length, 1, `${quem}: ${sql} mexeu na linha`);
        assert.equal(r.log.length, 1, `${quem}: ${sql} mexeu no log`);
      }
    }
    // Privilégio de escrita: nenhum, para nenhum papel de aplicação, em nenhuma das duas tabelas.
    const priv = (
      await c.query(`
        SELECT t.tabela, r.papel, p.priv
          FROM (VALUES ('public.fiscal_cadastro'), ('public.fiscal_cadastro_log')) t(tabela),
               (VALUES ('anon'), ('authenticated'), ('service_role')) r(papel),
               (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
         WHERE has_table_privilege(r.papel, t.tabela, p.priv)`)
    ).rows;
    assert.deepEqual(priv, [], "privilégio de escrita concedido");
    // A sequência do identity do log: nenhum papel de aplicação (nem PUBLIC) tem privilégio nela.
    const seq = (
      await c.query(
        "SELECT pg_get_serial_sequence('public.fiscal_cadastro_log', 'id') AS s",
      )
    ).rows[0].s;
    assert.ok(seq, "o log tem sequência de identity");
    const acl = (
      await c.query(
        `SELECT a.grantee, a.privilege_type
           FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) a
          WHERE c.oid = $1::regclass AND a.grantee <> c.relowner`,
        [seq],
      )
    ).rows;
    assert.deepEqual(acl, [], "a sequência do log tem grant fora do dono");
    const nextval = await rodar(c, [
      P("dono", [`SELECT nextval('${seq}'::regclass)`]),
      P("anon", [`SELECT nextval('${seq}'::regclass)`]),
    ]);
    for (const x of nextval.resultados) {
      assert.equal(x.ok, false);
      assert.equal(x.code, "42501");
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (6) atributos: SECURITY DEFINER, search_path, EXECUTE, RLS, políticas
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(6) fiscal_cadastro_salvar: SECURITY DEFINER, search_path = public, EXECUTE só para authenticated (anon, PUBLIC e service_role sem); RLS ligada (sem FORCE) e UMA política SELECT por tabela, com a porta do admin atual",
  corpo: async (c) => {
    const f = (
      await c.query(`
        SELECT p.prosecdef, p.proconfig, p.proisstrict, l.lanname, pg_get_function_arguments(p.oid) AS args,
               pg_get_function_result(p.oid) AS res, pg_get_userbyid(p.proowner) AS dono,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
               has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
               EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
               (SELECT count(*)::int FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
                 AND q.proname = 'fiscal_cadastro_salvar') AS quantas
          FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = 'public.fiscal_cadastro_salvar(jsonb)'::regprocedure`)
    ).rows[0];
    assert.deepEqual(
      [f.prosecdef, f.anon, f.authenticated, f.service, f.publico],
      [true, false, true, false, false],
    );
    assert.deepEqual(f.proconfig, ["search_path=public"], "search_path fixo");
    assert.equal(f.proisstrict, false);
    assert.equal(f.lanname, "plpgsql");
    assert.equal(f.args, "p jsonb");
    assert.equal(f.res, "jsonb");
    assert.equal(f.quantas, 1, "uma só, sem sobrecarga");
    assert.ok(
      !["authenticated", "anon", "service_role"].includes(f.dono),
      "o dono da função não é papel de aplicação",
    );

    await c.query("SET search_path = pg_catalog");
    try {
      const t = (
        await c.query(`
          SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relkind
            FROM pg_class c WHERE c.oid IN ('public.fiscal_cadastro'::regclass, 'public.fiscal_cadastro_log'::regclass)
           ORDER BY c.relname`)
      ).rows;
      assert.deepEqual(t, [
        {
          relname: "fiscal_cadastro",
          relrowsecurity: true,
          relforcerowsecurity: false,
          relkind: "r",
        },
        {
          relname: "fiscal_cadastro_log",
          relrowsecurity: true,
          relforcerowsecurity: false,
          relkind: "r",
        },
      ]);
      const pol = (
        await c.query(`
          SELECT pol.polrelid::regclass::text AS tabela, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                 pol.polwithcheck IS NULL AS sem_check, pol.polcmd::text AS cmd, pol.polpermissive AS permissiva,
                 pol.polroles::regrole[]::text AS papeis
            FROM pg_policy pol
           WHERE pol.polrelid IN ('public.fiscal_cadastro'::regclass, 'public.fiscal_cadastro_log'::regclass)
           ORDER BY 1`)
      ).rows;
      const qual = "( SELECT public.rls_admin_atual() AS rls_admin_atual)";
      assert.deepEqual(pol, [
        {
          tabela: "public.fiscal_cadastro",
          polname: "fiscal_cadastro_select_policy",
          qual,
          sem_check: true,
          cmd: "r",
          permissiva: true,
          papeis: "{authenticated}",
        },
        {
          tabela: "public.fiscal_cadastro_log",
          polname: "fiscal_cadastro_log_select_policy",
          qual,
          sem_check: true,
          cmd: "r",
          permissiva: true,
          papeis: "{authenticated}",
        },
      ]);
    } finally {
      await c.query("RESET search_path");
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (7) validação e CHECKs
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(7a) o dono manda dado fora do contrato: regime, atividade, datas e payload que não é objeto são recusados com 22023 e NADA fica gravado (nem linha pela metade, nem log); os 10 pares regime x atividade válidos passam",
  corpo: async (c) => {
    const invalidos = [
      ["regime desconhecido", { ...OK1, regime: "lucro_arbitrado" }],
      ["regime em maiúscula", { ...OK1, regime: "MEI" }],
      ["regime vazio", { ...OK1, regime: "" }],
      ["regime nulo", { ...OK1, regime: null }],
      ["regime número", { ...OK1, regime: 5 }],
      ["regime ausente", { atividade: "comercio" }],
      ["atividade desconhecida", { ...OK1, atividade: "industria" }],
      ["atividade vazia", { ...OK1, atividade: "" }],
      ["atividade nula", { ...OK1, atividade: null }],
      ["atividade ausente", { regime: "mei" }],
      ["aberta_em texto", { ...OK1, aberta_em: "amanhã" }],
      ["aberta_em vazia", { ...OK1, aberta_em: "" }],
      ["aberta_em dia 30 de fevereiro", { ...OK1, aberta_em: "2026-02-30" }],
      ["aberta_em mês 13", { ...OK1, aberta_em: "2026-13-01" }],
      ["aberta_em ano zero", { ...OK1, aberta_em: "0000-01-01" }],
      ["aberta_em sem zero", { ...OK1, aberta_em: "2026-1-5" }],
      ["aberta_em today", { ...OK1, aberta_em: "today" }],
      ["aberta_em infinity", { ...OK1, aberta_em: "infinity" }],
      ["aberta_em número", { ...OK1, aberta_em: 20260101 }],
      ["aberta_em com hora", { ...OK1, aberta_em: "2026-01-01T10:00:00" }],
      ["vende dia 2", { ...OK1, vende_no_app_desde: "2026-02-02" }],
      ["vende dia 31", { ...OK1, vende_no_app_desde: "2026-01-31" }],
      ["vende 30 de fevereiro", { ...OK1, vende_no_app_desde: "2026-02-30" }],
      ["vende texto", { ...OK1, vende_no_app_desde: "xx" }],
      ["vende vazia", { ...OK1, vende_no_app_desde: "" }],
      ["vende booleano", { ...OK1, vende_no_app_desde: true }],
      ["payload array", []],
      ["payload texto", "mei"],
      ["payload número", 5],
      ["payload json null", null],
    ];
    const r = await rodar(c, [
      ...invalidos.map(([, p]) =>
        P("dono", [
          "SELECT public.fiscal_cadastro_salvar($1::jsonb) AS r",
          [JSON.stringify(p)],
        ]),
      ),
      P("dono", SALVAR_NULO),
    ]);
    r.resultados.forEach((x, i) => {
      const rotulo =
        i < invalidos.length ? invalidos[i][0] : "payload SQL NULL";
      assert.equal(x.ok, false, `${rotulo} passou`);
      assert.equal(x.code, "22023", `${rotulo}: ${x.message}`);
    });
    assert.deepEqual(r.cadastro, []);
    assert.deepEqual(r.log, []);

    // Com uma linha já gravada, o dado inválido não a altera nem registra nada.
    const velha = await rodar(
      c,
      [
        P("dono", SALVAR({ ...OK2, regime: "xyz" })),
        P("dono", SALVAR({ ...OK2, vende_no_app_desde: "2026-02-02" })),
      ],
      { antes: [LINHA_ANTIGA(U_ADM)] },
    );
    for (const x of velha.resultados) assert.equal(x.code, "22023");
    assert.equal(velha.cadastro[0].regime, "simples");
    assert.equal(velha.cadastro[0].atualizado_por, U_ADM);
    assert.deepEqual(velha.log, []);

    // Os limites que valem: dia 1 de qualquer mês e todos os pares regime x atividade.
    const pares = [];
    for (const regime of ["mei", "simples", "presumido", "real", "nao_sei"]) {
      for (const atividade of ["comercio", "com_servico"]) {
        pares.push({ regime, atividade, vende_no_app_desde: "2024-02-01" });
      }
    }
    const bons = await rodar(c, [
      ...pares.map((p) => P("dono", SALVAR(p))),
      P("dono", SALVAR({ ...OK1, aberta_em: "1999-12-31" })),
      P("dono", SALVAR({ ...OK1, aberta_em: "2024-02-29" })),
    ]);
    bons.resultados.forEach((x, i) => assert.ok(x.ok, `${i}: ${x.message}`));
    assert.equal(bons.cadastro.length, 1, "uma linha só, sempre");
    assert.equal(bons.log.length, 12, "cada troca real é uma linha de log");
    assert.ok(trilhaEncadeia(bons.log));
  },
});

PROVAS.push({
  nome: "(7b) faixa plausível das datas (22023, nada gravado): abertura entre 1900-01-01 e hoje; início das vendas não antes de 2020-01-01, não no futuro e não antes do mês da abertura; os limites exatos passam; 'hoje' é o de São Paulo, não o do servidor",
  corpo: async (c) => {
    const hoje = hojeEmSaoPaulo();
    const amanha = somaDias(hoje, 1);
    const mes1 = dia1(hoje);
    const prox1 = dia1(hoje, 1);
    const ABERTURA = /Data de abertura inválida/;
    const INICIO = /Mês de início das vendas inválido/;
    const recusados = [
      ["abertura um dia antes de 1900", { aberta_em: "1899-12-31" }, ABERTURA],
      ["abertura no ano 1000", { aberta_em: "1000-01-01" }, ABERTURA],
      ["abertura amanhã", { aberta_em: amanha }, ABERTURA],
      ["abertura daqui a um ano", { aberta_em: dia1(hoje, 12) }, ABERTURA],
      [
        "vende em dezembro de 2019",
        { vende_no_app_desde: "2019-12-01" },
        INICIO,
      ],
      ["vende em 2010", { vende_no_app_desde: "2010-01-01" }, INICIO],
      ["vende no mês que vem", { vende_no_app_desde: prox1 }, INICIO],
      ["vende daqui a um ano", { vende_no_app_desde: dia1(hoje, 12) }, INICIO],
      [
        "vende no mês antes da abertura",
        { aberta_em: "2024-05-20", vende_no_app_desde: "2024-04-01" },
        INICIO,
      ],
      [
        "vende anos antes da abertura",
        { aberta_em: "2023-01-01", vende_no_app_desde: "2020-06-01" },
        INICIO,
      ],
    ];
    const r = await rodar(
      c,
      recusados.map(([, campos]) => P("dono", SALVAR({ ...OK2, ...campos }))),
    );
    r.resultados.forEach((x, i) => {
      const [rotulo, , msg] = recusados[i];
      assert.equal(x.ok, false, `${rotulo} passou`);
      assert.equal(x.code, "22023", `${rotulo}: ${x.message}`);
      assert.match(x.message, msg, rotulo);
    });
    assert.deepEqual(r.cadastro, []);
    assert.deepEqual(r.log, []);

    // Com uma linha já gravada, a data fora da faixa não a altera nem registra nada.
    const velha = await rodar(
      c,
      [P("dono", SALVAR({ ...OK1, aberta_em: amanha }))],
      { antes: [LINHA_ANTIGA(U_ADM)] },
    );
    assert.equal(velha.resultados[0].code, "22023");
    assert.equal(velha.cadastro[0].atualizado_por, U_ADM);
    assert.equal(velha.cadastro[0].aberta_em, "2021-03-15");
    assert.deepEqual(velha.log, []);

    // Os limites exatos passam, cada um uma troca real (mesmo mês da abertura, mês seguinte, hoje, o mês de hoje).
    const aceitos = [
      { aberta_em: "1900-01-01" },
      { aberta_em: hoje },
      { vende_no_app_desde: "2020-01-01" },
      { vende_no_app_desde: mes1 },
      { aberta_em: "2024-05-20", vende_no_app_desde: "2024-05-01" },
      { aberta_em: "2024-05-31", vende_no_app_desde: "2024-06-01" },
      { aberta_em: hoje, vende_no_app_desde: mes1 },
      { aberta_em: "1900-01-01", vende_no_app_desde: "2020-01-01" },
    ];
    const bons = await rodar(
      c,
      aceitos.map((campos) => P("dono", SALVAR({ ...OK2, ...campos }))),
    );
    bons.resultados.forEach((x, i) =>
      assert.ok(x.ok, `${JSON.stringify(aceitos[i])}: ${x.message}`),
    );
    assert.equal(bons.cadastro.length, 1, "uma linha só, sempre");
    assert.equal(bons.log.length, aceitos.length, "cada troca real é um log");
    assert.ok(trilhaEncadeia(bons.log));
    assert.deepEqual(
      bons.log.at(-1).depois,
      CAMPOS({ ...OK2, ...aceitos.at(-1) }),
    );

    // O "hoje" é o de São Paulo qualquer que seja o fuso da sessão: com a sessão em outro fuso, hoje passa e amanhã não.
    assert.equal(await SONDAS.hoje_e_o_de_sao_paulo(c, []), true);
  },
});

PROVAS.push({
  nome: "(7c) os CHECKs e a chave da tabela seguem de pé sem a função (defesa em profundidade): regime, atividade e dia fora do contrato (23514), segunda linha (23505/23514), nulos (23502)",
  corpo: async (c) => {
    const base = (campos, valores) =>
      `INSERT INTO public.fiscal_cadastro (${campos}) VALUES (${valores})`;
    const casos = [
      [
        base(
          "regime, atividade, atualizado_por",
          `'lucro_arbitrado', 'comercio', '${U_DONO}'`,
        ),
        "23514",
        "regime fora",
      ],
      [
        base(
          "regime, atividade, atualizado_por",
          `'mei', 'industria', '${U_DONO}'`,
        ),
        "23514",
        "atividade fora",
      ],
      [
        base(
          "regime, atividade, vende_no_app_desde, atualizado_por",
          `'mei', 'comercio', '2026-02-02', '${U_DONO}'`,
        ),
        "23514",
        "dia 2",
      ],
      [
        base(
          "id, regime, atividade, atualizado_por",
          `false, 'mei', 'comercio', '${U_DONO}'`,
        ),
        "23514",
        "id=false",
      ],
      [
        base("regime, atividade", "'mei', 'comercio'"),
        "23502",
        "sem atualizado_por",
      ],
      [
        base("atividade, atualizado_por", `'comercio', '${U_DONO}'`),
        "23502",
        "sem regime (sem padrão)",
      ],
      [
        base("regime, atualizado_por", `'mei', '${U_DONO}'`),
        "23502",
        "sem atividade (sem padrão)",
      ],
      [
        `INSERT INTO public.fiscal_cadastro_log (quem) VALUES ('${U_DONO}')`,
        "23502",
        "log sem depois",
      ],
    ];
    for (const [sql, code, rotulo] of casos) {
      await c.query("BEGIN");
      try {
        await assert.rejects(c.query(sql), (e) => e.code === code, rotulo);
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // Segunda linha: a chave barra (23505), com a primeira já lá.
    await c.query("BEGIN");
    try {
      await c.query(LINHA_ANTIGA(U_ADM));
      await assert.rejects(
        c.query(
          base(
            "regime, atividade, atualizado_por",
            `'mei', 'comercio', '${U_DONO}'`,
          ),
        ),
        (e) => e.code === "23505",
        "segunda linha",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (8) concorrência, atomicidade, transação interrompida
// ---------------------------------------------------------------------------------------------------------------------
async function esperandoTrava(c, cliente) {
  for (let i = 0; i < 100; i++) {
    const r = await c.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
      [cliente.processID],
    );
    if (r.rowCount === 1) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

PROVAS.push({
  nome: "(8a) duas chamadas simultâneas se enfileiram: a segunda espera o COMMIT da primeira e a trilha encadeia (o antes da segunda é o depois da primeira); dois chamadores com os MESMOS dados geram UMA linha de log",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();
    try {
      await limparFiscal(c);
      // Dados diferentes, a tabela ainda vazia (o caso mais traiçoeiro: não há linha para trancar).
      await a.query("BEGIN");
      await entrar(a, "dono");
      await a.query(...SALVAR(OK1));
      await b.query("BEGIN");
      await entrar(b, "dono");
      const segunda = b.query(...SALVAR(OK2));
      segunda.catch(() => {}); // sem rejeicao solta se a asserção abaixo falhar antes do await
      assert.equal(
        await esperandoTrava(c, b),
        true,
        "a segunda chamada não esperou a primeira",
      );
      await a.query("COMMIT");
      await segunda;
      await b.query("COMMIT");
      const dois = await fiscal(c);
      assert.equal(dois.cadastro.length, 1);
      assert.equal(
        dois.cadastro[0].regime,
        "mei",
        "a segunda gravou por último",
      );
      assert.deepEqual(
        dois.log.map((l) => [l.antes, l.depois]),
        [
          [null, CAMPOS(OK1)],
          [CAMPOS(OK1), CAMPOS(OK2)],
        ],
      );
      assert.ok(trilhaEncadeia(dois.log));

      // Mesmos dados nos dois: a segunda vê o resultado da primeira e não registra de novo.
      await limparFiscal(c);
      await a.query("BEGIN");
      await entrar(a, "dono");
      await a.query(...SALVAR(OK1));
      await b.query("BEGIN");
      await entrar(b, "dono");
      const igual = b.query(...SALVAR(OK1));
      igual.catch(() => {});
      assert.equal(await esperandoTrava(c, b), true);
      await a.query("COMMIT");
      await igual;
      await b.query("COMMIT");
      const um = await fiscal(c);
      assert.equal(um.log.length, 1, "os mesmos dados não duplicam o log");
      assert.equal(um.cadastro.length, 1);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await limparFiscal(c);
    }
  },
});

PROVAS.push({
  nome: "(8b) leitura não espera gravação em curso (a trava é só entre gravadores); transação desfeita não deixa linha nem log; falha NO LOG desfaz a linha também (a chamada é uma transação só)",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const a = new Client({ connectionString: url });
    await a.connect();
    try {
      await limparFiscal(c);
      await a.query("BEGIN");
      await entrar(a, "dono");
      await a.query(...SALVAR(OK1));
      // O leitor (admin atual) não espera o gravador e não vê o que não foi confirmado.
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      await entrar(c, "adm");
      const lida = await c.query(
        "SELECT count(*)::int AS n FROM public.fiscal_cadastro",
      );
      await c.query("ROLLBACK");
      assert.equal(lida.rows[0].n, 0);
      // Transação interrompida no meio (desfeita): nada fica.
      await a.query("ROLLBACK");
      const nada = await fiscal(c);
      assert.deepEqual(nada.cadastro, []);
      assert.deepEqual(nada.log, []);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
    }

    // Falha no log: um gatilho que recusa a linha do log, criado e removido de verdade (a chamada roda SEM BEGIN, como a
    // requisição do PostgREST: uma instrução, uma transação).
    await c.query(`CREATE FUNCTION public.zz_fiscal_log_recusa() RETURNS trigger LANGUAGE plpgsql
                   AS $$ BEGIN RAISE EXCEPTION 'log recusado' USING ERRCODE = 'P0001'; END $$`);
    await c.query(`CREATE TRIGGER zz_fiscal_log_recusa BEFORE INSERT ON public.fiscal_cadastro_log
                   FOR EACH ROW EXECUTE FUNCTION public.zz_fiscal_log_recusa()`);
    try {
      await c.query("SET ROLE authenticated");
      await c.query(
        "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
        [QUEM.dono.uid, QUEM.dono.jwt],
      );
      let erro = null;
      try {
        await c.query(...SALVAR(OK1));
      } catch (e) {
        erro = e;
      }
      await c.query("RESET ROLE");
      assert.ok(erro, "a gravação passou apesar do log recusado");
      assert.equal(erro.code, "P0001");
      const depois = await fiscal(c);
      assert.deepEqual(
        depois.cadastro,
        [],
        "a linha ficou gravada sem o seu log",
      );
    } finally {
      await c.query("RESET ROLE").catch(() => {});
      await c.query(
        "SELECT set_config('app.rpc.user_id', '', false), set_config('request.jwt.claims', '', false)",
      );
      await c.query(
        "DROP TRIGGER IF EXISTS zz_fiscal_log_recusa ON public.fiscal_cadastro_log",
      );
      await c.query("DROP FUNCTION IF EXISTS public.zz_fiscal_log_recusa()");
      await limparFiscal(c);
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (9) fin_dre intocado, reaplicar, rollback, pré-voo, pós-voo
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(9a) a migration não toca o fin_dre (o md5 do corpo é o MESMO antes e depois de aplicá-la, sem constante) e nenhum objeto existente mudou: a impressão digital só ganha o que é novo",
  corpo: async (c) => {
    const md5Dre = async () =>
      (
        await c.query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS m FROM pg_proc WHERE oid = 'public.fin_dre(date,date)'::regprocedure`,
        )
      ).rows[0].m;
    const viva = await md5Dre();
    // ANTES de aplicar = o banco sem nenhum objeto desta migration (rollback comum + destrutivo); DEPOIS = reaplicada.
    await c.query("BEGIN");
    try {
      await c.query(ROLLBACK);
      await c.query("SET LOCAL app.confirmo_apagar_cadastro_fiscal = 'APAGAR'");
      await c.query(DESTRUTIVO);
      assert.equal(
        (
          await c.query(
            "SELECT to_regclass('public.fiscal_cadastro') IS NULL AS a, to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NULL AS b",
          )
        ).rows[0].a,
        true,
        "o 'antes' não é o banco sem a migration",
      );
      const antes = await md5Dre();
      await c.query(MIGRATION);
      const depois = await md5Dre();
      assert.equal(depois, antes, "aplicar a migration mexeu no fin_dre");
      assert.equal(depois, viva, "o fin_dre reaplicado difere do vivo");
      // Controle: a leitura enxerga a mudança de UM comentário no corpo (se a migration redefinisse o fin_dre, o md5 mudaria).
      const def = (
        await c.query(
          "SELECT pg_get_functiondef('public.fin_dre(date,date)'::regprocedure) AS d",
        )
      ).rows[0].d;
      const fim = def.lastIndexOf("$function$");
      assert.ok(fim > 0, "o corpo do fin_dre não está entre $function$");
      await c.query(`${def.slice(0, fim)}-- controle\n${def.slice(fim)}`);
      assert.notEqual(
        await md5Dre(),
        antes,
        "o controle: redefinir o fin_dre tem de mudar o md5",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    // Estado de rollback (objetos novos fora) vs árvore: a diferença é só o que a migration cria.
    await c.query("BEGIN");
    try {
      const d0 = await digital(c);
      await c.query(ROLLBACK);
      const d1 = await digital(c);
      const novos = diferencas(d0, d1);
      assert.ok(
        novos.every((k) => /fiscal_cadastro/.test(k)),
        `o rollback mexeu fora do que é novo: ${novos.join(", ")}`,
      );
      assert.equal(
        d1["fn public.fin_dre(date,date)"],
        d0["fn public.fin_dre(date,date)"],
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(9b) reaplicar a migration 2x não muda a impressão digital nem as linhas que já estavam lá (cadastro e log), com LF e com CRLF; o comando de cadastro do dono do runbook segue valendo",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(LINHA_ANTIGA(U_ADM));
      await c.query(LOG_ANTIGO);
      const antes = await digital(c);
      assert.deepEqual(
        antes,
        fx.digitalInicial,
        "a árvore não é o estado que a prova (0) mediu",
      );
      const linhas = await fiscal(c);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), antes);
      assert.deepEqual(
        await fiscal(c),
        linhas,
        "as linhas mudaram ao reaplicar",
      );
      // CRLF (checkout do Windows) é aceito: o corpo é comparado sem CR.
      await c.query(MIGRATION.replace(/\r?\n/g, "\r\n"));
      assert.deepEqual(await digital(c), antes);
      assert.deepEqual(await fiscal(c), linhas);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(9c) rollback comum: só a função e as 2 políticas saem, as tabelas e as LINHAS ficam seladas (leitura vazia até para o admin), repetir é no-op, reaplicar volta ao estado; o destrutivo exige a confirmação e o rollback comum antes e depois apaga as tabelas (e só elas)",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(LINHA_ANTIGA(U_ADM));
      await c.query(LOG_ANTIGO);
      const linhas = await fiscal(c);
      const d0 = await digital(c);
      await c.query(ROLLBACK);
      const d1 = await digital(c);
      assert.deepEqual(
        diferencas(d0, d1),
        [
          "fn public.fiscal_cadastro_salvar(jsonb)",
          "pol public.fiscal_cadastro.fiscal_cadastro_select_policy",
          "pol public.fiscal_cadastro_log.fiscal_cadastro_log_select_policy",
        ].sort(),
      );
      assert.deepEqual(
        await fiscal(c),
        linhas,
        "o rollback comum mexeu nas linhas",
      );
      // Seladas: RLS ligada e sem política, ninguém de aplicação lê (nem o admin atual), e a função não existe mais.
      await entrar(c, "adm");
      const lida = await c.query(
        "SELECT (SELECT count(*) FROM public.fiscal_cadastro)::int AS a, (SELECT count(*) FROM public.fiscal_cadastro_log)::int AS b",
      );
      await c.query("RESET ROLE");
      assert.deepEqual(lida.rows[0], { a: 0, b: 0 });
      await c.query("SAVEPOINT s0");
      await entrar(c, "dono");
      await assert.rejects(
        c.query(...SALVAR(OK1)),
        (e) => e.code === "42883",
        "sem a migration a função não existe",
      );
      await c.query("ROLLBACK TO SAVEPOINT s0");
      // Repetir é no-op.
      await c.query(ROLLBACK);
      assert.deepEqual(await digital(c), d1);

      // O destrutivo: sem confirmação recusa; com confirmação mas ANTES do rollback comum, recusa.
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(DESTRUTIVO), /FISCAL_SO_COM_O_DONO/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await c.query("SET LOCAL app.confirmo_apagar_cadastro_fiscal = 'APAGAR'");

      // Reaplicar sobre o estado de rollback (tabelas com linhas): volta exatamente ao da árvore, as linhas intactas.
      await c.query("SAVEPOINT r");
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), d0);
      assert.deepEqual(await fiscal(c), linhas);
      await assert.rejects(
        c.query(DESTRUTIVO),
        /FISCAL_ROLLBACK_COMUM_PRIMEIRO/,
      );
      await c.query("ROLLBACK TO SAVEPOINT r");

      // Depois do comum + confirmação: as duas tabelas saem (e só elas).
      await c.query(DESTRUTIVO);
      const d2 = await digital(c);
      assert.deepEqual(
        diferencas(d1, d2),
        [
          "acl public.fiscal_cadastro",
          "acl public.fiscal_cadastro_log",
          ...[
            "id",
            "regime",
            "atividade",
            "aberta_em",
            "vende_no_app_desde",
            "atualizado_em",
            "atualizado_por",
          ].map((x) => `col public.fiscal_cadastro.${x}`),
          ...["id", "quem", "quando", "antes", "depois"].map(
            (x) => `col public.fiscal_cadastro_log.${x}`,
          ),
        ].sort(),
      );
      assert.equal(
        (
          await c.query(
            "SELECT to_regclass('public.fiscal_cadastro') IS NULL AS a, to_regclass('public.fiscal_cadastro_log') IS NULL AS b",
          )
        ).rows[0].a,
        true,
      );
      // A migration reaplicada nasce com as tabelas VAZIAS (dado apagado não volta) e o resto igual à árvore.
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), d0);
      assert.deepEqual(await fiscal(c), { cadastro: [], log: [] });
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(9d) pré-voo: 11 estados desconhecidos recusam com B1_BASELINE_DIVERGENT SEM escrever nada; no estado de rollback a recusa deixa os objetos novos ausentes; rollback sobre corpo desconhecido recusa",
  corpo: async (c) => {
    const sabotagens = [
      [
        "rls_admin_atual sem EXECUTE para authenticated",
        "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
      ],
      [
        "is_admin_atual com corpo diferente (a 20261197 trocada)",
        "CREATE OR REPLACE FUNCTION public.is_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT true $$",
      ],
      [
        "rls_admin_atual com corpo diferente",
        "CREATE OR REPLACE FUNCTION public.rls_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT true $$",
      ],
      [
        "dono_da_loja ausente (a 20261383 faltando)",
        "DROP TABLE public.dono_da_loja",
      ],
      [
        "dono_da_loja com coluna a mais",
        "ALTER TABLE public.dono_da_loja ADD COLUMN extra text",
      ],
      [
        "dono_da_loja sem RLS",
        "ALTER TABLE public.dono_da_loja DISABLE ROW LEVEL SECURITY",
      ],
      [
        "política de admin atual de fin_lancamentos ausente (a 20261202 faltando)",
        "DROP POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos",
      ],
      [
        "política de fin_lancamentos com outra expressão",
        "ALTER POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos USING (true)",
      ],
      [
        "fiscal_cadastro com coluna a mais",
        "ALTER TABLE public.fiscal_cadastro ADD COLUMN extra text",
      ],
      [
        "fiscal_cadastro_salvar com sobrecarga",
        "CREATE FUNCTION public.fiscal_cadastro_salvar(text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
      ],
      [
        "fiscal_cadastro_salvar com corpo diferente (sucessora no ar?)",
        DDL_SUCESSORA,
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
    // Pré-voo sem NADA escrito: no estado de rollback (função e políticas ausentes), a sabotagem faz o apply recusar e a
    // função continua ausente.
    await c.query("BEGIN");
    try {
      await c.query(ROLLBACK);
      await c.query(
        "DROP POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos",
      );
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      const r = await c.query(`
        SELECT to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NULL AS sem_funcao,
               NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname IN ('fiscal_cadastro_select_policy', 'fiscal_cadastro_log_select_policy')) AS sem_politicas`);
      assert.deepEqual(r.rows[0], { sem_funcao: true, sem_politicas: true });
    } finally {
      await c.query("ROLLBACK");
    }
    // Rollback sobre corpo desconhecido (sucessora no ar): recusa e nada é apagado.
    await c.query("BEGIN");
    try {
      await c.query(DDL_SUCESSORA);
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      const r = await c.query(
        "SELECT to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NOT NULL AS ainda_la",
      );
      assert.equal(r.rows[0].ainda_la, true);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(9e) pós-voo que falha desfaz TUDO numa conexão SEM BEGIN (como o aplicador): nada fica aplicado; depois de consertar, o apply fecha igual à árvore",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const cliente = new Client({ connectionString: url });
    await cliente.connect();
    try {
      // Estado de rollback (committed), com uma política a mais em fiscal_cadastro: o pré-voo não olha políticas, o
      // pós-voo sim.
      await c.query(ROLLBACK);
      await c.query(
        "CREATE POLICY fiscal_cadastro_intrusa ON public.fiscal_cadastro FOR SELECT TO authenticated USING (true)",
      );
      await assert.rejects(cliente.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
      const depois = await c.query(`
        SELECT to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NULL AS sem_funcao,
               NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname IN ('fiscal_cadastro_select_policy', 'fiscal_cadastro_log_select_policy')) AS sem_politicas`);
      assert.deepEqual(
        depois.rows[0],
        { sem_funcao: true, sem_politicas: true },
        "o pós-voo falhou mas algo ficou gravado",
      );
    } finally {
      await cliente.end().catch(() => {});
      await c.query(
        "DROP POLICY IF EXISTS fiscal_cadastro_intrusa ON public.fiscal_cadastro",
      );
      await c.query(MIGRATION);
    }
    assert.deepEqual(
      await digital(c),
      fx.digitalInicial,
      "o apply final não fechou igual à árvore",
    );
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (10) CONTROLES: sondas, o estado SEM a migration e os mutantes
// ---------------------------------------------------------------------------------------------------------------------
const FUSO_DE_SP = "SET LOCAL TIME ZONE 'America/Sao_Paulo'";
// O dono manda o payload e a função tem de recusar com 22023 sem gravar nada.
async function recusa22023(c, antes, payload) {
  const r = await rodar(c, [P("dono", SALVAR(payload))], { antes });
  return (
    !r.resultados[0].ok &&
    r.resultados[0].code === "22023" &&
    r.cadastro.length === 0
  );
}

const SONDAS = {
  async dono_grava(c, antes) {
    const r = await rodar(c, [P("dono", SALVAR(OK1))], { antes });
    return (
      r.resultados[0].ok &&
      r.cadastro.length === 1 &&
      r.cadastro[0].regime === "simples" &&
      r.log.length === 1
    );
  },
  async admin_nao_dono_recusa(c, antes) {
    const r = await rodar(c, [P("adm", SALVAR(OK1))], { antes });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.cadastro.length === 0
    );
  },
  async sem_dono_ninguem_grava(c, antes) {
    const r = await rodar(c, [P("dono", SALVAR(OK1))], {
      antes: [...antes, SEM_DONO],
    });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.cadastro.length === 0
    );
  },
  async dono_rebaixado_recusa(c, antes) {
    const r = await rodar(c, [P("donoRebaixado", SALVAR(OK1))], {
      antes: [...antes, ...DONO_E(U_DONO_REB)],
    });
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.cadastro.length === 0
    );
  },
  async cliente_nao_le(c, antes) {
    const contar = ["SELECT count(*)::int AS n FROM public.fiscal_cadastro"];
    const contarLog = [
      "SELECT count(*)::int AS n FROM public.fiscal_cadastro_log",
    ];
    const r = await rodar(
      c,
      [
        P("cliente", contar),
        P("cliente", contarLog),
        P("adm", contar),
        P("adm", contarLog),
      ],
      { antes: [...antes, LINHA_ANTIGA(U_ADM), LOG_ANTIGO] },
    );
    const n = (i) => r.resultados[i].ok && r.resultados[i].rows[0].n;
    return n(0) === 0 && n(1) === 0 && n(2) === 1 && n(3) === 1;
  },
  async repetir_nao_gera_log(c, antes) {
    const r = await rodar(c, [P("dono", SALVAR(OK1)), P("dono", SALVAR(OK1))], {
      antes,
    });
    return r.resultados[1].ok && r.log.length === 1;
  },
  async regime_invalido_22023(c, antes) {
    const r = await rodar(
      c,
      [P("dono", SALVAR({ ...OK1, regime: "lucro_arbitrado" }))],
      { antes },
    );
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "22023" &&
      r.cadastro.length === 0
    );
  },
  async data_fora_do_check_22023(c, antes) {
    const r = await rodar(
      c,
      [P("dono", SALVAR({ ...OK1, vende_no_app_desde: "2026-02-02" }))],
      { antes },
    );
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "22023" &&
      r.cadastro.length === 0
    );
  },
  async aberta_antes_de_1900_22023(c, antes) {
    return recusa22023(c, antes, { ...OK2, aberta_em: "1899-12-31" });
  },
  // Estas duas medem o TETO, não o fuso: a sessão fica no fuso de São Paulo para o resultado não depender da hora em que a prova
  // roda (de noite o dia do servidor, em UTC, já é o de amanhã em São Paulo). O fuso tem a sonda dele, mais abaixo.
  async aberta_no_futuro_22023(c, antes) {
    return recusa22023(c, [...antes, FUSO_DE_SP], {
      ...OK2,
      aberta_em: somaDias(hojeEmSaoPaulo(), 1),
    });
  },
  async vende_antes_de_2020_22023(c, antes) {
    return recusa22023(c, antes, { ...OK2, vende_no_app_desde: "2019-12-01" });
  },
  async vende_no_futuro_22023(c, antes) {
    return recusa22023(c, [...antes, FUSO_DE_SP], {
      ...OK2,
      vende_no_app_desde: dia1(hojeEmSaoPaulo(), 1),
    });
  },
  async vende_antes_da_abertura_22023(c, antes) {
    return recusa22023(c, antes, {
      ...OK2,
      aberta_em: "2024-05-20",
      vende_no_app_desde: "2024-04-01",
    });
  },
  // O "hoje" da faixa é o de São Paulo, não o do relógio do servidor: com a sessão em fusos de pontas opostas (+14 h e -11 h,
  // um dos dois sempre cai em outro DIA que São Paulo) hoje e o mês de hoje passam, amanhã e o mês que vem não.
  async hoje_e_o_de_sao_paulo(c, antes) {
    const hoje = hojeEmSaoPaulo();
    for (const fuso of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      const r = await rodar(
        c,
        [
          P("dono", SALVAR({ ...OK2, aberta_em: hoje })),
          P("dono", SALVAR({ ...OK2, aberta_em: somaDias(hoje, 1) })),
          P("dono", SALVAR({ ...OK2, vende_no_app_desde: dia1(hoje) })),
          P("dono", SALVAR({ ...OK2, vende_no_app_desde: dia1(hoje, 1) })),
        ],
        { antes: [...antes, `SET LOCAL TIME ZONE '${fuso}'`] },
      );
      const [a, b, v, w] = r.resultados;
      if (!a.ok || !v.ok || b.ok || b.code !== "22023") return false;
      if (w.ok || w.code !== "22023") return false;
    }
    return true;
  },
  async anon_sem_execute(c, antes) {
    const r = await rodar(c, [P("anon", SALVAR(OK1))], { antes });
    return (
      !r.resultados[0].ok &&
      /permission denied/.test(r.resultados[0].message) &&
      r.cadastro.length === 0
    );
  },
  async escrita_direta_negada(c, antes) {
    const r = await rodar(
      c,
      [
        P("dono", [
          "INSERT INTO public.fiscal_cadastro (regime, atividade, atualizado_por) VALUES ('mei', 'comercio', $1)",
          [U_DONO],
        ]),
      ],
      { antes },
    );
    return (
      !r.resultados[0].ok &&
      r.resultados[0].code === "42501" &&
      r.cadastro.length === 0
    );
  },
};

// Cada sonda roda numa transação desfeita, com o DDL do mutante (ou o rollback) aplicado antes dela.
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
  nome: "(10a) as 16 sondas valem no estado da árvore; SEM a migration (rollback) as que dependem dela REPROVAM — cada prova nova falha sem a mudança",
  corpo: async (c) => {
    assert.deepEqual(
      falhas(await rodarSondas(c)),
      [],
      "no estado da árvore todas as sondas valem",
    );
    const sem = await rodarSondas(c, [ROLLBACK]);
    // Sem a migration (rollback comum): a função não existe (42883, não a recusa de dono), as políticas somem (admin lê
    // vazio) e o anon não chega a uma porta que não existe. A única sonda que vale dos dois lados é a da escrita direta:
    // os grants das tabelas sobrevivem ao rollback comum (as tabelas ficam seladas, não abertas).
    assert.deepEqual(
      falhas(sem),
      Object.keys(SONDAS)
        .filter((k) => k !== "escrita_direta_negada")
        .sort(),
      "sem a migration todas as sondas (menos a da escrita direta) deveriam reprovar",
    );
  },
});

const MUTANTES = [
  {
    nome: "M1 sem conferir o dono do banco (basta estar logado)",
    reprovam: ["admin_nao_dono_recusa", "sem_dono_ninguem_grava"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_quem IS NULL OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem) THEN",
        "IF v_quem IS NULL THEN",
      ),
  },
  {
    nome: "M2 sem is_admin_atual() (o dono rebaixado grava)",
    reprovam: ["dono_rebaixado_recusa"],
    sql: () =>
      mutar(DDL_SALVAR, "IF NOT public.is_admin_atual() THEN", "IF false THEN"),
  },
  {
    nome: "M3 a política de leitura vira `true` nas duas tabelas (cliente lê)",
    reprovam: ["cliente_nao_le"],
    sql: () =>
      [
        "ALTER POLICY fiscal_cadastro_select_policy ON public.fiscal_cadastro USING (true)",
        "ALTER POLICY fiscal_cadastro_log_select_policy ON public.fiscal_cadastro_log USING (true)",
      ].join("; "),
  },
  {
    nome: "M4 grava e registra mesmo com os dados iguais (log sujo)",
    reprovam: ["repetir_nao_gera_log"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_antes IS NOT DISTINCT FROM v_depois THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M5 sem validar o regime na função (só o CHECK da tabela barra, com outro código)",
    reprovam: ["regime_invalido_22023"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "OR p ->> 'regime' NOT IN ('mei', 'simples', 'presumido', 'real', 'nao_sei') THEN",
        "OR false THEN",
      ),
  },
  {
    nome: "M6 sem validar o dia 1 de vende_no_app_desde na função",
    reprovam: ["data_fora_do_check_22023"],
    sql: () =>
      mutar(DDL_SALVAR, "AND extract(day FROM v_vende) <> 1", "AND false"),
  },
  {
    nome: "M7 anon recebe EXECUTE",
    reprovam: ["anon_sem_execute"],
    sql: () =>
      "GRANT EXECUTE ON FUNCTION public.fiscal_cadastro_salvar(jsonb) TO anon",
  },
  {
    nome: "M8 authenticated ganha escrita direta (GRANT ALL e política FOR ALL)",
    reprovam: ["escrita_direta_negada", "cliente_nao_le"],
    sql: () =>
      [
        "GRANT ALL ON TABLE public.fiscal_cadastro TO authenticated",
        "CREATE POLICY fiscal_cadastro_intrusa ON public.fiscal_cadastro FOR ALL TO authenticated USING (true) WITH CHECK (true)",
      ].join("; "),
  },
  {
    nome: "M9 sem conferir o dono E sem is_admin_atual (qualquer login grava)",
    reprovam: [
      "admin_nao_dono_recusa",
      "dono_rebaixado_recusa",
      "sem_dono_ninguem_grava",
    ],
    sql: () =>
      mutar(
        mutar(
          DDL_SALVAR,
          "IF v_quem IS NULL OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem) THEN",
          "IF v_quem IS NULL THEN",
        ),
        "IF NOT public.is_admin_atual() THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M10 sem o piso de 1900 na abertura",
    reprovam: ["aberta_antes_de_1900_22023"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_aberta IS NOT NULL AND v_aberta < DATE '1900-01-01' THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M11 sem o teto de hoje na abertura (empresa aberta no futuro)",
    // A sonda do fuso também usa o teto da abertura (amanhã tem de ser recusado): cai junto.
    reprovam: ["aberta_no_futuro_22023", "hoje_e_o_de_sao_paulo"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_aberta IS NOT NULL AND v_aberta > v_hoje THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M12 sem o piso de 2020 no início das vendas",
    reprovam: ["vende_antes_de_2020_22023"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_vende IS NOT NULL AND v_vende < DATE '2020-01-01' THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M13 sem o teto de hoje no início das vendas (mês que ainda não começou)",
    // A sonda do fuso também usa o teto do início das vendas (o mês que vem tem de ser recusado): cai junto.
    reprovam: ["vende_no_futuro_22023", "hoje_e_o_de_sao_paulo"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_vende IS NOT NULL AND v_vende > v_hoje THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M14 sem a regra do início das vendas não vir antes do mês da abertura",
    reprovam: ["vende_antes_da_abertura_22023"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "IF v_vende IS NOT NULL AND v_aberta IS NOT NULL AND v_vende < v_aberta - (extract(day FROM v_aberta)::int - 1) THEN",
        "IF false THEN",
      ),
  },
  {
    nome: "M15 o 'hoje' vira o relógio do servidor (current_date) em vez de São Paulo",
    reprovam: ["hoje_e_o_de_sao_paulo"],
    sql: () =>
      mutar(
        DDL_SALVAR,
        "v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;",
        "v_hoje date := current_date;",
      ),
  },
];

PROVAS.push({
  nome: "(10b) 15 mutantes (cada guarda tirada: sem conferir o dono, sem is_admin_atual, política `true`, log sujo, validação, grants, cada regra da faixa das datas e o 'hoje') deixam vermelha EXATAMENTE a sonda que cada um declara (e a de controle dono_grava segue verde: o DDL do mutante aplicou)",
  corpo: async (c) => {
    for (const m of MUTANTES) {
      const sondas = await rodarSondas(c, [m.sql()]);
      // Um DDL que falha ao aplicar faria rodarSondas devolver tudo falso: a sonda de controle denuncia isso.
      assert.equal(
        sondas.dono_grava,
        true,
        `${m.nome}: a sonda de controle dono_grava caiu (o DDL do mutante não aplicou?), falhas = ${falhas(sondas).join(",")}`,
      );
      assert.deepEqual(
        falhas(sondas),
        [...m.reprovam].sort(),
        `${m.nome}: só as sondas declaradas (${m.reprovam.join(",")}) deviam reprovar; reprovaram: ${falhas(sondas).join(",") || "(nenhuma)"}`,
      );
    }
  },
});

PROVAS.push({
  nome: "(10c) mutante da trava de tabela: sem o LOCK a segunda chamada simultânea NÃO espera e a trilha DESENCADEIA (o antes da segunda não é o depois da primeira); o corpo original encadeia (8a)",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();
    const mutado = mutar(
      DDL_SALVAR,
      "LOCK TABLE public.fiscal_cadastro IN SHARE ROW EXCLUSIVE MODE;",
      "NULL;",
    );
    try {
      await limparFiscal(c);
      await c.query(mutado);
      await a.query("BEGIN");
      await entrar(a, "dono");
      await a.query(...SALVAR(OK1));
      await b.query("BEGIN");
      await entrar(b, "dono");
      // Sem o LOCK, B leu a tabela vazia (A ainda não confirmou) e grava por cima quando A confirma.
      const segunda = b.query(...SALVAR(OK2));
      segunda.catch(() => {});
      assert.equal(
        await esperandoTrava(c, b),
        true,
        "sem o LOCK, B ainda espera a linha de A (o INSERT ... ON CONFLICT espera a confirmação dela)",
      );
      await a.query("COMMIT");
      await segunda;
      await b.query("COMMIT");
      const dois = await fiscal(c);
      assert.equal(dois.log.length, 2);
      assert.equal(
        trilhaEncadeia(dois.log),
        false,
        "o mutante tinha de reproduzir a atualização perdida (o antes da segunda ser nulo)",
      );
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await c.query(DDL_SALVAR);
      await limparFiscal(c);
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
  const titulo =
    "Prova viva: só o dono da loja altera o cadastro fiscal (rpc-ci)";
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
          "Uma regra do cadastro fiscal foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[cadastro-fiscal] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
