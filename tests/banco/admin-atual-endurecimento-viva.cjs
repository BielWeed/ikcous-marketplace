"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos e chaves vem exclusivamente das constantes deste teste; banco exclusivamente efemero. */
/**
 * Passo 1 do endurecimento do admin atual (migration 20261381000000): 21 politicas de 10 tabelas + a politica nova de
 * leitura do admin em banners + 10 RPCs trocam a checagem do JWT (is_admin) pela de AGORA (rls_admin_atual /
 * is_admin_atual). Papeis reais (authenticated/anon/service_role), claims de JWT simuladas (em CI auth.role() e NULL) e as
 * duas direcoes da contradicao auth.users x profiles.
 *
 * O QUE SE PROVA, objeto por objeto (cada politica e cada RPC tem ao menos uma sonda; a cobertura e verificada):
 *   (i)   admin ATUAL (os dois cadastros dizem admin) continua podendo — antes e depois, o mesmo resultado;
 *   (ii)  ex-admin (JWT ainda dizendo admin, mas auth.users e/ou profiles ja nao) PODIA antes (CONTROLE: o defeito e
 *         reproduzido com o estado antigo) e NAO pode depois;
 *   (iii) anonimo, cliente e servico ficam EXATAMENTE como estavam (a vitrine anonima le banners ativos e categorias);
 *   (iv)  rollback devolve politicas, corpos (prosrc), atributos, OID e ACL byte a byte; dados das tabelas intactos;
 *         reaplicar (LF e CRLF) nao muda nada; pre-voo recusa estado desconhecido sem escrever; pos-voo desfaz tudo;
 *   (v)   MUTANTES: devolver UM objeto ao estado antigo e' pego pelas sondas (32 mutantes: 22 politicas + 10 RPCs);
 *   (vi)  atomicidade: a migration que falha no pos-voo, numa conexao SEM transacao explicita, nao deixa meia mudanca.
 * Nao prova banco remoto nem o PostgREST.
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-endurecimento-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const nome =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const raiz = path.resolve(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(raiz, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${nome}`);
const rollback = ler(`supabase/migrations/rollback-manual-${nome}`);
const STEM_A = "86a-conferir-ex-admin-no-resto-do-painel-aplicado";
const STEM_B = "86b-antes-ex-admin-no-resto-do-painel-base-vigente";
const depois = ler(`scripts/publicacao/consultas/${STEM_A}.sql`);
const antes = ler(`scripts/publicacao/consultas/${STEM_B}.sql`);
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const TABELAS = [
  "_ninja_migrations",
  "app_settings",
  "assinatura_da_loja",
  "banners",
  "categorias",
  "marketplace_ai_state",
  "shipping_calculation_logs",
  "shipping_quotes_cache",
  "store_config",
  "vor_receipts",
];
const ADMIN_SEL = "banners_admin_select_policy";
// As 21 politicas trocadas (nome => tabela). A 22a (ADMIN_SEL) nasce.
const POLITICAS = {
  "Admins full access on _ninja_migrations": "_ninja_migrations",
  "Admins legacy access on app_settings": "app_settings",
  assinatura_da_loja_admin_select_policy: "assinatura_da_loja",
  banners_admin_delete_policy: "banners",
  banners_admin_insert_policy: "banners",
  banners_admin_update_policy: "banners",
  banners_select_policy: "banners",
  categorias_admin_delete_policy: "categorias",
  categorias_admin_insert_policy: "categorias",
  categorias_admin_update_policy: "categorias",
  marketplace_ai_state_admin_delete: "marketplace_ai_state",
  marketplace_ai_state_admin_insert: "marketplace_ai_state",
  marketplace_ai_state_admin_select: "marketplace_ai_state",
  marketplace_ai_state_admin_update: "marketplace_ai_state",
  "Admins have full access to shipping calculation logs":
    "shipping_calculation_logs",
  "Admins have full access to shipping_quotes_cache": "shipping_quotes_cache",
  store_config_admin_delete_policy: "store_config",
  store_config_admin_insert_policy: "store_config",
  store_config_admin_update_policy: "store_config",
  "Admins can view all VOR receipts": "vor_receipts",
  vor_receipts_insert_policy: "vor_receipts",
};
// RPC => [assinatura de chamada, gate antigo, gate novo]
const GATES = {
  get_admin_reviews_paged: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  get_admin_questions_paged: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  get_admin_products_paged: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  get_reviews_metrics: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  buscar_por_codigo_barras: [
    "IF public.is_admin() IS DISTINCT FROM true THEN",
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  ],
  read_store_identity: [
    "IF public.is_admin() IS DISTINCT FROM true THEN",
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  ],
  assinatura_da_loja_ler: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  record_vor_action: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  reorder_banners_atomic: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
  swap_banner_order: [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ],
};
const RPCS = Object.keys(GATES);

// Atores: id, o que diz auth.users, o que diz profiles, o que diz o JWT (app_metadata.role).
const id = (n) => `b3810000-0000-4000-8000-0000000000${n}`;
const ATORES = {
  admin: { id: id("01"), auth: "admin", perfil: "admin", jwt: "admin" },
  perfil: { id: id("02"), auth: "admin", perfil: "customer", jwt: "admin" },
  auth: { id: id("03"), auth: "customer", perfil: "admin", jwt: "admin" },
  velho: { id: id("04"), auth: "customer", perfil: "customer", jwt: "admin" },
  fonte: { id: id("05"), auth: "admin", perfil: "customer", jwt: null },
  cliente: { id: id("06"), auth: "customer", perfil: "customer", jwt: null },
  outra: { id: id("07"), auth: "customer", perfil: "customer", jwt: null },
};
const EX = ["perfil", "auth", "velho", "fonte"];
const B1 = id("11");
const B2 = id("12");
const B3 = id("13");
const PROD = id("21");
const PEDIDO_QUESTION = id("22");
const REVIEW = id("23");
const CAT = id("31");
const CODIGO = "7891000000011";
let c;

// ----------------------------------------------------------------------------------------------------------------
// Catalogo: tudo que a migration pode tocar, para comparar byte a byte.
async function catalogo() {
  const p = await c.query(
    `SELECT t.relname tabela,p.polname,p.polcmd::text cmd,p.polroles::text papeis,p.polpermissive,
       pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk
     FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname='public' AND t.relname = ANY($1) ORDER BY t.relname,p.polname`,
    [TABELAS],
  );
  const f = await c.query(
    `SELECT p.oid::text oid,p.proname,replace(p.prosrc,chr(13),'') corpo,to_jsonb(p)-'prosrc' atributos,
       obj_description(p.oid,'pg_proc') comentario
     FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY p.proname,p.oid`,
    [RPCS],
  );
  const t = await c.query(
    `SELECT relname,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relname = ANY($1) ORDER BY relname`,
    [TABELAS],
  );
  return { politicas: p.rows, funcoes: f.rows, tabelas: t.rows };
}
// md5 do conteudo de cada uma das 10 tabelas: a migration nao pode ler nem escrever dado.
async function dados() {
  const out = {};
  for (const t of TABELAS) {
    out[t] = (
      await c.query(
        `SELECT count(*)::int n,coalesce(md5(string_agg(r::text,'|' ORDER BY r::text)),'') h FROM public.${t} r`,
      )
    ).rows[0];
  }
  return out;
}
async function consulta(sql, stem, positiva) {
  await c.query("SAVEPOINT consulta");
  let rows;
  try {
    await c.query("SET LOCAL ROLE authenticated");
    rows = (await c.query(sql)).rows;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT consulta");
    await c.query("RELEASE SAVEPOINT consulta");
  }
  assert.equal(rows.length, 36, `${stem}: 36 itens`);
  assert.equal(new Set(rows.map((r) => r.item)).size, 36);
  assert.equal(
    rows.every((r) => r.ok === true),
    positiva,
    JSON.stringify(rows.filter((r) => !r.ok)),
  );
  assert.match(
    CONF.veredictoDaConsulta({
      consulta: stem,
      ref: "efemero",
      sha: "local",
      linhas: rows,
    }),
    /rol=ok/,
  );
  for (const incompleta of [rows.slice(1), [...rows, rows[0]]]) {
    assert.match(
      CONF.veredictoDaConsulta({
        consulta: stem,
        ref: "efemero",
        sha: "local",
        linhas: incompleta,
      }),
      /rol=invalido/,
    );
  }
  return rows;
}
// As consultas de lotes ANTERIORES que fixam um dos objetos desta migration aceitam o corpo/politica de antes E o de depois
// (a sucessora): 9a (buscar_por_codigo_barras), 17a (get_admin_products_paged), 25a (get_reviews_metrics), 61a e 63a
// (politicas de categorias). Devem seguir inteiras positivas nos dois estados, senao o portao da loja para depois do apply.
const SUCESSORAS = [
  "9a-conferir-60-a-66-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "25a-conferir-media-de-avaliacoes-so-admin",
  "61a-conferir-icones-das-categorias-aplicado",
  "63a-conferir-forma-do-icone-aplicado",
];
async function sucessoras(rotulo) {
  for (const stem of SUCESSORAS) {
    const sql = ler(`scripts/publicacao/consultas/${stem}.sql`);
    await c.query("SAVEPOINT sucessora");
    let rows;
    try {
      await c.query("SET LOCAL ROLE authenticated");
      rows = (await c.query(sql)).rows;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT sucessora");
      await c.query("RELEASE SAVEPOINT sucessora");
    }
    assert.ok(rows.length > 0, `${stem}: sem linhas`);
    assert.deepEqual(
      rows.filter((r) => r.ok !== true),
      [],
      `${stem} ${rotulo}: toda linha deve ser ok`,
    );
  }
}
async function aplicar(sql) {
  await c.query(sql);
}
// Executa `sql` como o ator, numa transacao que e DESFEITA (savepoint). `prep` roda antes, como dono, no mesmo savepoint.
async function como(quem, sql, prep) {
  await c.query("SAVEPOINT acao");
  try {
    const papel =
      quem === "anon"
        ? "anon"
        : quem === "servico"
          ? "service_role"
          : "authenticated";
    if (prep) await c.query(prep);
    await c.query(`SET LOCAL ROLE ${papel}`);
    const a = ATORES[quem];
    const uid = a ? a.id : "";
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role: papel,
          app_metadata: a?.jwt ? { role: a.jwt } : {},
        }),
      ],
    );
    try {
      const r = await c.query(sql);
      return { n: r.rowCount, rows: r.rows };
    } catch (e) {
      return { code: e.code, message: e.message };
    }
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT acao");
    await c.query("RELEASE SAVEPOINT acao");
  }
}
const sucesso = (r) => r.code === undefined && r.n > 0;
const assinatura = (r) =>
  r.code !== undefined
    ? `ERRO ${r.code} ${r.message}`
    : `OK n=${r.n > 0 ? ">0" : "0"}`;

async function semear() {
  // auth.role e a emulacao da plataforma no provisionar (na fabrica e NULL); aqui espelha o JWT real.
  await c.query(
    `CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $stub$
   SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $stub$`,
  );
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role",
  );
  for (const [k, a] of Object.entries(ATORES)) {
    await c.query(
      "INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)",
      [a.id, `${k}@exemplo.invalid`, JSON.stringify({})],
    );
    await c.query(
      "INSERT INTO public.profiles(id,full_name,role) VALUES($1,$2,$3)",
      [a.id, k, a.perfil],
    );
  }
  // O gatilho de profiles sincroniza auth.users: os papeis contraditorios nascem DEPOIS dele.
  for (const a of Object.values(ATORES)) {
    await c.query(
      "UPDATE auth.users SET raw_app_meta_data=$2::jsonb WHERE id=$1",
      [a.id, JSON.stringify({ role: a.auth })],
    );
  }
  const fontes = (
    await c.query(
      `SELECT p.id,p.role,u.raw_app_meta_data->>'role' auth_role FROM public.profiles p
       JOIN auth.users u ON u.id=p.id WHERE p.id = ANY($1) ORDER BY p.id`,
      [Object.values(ATORES).map((a) => a.id)],
    )
  ).rows;
  assert.deepEqual(
    fontes.map((f) => [f.role, f.auth_role]),
    Object.values(ATORES).map((a) => [a.perfil, a.auth]),
    "as duas fontes do papel nasceram como o teste declara",
  );
  await c.query(
    "INSERT INTO public.store_config(id,store_name,share_text) VALUES (1,'Loja de prova','texto original')",
  );
  await c.query(
    "INSERT INTO public.assinatura_da_loja(id,plano,status) VALUES (1,'basico','ativa')",
  );
  await c.query(
    `INSERT INTO public.banners(id,image_url,title,active,position,"order",start_date) VALUES
       ($1,'https://exemplo.invalid/a.png','ativo na janela',true,'home_top',1,NULL),
       ($2,'https://exemplo.invalid/b.png','inativo',false,'home_top',2,NULL),
       ($3,'https://exemplo.invalid/c.png','agendado',true,'home_top',3,now()+interval '2 days')`,
    [B1, B2, B3],
  );
  await c.query(
    "INSERT INTO public.categorias(id,nome,slug) VALUES ($1,'Categoria de prova','categoria-de-prova')",
    [CAT],
  );
  await c.query(
    "INSERT INTO public.marketplace_ai_state(component_name,state_json) VALUES ('prova','{}')",
  );
  await c.query(
    "INSERT INTO public.shipping_calculation_logs(origin_cep,destination_cep,provider,cart_items,response_time_ms,status) VALUES ('01001000','02002000','prova','[]',1,'ok')",
  );
  await c.query(
    "INSERT INTO public.shipping_quotes_cache(origin_cep,destination_cep,cart_hash,options) VALUES ('01001000','02002000','hash','[]')",
  );
  await c.query(
    "INSERT INTO public.vor_receipts(action_type,proof_hash) VALUES ('prova','hash-0')",
  );
  await c.query(
    "INSERT INTO public._ninja_migrations(filename,checksum) VALUES ('prova.sql','c0')",
  );
  await c.query(
    "INSERT INTO public.app_settings(key,value) VALUES ('prova','v0')",
  );
  await c.query(
    "INSERT INTO public.produtos(id,nome,preco_venda,estoque,ativo,custo,codigo_barras) VALUES ($1,'Produto de prova',10,10,true,3,$2)",
    [PROD, CODIGO],
  );
  await c.query(
    "INSERT INTO public.questions(id,product_id,user_id,question) VALUES ($1,$2,$3,'Tem M?')",
    [PEDIDO_QUESTION, PROD, ATORES.cliente.id],
  );
  await c.query(
    "INSERT INTO public.reviews(id,product_id,user_id,rating,comment,status) VALUES ($1,$2,$3,5,'Otimo','pendente')",
    [REVIEW, PROD, ATORES.cliente.id],
  );
}

// ----------------------------------------------------------------------------------------------------------------
// SONDAS. `objs` = os objetos que a sonda exercita (cobertura obrigatoria); `tipo` 'tabela' | 'rpc'.
const GRANT_APP_SETTINGS = "GRANT ALL ON public.app_settings TO authenticated";
const SONDAS = [];
const tab = (idSonda, objs, sql, prep) =>
  SONDAS.push({ id: idSonda, objs, sql, prep, tipo: "tabela" });
const rpc = (idSonda, objs, sql) =>
  SONDAS.push({ id: idSonda, objs, sql, tipo: "rpc" });
// politicas FOR ALL (leitura e escrita)
for (const [pol, tabela, prep, colunas] of [
  [
    "Admins full access on _ninja_migrations",
    "_ninja_migrations",
    undefined,
    ["filename,checksum", "'novo.sql','c1'", "checksum='c2'"],
  ],
  [
    "Admins legacy access on app_settings",
    "app_settings",
    GRANT_APP_SETTINGS,
    ["key,value", "'nova','v1'", "value='v2'"],
  ],
  [
    "Admins have full access to shipping calculation logs",
    "shipping_calculation_logs",
    undefined,
    [
      "origin_cep,destination_cep,provider,cart_items,response_time_ms,status",
      "'1','2','p','[]',1,'ok'",
      "provider='outro'",
    ],
  ],
  [
    "Admins have full access to shipping_quotes_cache",
    "shipping_quotes_cache",
    undefined,
    [
      "origin_cep,destination_cep,cart_hash,options",
      "'1','2','h2','[]'",
      "cart_hash='h3'",
    ],
  ],
]) {
  tab(`${tabela} SELECT`, [pol], `SELECT * FROM public.${tabela}`, prep);
  tab(
    `${tabela} INSERT`,
    [pol],
    `INSERT INTO public.${tabela}(${colunas[0]}) VALUES (${colunas[1]})`,
    prep,
  );
  tab(
    `${tabela} UPDATE`,
    [pol],
    `UPDATE public.${tabela} SET ${colunas[2]}`,
    prep,
  );
  tab(`${tabela} DELETE`, [pol], `DELETE FROM public.${tabela}`, prep);
}
tab(
  "assinatura_da_loja SELECT",
  ["assinatura_da_loja_admin_select_policy"],
  "SELECT plano FROM public.assinatura_da_loja",
);
tab(
  "banners SELECT inativo",
  ["banners_select_policy", ADMIN_SEL],
  `SELECT id FROM public.banners WHERE id='${B2}'`,
);
tab(
  "banners SELECT agendado",
  ["banners_select_policy", ADMIN_SEL],
  `SELECT id FROM public.banners WHERE id='${B3}'`,
);
tab(
  "banners INSERT",
  ["banners_admin_insert_policy"],
  "INSERT INTO public.banners(image_url,active,position,\"order\") VALUES ('https://exemplo.invalid/n.png',true,'home_top',9)",
);
tab(
  "banners UPDATE",
  ["banners_admin_update_policy"],
  `UPDATE public.banners SET title='alterado' WHERE id='${B1}'`,
);
tab(
  "banners DELETE",
  ["banners_admin_delete_policy"],
  `DELETE FROM public.banners WHERE id='${B1}'`,
);
tab(
  "categorias INSERT",
  ["categorias_admin_insert_policy"],
  "INSERT INTO public.categorias(nome,slug) VALUES ('Outra','outra')",
);
tab(
  "categorias UPDATE",
  ["categorias_admin_update_policy"],
  `UPDATE public.categorias SET nome='Alterada' WHERE id='${CAT}'`,
);
tab(
  "categorias DELETE",
  ["categorias_admin_delete_policy"],
  `DELETE FROM public.categorias WHERE id='${CAT}'`,
);
tab(
  "marketplace_ai_state SELECT",
  ["marketplace_ai_state_admin_select"],
  "SELECT * FROM public.marketplace_ai_state",
);
tab(
  "marketplace_ai_state INSERT",
  ["marketplace_ai_state_admin_insert"],
  "INSERT INTO public.marketplace_ai_state(component_name,state_json) VALUES ('outro','{}')",
);
tab(
  "marketplace_ai_state UPDATE",
  ["marketplace_ai_state_admin_update"],
  "UPDATE public.marketplace_ai_state SET state_json='{\"a\":1}'",
);
tab(
  "marketplace_ai_state DELETE",
  ["marketplace_ai_state_admin_delete"],
  "DELETE FROM public.marketplace_ai_state",
);
tab(
  "store_config INSERT",
  ["store_config_admin_insert_policy"],
  "INSERT INTO public.store_config(id) VALUES (3)",
);
tab(
  "store_config UPDATE",
  ["store_config_admin_update_policy"],
  "UPDATE public.store_config SET share_text='alterado' WHERE id=1",
);
tab(
  "store_config DELETE",
  ["store_config_admin_delete_policy"],
  "DELETE FROM public.store_config WHERE id=1",
);
tab(
  "vor_receipts SELECT",
  ["Admins can view all VOR receipts"],
  "SELECT * FROM public.vor_receipts",
);
tab(
  "vor_receipts INSERT",
  ["vor_receipts_insert_policy"],
  "INSERT INTO public.vor_receipts(action_type,proof_hash) VALUES ('x','y')",
);
rpc(
  "get_admin_reviews_paged",
  ["get_admin_reviews_paged"],
  "SELECT public.get_admin_reviews_paged('', 'all', 0, 10) r",
);
rpc(
  "get_admin_questions_paged",
  ["get_admin_questions_paged"],
  "SELECT public.get_admin_questions_paged('', 'all', 0, 10) r",
);
rpc(
  "get_admin_products_paged",
  ["get_admin_products_paged"],
  "SELECT public.get_admin_products_paged('', 'all', 'all', 'all', 0, 10) r",
);
rpc(
  "get_reviews_metrics",
  ["get_reviews_metrics"],
  "SELECT * FROM public.get_reviews_metrics(NULL, NULL)",
);
rpc(
  "buscar_por_codigo_barras",
  ["buscar_por_codigo_barras"],
  `SELECT public.buscar_por_codigo_barras('${CODIGO}') r`,
);
rpc(
  "read_store_identity",
  ["read_store_identity"],
  "SELECT public.read_store_identity() r",
);
rpc(
  "assinatura_da_loja_ler",
  ["assinatura_da_loja_ler"],
  "SELECT public.assinatura_da_loja_ler() r",
);
rpc(
  "record_vor_action",
  ["record_vor_action"],
  "SELECT public.record_vor_action('prova','{}'::jsonb,'{}'::jsonb,'hash-prova')",
);
rpc(
  "reorder_banners_atomic",
  ["reorder_banners_atomic"],
  `SELECT public.reorder_banners_atomic('home_top','${B1}','${B2}')`,
);
rpc(
  "swap_banner_order",
  ["swap_banner_order"],
  `SELECT public.swap_banner_order('${B1}','${B2}')`,
);

async function bateria(quem, sondas = SONDAS) {
  const out = {};
  for (const s of sondas) {
    if (quem === "servico" && s.tipo !== "rpc") continue;
    out[s.id] = await como(quem, s.sql, s.prep);
  }
  return out;
}
const resumo = (b) =>
  Object.fromEntries(Object.entries(b).map(([k, r]) => [k, assinatura(r)]));

// Estado "ANTES" (novo=false) ou "DEPOIS" (novo=true) das sondas.
async function comportamento(novo, rotulo) {
  const admin = await bateria("admin");
  for (const [k, r] of Object.entries(admin)) {
    assert(
      sucesso(r),
      `${rotulo}: admin atual deve poder ${k}: ${JSON.stringify(r)}`,
    );
  }
  for (const quem of EX) {
    const b = await bateria(quem);
    for (const [k, r] of Object.entries(b)) {
      if (novo) {
        assert(
          !sucesso(r),
          `${rotulo}: ex-admin "${quem}" NAO pode mais ${k}: ${JSON.stringify(r)}`,
        );
      } else {
        assert(
          sucesso(r),
          `${rotulo}: CONTROLE — com o estado antigo "${quem}" (JWT velho/contraditorio) conseguia ${k}: ${JSON.stringify(r)}`,
        );
      }
    }
  }
  const outros = {};
  for (const quem of ["cliente", "outra", "anon", "servico"]) {
    outros[quem] = resumo(await bateria(quem));
  }
  return { admin: resumo(admin), outros };
}
function exigirSondasDeTodosOsObjetos() {
  const cobertos = new Set(SONDAS.flatMap((s) => s.objs));
  const esperados = [...Object.keys(POLITICAS), ADMIN_SEL, ...RPCS];
  assert.equal(esperados.length, 32);
  for (const o of esperados) assert(cobertos.has(o), `objeto sem sonda: ${o}`);
  for (const o of cobertos)
    assert(esperados.includes(o), `sonda de objeto desconhecido: ${o}`);
}

// ----------------------------------------------------------------------------------------------------------------
// Vitrine anonima e cliente: leituras que NAO podem mudar (iii).
async function vitrine() {
  const anonBanners = await como(
    "anon",
    "SELECT title FROM public.banners ORDER BY title",
  );
  const clienteBanners = await como(
    "cliente",
    "SELECT title FROM public.banners ORDER BY title",
  );
  const adminBanners = await como(
    "admin",
    "SELECT title FROM public.banners ORDER BY title",
  );
  const exBanners = await como(
    "velho",
    "SELECT title FROM public.banners ORDER BY title",
  );
  const anonCat = await como("anon", "SELECT nome FROM public.categorias");
  const anonCfg = await como("anon", "SELECT id FROM public.store_config");
  return {
    anonBanners: anonBanners.rows,
    clienteBanners: clienteBanners.rows,
    adminBanners: adminBanners.rows,
    exBanners: exBanners.rows,
    anonCat: anonCat.rows,
    anonCfg: anonCfg.rows,
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Extracao do estado ANTIGO de UM objeto a partir do rollback (e' tambem uma checagem cruzada do rollback).
function sqlAntigoDe(objeto) {
  if (objeto === ADMIN_SEL)
    return `DROP POLICY IF EXISTS ${ADMIN_SEL} ON public.banners;`;
  if (POLITICAS[objeto]) {
    const nomeSql = /^[a-z_0-9]+$/.test(objeto) ? objeto : `"${objeto}"`;
    const m = rollback.match(
      // eslint-disable-next-line security/detect-non-literal-regexp -- nome de politica e tabela de constantes deste teste.
      new RegExp(
        `^ALTER POLICY ${nomeSql.replace(/[()]/g, "\\$&")} ON public\\.${POLITICAS[objeto]}\\n[\\s\\S]*?;$`,
        "m",
      ),
    );
    assert(m, `rollback sem ALTER de ${objeto}`);
    return m[0];
  }
  const m = rollback.match(
    // eslint-disable-next-line security/detect-non-literal-regexp -- nome de funcao vindo da lista fixa de objetos deste teste.
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${objeto}\\([\\s\\S]*?\\$function\\$;`,
    ),
  );
  assert(m, `rollback sem corpo de ${objeto}`);
  return m[0];
}
async function mutantes() {
  let n = 0;
  const objetos = [...Object.keys(POLITICAS), ADMIN_SEL, ...RPCS];
  for (const objeto of objetos) {
    await c.query("SAVEPOINT mutante");
    await c.query(sqlAntigoDe(objeto));
    const sondas = SONDAS.filter((s) => s.objs.includes(objeto));
    assert(sondas.length > 0);
    const desvios = [];
    for (const s of sondas) {
      const a = await como("admin", s.sql, s.prep);
      if (!sucesso(a)) desvios.push(`admin perdeu ${s.id}`);
      for (const quem of EX) {
        const r = await como(quem, s.sql, s.prep);
        if (sucesso(r)) desvios.push(`${quem} vazou ${s.id}`);
      }
    }
    assert(
      desvios.length > 0,
      `MUTANTE VIVO: devolver ${objeto} ao estado antigo nao foi pego pelas sondas`,
    );
    await c.query("ROLLBACK TO SAVEPOINT mutante");
    await c.query("RELEASE SAVEPOINT mutante");
    n++;
  }
  return n;
}

// ----------------------------------------------------------------------------------------------------------------
function compararCatalogos(original, atual) {
  // politicas
  const chave = (p) => `${p.tabela}/${p.polname}`;
  const o = new Map(original.politicas.map((p) => [chave(p), p]));
  const a = new Map(atual.politicas.map((p) => [chave(p), p]));
  const novas = [...a.keys()].filter((k) => !o.has(k));
  assert.deepEqual(
    novas,
    [`banners/${ADMIN_SEL}`],
    "so a politica de leitura do admin em banners nasce",
  );
  const sumidas = [...o.keys()].filter((k) => !a.has(k));
  assert.deepEqual(sumidas, [], "nenhuma politica some");
  const mudadas = [];
  for (const [k, p] of o) {
    const q = a.get(k);
    assert.equal(q.cmd, p.cmd, `${k}: comando igual`);
    assert.equal(q.papeis, p.papeis, `${k}: papeis iguais`);
    assert.equal(q.polpermissive, p.polpermissive, `${k}: permissiva igual`);
    if (q.qual !== p.qual || q.chk !== p.chk) mudadas.push(p.polname);
  }
  assert.deepEqual(
    [...mudadas].sort(),
    Object.keys(POLITICAS).sort(),
    "exatamente as 21 politicas mudam",
  );
  for (const k of a.keys()) {
    const q = a.get(k);
    assert(
      !/is_admin\(\)/.test(`${q.qual} ${q.chk}`),
      `${k} ainda usa is_admin()`,
    );
  }
  // funcoes: atributos identicos (OID, ACL, dono, config...), comentario igual, corpo difere SO no gate
  assert.equal(atual.funcoes.length, original.funcoes.length);
  for (let i = 0; i < original.funcoes.length; i++) {
    const f = original.funcoes[i];
    const g = atual.funcoes[i];
    assert.equal(g.oid, f.oid, `${f.proname}: mesmo OID`);
    assert.deepEqual(
      g.atributos,
      f.atributos,
      `${f.proname}: mesmos atributos/ACL/dono`,
    );
    assert.equal(g.comentario, f.comentario, `${f.proname}: mesmo comentario`);
    const lf = f.corpo.split("\n");
    const lg = g.corpo.split("\n");
    assert.equal(lg.length, lf.length, `${f.proname}: mesmo numero de linhas`);
    const diff = lf.map((l, j) => [l, lg[j]]).filter(([x, y]) => x !== y);
    assert.equal(diff.length, 1, `${f.proname}: UMA linha muda`);
    assert.equal(diff[0][0].trim(), GATES[f.proname][0]);
    assert.equal(diff[0][1].trim(), GATES[f.proname][1]);
  }
  // tabelas: ACL, RLS ligada, sem FORCE — iguais
  assert.deepEqual(
    atual.tabelas,
    original.tabelas,
    "ACL e RLS das tabelas intactas",
  );
}

async function main() {
  c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    // (vi) atomicidade SEM transacao explicita, antes de qualquer BEGIN: a migration que falha no pos-voo nao deixa meia mudanca.
    await c.query("SET search_path=pg_catalog,public");
    const noAr = async () =>
      (
        await c.query(
          "SELECT EXISTS(SELECT 1 FROM pg_policy WHERE polname=$1 AND polrelid='public.banners'::regclass) sim",
          [ADMIN_SEL],
        )
      ).rows[0].sim;
    // A 20261393100000 (o balcao diz "inativo") sucede buscar_por_codigo_barras desta migration: sai primeiro (ordem inversa
    // da aplicacao). Definicao unica em tests/banco/o-balcao-diz-inativo-posterior.cjs.
    await require("./o-balcao-diz-inativo-posterior.cjs").desfazerBalcaoDizInativoNaTransacao(
      c,
    );
    // A 20261385 (a busca de produtos) sucede get_admin_products_paged desta migration: sai antes (o rollback da 81 exige o
    // corpo da 81 e a 86a mede o corpo da 81). O clone do rodar-isolado e' descartavel.
    await require("./busca-do-painel-por-codigo-posterior.cjs").desfazerBuscaDoPainelNaTransacao(
      c,
    );
    if (await noAr()) await c.query(rollback);
    assert.equal(await noAr(), false, "ponto de partida: estado ANTES");
    const base = JSON.stringify(await catalogo());
    const falhaNoPosVoo = migration.replace(
      "DO $conferencia_20261381000000$",
      "ALTER POLICY store_config_admin_insert_policy ON public.store_config WITH CHECK (true);\nDO $conferencia_20261381000000$",
    );
    assert.notEqual(
      falhaNoPosVoo,
      migration,
      "a sabotagem do pos-voo entrou no texto",
    );
    await assert.rejects(() => c.query(falhaNoPosVoo), /B1_BASELINE_DIVERGENT/);
    assert.equal(
      JSON.stringify(await catalogo()),
      base,
      "falha no pos-voo, conexao sem BEGIN: NADA ficou aplicado (nem as politicas, nem os corpos)",
    );
    const falhaNoMeio = migration.replace(
      "CREATE OR REPLACE FUNCTION public.read_store_identity()",
      "SELECT 1/0;\nCREATE OR REPLACE FUNCTION public.read_store_identity()",
    );
    assert.notEqual(falhaNoMeio, migration);
    await assert.rejects(() => c.query(falhaNoMeio), /division by zero/);
    assert.equal(
      JSON.stringify(await catalogo()),
      base,
      "erro no meio das escritas, conexao sem BEGIN: nada ficou aplicado",
    );
    console.log(
      "[L3] atomicidade: falha no pos-voo e erro no meio nao deixam meia mudanca (conexao sem BEGIN)",
    );

    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL search_path=pg_catalog,public");
      // A fabrica local omite este USAGE, presente no Supabase e necessario ao catalogo da consulta.
      await c.query(
        "GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role",
      );
      exigirSondasDeTodosOsObjetos();
      const original = await catalogo();
      await consulta(antes, STEM_B, true);
      await consulta(depois, STEM_A, false);
      await semear();
      const dadosAntes = await dados();
      const vitrineAntes = await vitrine();
      assert.equal(
        vitrineAntes.anonBanners.length,
        1,
        "anon ve 1 de 3 banners (ativo e dentro da janela)",
      );
      assert.equal(vitrineAntes.clienteBanners.length, 1);
      assert.equal(vitrineAntes.adminBanners.length, 3, "admin atual ve os 3");
      assert.equal(
        vitrineAntes.exBanners.length,
        3,
        "CONTROLE: o ex-admin com JWT velho via os 3",
      );
      assert.equal(vitrineAntes.anonCat.length, 1);
      assert.equal(vitrineAntes.anonCfg.length, 1);
      const estadoAntes = await comportamento(false, "antes");
      console.log(
        `[L3] CONTROLE: com o estado antigo os 4 ex-admins vazam em todas as ${SONDAS.length} sondas`,
      );

      await aplicar(migration);
      const atual = await catalogo();
      compararCatalogos(original, atual);
      assert.deepEqual(
        await dados(),
        dadosAntes,
        "nenhuma linha de nenhuma tabela mudou",
      );
      const estadoDepois = await comportamento(true, "depois");
      if (process.env.PROVA_DETALHE === "1")
        console.log(JSON.stringify(estadoDepois, null, 1));
      assert.deepEqual(
        estadoDepois.admin,
        estadoAntes.admin,
        "admin atual: mesmo resultado antes e depois",
      );
      assert.deepEqual(
        estadoDepois.outros,
        estadoAntes.outros,
        "cliente, outra pessoa, anon e servico: mesmo resultado antes e depois",
      );
      const vitrineDepois = await vitrine();
      assert.deepEqual(
        vitrineDepois.anonBanners,
        vitrineAntes.anonBanners,
        "a vitrine anonima nao muda",
      );
      assert.deepEqual(
        vitrineDepois.clienteBanners,
        vitrineAntes.clienteBanners,
      );
      assert.deepEqual(
        vitrineDepois.adminBanners,
        vitrineAntes.adminBanners,
        "admin atual ainda ve inativos e agendados",
      );
      assert.equal(
        vitrineDepois.exBanners.length,
        1,
        "o ex-admin passa a ver so o que a vitrine mostra",
      );
      assert.deepEqual(vitrineDepois.anonCat, vitrineAntes.anonCat);
      assert.deepEqual(vitrineDepois.anonCfg, vitrineAntes.anonCfg);
      // service_role: as RPCs seguem passando (a automacao/bootstrap), antes e depois.
      for (const [k, v] of Object.entries(estadoDepois.outros.servico)) {
        assert.match(v, /^OK/, `servico passa em ${k}`);
      }
      // anon: nenhuma RPC executavel, antes e depois
      for (const s of SONDAS.filter((x) => x.tipo === "rpc")) {
        assert.match(
          estadoDepois.outros.anon[s.id],
          /ERRO 42501/,
          `anon sem EXECUTE em ${s.id}`,
        );
      }
      console.log(
        `[L3] ${SONDAS.length} sondas: admin atual igual, 4 ex-admins recusados, anon/cliente/servico iguais; vitrine intacta`,
      );

      await consulta(depois, STEM_A, true);
      await consulta(antes, STEM_B, false);
      await sucessoras("depois da migration");

      // reaplicar: idempotente, LF e CRLF
      await aplicar(migration);
      assert.deepEqual(await catalogo(), atual, "reaplicar nao muda nada");
      await aplicar(migration.replace(/\n/g, "\r\n"));
      assert.deepEqual(
        await catalogo(),
        atual,
        "reaplicar em CRLF nao muda nada (prosrc comparado sem CR)",
      );

      // pre-voo recusa estado desconhecido, sem escrever
      const sabotagens = [
        "DROP POLICY store_config_admin_insert_policy ON public.store_config",
        "ALTER POLICY banners_select_policy ON public.banners TO authenticated",
        "ALTER POLICY categorias_admin_update_policy ON public.categorias USING (true)",
        `ALTER POLICY ${ADMIN_SEL} ON public.banners USING (true)`,
        "ALTER TABLE public.banners FORCE ROW LEVEL SECURITY",
        "ALTER TABLE public.vor_receipts DISABLE ROW LEVEL SECURITY",
        "ALTER FUNCTION public.read_store_identity() SECURITY INVOKER",
        "ALTER FUNCTION public.buscar_por_codigo_barras(text) SET search_path = public",
        "GRANT EXECUTE ON FUNCTION public.assinatura_da_loja_ler() TO anon",
        "GRANT EXECUTE ON FUNCTION public.swap_banner_order(uuid,uuid) TO PUBLIC",
        "REVOKE EXECUTE ON FUNCTION public.record_vor_action(text,jsonb,jsonb,text) FROM service_role",
        "GRANT EXECUTE ON FUNCTION public.is_admin_atual() TO authenticated",
        "CREATE FUNCTION public.record_vor_action(text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void'",
        `CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
           RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
           LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN; END; $f$`,
      ];
      for (const sql of sabotagens) {
        await c.query("SAVEPOINT sabotagem");
        await c.query(sql);
        const antesFalha = await catalogo();
        await c.query("SAVEPOINT tentativa");
        await assert.rejects(
          () => aplicar(migration),
          /B1_BASELINE_DIVERGENT/,
          sql,
        );
        await c.query("ROLLBACK TO SAVEPOINT tentativa");
        assert.deepEqual(
          await catalogo(),
          antesFalha,
          `preflight recusou sem escrever: ${sql}`,
        );
        await c.query("ROLLBACK TO SAVEPOINT sabotagem");
        await c.query("RELEASE SAVEPOINT sabotagem");
      }
      // pos-voo: uma troca sorrateira DEPOIS das escritas desfaz tudo (erro aborta o savepoint do aplicador)
      await c.query("SAVEPOINT posvoo");
      await assert.rejects(
        () =>
          aplicar(
            migration.replace(
              "DO $conferencia_20261381000000$",
              "ALTER FUNCTION public.swap_banner_order(uuid,uuid) SECURITY INVOKER;\nDO $conferencia_20261381000000$",
            ),
          ),
        /B1_BASELINE_DIVERGENT/,
      );
      await c.query("ROLLBACK TO SAVEPOINT posvoo");
      assert.deepEqual(
        await catalogo(),
        atual,
        "pos-voo reprovado nao deixa nada",
      );
      console.log(
        `[L3] reaplicacao LF/CRLF; ${sabotagens.length} sabotagens recusadas sem escrever; pos-voo reprovado desfaz tudo`,
      );

      // (v) mutantes
      const n = await mutantes();
      console.log(
        `[L3] ${n} mutantes (cada objeto devolvido ao estado antigo) pegos pelas sondas`,
      );
      assert.deepEqual(await catalogo(), atual, "os mutantes foram desfeitos");

      // (iv) rollback exato, dados intactos, repeticao recusada
      await aplicar(rollback);
      assert.deepEqual(
        await catalogo(),
        original,
        "rollback exato: politicas, corpos, atributos, OID, ACL",
      );
      assert.deepEqual(await dados(), dadosAntes, "rollback nao mexe em dado");
      await consulta(antes, STEM_B, true);
      await consulta(depois, STEM_A, false);
      await sucessoras("depois do rollback");
      const estadoRollback = await comportamento(false, "apos rollback");
      assert.deepEqual(estadoRollback.admin, estadoAntes.admin);
      assert.deepEqual(estadoRollback.outros, estadoAntes.outros);
      await c.query("SAVEPOINT repetido");
      await assert.rejects(() => aplicar(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT repetido");
      // o rollback tambem recusa estado desconhecido
      await aplicar(migration);
      await c.query("SAVEPOINT rbsab");
      await c.query(
        "ALTER POLICY vor_receipts_insert_policy ON public.vor_receipts WITH CHECK (true)",
      );
      await assert.rejects(() => aplicar(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbsab");
      assert.deepEqual(await catalogo(), atual);
      console.log(
        "[L3] rollback exato (catalogo, dados e comportamento); repetido e estado desconhecido recusados",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
