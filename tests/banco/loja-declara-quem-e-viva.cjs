"use strict";

/**
 * Prova VIVA da migration 20261239000000 (a loja PODE declarar razao social, CNPJ/CPF e e-mail de atendimento;
 * 100% opcional e aditiva; 14/10/2026), num Postgres EFEMERO local, sem rede, com os papeis de verdade (anon,
 * authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK. O banco e' o clone do rodar-isolado.cjs: a arvore
 * migrada (com a 20261239 no ar). Os casos que medem o ANTES montam o estado de antes com o rollback-manual dela
 * (que devolve o corpo da 20261199 e a view de 42 colunas).
 *
 *  CATALOGO     3 colunas text, nulas, sem DEFAULT, 3 CHECK de forma, a view lendo as 3 NO FIM com o ACL e as
 *               opcoes de antes, o corpo da upsert com o hash da migration.
 *  SALVAR       salvar a razao social NAO apaga o horario, o endereco, a descricao, o documento nem o e-mail, e
 *               salvar qualquer outro campo da loja NAO apaga os tres; null limpa so o campo pedido; so o
 *               admin ATUAL grava (cliente, visitante e admin rebaixado com JWT velho sao recusados SEM escrever).
 *  FORMA        a CHECK recusa vazio, so espaco, 201 caracteres, documento com mascara, minusculo ou de tamanho
 *               errado, e e-mail sem forma; aceita CPF, CNPJ numerico e alfanumerico e o e-mail de 254. O DIGITO
 *               VERIFICADOR nao e' do banco (e' do app): documento com DV errado e' aceito aqui, de proposito.
 *  LEITURA      o visitante (anon) le os tres pela v_store_config e pela tabela; anon e authenticated comum
 *               NAO conseguem escrever (RLS); a lista de colunas da view e' exatamente a esperada (nada privado
 *               entra junto).
 *  MIGRATION    ida e volta (rollback devolve o prosrc IDENTICO ao da 20261199 lido do ARQUIVO, a view de 42
 *               colunas, o ACL e as opcoes da view, nenhuma funcao nem tabela alheia muda), reaplicar 2x e em
 *               CRLF = mesmo estado, o rollback RECUSA se a loja ja preencheu um campo (nada e' apagado sem
 *               querer), o preflight recusa SEM escrever (corpo divergente, lista de colunas da view diferente,
 *               coluna de mesmo nome com outro tipo).
 *  MUTANTES     CASE do nome trocado por atribuicao direta (salvar outro campo apaga o nome), CHECK do documento
 *               retirada, view sem a 3a coluna, rollback sem a guarda de dado: cada um e' pego.
 *
 * NAO PROVA: a IKCOUS nem a Savy (so o run da conferencia contra o ref de cada loja prova), concorrencia (a
 * migration toca uma tabela de 1 linha) nem o PostgREST (cache de schema: o NOTIFY esta no arquivo, a recarga e'
 * da plataforma).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/loja-declara-quem-e-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo (entre as aspas de dolar) da upsert_store_config de um .sql, do arquivo. */
function corpoDaUpsert(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.upsert_store_config(";
  const i = sql.indexOf(marca);
  assert.ok(i >= 0, "upsert_store_config nao encontrada no fonte");
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("\n$$;", abre) + 1);
}
/** O CREATE OR REPLACE FUNCTION inteiro da upsert, para fabricar um corpo divergente. */
function definicaoDaUpsert(sql) {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config(",
  );
  const fim = sql.indexOf("\n$$;", i) + "\n$$;".length;
  return sql.slice(i, fim);
}

// O corpo ANTIGO e' o da 20261199, LIDO DO ARQUIVO, nunca copiado para ca.
const CORPO_99 = corpoDaUpsert(
  fs.readFileSync(
    path.join(
      MIGRATIONS,
      "20261199000000_portas_do_painel_exigem_admin_atual.sql",
    ),
    "utf8",
  ),
);
const H_99 = "9c56a9c6953e1d774a1ee97d5d8a7e16";
const H_NOVO = "b562669936df1cda31d4bdd4d075bff3";
assert.equal(md5(CORPO_99), H_99, "o corpo da 20261199 mudou");
assert.equal(
  md5(corpoDaUpsert(MIGRATION)),
  H_NOVO,
  "o corpo da migration nao e' o hash pinado",
);
assert.equal(
  corpoDaUpsert(ROLLBACK),
  CORPO_99,
  "o rollback tem de repetir o corpo da 99 byte a byte",
);

const FN = "public.upsert_store_config(jsonb)";
const COLUNAS_NOVAS = [
  "store_legal_name",
  "store_legal_document",
  "store_support_email",
];
const COLUNAS_DA_VIEW_ANTES =
  "id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega";
const COLUNAS_DA_VIEW_DEPOIS = `${COLUNAS_DA_VIEW_ANTES},${COLUNAS_NOVAS.join(",")}`;

const U = {
  admin: "7e7e2239-0000-4000-8000-0000000000a1",
  cliente: "7e7e2239-0000-4000-8000-0000000000b2",
  rebaixado: "7e7e2239-0000-4000-8000-0000000000c3",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "customer" },
});
const NAO_AUTORIZADO = /N.o autorizado/;

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita; `antes` monta o estado ANTES (o rollback-manual). */
async function emTransacao(fn, { antes = false } = {}) {
  await C.query("BEGIN");
  try {
    if (antes) {
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(), H_99, "o estado ANTES nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

async function como(papel, sql, params = [], { uid = "", claims = "" } = {}) {
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
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

const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].h;
const prosrcVivo = async () =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].prosrc;
const colunasDaView = async () =>
  (
    await C.query(
      `SELECT string_agg(attname, ',' ORDER BY attnum) AS c FROM pg_attribute
        WHERE attrelid = 'public.v_store_config'::regclass AND attnum > 0 AND NOT attisdropped`,
    )
  ).rows[0].c;
const colunasNovasNaTabela = async () =>
  (
    await C.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'store_config'
          AND column_name = ANY($1) ORDER BY column_name`,
      [COLUNAS_NOVAS],
    )
  ).rows;
const aclDaView = async () =>
  (
    await C.query(
      `SELECT c.relacl::text AS acl, c.reloptions::text AS opts
         FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass`,
    )
  ).rows[0];

/** O que a migration nao pode tocar: ACL de toda tabela e corpo/ACL de toda funcao de public (menos a upsert). */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.oid <> to_regprocedure($1)::oid ORDER BY 1`,
      [FN],
    )
  ).rows;
  const upsert = (
    await C.query(
      `SELECT p.oid::text AS oid, p.proacl::text AS acl, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
              pg_get_userbyid(p.proowner) AS dono
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [FN],
    )
  ).rows[0];
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl, c.reloptions::text AS opts, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const politicas = (
    await C.query(
      "SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2",
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT tgrelid::regclass::text AS t, tgname, tgenabled::text AS ligado, pg_get_triggerdef(oid) AS def
         FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.store_config'::regclass ORDER BY 2`,
    )
  ).rows;
  return { funcoes, upsert, tabelas, politicas, gatilhos };
}

/** A linha da loja SEM as tres colunas novas: o que a migration nao pode alterar. */
async function linhaDaLojaSemAsNovas() {
  const r = await C.query(
    `SELECT coalesce(md5(string_agg(
              (to_jsonb(s) - 'store_legal_name' - 'store_legal_document' - 'store_support_email' - 'updated_at')::text,
              '|' ORDER BY s.id)), '') AS h,
            count(*)::int AS n
       FROM public.store_config s`,
  );
  return r.rows[0];
}

/** Pessoas: o admin ATUAL (profiles E auth.users), um cliente e um admin REBAIXADO (so o JWT velho diz admin). */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@39.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 39', 'admin'), ($2, 'Cliente 39', 'customer'), ($3, 'Rebaixado 39', 'customer')`,
    [U.admin, U.cliente, U.rebaixado],
  );
  await C.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
}

const comoAdmin = (config) =>
  como(
    "authenticated",
    "SELECT public.upsert_store_config($1::jsonb) AS r",
    [JSON.stringify(config)],
    { uid: U.admin, claims: JWT_ADMIN },
  ).then((l) => l[0].r);
const tentarComoAdmin = (config) =>
  tentar(
    "authenticated",
    "SELECT public.upsert_store_config($1::jsonb) AS r",
    [JSON.stringify(config)],
    { uid: U.admin, claims: JWT_ADMIN },
  );
const lerLoja = async () =>
  (await C.query("SELECT * FROM public.store_config WHERE id = 1")).rows[0];

/**
 * As asercoes de COMPORTAMENTO do salvar e da forma. Rodam no estado atual do banco (com a migration no ar) e
 * sao as mesmas contra os mutantes: o que um mutante quebra, elas pegam.
 */
async function asercoesDoSalvar() {
  await semear();
  // A loja ja tem horario, endereco e descricao; a lojista vai declarar a identidade legal por cima.
  await comoAdmin({
    business_hours: "Seg a Sex 9h-18h",
    store_address: "Rua das Flores, 10",
    store_description: "<p>Contamos a historia.</p>",
    whatsapp_number: "5511999990000",
  });

  // 1) salvar SO a razao social nao apaga o resto
  let r = await comoAdmin({ store_legal_name: "Loja da Ana Ltda" });
  assert.equal(r.store_legal_name, "Loja da Ana Ltda");
  assert.equal(r.business_hours, "Seg a Sex 9h-18h");
  assert.equal(r.store_address, "Rua das Flores, 10");
  assert.equal(r.store_description, "<p>Contamos a historia.</p>");
  assert.equal(r.whatsapp_number, "5511999990000");
  assert.equal(r.store_legal_document, null);
  assert.equal(r.store_support_email, null);

  // 2) documento e e-mail por cima, sem apagar o nome
  r = await comoAdmin({
    store_legal_document: "11222333000181",
    store_support_email: "oi@loja.com.br",
  });
  assert.equal(
    r.store_legal_name,
    "Loja da Ana Ltda",
    "salvar o documento nao apaga o nome",
  );
  assert.equal(r.store_legal_document, "11222333000181");
  assert.equal(r.store_support_email, "oi@loja.com.br");

  // 3) salvar OUTRO campo da loja nao apaga os tres (o outro sentido do aceite)
  r = await comoAdmin({ business_hours: "Seg a Sab 8h-20h" });
  assert.equal(r.business_hours, "Seg a Sab 8h-20h");
  assert.equal(
    r.store_legal_name,
    "Loja da Ana Ltda",
    "salvar o horario nao apaga a razao social",
  );
  assert.equal(
    r.store_legal_document,
    "11222333000181",
    "salvar o horario nao apaga o documento",
  );
  assert.equal(
    r.store_support_email,
    "oi@loja.com.br",
    "salvar o horario nao apaga o e-mail",
  );
  r = await comoAdmin({
    store_address: "Av. Brasil, 200",
    whatsapp_number: null,
  });
  assert.equal(r.store_legal_name, "Loja da Ana Ltda");
  assert.equal(r.store_legal_document, "11222333000181");
  assert.equal(r.store_support_email, "oi@loja.com.br");

  // 4) null limpa SO o campo pedido
  r = await comoAdmin({ store_legal_name: null });
  assert.equal(r.store_legal_name, null);
  assert.equal(r.store_legal_document, "11222333000181");
  assert.equal(r.store_support_email, "oi@loja.com.br");
  r = await comoAdmin({
    store_legal_document: null,
    store_support_email: null,
  });
  assert.equal(r.store_legal_document, null);
  assert.equal(r.store_support_email, null);

  // 5) a FORMA: o que a CHECK recusa NAO grava e a linha fica como estava
  await comoAdmin({
    store_legal_name: "Loja da Ana Ltda",
    store_legal_document: "52998224725",
    store_support_email: "oi@loja.com.br",
  });
  const antes = await lerLoja();
  const recusados = [
    { store_legal_name: "" },
    { store_legal_name: "   " },
    { store_legal_name: "x".repeat(201) },
    { store_legal_document: "" },
    { store_legal_document: "11.222.333/0001-81" },
    { store_legal_document: "1122233300018" },
    { store_legal_document: "12abc34501de35" },
    { store_legal_document: "ABCDEFGHIJKLMN" },
    { store_legal_document: "1234567890" },
    { store_support_email: "" },
    { store_support_email: "sem-arroba.com" },
    { store_support_email: "a@b" },
    { store_support_email: "a b@c.com" },
    { store_support_email: `${"a".repeat(249)}@b.com` }, // 255 caracteres
  ];
  for (const payload of recusados) {
    const x = await tentarComoAdmin(payload);
    assert.equal(
      x.codigo,
      "23514",
      `deveria recusar ${JSON.stringify(payload).slice(0, 60)} (CHECK), veio ${x.codigo}: ${x.erro}`,
    );
  }
  assert.deepEqual(
    await lerLoja(),
    antes,
    "o que foi recusado nao gravou nada",
  );

  // 6) o que a CHECK aceita
  r = await comoAdmin({
    store_legal_name: "x".repeat(200),
    store_legal_document: "12ABC34501DE35",
    store_support_email: `${"a".repeat(248)}@b.com`, // 254 caracteres: o limite
  });
  assert.equal(r.store_legal_name.length, 200);
  assert.equal(r.store_legal_document, "12ABC34501DE35");
  assert.equal(r.store_support_email.length, 254);
  r = await comoAdmin({ store_legal_document: "52998224725" });
  assert.equal(r.store_legal_document, "52998224725");
  // O DV nao e' do banco: um CNPJ de forma certa e DV errado passa aqui (o app o recusa antes).
  r = await comoAdmin({ store_legal_document: "11222333000182" });
  assert.equal(r.store_legal_document, "11222333000182");
}

// ---------------------------------------------------------------------------
// CATALOGO (a arvore migrada)
// ---------------------------------------------------------------------------

prova(
  "CATALOGO: 3 colunas text nulas e sem DEFAULT, 3 CHECK, a view le as 3 no FIM com o ACL e as opcoes de sempre, o corpo e' o da migration",
  () =>
    emTransacao(async () => {
      const colunas = await colunasNovasNaTabela();
      assert.deepEqual(
        colunas.map((c) => c.column_name),
        [...COLUNAS_NOVAS].sort(),
      );
      for (const c of colunas) {
        assert.equal(c.data_type, "text");
        assert.equal(c.is_nullable, "YES");
        assert.equal(c.column_default, null, `${c.column_name} sem DEFAULT`);
      }
      const checks = (
        await C.query(
          `SELECT conname FROM pg_constraint WHERE conrelid = 'public.store_config'::regclass
            AND conname LIKE 'store_config_store_%_check' ORDER BY 1`,
        )
      ).rows.map((x) => x.conname);
      assert.deepEqual(checks, [
        "store_config_store_legal_document_check",
        "store_config_store_legal_name_check",
        "store_config_store_support_email_check",
      ]);
      assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_DEPOIS);
      const v = await aclDaView();
      assert.equal(v.opts, "{security_invoker=on}");
      for (const papel of ["anon", "authenticated", "service_role"])
        assert.ok(
          v.acl.includes(`${papel}=arwdDxtm/postgres`),
          `view: ${papel} mantem o ACL de sempre`,
        );
      assert.equal(await hashVivo(), H_NOVO);
      const f = (
        await C.query(
          "SELECT prosecdef, proconfig::text AS cfg FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN],
        )
      ).rows[0];
      assert.equal(f.prosecdef, true, "continua SECURITY DEFINER");
      assert.equal(f.cfg, "{search_path=public}");
    }),
);

// ---------------------------------------------------------------------------
// SALVAR + FORMA + permissao
// ---------------------------------------------------------------------------

prova(
  "SALVAR e FORMA: salvar um campo nao apaga os outros, null limpa so o pedido, a CHECK recusa o que nao tem forma e nao grava nada",
  () => emTransacao(asercoesDoSalvar),
);

prova(
  "PERMISSAO: so o admin ATUAL grava; cliente, visitante e admin rebaixado (JWT velho) sao recusados e NADA e' escrito",
  () =>
    emTransacao(async () => {
      await semear();
      await comoAdmin({ store_legal_name: "Loja da Ana Ltda" });
      const antes = await lerLoja();
      const payload = JSON.stringify({
        store_legal_name: "Invasor",
        store_legal_document: "52998224725",
        store_support_email: "x@y.zz",
      });
      const sql = "SELECT public.upsert_store_config($1::jsonb) AS r";
      const cliente = await tentar("authenticated", sql, [payload], {
        uid: U.cliente,
        claims: JWT_CLIENTE,
      });
      assert.match(
        cliente.erro ?? "",
        NAO_AUTORIZADO,
        "cliente comum e' recusado",
      );
      const rebaixado = await tentar("authenticated", sql, [payload], {
        uid: U.rebaixado,
        claims: JWT_ADMIN,
      });
      assert.match(
        rebaixado.erro ?? "",
        NAO_AUTORIZADO,
        "admin rebaixado com JWT velho e' recusado",
      );
      const anon = await tentar("anon", sql, [payload]);
      assert.ok(anon.erro, "o visitante e' recusado");
      assert.deepEqual(await lerLoja(), antes, "nenhuma recusa escreveu");
    }),
);

// ---------------------------------------------------------------------------
// LEITURA publica
// ---------------------------------------------------------------------------

prova(
  "LEITURA: o visitante le os tres pela view e pela tabela; nao escreve; a view tem so as colunas esperadas",
  () =>
    emTransacao(async () => {
      await semear();
      await comoAdmin({
        store_legal_name: "Loja da Ana Ltda",
        store_legal_document: "11222333000181",
        store_support_email: "oi@loja.com.br",
      });
      for (const fonte of ["public.v_store_config", "public.store_config"]) {
        const l = await como(
          "anon",
          `SELECT store_legal_name, store_legal_document, store_support_email FROM ${fonte}`,
        );
        assert.deepEqual(
          l,
          [
            {
              store_legal_name: "Loja da Ana Ltda",
              store_legal_document: "11222333000181",
              store_support_email: "oi@loja.com.br",
            },
          ],
          `anon le por ${fonte}`,
        );
      }
      const logado = await como(
        "authenticated",
        "SELECT store_legal_name FROM public.v_store_config",
        [],
        { uid: U.cliente, claims: JWT_CLIENTE },
      );
      assert.equal(logado[0].store_legal_name, "Loja da Ana Ltda");

      // ESCRITA direta: a RLS barra (0 linhas ou erro), para anon e para o cliente logado
      for (const [papel, id] of [
        ["anon", {}],
        ["authenticated", { uid: U.cliente, claims: JWT_CLIENTE }],
      ]) {
        const x = await tentar(
          papel,
          "UPDATE public.store_config SET store_legal_name = 'Invasor' WHERE id = 1 RETURNING id",
          [],
          id,
        );
        assert.ok(
          x.erro || x.linhas.length === 0,
          `${papel} nao altera a razao social direto na tabela`,
        );
      }
      assert.equal((await lerLoja()).store_legal_name, "Loja da Ana Ltda");
      // A view publica tem EXATAMENTE as 45 colunas: nada de coluna interna entra de carona.
      assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_DEPOIS);
      const privadas = (
        await C.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='store_config'
          AND column_name NOT IN (SELECT attname FROM pg_attribute WHERE attrelid='public.v_store_config'::regclass AND attnum>0)`,
        )
      ).rows.map((x) => x.column_name);
      assert.deepEqual(
        privadas,
        ["identity_revision"],
        "so a revisao interna da identidade visual fica fora da view",
      );
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: ida e volta, reaplicar, recusas
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: ida e volta (rollback devolve o corpo da 99 byte a byte, a view de 42 colunas e o ACL; reaplicar 2x e CRLF = mesmo estado; nada alheio muda)",
  () =>
    emTransacao(async () => {
      await semear();
      await comoAdmin({
        business_hours: "Seg a Sex 9h-18h",
        store_address: "Rua X, 1",
      });
      const retratoDepois = await retratoDoSchema();
      const viewDepois = await aclDaView();
      const linhaDepois = await linhaDaLojaSemAsNovas();

      // volta
      assert.equal(
        await aplicar(ROLLBACK),
        null,
        "o rollback aplica (a loja nao preencheu nada)",
      );
      assert.equal(await hashVivo(), H_99);
      assert.equal(
        await prosrcVivo(),
        CORPO_99,
        "prosrc IDENTICO ao da 20261199 lido do arquivo",
      );
      assert.deepEqual(await colunasNovasNaTabela(), []);
      assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_ANTES);
      const viewAntes = await aclDaView();
      assert.equal(viewAntes.opts, "{security_invoker=on}");
      assert.equal(
        viewAntes.acl,
        viewDepois.acl,
        "o ACL da view e' o mesmo de antes e de depois",
      );
      assert.deepEqual(
        await linhaDaLojaSemAsNovas(),
        linhaDepois,
        "a linha da loja (fora das 3 colunas) nao mudou",
      );
      // o salvar de ANTES continua funcionando, sem as chaves novas
      const r = await comoAdmin({ business_hours: "Seg a Sab" });
      assert.equal(r.business_hours, "Seg a Sab");
      assert.ok(
        !("store_legal_name" in r),
        "sem a migration a RPC nao devolve as colunas novas",
      );
      // as chaves novas sao ignoradas em silencio pela RPC antiga (o app confere o retorno e acusaria falha)
      const ignorada = await comoAdmin({ store_legal_name: "X" });
      assert.ok(!("store_legal_name" in ignorada));
      const linhaAposAVolta = await linhaDaLojaSemAsNovas();
      // o resto do schema, na volta, e' o de depois menos o que e' desta migration
      const retratoVolta = await retratoDoSchema();
      assert.deepEqual(
        retratoVolta.funcoes,
        retratoDepois.funcoes,
        "nenhuma outra funcao mudou",
      );
      assert.equal(
        retratoVolta.upsert.acl,
        retratoDepois.upsert.acl,
        "o ACL da upsert nao mudou",
      );
      assert.equal(
        retratoVolta.upsert.oid,
        retratoDepois.upsert.oid,
        "mesmo oid: CREATE OR REPLACE",
      );
      assert.deepEqual(retratoVolta.politicas, retratoDepois.politicas);
      assert.deepEqual(retratoVolta.gatilhos, retratoDepois.gatilhos);

      // ida de novo, 2x, e em CRLF
      for (const [rotulo, sql] of [
        ["ida", MIGRATION],
        ["reaplicar", MIGRATION],
        ["CRLF sobre CRLF", emCRLF(MIGRATION)],
      ]) {
        assert.equal(await aplicar(sql), null, `${rotulo}: aplica sem erro`);
        assert.equal(
          await hashVivo(),
          H_NOVO,
          `${rotulo}: o corpo e' o da migration`,
        );
        assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_DEPOIS);
        assert.equal((await aclDaView()).acl, viewDepois.acl);
      }
      assert.deepEqual(
        await retratoDoSchema(),
        retratoDepois,
        "ida, volta e ida: o schema inteiro e' o de antes da volta",
      );
      assert.deepEqual(
        await linhaDaLojaSemAsNovas(),
        linhaAposAVolta,
        "reaplicar nao mexe em linha nenhuma",
      );
      assert.deepEqual(
        (await colunasNovasNaTabela()).map((c) => c.column_name),
        [...COLUNAS_NOVAS].sort(),
      );
    }),
);

prova(
  "MIGRATION: o rollback RECUSA se a loja ja preencheu um dos campos, e nada e' apagado nem trocado",
  () =>
    emTransacao(async () => {
      await semear();
      for (const campo of COLUNAS_NOVAS) {
        await C.query("SAVEPOINT caso");
        const valor = {
          store_legal_name: "Loja da Ana Ltda",
          store_legal_document: "52998224725",
          store_support_email: "oi@loja.com.br",
        }[campo];
        await comoAdmin({ [campo]: valor });
        const antes = await lerLoja();
        const e = await aplicar(ROLLBACK);
        assert.ok(e, `${campo} preenchido: o rollback recusa`);
        assert.match(e.erro, /DADO_DA_LOJA_NAO_SE_APAGA_SEM_QUERER/);
        assert.equal(
          await hashVivo(),
          H_NOVO,
          "o corpo continua o da migration",
        );
        assert.equal(
          await colunasDaView(),
          COLUNAS_DA_VIEW_DEPOIS,
          "a view continua com as 3",
        );
        assert.deepEqual(await lerLoja(), antes, "o dado continua la");
        await C.query("ROLLBACK TO SAVEPOINT caso");
      }
    }),
);

prova(
  "MIGRATION: o preflight recusa SEM escrever (corpo divergente, lista de colunas da view diferente, coluna de mesmo nome com outro tipo)",
  () =>
    emTransacao(
      async () => {
        // estado ANTES (a 99): nada da 20261239 existe ainda
        const retratoAntes = await retratoDoSchema();

        // (a) corpo vivo diferente do da 99 (1 byte)
        await C.query("SAVEPOINT a");
        const divergente = definicaoDaUpsert(ROLLBACK).replace(
          "'Confira os produtos!'",
          "'Confira os produtos!!'",
        );
        assert.notEqual(
          divergente,
          definicaoDaUpsert(ROLLBACK),
          "o mutante de texto foi aplicado",
        );
        await C.query(divergente);
        let e = await aplicar(MIGRATION);
        assert.ok(e, "corpo divergente: recusa");
        assert.match(e.erro, /B1_BASELINE_DIVERGENT.*upsert_store_config/s);
        assert.deepEqual(
          await colunasNovasNaTabela(),
          [],
          "nenhuma coluna foi criada",
        );
        assert.equal(await colunasDaView(), COLUNAS_DA_VIEW_ANTES);
        await C.query("ROLLBACK TO SAVEPOINT a");

        // (b) a view com outra lista de colunas
        await C.query("SAVEPOINT b");
        await C.query("DROP VIEW public.v_store_config");
        await C.query(
          "CREATE VIEW public.v_store_config WITH (security_invoker=on) AS SELECT id, store_name FROM public.store_config WHERE id = 1",
        );
        e = await aplicar(MIGRATION);
        assert.ok(e, "view diferente: recusa");
        assert.match(e.erro, /lista de colunas de v_store_config/);
        assert.deepEqual(await colunasNovasNaTabela(), []);
        assert.equal(await hashVivo(), H_99, "o corpo nao foi trocado");
        await C.query("ROLLBACK TO SAVEPOINT b");

        // (c) uma coluna de mesmo nome e outro tipo (ADD COLUMN IF NOT EXISTS pularia em silencio)
        await C.query("SAVEPOINT c");
        await C.query(
          "ALTER TABLE public.store_config ADD COLUMN store_legal_name integer",
        );
        e = await aplicar(MIGRATION);
        assert.ok(e, "coluna de outro tipo: recusa");
        assert.match(
          e.erro,
          /store_config\.store_legal_name já existe com o tipo integer/,
        );
        assert.equal(await hashVivo(), H_99);
        await C.query("ROLLBACK TO SAVEPOINT c");

        assert.deepEqual(
          await retratoDoSchema(),
          retratoAntes,
          "as recusas nao deixaram rastro",
        );
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// MUTANTES: cada guarda tirada deixa a prova vermelha
// ---------------------------------------------------------------------------

/** Aplica o texto mutante sobre o estado ANTES e roda `asercoes`. O mutante MORRE se aplicar recusa ou se as asercoes falham. */
async function mutanteMorre(sqlMutante, asercoes) {
  await C.query("SAVEPOINT mutante");
  try {
    const recusa = await aplicar(sqlMutante);
    if (recusa) return `a aplicacao recusou (${recusa.codigo ?? "?"})`;
    try {
      await asercoes();
    } catch (e) {
      if (
        e instanceof assert.AssertionError ||
        /CHECK|23514|violates/.test(String(e.message))
      ) {
        return `as asercoes pegaram: ${String(e.message).split("\n")[0].slice(0, 90)}`;
      }
      throw e;
    }
    return null; // sobreviveu
  } finally {
    await C.query("ROLLBACK TO SAVEPOINT mutante");
  }
}

/**
 * Troca um trecho da migration. Se o CORPO da upsert mudou, o hash fixado (preflight e pos-voo) passa a ser o do
 * corpo mutante: sem isso todo mutante de corpo morreria no hash e as asercoes de COMPORTAMENTO nunca rodariam.
 */
function trocar(sql, de, para) {
  assert.ok(
    sql.includes(de),
    `o trecho do mutante nao existe: ${de.slice(0, 50)}`,
  );
  return sql.replace(de, para);
}
function mutar(sql, de, para) {
  const mutado = trocar(sql, de, para);
  return mutado.split(H_NOVO).join(md5(corpoDaUpsert(mutado)));
}

prova("MUTANTES: o controle passa e cada guarda tirada e' pega", () =>
  emTransacao(
    async () => {
      // CONTROLE: a migration de verdade, sobre o ANTES, passa as mesmas asercoes.
      assert.equal(await aplicar(MIGRATION), null);
      await asercoesDoSalvar();
      await C.query("ROLLBACK");
      await C.query("BEGIN");
      await C.query(ROLLBACK);

      const mutantes = {
        "CASE do nome trocado por atribuicao direta (salvar outro campo apaga o nome)":
          mutar(
            MIGRATION,
            "store_legal_name = CASE WHEN config_json ? 'store_legal_name'\n      THEN config_json->>'store_legal_name'\n      ELSE store_config.store_legal_name END,",
            "store_legal_name = config_json->>'store_legal_name',",
          ),
        "CASE do e-mail trocado por atribuicao direta": mutar(
          MIGRATION,
          "store_support_email = CASE WHEN config_json ? 'store_support_email'\n      THEN config_json->>'store_support_email'\n      ELSE store_config.store_support_email END,",
          "store_support_email = config_json->>'store_support_email',",
        ),
        "CHECK do documento sem a forma (aceita qualquer texto)": mutar(
          MIGRATION,
          "OR store_legal_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');",
          "OR true);",
        ),
        "CHECK do nome aceita vazio": mutar(
          MIGRATION,
          "OR char_length(btrim(store_legal_name)) BETWEEN 1 AND 200);",
          "OR char_length(btrim(store_legal_name)) BETWEEN 0 AND 200);",
        ),
        "CHECK do e-mail sem a forma": mutar(
          MIGRATION,
          "AND store_support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'));",
          "AND true));",
        ),
        "view sem a terceira coluna": mutar(
          MIGRATION,
          "    store_legal_document,\n    store_support_email\n   FROM store_config",
          "    store_legal_document\n   FROM store_config",
        ),
      };
      for (const [nome, sql] of Object.entries(mutantes)) {
        const morte = await mutanteMorre(sql, asercoesDoSalvar);
        assert.ok(morte, `SOBREVIVEU o mutante: ${nome}`);
        console.log(`      mutante morto (${nome}): ${morte}`);
      }

      // Rollback sem a guarda de dado: com a loja preenchida ele APAGA o que a lojista digitou.
      await C.query(MIGRATION);
      await semear();
      await comoAdmin({ store_legal_name: "Loja da Ana Ltda" });
      const semGuarda = trocar(
        ROLLBACK,
        "IF v_com_dado > 0 THEN",
        "IF v_com_dado > 0 AND false THEN",
      );
      const apagou = await aplicar(semGuarda);
      assert.equal(
        apagou,
        null,
        "o mutante (rollback sem a guarda) aplica e apaga",
      );
      assert.deepEqual(
        await colunasNovasNaTabela(),
        [],
        "o mutante apagou a coluna com o dado dentro",
      );
      // ...e o rollback de verdade, no mesmo cenario, recusa (provado no caso anterior).
    },
    { antes: true },
  ),
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
          `  FALHOU  ${nome}\n    ${String(e.stack ?? e.message)
            .split("\n")
            .slice(0, 14)
            .join("\n    ")}`,
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
      `${falhas.length} de ${PROVAS.length} provas da identidade legal da loja falharam.`,
    );
  }
  console.log(
    `\n[loja-declara-quem-e] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
