"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, CASOS,
 * HASH_VIGENTE, HASH_DESTA) ou do catálogo do Postgres efêmero; nunca de
 * entrada de rede nem de payload de terceiro. */

/**
 * PROVA VIVA da migration
 * 20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO (ressalva R-b da revisão Opus da 20261199000000, 04/10/2026):
 *   admin_devolucao_decidir, admin_devolucao_registrar e
 *   admin_devolucao_reprovar autorizavam só por `is_admin()`, que confia no
 *   JWT (~1 h depois do rebaixamento). Um ex-admin decidia (aprovava ou
 *   recusava), registrava envio/recebimento e reprovava a devolução de um
 *   cliente — a loja inteira vê o resultado, e o cliente recebe a recusa.
 *
 * O QUE SE PROVA, para CADA uma das três RPCs:
 *   (a) ex-admin rebaixado só no profiles e ex-admin rebaixado só no
 *       app_metadata (nos dois casos com o JWT ainda dizendo admin) recebem
 *       a MESMA recusa de sempre (42501 'Acesso negado.') e NADA é escrito
 *       (a linha da devolução e os eventos dela ficam iguais, lidos antes e
 *       depois); a recusa vem ANTES de olhar a devolução (id que não existe
 *       também recebe 42501, nunca P0002 — sem oráculo de existência);
 *   (b) admin de verdade (admin nas duas fontes) tem o efeito normal: a
 *       devolução muda de estado e ganha o evento; service_role e postgres
 *       passam como antes; id que não existe, para o admin, segue P0002;
 *   (c) cliente comum e anon recusam como antes, sem escrita;
 *   CONTROLE: com o corpo vivo SEM a guarda os dois rebaixados passam e
 *   ESCREVEM — é a guarda, e não outra coisa, que recusa.
 *   (d) o banco nascido das migrations tem os três corpos DESTA migration;
 *       reaplicar por cima (2x) não muda a impressão digital; o
 *       rollback-manual troca SÓ os três corpos para o md5 de antes (ACL,
 *       SECURITY DEFINER, search_path, dono e assinatura intactos), o 2o
 *       rollback recusa sem escrever e reaplicar volta ao estado da
 *       migration; o preflight recusa (sem nenhuma escrita) corpo vivo
 *       divergente, is_admin_atual() divergente e is_admin_atual() ausente;
 *       o rollback recusa sobre estado divergente.
 *
 * Toda chamada de RPC roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-devolucao-viva.cjs
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

const NOME_MIGRATION =
  "20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql";
const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);

// Lidos sob demanda: a prova de comportamento (a)-(c) não depende do arquivo.
const memo = {};
function lerMigration(nome) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
  memo[nome] ??= fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
  return memo[nome];
}
const migration = () => lerMigration(NOME_MIGRATION);
const rollback = () => lerMigration(`rollback-manual-${NOME_MIGRATION}`);

// Os hashes (md5 de prosrc sem \r) de antes e de depois, lidos do PREFLIGHT
// da própria migration — a prova de texto amarra cada um ao md5 real do
// corpo; aqui se prova que o banco nascido das migrations bate com eles.
function hashes() {
  const vigente = {};
  const desta = {};
  for (const m of migration().matchAll(
    /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
  )) {
    vigente[m[1]] = m[2];
    desta[m[1]] = m[3];
  }
  return { vigente, desta, assinaturas: Object.keys(vigente) };
}

const U_ADMIN = "a9b00000-0000-4000-8000-000000000001";
const U_REB_PERFIL = "a9b00000-0000-4000-8000-000000000002";
const U_REB_AUTH = "a9b00000-0000-4000-8000-000000000003";
const U_CLIENTE = "a9b00000-0000-4000-8000-000000000004";
const U_DONO = "a9b00000-0000-4000-8000-000000000005";
const ID_INEXISTENTE = "a9bddddd-0000-4000-8000-0000000000ff";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (auth.uid() desta suíte
// lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
  dono: { papel: "authenticated", uid: U_DONO, jwt: claims(U_DONO, null) },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  // Rebaixado só no profiles (auth.users ainda admin), JWT velho dizendo admin.
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: U_REB_PERFIL,
    jwt: claims(U_REB_PERFIL, "admin"),
  },
  // Rebaixado só no app_metadata (painel do Supabase; profiles ainda admin).
  rebaixadoAuth: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "admin"),
  },
  // O mesmo, já com o JWT NOVO (diz customer).
  rebaixadoAuthJwtNovo: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "customer"),
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

// A linha da devolução e a contagem dos eventos dela, lidas como o dono do
// banco (sem RLS) — a prova de "nenhuma escrita".
async function retrato(c, id) {
  const r = await c.query(
    `SELECT (SELECT to_jsonb(d) FROM public.devolucoes d WHERE d.id = $1::uuid) AS d,
            (SELECT count(*)::int FROM public.devolucao_eventos e WHERE e.devolucao_id = $1::uuid) AS eventos`,
    [id],
  );
  return r.rows[0];
}

// Roda `sql` como `quem` numa transação SEMPRE desfeita e devolve a resposta
// e o retrato de `id` antes e depois. `preparo`: SQL rodado como dono do
// banco antes de entrar (o CONTROLE troca o corpo da função aqui).
async function chamar(c, quem, sql, params, id, { preparo = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of preparo) await c.query(s);
    const antes = await retrato(c, id);
    await entrar(c, quem);
    await c.query("SAVEPOINT chamada");
    let res;
    try {
      const r = await c.query(sql, params);
      res = { ok: true, linhas: r.rows };
    } catch (erro) {
      res = { ok: false, code: erro.code, message: erro.message };
      await c.query("ROLLBACK TO SAVEPOINT chamada");
    }
    await c.query("RESET ROLE");
    const depois = await retrato(c, id);
    return { ...res, antes, depois };
  } finally {
    await c.query("ROLLBACK");
  }
}

// A guarda desta migration, como aparece no corpo vivo.
const RE_GUARDA =
  /\n[ \t]*-- Papel ATUAL[^\n]*\(20261200000000\)\.\n[ \t]*IF [^\n]*public\.is_admin_atual\(\)[\s\S]*?\n[ \t]*END IF;\n/g;

function semGuarda(def) {
  const achados = def.match(RE_GUARDA) || [];
  assert.equal(
    achados.length,
    1,
    "a guarda tem de aparecer UMA vez no corpo vivo",
  );
  return def.replace(RE_GUARDA, "\n");
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de
// tabela/coluna — deparseadas com search_path = pg_catalog.
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
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname, a.attacl::text
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

const fnChave = (assinatura) => `fn ${assinatura}`;

const PROVAS = [];
const fx = {};

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixados nas duas direções, cliente e dono; três devoluções (solicitada, aprovada, recebida)",
  corpo: async (c) => {
    for (const id of [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_CLIENTE, U_DONO]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@decisao.teste', '{}'::jsonb)`,
        [id],
      );
    }
    // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia).
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Atual', 'admin'), ($2, 'Rebaixado Perfil', 'customer'),
         ($3, 'Rebaixado Auth', 'admin'), ($4, 'Cliente', 'customer'),
         ($5, 'Dono da Devolução', 'customer')`,
      [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_CLIENTE, U_DONO],
    );
    // As contradições, direto em auth.users (como o painel do Supabase faz).
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_REB_PERFIL],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
      [U_REB_AUTH],
    );
    const r = await c.query(
      `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS auth_role, p.role AS perfil_role
         FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id::text LIKE 'a9b00000-%' ORDER BY u.id`,
    );
    assert.deepEqual(
      r.rows.map((l) => [l.id, l.auth_role, l.perfil_role]),
      [
        [U_ADMIN, "admin", "admin"],
        [U_REB_PERFIL, "admin", "customer"],
        [U_REB_AUTH, "customer", "admin"],
        [U_CLIENTE, "customer", "customer"],
        [U_DONO, "customer", "customer"],
      ],
    );

    // Uma devolução ABERTA por pedido (índice único): um pedido por estado.
    const dados = JSON.stringify({ whatsapp: "5599999990000" });
    let n = 0;
    for (const [chave, status] of [
      ["solicitada", "solicitada"],
      ["aprovada", "aprovada"],
      ["recebida", "recebida"],
    ]) {
      n += 1;
      const pedido = `a9bccccc-0000-4000-8000-00000000000${n}`;
      const dev = `a9bddddd-0000-4000-8000-00000000000${n}`;
      await c.query(
        `INSERT INTO public.marketplace_orders
           (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
            payment_method, payment_status, paid_at, cancelled_after_shipping)
         VALUES ($1, $2, 'Cliente Decisão', $3::jsonb, 100, 100, 'delivered', 'online',
                 'pix', 'pago', now(), false)`,
        [pedido, U_DONO, dados],
      );
      await c.query(
        `INSERT INTO public.devolucoes
           (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
            metodo_retorno, status, valor_itens, prazo_ate, politica)
         VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'troca', 'local',
                 'entrega_na_loja', $5, 100, current_date + 7, '{}'::jsonb)`,
        [dev, `DEV-DECISAO-${n}`, pedido, U_DONO, status],
      );
      fx[chave] = dev;
    }
  },
});

// ---------------------------------------------------------------------------
// (a)-(c) comportamento, para cada RPC
// ---------------------------------------------------------------------------

const RECUSA = { code: "42501", mensagem: /^Acesso negado\.$/ };

// `fx`: chave da devolução da fixture; `estadoAntes`/`estadoDepois`: o que o
// admin de verdade muda (a RPC faz esta transição); `sql`: a chamada.
const CASOS = [
  {
    nome: "admin_devolucao_decidir",
    assinatura:
      "public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)",
    dev: "solicitada",
    sql: "SELECT public.admin_devolucao_decidir($1::uuid, true, 'Aprovada pela loja.') AS r",
    estadoAntes: "solicitada",
    estadoDepois: "aprovada",
  },
  {
    nome: "admin_devolucao_registrar",
    assinatura: "public.admin_devolucao_registrar(uuid,text,text,text)",
    dev: "aprovada",
    sql: "SELECT public.admin_devolucao_registrar($1::uuid, 'recebida', NULL, 'Chegou.') AS r",
    estadoAntes: "aprovada",
    estadoDepois: "recebida",
  },
  {
    nome: "admin_devolucao_reprovar",
    assinatura: "public.admin_devolucao_reprovar(uuid,text)",
    dev: "recebida",
    sql: "SELECT public.admin_devolucao_reprovar($1::uuid, 'Produto usado.') AS r",
    estadoAntes: "recebida",
    estadoDepois: "reprovada",
  },
];

function recusou(r, quem, nome) {
  assert.equal(r.ok, false, `${nome}: ${quem} NÃO foi recusado`);
  assert.equal(r.code, RECUSA.code, `${nome}: ${quem} SQLSTATE ${r.code}`);
  assert.match(r.message, RECUSA.mensagem, `${nome}: ${quem} mensagem`);
}

function semEscrita(r, quem, nome) {
  assert.deepEqual(
    r.depois,
    r.antes,
    `${nome}: ${quem} recusado mas a devolução/eventos mudaram`,
  );
}

for (const caso of CASOS) {
  PROVAS.push({
    nome: `(a)(b)(c) ${caso.nome}: rebaixados (JWT velho) recusados sem escrita e sem oráculo de existência; admin atual tem o efeito normal; service_role/postgres como antes; cliente e anon recusam; CONTROLE sem a guarda escreve`,
    corpo: async (c) => {
      const id = fx[caso.dev];
      assert.ok(id, `fixture ${caso.dev} ausente`);

      // (a) os dois rebaixados, JWT ainda dizendo admin; e o JWT novo.
      for (const quem of [
        "rebaixadoPerfil",
        "rebaixadoAuth",
        "rebaixadoAuthJwtNovo",
      ]) {
        const r = await chamar(c, quem, caso.sql, [id], id);
        recusou(r, quem, caso.nome);
        semEscrita(r, quem, caso.nome);
        assert.equal(r.antes.d.status, caso.estadoAntes);
        // Borda: devolução que não existe — a recusa vem ANTES de olhar a
        // tabela (42501, nunca P0002: sem oráculo de existência).
        const x = await chamar(c, quem, caso.sql, [ID_INEXISTENTE], id);
        recusou(x, `${quem} (id inexistente)`, caso.nome);
      }

      // (c) cliente comum, o dono da devolução (não é admin) e anon.
      for (const quem of ["cliente", "dono"]) {
        const r = await chamar(c, quem, caso.sql, [id], id);
        recusou(r, quem, caso.nome);
        semEscrita(r, quem, caso.nome);
      }
      const anon = await chamar(c, "anon", caso.sql, [id], id);
      assert.equal(anon.ok, false, `${caso.nome}: anon passou`);
      assert.equal(anon.code, "42501", `${caso.nome}: anon ${anon.code}`);
      semEscrita(anon, "anon", caso.nome);

      // (b) admin de verdade: efeito normal (estado muda e ganha 1 evento).
      for (const quem of ["admin", "service", "postgres"]) {
        const r = await chamar(c, quem, caso.sql, [id], id);
        assert.equal(
          r.ok,
          true,
          `${caso.nome}: ${quem} recusado: ${r.code} ${r.message}`,
        );
        assert.equal(r.depois.d.status, caso.estadoDepois, `${quem}: estado`);
        assert.equal(
          r.depois.eventos,
          r.antes.eventos + 1,
          `${quem}: o evento não foi gravado`,
        );
      }
      // Admin com id inexistente continua recebendo P0002.
      const nada = await chamar(c, "admin", caso.sql, [ID_INEXISTENTE], id);
      assert.equal(nada.ok, false);
      assert.equal(nada.code, "P0002", "admin + id inexistente");

      // CONTROLE: o corpo vivo sem a guarda deixa os dois rebaixados
      // passarem e escreverem.
      const vivo = await catalogo(c, caso.assinatura);
      assert.ok(vivo, `${caso.assinatura} não existe`);
      const controle = semGuarda(vivo.def);
      for (const quem of ["rebaixadoPerfil", "rebaixadoAuth"]) {
        const r = await chamar(c, quem, caso.sql, [id], id, {
          preparo: [controle],
        });
        assert.equal(
          r.ok,
          true,
          `CONTROLE FALHOU (${caso.nome}, ${quem}): sem a guarda ainda recusa (${r.code} ${r.message}) — a prova não mede a guarda`,
        );
        assert.equal(
          r.depois.d.status,
          caso.estadoDepois,
          `CONTROLE (${caso.nome}, ${quem}): sem a guarda não escreveu`,
        );
      }
      assert.equal(
        (await catalogo(c, caso.assinatura)).hash,
        vivo.hash,
        "o controle vazou para o corpo vivo",
      );
    },
  });
}

// ---------------------------------------------------------------------------
// (d) corpo vivo, rollback, idempotência, preflight
// ---------------------------------------------------------------------------

PROVAS.push({
  nome: "(d) o banco nascido das migrations tem os 3 corpos DESTA migration (e cada um é o que o preflight declara)",
  corpo: async (c) => {
    const h = hashes();
    assert.deepEqual(
      h.assinaturas.slice().sort(),
      CASOS.map((x) => x.assinatura).sort(),
      "o preflight tem de listar exatamente as três RPCs",
    );
    for (const a of h.assinaturas) {
      const r = await catalogo(c, a);
      assert.ok(r, `${a} não existe`);
      assert.equal(
        r.hash,
        h.desta[a],
        `${a}: o corpo vivo não é o desta migration`,
      );
    }
  },
});

PROVAS.push({
  nome: "(d) reaplicar a migration por cima de si mesma (2x) não muda a impressão digital",
  corpo: async (c) => {
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(migration());
      await c.query(migration());
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(d) rollback-manual: SÓ os 3 corpos mudam, cada um para o md5 de antes; o resto da impressão digital igual; 2o rollback recusa sem escrever; reaplicar volta ao estado da migration",
  corpo: async (c) => {
    const h = hashes();
    const com = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(rollback());
      const sem = await digital(c);
      assert.deepEqual(
        Object.keys(sem).sort(),
        Object.keys(com).sort(),
        "o rollback criou ou apagou objeto",
      );
      const mudou = Object.keys(com)
        .filter((k) => com[k] !== sem[k])
        .sort();
      assert.deepEqual(
        mudou,
        h.assinaturas.map(fnChave).sort(),
        "o rollback mudou algo além dos 3 corpos",
      );
      for (const a of h.assinaturas) {
        const [hCom, ...restoCom] = com[fnChave(a)].split(" | ");
        const [hSem, ...restoSem] = sem[fnChave(a)].split(" | ");
        assert.equal(hCom, h.desta[a]);
        assert.equal(
          hSem,
          h.vigente[a],
          `${a}: o rollback não voltou ao corpo de antes`,
        );
        assert.deepEqual(
          restoSem,
          restoCom,
          `${a}: ACL/SECURITY DEFINER/search_path/dono/assinatura mudou`,
        );
      }
      // Depois do rollback o defeito VOLTA (prova de que o rollback é real):
      // o rebaixado decide a devolução.
      await c.query("SAVEPOINT volta");
      const id = fx.solicitada;
      await entrar(c, "rebaixadoPerfil");
      const r = await c.query(CASOS[0].sql, [id]);
      assert.equal(r.rows[0].r.status, "aprovada");
      await c.query("RESET ROLE");
      await c.query("ROLLBACK TO SAVEPOINT volta");
      // Segundo rollback: recusa sem escrever.
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(rollback()), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(await digital(c), sem, "o 2o rollback escreveu algo");
      // Reaplicar: volta exatamente ao estado da migration; de novo: igual.
      await c.query(migration());
      assert.deepEqual(
        await digital(c),
        com,
        "reaplicar depois do rollback divergiu",
      );
      await c.query(migration());
      assert.deepEqual(await digital(c), com, "reaplicar 2x divergiu");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(d) preflight: corpo vivo divergente, is_admin_atual() divergente ou ausente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita; rollback sobre estado divergente idem",
  corpo: async (c) => {
    const h = hashes();
    const primeira = h.assinaturas[0];
    const ultima = h.assinaturas[h.assinaturas.length - 1];
    const divergir = {
      corpo: async () => {
        const def = (await catalogo(c, ultima)).def;
        const d = def.replace(
          "Só um produto recebido pode ser reprovado na inspeção.",
          "Só um produto recebido pode ser reprovado na inspeção (divergente).",
        );
        assert.notEqual(d, def);
        await c.query(d);
      },
      atualDiferente: async () => {
        const def = (await catalogo(c, "public.is_admin_atual()")).def;
        const d = def.replace(
          "(c) Qualquer outra coisa: false.",
          "(c) Qualquer outra coisa: false (divergente).",
        );
        assert.notEqual(d, def);
        await c.query(d);
      },
      atualAusente: () => c.query("DROP FUNCTION public.is_admin_atual()"),
    };
    const regex = {
      corpo:
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.admin_devolucao_reprovar/,
      atualDiferente: /B1_BASELINE_DIVERGENT: public\.is_admin_atual\(\)/,
      atualAusente: /B1_BASELINE_DIVERGENT: public\.is_admin_atual\(\)/,
    };
    for (const rotulo of Object.keys(divergir)) {
      await c.query("BEGIN");
      try {
        // Volta ao estado de antes da migration e diverge UMA peça.
        await c.query(rollback());
        await divergir[rotulo]();
        const antes = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(migration()), regex[rotulo], rotulo);
        await c.query("ROLLBACK TO SAVEPOINT aplicar");
        assert.deepEqual(
          await digital(c),
          antes,
          `a recusa (${rotulo}) escreveu algo`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // Rollback por cima de estado divergente (a primeira e a última da
    // lista): recusa sem escrever.
    for (const a of [primeira, ultima]) {
      await c.query("BEGIN");
      try {
        const def = (await catalogo(c, a)).def;
        const d = def.replace(
          "(20261200000000)",
          "(20261200000000, divergente)",
        );
        assert.notEqual(d, def);
        await c.query(d);
        const antes = await digital(c);
        await c.query("SAVEPOINT reverter");
        await assert.rejects(c.query(rollback()), /B1_BASELINE_DIVERGENT/, a);
        await c.query("ROLLBACK TO SAVEPOINT reverter");
        assert.deepEqual(
          await digital(c),
          antes,
          `rollback recusado (${a}) escreveu algo`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
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
  const titulo = "Prova viva da decisão da devolução com admin atual (rpc-ci)";
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
          "Uma regra do admin atual na decisão da devolução foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[admin-atual-devolucao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
