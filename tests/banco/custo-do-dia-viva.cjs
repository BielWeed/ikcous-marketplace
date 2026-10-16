"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste ou do JSON das próprias RPCs no Postgres
 * efêmero; os únicos arquivos lidos são as migrations deste repositório, por nome fixo. */

/**
 * PROVA VIVA da migration 20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero (rpc-ci): cada venda guarda o custo que o produto tinha
 * no dia, e o lucro do CRM (`get_admin_analytics_v2`) e o CMV da DRE (`fin_dre`) usam esse custo.
 *
 * A SEMENTE (loja limpa; vendas pagas pelos caminhos REAIS):
 *   A "Anel"      custo 10  preço 50      D "Dudu"   custo NULL (nunca teve)  preço 20
 *   B "Brinco"    custo NULL preço 30     E "Esmeralda" custo 7  preço 70
 *   C "Colar"     custo 0   preço 40
 *   S1 online (create_marketplace_order_v24, cliente): A x2 + C x1 + B x1      -> grava A=10, C=0 (B sem custo: sem linha)
 *   S2 balcão (registrar_venda_presencial, admin):     A x1 + B x1 + C x2      -> grava A=10, C=0
 *   S3 venda ANTIGA (item sem linha, 3 dias atrás):    A x1 + C x1 + B x1      -> segue o custo de hoje
 *   S5 balcão: D x1 + E x1                                                      -> grava E=7 (D sem custo: sem linha)
 *   mudança de custo 1: A 25, B 8, C 4, E apagado (NULL); S4 balcão: A x1      -> grava A=25
 *   mudança de custo 2: A 99, B 10, C 5, D 3
 *
 * O QUE SE PROVA:
 *   (1) as duas vendas reais gravam o custo do dia (loja e balcão), 0 é gravado e NULL não;
 *   (2) depois de mudar o custo, o lucro da venda NOVA não muda e o da ANTIGA segue o custo de hoje (as
 *       duas etapas, com números fechados); o CMV da DRE idem, e a devolução credita o custo da venda;
 *   (3) produto sem custo vende normal e sem aviso; o custo apagado depois da venda não tira a venda do lucro;
 *   (4) o custo NÃO vaza: cliente dono do pedido, outra cliente, anon, admin e service_role não leem nem
 *       escrevem a tabela; os itens do cliente seguem com as mesmas 9 colunas; nenhuma função de cliente a cita;
 *   (5) o gatilho com falha simulada (tabela sumida, tabela que recusa a linha) NÃO impede a compra, avisa, e
 *       o erro legítimo da venda (estoque) continua sendo erro;
 *   (6) mesmas chaves nos dois relatórios, e em dataset sem registros os MESMOS números do corpo vivo anterior,
 *       executando as duas versões no mesmo banco;
 *   (7) rollback: devolve os dois corpos byte a byte (md5 pinado), remove gatilho, função e tabela, recusa com
 *       linhas (atomicamente: o gatilho continua lá), é idempotente e recusa redefinição posterior;
 *   (8) aplicar: dado existente intacto e sem backfill, 2x idêntico, pré-voo recusa sem escrever;
 *   (9) MUTANTES: tirar o COALESCE (só o custo do dia), inverter a ordem, tirar o custo do dia da DRE ou da
 *       devolução, tirar o tratamento de erro do gatilho — cada um deixa uma prova VERMELHA;
 *   (10) CORRIDA: mudar o custo enquanto a venda está aberta espera a venda e o registro fica com o custo de antes
 *       (por último: grava uma venda do Fio, que mexeria nos números fechados das outras provas).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/custo-do-dia-viva.cjs
 */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");

const NOME = "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const ANALYTICS = "public.get_admin_analytics_v2(integer)";
const DRE = "public.fin_dre(date,date)";
const GATILHO_FN = "public.marketplace_order_item__guarda_o_custo_do_dia()";
const TABELA = "public.marketplace_order_item_custo";

// Os hashes (md5 de prosrc sem \r) lidos do PREFLIGHT da migration (a prova de texto amarra ao md5 real).
function hashesDoPreflight(sql, assinatura) {
  const ini = sql.indexOf(`('${assinatura}', '`);
  const tupla = ini < 0 ? "" : sql.slice(ini, sql.indexOf("')", ini) + 2);
  const hs = tupla.match(/[0-9a-f]{32}/g);
  assert.ok(hs, `o preflight não cita os hashes de ${assinatura}`);
  return { vigente: hs[0], desta: hs[1] };
}
const H_A = hashesDoPreflight(MIGRATION, ANALYTICS);
const H_D = hashesDoPreflight(MIGRATION, DRE);

const U_ADMIN = "c0570000-0000-4000-8000-0000000000e1";
const U_CLIENTE = "c0570000-0000-4000-8000-0000000000e2";
const U_OUTRA = "c0570000-0000-4000-8000-0000000000e3";
const P = {
  A: "c0570000-0000-4000-8000-0000000000f1",
  B: "c0570000-0000-4000-8000-0000000000f2",
  C: "c0570000-0000-4000-8000-0000000000f3",
  D: "c0570000-0000-4000-8000-0000000000f4",
  E: "c0570000-0000-4000-8000-0000000000f5",
  F: "c0570000-0000-4000-8000-0000000000f6",
};

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = new Map([
  ["anon", { papel: "anon", uid: "", jwt: "" }],
  [
    "cliente",
    {
      papel: "authenticated",
      uid: U_CLIENTE,
      jwt: claims(U_CLIENTE, null),
    },
  ],
  [
    "outra",
    { papel: "authenticated", uid: U_OUTRA, jwt: claims(U_OUTRA, null) },
  ],
  [
    "admin",
    {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
  ],
  ["service", { papel: "service_role", uid: "", jwt: "" }],
]);

const num = (v) => Math.round(Number(v) * 100) / 100;
const fx = {};
const PROVAS = [];

// ------------------------------------------------------------- utilitários

/** Avisos (RAISE WARNING) que o servidor mandou a esta conexão. */
function ouvirAvisos(c) {
  const avisos = [];
  const f = (m) => avisos.push(`${m.severity}: ${m.message}`);
  c.on("notice", f);
  return {
    avisos,
    parar: () => c.removeListener("notice", f),
  };
}

/** Roda `sql` COMO `quem` numa transação aberta; um erro não aborta a transação (savepoint). */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma transação que SEMPRE desfaz (ou commita, se pedido). */
async function emTx(c, corpo, { commit = false } = {}) {
  await c.query("BEGIN");
  try {
    const r = await corpo();
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def,
            prosecdef, coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de tabela/coluna.
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
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '') || ' | rls=' || c.relrowsecurity::text
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

/** Resumo md5 das linhas que a migration NÃO pode tocar (e a contagem da tabela nova). */
async function dados(c) {
  const r = await c.query(`
    SELECT 'produtos' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.produtos x
    UNION ALL SELECT 'pedidos', count(*)::int, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_orders x
    UNION ALL SELECT 'itens', count(*)::int, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_order_items x`);
  return r.rows;
}

/** Os caminhos de chave de um JSON (formato), sem os valores. */
function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

/** O JSON do CRM como o admin o lê (a mesma conexão, `set_config` fora de transação vale para a sessão). */
async function analytics(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  return (await c.query("SELECT public.get_admin_analytics_v2(30) AS r"))
    .rows[0].r;
}

/** O DRE do período (10 dias até hoje de São Paulo), como o admin o lê. */
async function dre(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  const r = await c.query(
    `SELECT public.fin_dre(((now() AT TIME ZONE 'America/Sao_Paulo')::date - 10), (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS r`,
  );
  return r.rows[0].r;
}

/** Soma do lucro e do custo vendido de TODOS os dias do gráfico. */
function somas(json) {
  return {
    lucro: num(json.revenueHistory.reduce((s, h) => s + Number(h.profit), 0)),
    custoVendido: num(
      json.revenueHistory.reduce((s, h) => s + Number(h.cost_sold), 0),
    ),
  };
}
const ranking = (json) =>
  json.topProducts.map((t) => [
    t.name.replace("Custo ", ""),
    num(t.total),
    t.quantity,
  ]);

// ---------------------------------------------------------------- vendas reais

/** Venda de LOJA pelo caminho de produção (cliente logado) e pagamento carimbado; devolve o id do pedido. */
async function venderOnline(c, quem, itens, total) {
  await c.query("BEGIN");
  try {
    const r = await como(
      c,
      quem,
      `SELECT public.create_marketplace_order_v24($1::jsonb, $2::numeric, 0::numeric, 'pix', NULL::uuid, NULL::text,
         'Comprador', '5539000000000', NULL::text, $3::jsonb, '38500-000', 'local-delivery', $4::uuid) AS id`,
      [
        JSON.stringify(
          itens.map(([p, q]) => ({
            product_id: p,
            variant_id: null,
            quantity: q,
          })),
        ),
        total,
        JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
        crypto.randomUUID(),
      ],
    );
    assert.ok(r.ok, `create_marketplace_order_v24 falhou: ${r.message}`);
    const id = r.rows[0].id;
    await c.query(
      "UPDATE public.marketplace_orders SET payment_status = 'pago', paid_at = now() WHERE id = $1",
      [id],
    );
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** Venda de BALCÃO pelo caminho de produção (admin atual), DENTRO da transação já aberta; devolve o id do pedido. */
async function venderBalcaoNaTx(c, itens) {
  const r = await como(
    c,
    "admin",
    "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
    [
      JSON.stringify(
        itens.map(([p, q]) => ({
          product_id: p,
          variant_id: null,
          quantity: q,
        })),
      ),
      crypto.randomUUID(),
    ],
  );
  assert.ok(r.ok, `registrar_venda_presencial falhou: ${r.message}`);
  return r.rows[0].r.order.id;
}

/** O mesmo, numa transação própria que COMMITA. */
async function venderBalcao(c, itens) {
  await c.query("BEGIN");
  try {
    const id = await venderBalcaoNaTx(c, itens);
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** Os itens de um pedido com o custo do dia (null = sem linha), por produto. */
async function registros(c, pedidoId) {
  const r = await c.query(
    `SELECT oi.product_id, oi.quantity, k.custo
       FROM public.marketplace_order_items oi
       LEFT JOIN ${TABELA} k ON k.item_id = oi.id
      WHERE oi.order_id = $1
      ORDER BY oi.product_id`,
    [pedidoId],
  );
  return Object.fromEntries(
    r.rows.map((l) => [
      Object.entries(P).find(([, v]) => v === l.product_id)[0],
      l.custo === null ? null : num(l.custo),
    ]),
  );
}

async function mudarCusto(c, custos) {
  for (const [letra, custo] of Object.entries(custos)) {
    await c.query("UPDATE public.produtos SET custo = $2 WHERE id = $1", [
      P[letra],
      custo,
    ]);
  }
}

// ---------------------------------------------------------------- (0) semente

PROVAS.push({
  nome: "(0) semente: loja LIMPA, 3 usuários, 5 produtos (custo 10, sem custo, custo 0, sem custo, custo 7) e as vendas S1 (loja), S2 (balcão), S3 (antiga, sem linha) e S5 (balcão)",
  corpo: async (c) => {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@custodia.teste', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@custodia.teste', '{}'::jsonb),
         ($3, 'outra@custodia.teste', '{}'::jsonb)`,
      [U_ADMIN, U_CLIENTE, U_OUTRA],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Custo', 'admin'), ($2, 'Cliente Custo', 'customer'), ($3, 'Outra Custo', 'customer')`,
      [U_ADMIN, U_CLIENTE, U_OUTRA],
    );
    await c.query(
      `INSERT INTO public.store_config
         (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
       VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
       ON CONFLICT (id) DO UPDATE
         SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
             free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
             enable_coupons = EXCLUDED.enable_coupons`,
    );
    const limpa = await c.query(
      `SELECT (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos,
              (SELECT count(*) FROM public.marketplace_order_items)::int AS itens,
              (SELECT count(*) FROM ${TABELA})::int AS custos`,
    );
    assert.deepEqual(
      limpa.rows[0],
      { pedidos: 0, itens: 0, custos: 0 },
      "a prova mede o ranking exato: a loja de partida tem de estar LIMPA (e a tabela do custo do dia, vazia)",
    );
    for (const [letra, nome, custo, preco] of [
      ["A", "Anel", 10, 50],
      ["B", "Brinco", null, 30],
      ["C", "Colar", 0, 40],
      ["D", "Dudu", null, 20],
      ["E", "Esmeralda", 7, 70],
      ["F", "Fio", 12, 15],
    ]) {
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
         VALUES ($1, $2, $3, $4, 1000, true, false)`,
        [P[letra], `Custo ${nome}`, preco, custo],
      );
    }

    fx.S1 = await venderOnline(
      c,
      "cliente",
      [
        [P.A, 2],
        [P.C, 1],
        [P.B, 1],
      ],
      170,
    );
    fx.S2 = await venderBalcao(c, [
      [P.A, 1],
      [P.B, 1],
      [P.C, 2],
    ]);
    // S3: a venda ANTIGA (de antes da migration): três dias atrás, SEM linha de custo do dia.
    const s3 = await c.query(
      `INSERT INTO public.marketplace_orders
         (customer_name, customer_data, total, subtotal, status, canal, payment_method,
          payment_status, paid_at, created_at)
       VALUES ('Cliente antiga', '{}'::jsonb, 120, 120, 'delivered', 'online', 'online', 'pago',
               ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 3 + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
               ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 3 + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
       RETURNING id`,
    );
    fx.S3 = s3.rows[0].id;
    for (const [produto, preco] of [
      [P.A, 50],
      [P.C, 40],
      [P.B, 30],
    ]) {
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'item antigo', 1, $3)`,
        [fx.S3, produto, preco],
      );
    }
    await c.query(
      `DELETE FROM ${TABELA} WHERE item_id IN (SELECT id FROM public.marketplace_order_items WHERE order_id = $1)`,
      [fx.S3],
    );
    fx.S5 = await venderBalcao(c, [
      [P.D, 1],
      [P.E, 1],
    ]);
  },
});

// ------------------------------------------------- (1) a venda grava o custo do dia

PROVAS.push({
  nome: "(1) a venda da LOJA e a do BALCÃO gravam o custo do dia de cada item (0 é gravado, produto sem custo não grava), a venda antiga segue sem linha",
  corpo: async (c) => {
    assert.deepEqual(
      await registros(c, fx.S1),
      { A: 10, B: null, C: 0 },
      "S1 (loja): Anel 10 e Colar 0 gravados; Brinco (sem custo) sem linha",
    );
    assert.deepEqual(
      await registros(c, fx.S2),
      { A: 10, B: null, C: 0 },
      "S2 (balcão): idem",
    );
    assert.deepEqual(
      await registros(c, fx.S3),
      { A: null, B: null, C: null },
      "S3 (antiga): nenhuma linha",
    );
    assert.deepEqual(
      await registros(c, fx.S5),
      { D: null, E: 7 },
      "S5 (balcão): Dudu (sem custo) sem linha, Esmeralda 7",
    );
    const tot = await c.query(`SELECT count(*)::int AS n FROM ${TABELA}`);
    assert.equal(tot.rows[0].n, 5, "5 linhas: A,C (S1), A,C (S2), E (S5)");
    // O instante do registro é o da venda (agora há pouco), não o da migration.
    const r = await c.query(
      `SELECT bool_and(k.registrado_em <= now() AND k.registrado_em > now() - interval '30 minutes') AS ok FROM ${TABELA} k`,
    );
    assert.equal(r.rows[0].ok, true);
  },
});

// ---------------------------------------------- (2) o lucro congela e o antigo se mexe

const ETAPA1 = {
  lucro: 455,
  custoVendido: 115,
  ranking: [
    ["Anel", 170, 5],
    ["Colar", 156, 4],
    ["Brinco", 66, 3],
    ["Esmeralda", 63, 1],
  ],
  semCusto: 1,
  cmv: 115,
};
const ETAPA2 = {
  lucro: 391,
  custoVendido: 199,
  ranking: [
    ["Colar", 155, 4],
    ["Anel", 96, 5],
    ["Esmeralda", 63, 1],
    ["Brinco", 60, 3],
    ["Dudu", 17, 1],
  ],
  semCusto: 0,
  cmv: 199,
};

/** O que o CRM e a DRE têm de mostrar em cada etapa. Lança se o JSON não for esse. */
async function conferirEtapa(c, esperado, cmvEsperado) {
  const json = await analytics(c);
  assert.deepEqual(
    somas(json),
    { lucro: esperado.lucro, custoVendido: esperado.custoVendido },
    `lucro e custo vendido do CRM (esperado ${esperado.lucro} e ${esperado.custoVendido})`,
  );
  assert.deepEqual(ranking(json), esperado.ranking, "o ranking de lucro");
  assert.equal(
    json.productsWithoutCost,
    esperado.semCusto,
    "productsWithoutCost",
  );
  const d = await dre(c);
  assert.equal(num(d.cmv), cmvEsperado, "CMV da DRE");
  return { json, d };
}

PROVAS.push({
  nome: "(2) depois de mudar o custo, o lucro da venda NOVA não muda e o da ANTIGA segue o custo de hoje (CRM e DRE, duas etapas, números fechados; a devolução credita o custo da venda)",
  corpo: async (c) => {
    // ETAPA 1: custo muda (A 25, B 8, C 4, E apagado), e uma venda NOVA do Anel já sai a 25.
    await mudarCusto(c, { A: 25, B: 8, C: 4, E: null });
    fx.S4 = await venderBalcao(c, [[P.A, 1]]);
    assert.deepEqual(await registros(c, fx.S4), { A: 25 }, "S4 grava 25");
    await conferirEtapa(c, ETAPA1, ETAPA1.cmv);

    // CONTROLE (o corpo ANTERIOR, que só olha o custo de hoje): daria 335 de lucro (o Anel a 25 em todas as 5
    // unidades, sem a Esmeralda, que hoje não tem custo) — a diferença de 120 é exatamente o que esta migration
    // muda: 3 unidades do Anel vendidas a custo 10 (45), 3 do Colar a custo 0 (12) e a Esmeralda a custo 7 (63).
    const antigo = await emTx(c, async () => {
      await c.query(`DELETE FROM ${TABELA}`);
      await c.query(ROLLBACK);
      return somas(await analytics(c));
    });
    assert.equal(
      antigo.lucro,
      335,
      "CONTROLE: o corpo anterior (custo de hoje em tudo) dava 335",
    );
    assert.equal(ETAPA1.lucro - antigo.lucro, 45 + 12 + 63);

    // A DEVOLUÇÃO credita o MESMO custo com que a venda saiu: 1 Anel do S2 (custo do dia 10; hoje 25).
    const item = await c.query(
      "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 AND product_id = $2",
      [fx.S2, P.A],
    );
    const dev = crypto.randomUUID();
    await c.query(
      `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
         modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica, concluida_em)
       VALUES ($1, 'DV-CUSTO-DIA', $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
         'local', 'entrega_na_loja', 'concluida', 50, 0, false, current_date + 7, '{}'::jsonb, now())`,
      [dev, fx.S2, U_CLIENTE],
    );
    await c.query(
      `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
       VALUES ($1, $2, $3, 1, 50, now())`,
      [dev, item.rows[0].id, P.A],
    );
    const comDevolucao = await dre(c);
    assert.equal(
      num(comDevolucao.cmv),
      ETAPA1.cmv - 10,
      "o CMV cai 10 (o custo do dia do Anel devolvido), não 25 (o de hoje)",
    );

    // ETAPA 2: o custo muda DE NOVO (A 99, B 10, C 5, D 3). As vendas com linha não se mexem; as sem linha seguem o novo.
    await mudarCusto(c, { A: 99, B: 10, C: 5, D: 3 });
    const e2 = await conferirEtapa(c, ETAPA2, ETAPA2.cmv - 10);
    assert.equal(
      somas(e2.json).lucro - ETAPA1.lucro,
      -2 - 2 - 74 - 1 - 2 + 17 - 0,
      "só as unidades SEM linha se mexeram (Brinco x3, Anel/Colar da antiga, Dudu que passou a ter custo)",
    );
    fx.devolucao = dev;
  },
});

// -------------------------------------------------- (3) produto sem custo vende normal

PROVAS.push({
  nome: "(3) produto sem custo vende normal e SEM aviso do gatilho; custo 0 grava; o custo apagado depois da venda não tira a venda do lucro",
  corpo: async (c) => {
    // Tudo dentro de uma transação que se desfaz: as vendas desta prova não entram nos números fechados das outras.
    await emTx(c, async () => {
      const ouvinte = ouvirAvisos(c);
      try {
        await c.query("UPDATE public.produtos SET custo = NULL WHERE id = $1", [
          P.B,
        ]);
        const estoqueAntes = (
          await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
            P.B,
          ])
        ).rows[0].estoque;
        const s = await venderBalcaoNaTx(c, [[P.B, 3]]);
        const estoqueDepois = (
          await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
            P.B,
          ])
        ).rows[0].estoque;
        assert.equal(
          estoqueDepois,
          estoqueAntes - 3,
          "a venda baixou o estoque",
        );
        assert.deepEqual(
          await registros(c, s),
          { B: null },
          "sem custo: sem linha",
        );
        assert.deepEqual(
          ouvinte.avisos.filter((a) => a.includes("guarda_o_custo_do_dia")),
          [],
          "produto sem custo não é erro: nenhum aviso do gatilho",
        );
        await c.query("UPDATE public.produtos SET custo = 0 WHERE id = $1", [
          P.C,
        ]);
        const s2 = await venderBalcaoNaTx(c, [[P.C, 1]]);
        assert.deepEqual(await registros(c, s2), { C: 0 }, "custo 0 é gravado");
        // O custo da Esmeralda foi apagado DEPOIS da venda: o item tem linha (7) e segue contando no ranking.
        const json = await analytics(c);
        const esmeralda = json.topProducts.find(
          (t) => t.name === "Custo Esmeralda",
        );
        assert.equal(
          num(esmeralda.total),
          63,
          "a Esmeralda (custo apagado hoje) segue no ranking pelo custo do dia",
        );
      } finally {
        ouvinte.parar();
      }
    });
    // Depois do ROLLBACK os números fechados da etapa 2 continuam os mesmos (nada vazou desta prova).
    await conferirEtapa(c, ETAPA2, ETAPA2.cmv - 10);
  },
});

// ------------------------------------------------------- (4) o custo não vaza

PROVAS.push({
  nome: "(4) o custo NÃO vaza: ninguém de fora lê nem escreve a tabela; os itens do cliente seguem com as mesmas colunas; nenhuma função de cliente a cita",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      for (const quem of ["cliente", "outra", "anon", "admin", "service"]) {
        for (const [rotulo, sql] of [
          ["SELECT", `SELECT * FROM ${TABELA}`],
          ["SELECT de uma coluna", `SELECT custo FROM ${TABELA}`],
          [
            "INSERT",
            `INSERT INTO ${TABELA} (item_id, custo) SELECT id, 1 FROM public.marketplace_order_items LIMIT 1 ON CONFLICT DO NOTHING`,
          ],
          ["UPDATE", `UPDATE ${TABELA} SET custo = 0`],
          ["DELETE", `DELETE FROM ${TABELA}`],
        ]) {
          const r = await como(c, quem, sql);
          assert.equal(r.ok, false, `${quem} não podia fazer ${rotulo}`);
          assert.equal(
            r.code,
            "42501",
            `${quem} ${rotulo}: tinha de ser permission denied (veio ${r.code}: ${r.message})`,
          );
        }
      }
      // O cliente dono do pedido lê os PRÓPRIOS itens: mesmas 9 colunas, nenhuma de custo, e o número do custo não aparece.
      const cols = await c.query(
        `SELECT array_agg(column_name::text ORDER BY column_name) AS cols FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'marketplace_order_items'`,
      );
      assert.deepEqual(cols.rows[0].cols, [
        "created_at",
        "id",
        "image_url",
        "order_id",
        "price",
        "product_id",
        "product_name",
        "quantity",
        "variant_id",
      ]);
      const meus = await como(
        c,
        "cliente",
        "SELECT to_jsonb(oi) AS j FROM public.marketplace_order_items oi WHERE oi.order_id = $1",
        [fx.S1],
      );
      assert.ok(
        meus.ok && meus.rows.length === 3,
        "o cliente lê os 3 itens do próprio pedido",
      );
      for (const l of meus.rows) {
        assert.ok(
          !Object.keys(l.j).some((k) => /custo|cost/i.test(k)),
          `o item do cliente tem coluna de custo: ${Object.keys(l.j)}`,
        );
      }
      // A outra cliente não vê item nenhum do pedido.
      const alheios = await como(
        c,
        "outra",
        "SELECT count(*)::int AS n FROM public.marketplace_order_items WHERE order_id = $1",
        [fx.S1],
      );
      assert.equal(alheios.rows[0].n, 0);
      // Os dois relatórios recusam cliente e anon.
      for (const quem of ["cliente", "anon"]) {
        const a = await como(
          c,
          quem,
          "SELECT public.get_admin_analytics_v2(30)",
        );
        assert.equal(a.ok, false, `${quem} não lê o CRM`);
        const d = await como(
          c,
          quem,
          "SELECT public.fin_dre(current_date - 5, current_date)",
        );
        assert.equal(d.ok, false, `${quem} não lê a DRE`);
      }
      // O catálogo: só as duas RPCs do admin e a função do gatilho citam a tabela; nenhuma alcançável por anon.
      const cita = await c.query(
        `SELECT p.oid::regprocedure::text AS fn,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc LIKE '%marketplace_order_item_custo%'
          ORDER BY 1`,
      );
      assert.deepEqual(
        cita.rows.map((l) => l.fn),
        [
          "fin_dre(date,date)",
          "get_admin_analytics_v2(integer)",
          "marketplace_order_item__guarda_o_custo_do_dia()",
        ],
      );
      assert.ok(cita.rows.every((l) => l.anon === false));
      assert.equal(
        cita.rows.find((l) => l.fn.startsWith("marketplace_order_item__")).auth,
        false,
        "a função do gatilho não é porta de ninguém",
      );
      // A tabela não está na publicação do realtime (a de itens está).
      const pub = await c.query(
        `SELECT array_agg(tablename::text ORDER BY tablename) AS t FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('marketplace_order_items', 'marketplace_order_item_custo')`,
      );
      assert.ok(
        !(pub.rows[0].t || []).includes("marketplace_order_item_custo"),
        "o custo do dia nunca vai ao realtime",
      );
      // RLS ligada, sem política, nenhum privilégio de papel de API.
      const t = await c.query(
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)::int AS politicas,
                has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon,
                has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS auth,
                has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS service
           FROM pg_class c WHERE c.oid = '${TABELA}'::regclass`,
      );
      assert.deepEqual(t.rows[0], {
        rls: true,
        politicas: 0,
        anon: false,
        auth: false,
        service: false,
      });
      // Por aclexplode (o que de fato está gravado na ACL): nenhum privilégio a PUBLIC, anon, authenticated, service_role,
      // nem na tabela nem na função do gatilho; e FORCE RLS desligado (com ele o INSERT do gatilho falharia em silêncio).
      const acl = await c.query(
        `SELECT
           (SELECT count(*)::int FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
             WHERE c.oid = '${TABELA}'::regclass
               AND (x.grantee = 0 OR x.grantee IN (SELECT pr.oid FROM pg_roles pr WHERE pr.rolname IN ('anon', 'authenticated', 'service_role')))) AS tabela,
           (SELECT count(*)::int FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
             WHERE p.oid = to_regprocedure('${GATILHO_FN}')
               AND (x.grantee = 0 OR x.grantee IN (SELECT pr.oid FROM pg_roles pr WHERE pr.rolname IN ('anon', 'authenticated', 'service_role')))) AS funcao,
           (SELECT relforcerowsecurity FROM pg_class WHERE oid = '${TABELA}'::regclass) AS force_rls`,
      );
      assert.deepEqual(acl.rows[0], { tabela: 0, funcao: 0, force_rls: false });
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ----------------------------------------- (5) o gatilho com falha não impede a compra

PROVAS.push({
  nome: "(5) o gatilho com falha simulada (tabela sumida; tabela que recusa a linha) NÃO impede a compra da loja nem a do balcão, avisa, e o erro legítimo da venda continua erro",
  corpo: async (c) => {
    const cenarios = [
      [
        "tabela do custo do dia SUMIDA",
        async () => c.query(`DROP TABLE ${TABELA}`),
      ],
      [
        "tabela que RECUSA a linha (CHECK impossível)",
        async () =>
          c.query(
            `ALTER TABLE ${TABELA} ADD CONSTRAINT recusa_tudo CHECK (custo < 0) NOT VALID`,
          ),
      ],
    ];
    for (const [rotulo, quebrar] of cenarios) {
      await c.query("BEGIN");
      const ouvinte = ouvirAvisos(c);
      try {
        await quebrar();
        const antes = (
          await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
            P.F,
          ])
        ).rows[0].estoque;
        // A venda da LOJA (cliente logado).
        const loja = await como(
          c,
          "cliente",
          `SELECT public.create_marketplace_order_v24($1::jsonb, 30::numeric, 0::numeric, 'pix', NULL::uuid, NULL::text,
             'Comprador', '5539000000000', NULL::text, $2::jsonb, '38500-000', 'local-delivery', $3::uuid) AS id`,
          [
            JSON.stringify([
              { product_id: P.F, variant_id: null, quantity: 2 },
            ]),
            JSON.stringify({
              cep: "38500-000",
              rua: "Rua da Prova",
              numero: "1",
            }),
            crypto.randomUUID(),
          ],
        );
        assert.ok(loja.ok, `${rotulo}: a compra da LOJA caiu: ${loja.message}`);
        // A venda do BALCÃO (admin).
        const balcao = await como(
          c,
          "admin",
          "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
          [
            JSON.stringify([
              { product_id: P.F, variant_id: null, quantity: 1 },
            ]),
            crypto.randomUUID(),
          ],
        );
        assert.ok(
          balcao.ok,
          `${rotulo}: a venda do BALCÃO caiu: ${balcao.message}`,
        );
        const depois = (
          await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
            P.F,
          ])
        ).rows[0].estoque;
        assert.equal(depois, antes - 3, `${rotulo}: o estoque baixou (2 + 1)`);
        const itens = await c.query(
          "SELECT count(*)::int AS n FROM public.marketplace_order_items WHERE order_id IN ($1, $2)",
          [loja.rows[0].id, balcao.rows[0].r.order.id],
        );
        assert.equal(itens.rows[0].n, 2, `${rotulo}: os dois itens nasceram`);
        const dos = ouvinte.avisos.filter(
          (a) => a.includes("o item") && a.includes("ficou sem o custo do dia"),
        );
        assert.equal(
          dos.length,
          2,
          `${rotulo}: um aviso por item (${ouvinte.avisos.join(" | ")})`,
        );
        assert.ok(
          dos.every((a) => a.startsWith("WARNING")) &&
            !/\b12\b/.test(dos.join("")),
          "o aviso é WARNING e não leva o valor do custo",
        );
        assert.ok(
          dos.every((a) => /\(SQLSTATE [0-9A-Z]{5}\)\.$/.test(a)),
          `o aviso leva só o SQLSTATE e o id do item, nunca a mensagem do erro: ${dos.join(" | ")}`,
        );
      } finally {
        ouvinte.parar();
        await c.query("ROLLBACK");
      }
    }
    // O erro LEGÍTIMO da venda segue sendo erro (o gatilho não engole nada que não é dele): estoque insuficiente.
    await c.query("BEGIN");
    try {
      const falta = await como(
        c,
        "admin",
        "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
        [
          JSON.stringify([
            { product_id: P.F, variant_id: null, quantity: 999999 },
          ]),
          crypto.randomUUID(),
        ],
      );
      assert.equal(
        falta.ok,
        false,
        "estoque insuficiente tem de recusar a venda",
      );
      assert.match(falta.message, /[Ee]stoque insuficiente/);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ----------------------------------- (6) mesmas chaves e, sem registros, mesmos números

PROVAS.push({
  nome: "(6) get_admin_analytics_v2 e fin_dre devolvem as mesmas chaves e tipos; em dataset SEM registros de custo do dia os números são IDÊNTICOS aos do corpo vivo anterior (as duas versões no mesmo banco)",
  corpo: async (c) => {
    const novoAnalytics = await analytics(c);
    const novoDre = await dre(c);
    const { semRegistro, antigoAnalytics, antigoDre } = await emTx(
      c,
      async () => {
        await c.query(`DELETE FROM ${TABELA}`);
        const semReg = {
          analytics: (
            await c.query("SELECT public.get_admin_analytics_v2(30)::text AS t")
          ).rows[0].t,
          dre: await dre(c),
        };
        await c.query(ROLLBACK);
        assert.equal((await catalogo(c, ANALYTICS)).hash, H_A.vigente);
        assert.equal((await catalogo(c, DRE)).hash, H_D.vigente);
        await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [
          U_ADMIN,
        ]);
        const antigoA = (
          await c.query("SELECT public.get_admin_analytics_v2(30)::text AS t")
        ).rows[0].t;
        const antigoD = await dre(c);
        return {
          semRegistro: semReg,
          antigoAnalytics: antigoA,
          antigoDre: antigoD,
        };
      },
    );
    assert.equal(
      semRegistro.analytics,
      antigoAnalytics,
      "sem registros, o TEXTO do CRM é idêntico ao do corpo anterior",
    );
    assert.deepEqual(
      semRegistro.dre,
      antigoDre,
      "sem registros, a DRE é idêntica à do corpo anterior",
    );
    // Com registros os valores mudam, mas as chaves e os tipos NÃO.
    assert.deepEqual(
      formato(novoAnalytics),
      formato(JSON.parse(antigoAnalytics)),
      "as chaves do CRM não mudaram",
    );
    assert.deepEqual(
      formato(novoDre),
      formato(antigoDre),
      "as chaves da DRE não mudaram",
    );
    assert.equal(
      novoDre.cmv_estimado,
      true,
      "a DRE segue dizendo que o CMV é estimado",
    );
    assert.notEqual(
      somas(novoAnalytics).lucro,
      somas(JSON.parse(antigoAnalytics)).lucro,
      "com registros o lucro do CRM muda (se não mudasse, a prova (2) não provaria nada)",
    );
  },
});

// ------------------------------------------------------------ (7) rollback em DOIS degraus

const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);

/** O conteúdo da tabela do custo do dia (contagem e md5 das linhas), para provar que ninguém o tocou. */
const conteudo = async (c) =>
  (
    await c.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${TABELA} x`,
    )
  ).rows[0];

PROVAS.push({
  nome: "(7) rollback em DOIS degraus: o comum devolve os dois corpos byte a byte e tira gatilho e função, mas DEIXA a tabela e as linhas; 2x não muda nada; a venda segue sem o gatilho; reaplicar com a tabela presente mantém as linhas; o destrutivo só roda com confirmação e depois do comum; recusa redefinição posterior",
  corpo: async (c) => {
    const comLinhas = await conteudo(c);
    assert.ok(comLinhas.n > 0, "a prova precisa de linhas");
    await emTx(c, async () => {
      const fotoAtual = await catalogo(c, ANALYTICS);
      const fotoDre = await catalogo(c, DRE);
      // DEGRAU (a): o rollback comum, com linhas, SEM recusar.
      await c.query(ROLLBACK);
      const a = await catalogo(c, ANALYTICS);
      const d = await catalogo(c, DRE);
      assert.equal(
        a.hash,
        H_A.vigente,
        "analytics voltou byte a byte (md5 pinado)",
      );
      assert.equal(
        d.hash,
        H_D.vigente,
        "fin_dre voltou byte a byte (md5 pinado)",
      );
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
        assert.equal(a[k], fotoAtual[k], `analytics: ${k} mudou no rollback`);
        assert.equal(d[k], fotoDre[k], `fin_dre: ${k} mudou no rollback`);
      }
      const resto = await c.query(
        `SELECT to_regclass('${TABELA}') IS NOT NULL AS tabela,
                to_regprocedure('${GATILHO_FN}') AS funcao,
                (SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia')::int AS gatilhos`,
      );
      assert.deepEqual(resto.rows[0], {
        tabela: true,
        funcao: null,
        gatilhos: 0,
      });
      assert.deepEqual(
        await conteudo(c),
        comLinhas,
        "o rollback comum tocou nas linhas do custo do dia",
      );
      const semDigital = await digital(c);
      await c.query(ROLLBACK);
      assert.deepEqual(
        await digital(c),
        semDigital,
        "o 2o rollback mudou algo",
      );
      // A compra segue funcionando sem o gatilho; o item novo fica SEM linha (usa o custo de hoje).
      const venda = await como(
        c,
        "admin",
        "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
        [
          JSON.stringify([{ product_id: P.F, variant_id: null, quantity: 1 }]),
          crypto.randomUUID(),
        ],
      );
      assert.ok(
        venda.ok,
        `a venda do balcão caiu depois do rollback: ${venda.message}`,
      );
      assert.deepEqual(
        await registros(c, venda.rows[0].r.order.id),
        { F: null },
        "sem o gatilho o item novo não ganha linha",
      );
      // REAPLICAR com a tabela JÁ PRESENTE e com linhas: as linhas ficam como estavam (a mais, só as novas depois).
      await c.query(MIGRATION);
      assert.equal((await catalogo(c, ANALYTICS)).hash, H_A.desta);
      assert.equal((await catalogo(c, DRE)).hash, H_D.desta);
      assert.deepEqual(
        await conteudo(c),
        comLinhas,
        "reaplicar com a tabela presente mexeu nas linhas",
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia' AND tgenabled = 'O'",
          )
        ).rows[0].n,
        1,
        "reaplicar religa o gatilho",
      );
    });
    // DEGRAU (b): o destrutivo. Sem confirmação RECUSA; com a migration no ar (gatilho existe) RECUSA mesmo confirmado;
    // depois do comum e confirmado, apaga a tabela; 2x é inofensivo.
    await emTx(c, async () => {
      const tentar = async (sql, esperado) => {
        await c.query("SAVEPOINT dest");
        await assert.rejects(c.query(sql), esperado);
        await c.query("ROLLBACK TO SAVEPOINT dest");
      };
      await tentar(DESTRUTIVO, /CUSTO_DO_DIA_SO_COM_O_DONO/);
      await c.query("SET LOCAL app.confirmo_apagar_o_custo_do_dia = 'APAGAR'");
      await tentar(DESTRUTIVO, /CUSTO_DO_DIA_ROLLBACK_COMUM_PRIMEIRO/);
      assert.deepEqual(await conteudo(c), comLinhas, "a recusa apagou algo");
      await c.query(ROLLBACK);
      await c.query("RESET app.confirmo_apagar_o_custo_do_dia");
      await tentar(DESTRUTIVO, /CUSTO_DO_DIA_SO_COM_O_DONO/);
      assert.deepEqual(
        await conteudo(c),
        comLinhas,
        "sem confirmação a tabela não pode mexer",
      );
      await c.query("SET LOCAL app.confirmo_apagar_o_custo_do_dia = 'APAGAR'");
      await c.query(DESTRUTIVO);
      assert.equal(
        (await c.query(`SELECT to_regclass('${TABELA}') AS t`)).rows[0].t,
        null,
        "o destrutivo, confirmado e depois do comum, apaga a tabela",
      );
      assert.equal(
        (await catalogo(c, ANALYTICS)).hash,
        H_A.vigente,
        "o destrutivo não toca nos corpos",
      );
      await c.query(DESTRUTIVO); // 2x
    });
    // Rollback recusa o corpo de OUTRA redefinição (posterior) em vez de apagá-la.
    await emTx(c, async () => {
      const a = await catalogo(c, ANALYTICS);
      const posterior = a.def.replace(
        "-- 0. Security Check",
        "-- 0. Security Check (posterior)",
      );
      assert.notEqual(posterior, a.def);
      await c.query(posterior);
      await c.query("SAVEPOINT rb");
      await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rb");
    });
    // Nada disso vazou: as linhas e o desenho de antes estão intactos.
    assert.deepEqual(await conteudo(c), comLinhas);
  },
});

// -------------------------------------------------------------- (8) aplicar

PROVAS.push({
  nome: "(8) aplicar: o dado que já existia fica intacto e SEM backfill (a tabela nasce vazia), 2x deixa a mesma impressão digital, e o pré-voo recusa SEM escrever (corpo divergente, ACL aberta, tabela de outra forma, gatilho de outra função)",
  corpo: async (c) => {
    // Dado existente: pedidos e itens ficam como estavam e a tabela nova nasce VAZIA (nenhum backfill).
    await emTx(c, async () => {
      await c.query(ROLLBACK);
      await c.query(`DROP TABLE ${TABELA}`); // loja que ainda nao tem a tabela: a migration a cria VAZIA
      const antes = await dados(c);
      assert.ok(
        antes.every((l) => l.n > 0),
        "a semente tinha de ter linhas",
      );
      await c.query(MIGRATION);
      assert.deepEqual(
        await dados(c),
        antes,
        "uma linha de dado mudou ao aplicar",
      );
      const n = await c.query(`SELECT count(*)::int AS n FROM ${TABELA}`);
      assert.equal(
        n.rows[0].n,
        0,
        "SEM backfill: itens existentes ficam sem linha",
      );
    });
    // Idempotência: aplicar 2x não muda nada.
    const base = await digital(c);
    await emTx(c, async () => {
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), base, "reaplicar mudou alguma coisa");
    });
    const recusa = async (preparar, esperado) => {
      await c.query("BEGIN");
      try {
        await preparar();
        const estado = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(MIGRATION), esperado);
        await c.query("ROLLBACK TO SAVEPOINT aplicar");
        assert.deepEqual(await digital(c), estado, "a recusa escreveu algo");
      } finally {
        await c.query("ROLLBACK");
      }
    };
    await recusa(async () => {
      const def = (await catalogo(c, ANALYTICS)).def;
      await c.query(
        def.replace(
          "-- 0. Security Check",
          "-- 0. Security Check (divergente)",
        ),
      );
    }, /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_analytics_v2\(integer\)/);
    await recusa(async () => {
      const def = (await catalogo(c, DRE)).def;
      await c.query(
        def.replace("-- Competência:", "-- Competência (divergente):"),
      );
    }, /B1_BASELINE_DIVERGENT: corpo vivo de public\.fin_dre\(date,date\)/);
    await recusa(async () => {
      await c.query(
        "GRANT EXECUTE ON FUNCTION public.fin_dre(date, date) TO PUBLIC",
      );
    }, /B1_BASELINE_DIVERGENT: ACL de public\.fin_dre\(date,date\)/);
    await recusa(async () => {
      await c.query(ROLLBACK);
      await c.query(`DROP TABLE ${TABELA}`);
      await c.query(`CREATE TABLE ${TABELA} (outra_coisa int)`);
    }, /B1_BASELINE_DIVERGENT: public\.marketplace_order_item_custo já existe com colunas diferentes/);
    await recusa(async () => {
      await c.query(
        "CREATE FUNCTION public.fn_outra_do_teste() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
      );
      await c.query(
        "DROP TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia ON public.marketplace_order_items",
      );
      await c.query(
        `CREATE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia AFTER INSERT ON public.marketplace_order_items
           FOR EACH ROW EXECUTE FUNCTION public.fn_outra_do_teste()`,
      );
    }, /B1_BASELINE_DIVERGENT: o gatilho tr_marketplace_order_items_guarda_o_custo_do_dia já existe apontando para outra função/);
  },
});

// ------------------------------------------------------------------ (9) mutantes

/** Troca UM trecho do corpo vivo da função; `prova` PRECISA falhar com ele (o banco volta no ROLLBACK). */
async function mutante(c, nome, assinatura, de, para, prova) {
  const def = (await catalogo(c, assinatura)).def;
  assert.equal(
    def.split(de).length - 1,
    1,
    `o trecho do mutante "${nome}" tem de aparecer 1x (achei ${def.split(de).length - 1}): ${de.slice(0, 70)}`,
  );
  // CONTROLE: a mesma prova PASSA no corpo sem mutação (senão o mutante morreria à toa).
  await emTx(c, prova);
  await c.query("BEGIN");
  let sobreviveu = false;
  let motivo = "";
  try {
    await c.query(def.replace(de, para));
    try {
      await prova();
      sobreviveu = true;
    } catch (e) {
      motivo = `a prova viu ${JSON.stringify(e.actual)?.slice(0, 90) ?? e.message.slice(0, 90)}`;
    }
  } finally {
    await c.query("ROLLBACK");
  }
  assert.ok(!sobreviveu, `MUTANTE SOBREVIVEU: ${nome}`);
  console.log(`    mutante morto: ${nome} (${motivo})`);
}

/** O que o ranking e o contador têm de dizer quando o Dudu NÃO tem custo (nem hoje, nem na venda). */
async function provaDuduSemCusto(c) {
  await mudarCusto(c, { D: null });
  const json = await analytics(c);
  assert.deepEqual(
    ranking(json),
    [
      ["Colar", 155, 4],
      ["Anel", 96, 5],
      ["Esmeralda", 63, 1],
      ["Brinco", 60, 3],
    ],
    "sem custo hoje nem no dia, o Dudu fica fora do ranking",
  );
  assert.equal(
    json.productsWithoutCost,
    1,
    "e é contado como produto sem custo",
  );
}

PROVAS.push({
  nome: "(9) MUTANTES: sem o COALESCE (só o custo do dia), custo de hoje na frente, ranking e contador sem o custo do dia, DRE e devolução sem o custo do dia, gatilho sem tratamento de erro e gatilho que grava produto sem custo — cada um deixa uma prova VERMELHA",
  corpo: async (c) => {
    const etapa2 = () => conferirEtapa(c, ETAPA2, ETAPA2.cmv - 10);
    await mutante(
      c,
      "CRM só com o custo do dia (sem o COALESCE com o custo de hoje)",
      ANALYTICS,
      "(oi.price - COALESCE(oic.custo, p.custo))) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit",
      "(oi.price - oic.custo)) FILTER (WHERE oic.custo IS NOT NULL), 0) AS profit",
      etapa2,
    );
    await mutante(
      c,
      "CRM com o custo de HOJE na frente (o do dia só se faltar)",
      ANALYTICS,
      "(oi.price - COALESCE(oic.custo, p.custo))) FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit",
      "(oi.price - COALESCE(p.custo, oic.custo))) FILTER (WHERE COALESCE(p.custo, oic.custo) IS NOT NULL), 0) AS profit",
      etapa2,
    );
    await mutante(
      c,
      "CRM: custo vendido sem o custo do dia",
      ANALYTICS,
      "COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold",
      "COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold",
      etapa2,
    );
    await mutante(
      c,
      "ranking sem o custo do dia (volta a olhar só o produto)",
      ANALYTICS,
      "SUM(oi.quantity * (oi.price - COALESCE(oic.custo, p.custo))) as total",
      "SUM(oi.quantity * (oi.price - p.custo)) as total",
      etapa2,
    );
    await mutante(
      c,
      "ranking sem o filtro de custo conhecido (o Dudu sem custo volta ao topo)",
      ANALYTICS,
      "AND COALESCE(oic.custo, p.custo) IS NOT NULL\n        GROUP BY",
      "AND true\n        GROUP BY",
      () => provaDuduSemCusto(c),
    );
    await mutante(
      c,
      "contador de produtos sem custo olhando só o produto (a Esmeralda, de custo apagado, passaria a contar)",
      ANALYTICS,
      "AND COALESCE(oic.custo, p.custo) IS NULL;",
      "AND p.custo IS NULL;",
      etapa2,
    );
    await mutante(
      c,
      "DRE: CMV da venda sem o custo do dia",
      DRE,
      "(SELECT COALESCE(sum(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0)",
      "(SELECT COALESCE(sum(oi.quantity * COALESCE(p.custo, 0)), 0)",
      etapa2,
    );
    await mutante(
      c,
      "DRE: a devolução credita o custo de HOJE e não o da venda",
      DRE,
      "(SELECT COALESCE(sum(di.quantidade * COALESCE(oic.custo, p.custo, 0)), 0)",
      "(SELECT COALESCE(sum(di.quantidade * COALESCE(p.custo, 0)), 0)",
      etapa2,
    );
    await mutante(
      c,
      "DRE: a devolução em OUTRO período credita o custo de hoje (o cenário do custo que sobe)",
      DRE,
      "(SELECT COALESCE(sum(di.quantidade * COALESCE(oic.custo, p.custo, 0)), 0)",
      "(SELECT COALESCE(sum(di.quantidade * COALESCE(p.custo, 0)), 0)",
      () => provaDevolucaoComCustoTrocado(c),
    );
    await mutante(
      c,
      "DRE: cmv_estimado volta a ser constante true",
      DRE,
      "'cmv_estimado', v_cmv_estimado,",
      "'cmv_estimado', true,",
      () => provaDevolucaoComCustoTrocado(c),
    );
    await mutante(
      c,
      "DRE só com o custo do dia (sem o COALESCE com o custo de hoje)",
      DRE,
      "(SELECT COALESCE(sum(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0)",
      "(SELECT COALESCE(sum(oi.quantity * COALESCE(oic.custo, 0)), 0)",
      etapa2,
    );

    // O GATILHO sem o tratamento de erro: com a tabela recusando a linha, a compra cai.
    const defGatilho = (await catalogo(c, GATILHO_FN)).def;
    const semHandler = defGatilho.replace(
      /EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING[^;]*;/,
      "",
    );
    assert.notEqual(
      semHandler,
      defGatilho,
      "o handler tem de existir para o mutante tirá-lo",
    );
    const vendaComTabelaQuebrada = async () => {
      await c.query(
        `ALTER TABLE ${TABELA} ADD CONSTRAINT recusa_tudo CHECK (custo < 0) NOT VALID`,
      );
      const venda = await como(
        c,
        "admin",
        "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
        [
          JSON.stringify([{ product_id: P.F, variant_id: null, quantity: 1 }]),
          crypto.randomUUID(),
        ],
      );
      return venda.ok;
    };
    // controle: com o gatilho de verdade a compra passa mesmo com a tabela recusando a linha
    assert.equal(
      await emTx(c, vendaComTabelaQuebrada),
      true,
      "controle: a compra passa",
    );
    const caiu = await emTx(c, async () => {
      await c.query(semHandler);
      return (await vendaComTabelaQuebrada()) === false;
    });
    assert.ok(
      caiu,
      "MUTANTE SOBREVIVEU: gatilho sem tratamento de erro não derrubou a compra",
    );
    console.log(
      "    mutante morto: gatilho sem tratamento de erro (a compra cai com a tabela recusando a linha)",
    );

    // O GATILHO que não filtra produto sem custo: o NOT NULL da tabela recusa, o tratamento de erro engole, e a
    // venda segue — mas AVISA sem motivo. A prova (3) exige ZERO aviso para produto sem custo.
    const semFiltro = defGatilho.replace("AND p.custo IS NOT NULL", "AND true");
    assert.notEqual(semFiltro, defGatilho);
    const avisosDeProdutoSemCusto = (corpoDoGatilho) =>
      emTx(c, async () => {
        if (corpoDoGatilho) await c.query(corpoDoGatilho);
        const ouvinte = ouvirAvisos(c);
        try {
          await c.query(
            "UPDATE public.produtos SET custo = NULL WHERE id = $1",
            [P.F],
          );
          await venderBalcaoNaTx(c, [[P.F, 1]]);
          return ouvinte.avisos.filter((a) =>
            a.includes("guarda_o_custo_do_dia"),
          );
        } finally {
          ouvinte.parar();
        }
      });
    assert.deepEqual(
      await avisosDeProdutoSemCusto(null),
      [],
      "controle: sem aviso",
    );
    const com = await avisosDeProdutoSemCusto(semFiltro);
    assert.ok(
      com.length >= 1,
      "MUTANTE SOBREVIVEU: gatilho sem o filtro de custo NULL avisaria de graça",
    );
    console.log(
      "    mutante morto: gatilho sem o filtro de custo NULL (avisa à toa)",
    );
  },
});

// ------------------------------------------------------------------ (10) corrida

PROVAS.push({
  nome: "(10) CORRIDA (duas conexões reais): mudar o custo enquanto a venda está aberta ESPERA a venda, e o registro guarda o custo que o produto tinha quando a venda o pegou",
  corpo: async (c) => {
    const outra = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await outra.connect();
    try {
      await c.query("UPDATE public.produtos SET custo = 12 WHERE id = $1", [
        P.F,
      ]);
      await c.query("BEGIN");
      let pedidoId;
      try {
        const v = await como(
          c,
          "admin",
          "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, 0::numeric, NULL, $2::uuid) AS r",
          [
            JSON.stringify([
              { product_id: P.F, variant_id: null, quantity: 1 },
            ]),
            crypto.randomUUID(),
          ],
        );
        assert.ok(v.ok, v.message);
        pedidoId = v.rows[0].r.order.id;
        // Com a venda ABERTA (ela travou a linha do produto no UPDATE do estoque), o outro lojista muda o custo.
        const pid = (await outra.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        const mudanca = outra.query(
          "UPDATE public.produtos SET custo = 99 WHERE id = $1",
          [P.F],
        );
        let esperando = false;
        for (let i = 0; i < 200 && !esperando; i += 1) {
          const w = await c.query(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
            [pid],
          );
          esperando = w.rows[0]?.wait_event_type === "Lock";
          if (!esperando) await new Promise((r) => setTimeout(r, 20));
        }
        assert.ok(
          esperando,
          "a mudança de custo tinha de esperar a venda aberta",
        );
        await c.query("COMMIT");
        await mudanca;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
      assert.deepEqual(
        await registros(c, pedidoId),
        { F: 12 },
        "a venda guardou o custo de ANTES da mudança (12), não o 99",
      );
      assert.equal(
        num(
          (
            await c.query("SELECT custo FROM public.produtos WHERE id = $1", [
              P.F,
            ])
          ).rows[0].custo,
        ),
        99,
        "e o produto passou a custar 99",
      );
      await c.query("UPDATE public.produtos SET custo = 12 WHERE id = $1", [
        P.F,
      ]);
    } finally {
      await outra.end().catch(() => {});
    }
  },
});

// ------------------------------------------------- (11) a devolução e o cmv_estimado

/** Pedido ANTIGO pago (n dias atrás, meio-dia de SP) com itens [produto, quantidade, preço]; o gatilho grava o custo do dia. */
async function pedidoAntigo(c, dias, itens) {
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ('Cliente do passado', '{}'::jsonb, 1, 1, 'delivered', 'online', 'online', 'pago',
             ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int + time '12:00') AT TIME ZONE 'America/Sao_Paulo',
             ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
     RETURNING id`,
    [dias],
  );
  for (const [produto, quantidade, preco] of itens) {
    await c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'item do passado', $3, $4)`,
      [r.rows[0].id, produto, quantidade, preco],
    );
  }
  return r.rows[0].id;
}

/** A DRE da janela [hoje-de, hoje-ate] (dias de SP), como o admin a lê. */
async function dreEm(c, de, ate) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  const r = await c.query(
    `SELECT public.fin_dre(((now() AT TIME ZONE 'America/Sao_Paulo')::date - $1::int),
                           ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $2::int)) AS r`,
    [de, ate],
  );
  return r.rows[0].r;
}

/** Devolução concluída de `quantidade` do item (reestocada `dias` atrás). */
async function devolver(
  c,
  pedido,
  itemId,
  produto,
  quantidade,
  dias,
  protocolo,
) {
  const dev = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.devolucoes (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
       modalidade, metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, $5, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
       'local', 'entrega_na_loja', 'concluida', $4::numeric * 15, 0, false, current_date + 7, '{}'::jsonb, now())`,
    [dev, pedido, U_CLIENTE, quantidade, protocolo],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
     VALUES ($1, $2, $3, $4,
       15, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - $5::int + time '12:00') AT TIME ZONE 'America/Sao_Paulo')`,
    [dev, itemId, produto, quantidade, dias],
  );
}

/**
 * O cenário do crítico de desenho: venda a custo 12, o custo SOBE a 30, a peça volta.
 *   S6 (-20 dias): Fio x2 a custo do dia 12;  S7 (-8 dias): Fio x3 a custo do dia 12;  o custo do Fio vai a 30.
 *   Devolução de 1 Fio do S6, reestocada no dia -7 (OUTRO período: a venda é de -20, a devolução cai na janela de S7).
 *   Janela [-10,-5]: CMV = 3x12 - 1x12 = 24 (com o custo de HOJE na devolução seria 36 - 30 = 6).
 *   Janela [-25,-15]: só S6, CMV = 24.
 *   MESMO período: devolução de 1 Fio do S7 no dia -6, janela [-10,-5]: 36 - 12 - 12 = 12.
 */
async function provaDevolucaoComCustoTrocado(c) {
  await c.query("UPDATE public.produtos SET custo = 12 WHERE id = $1", [P.F]);
  const s6 = await pedidoAntigo(c, 20, [[P.F, 2, 15]]);
  const s7 = await pedidoAntigo(c, 8, [[P.F, 3, 15]]);
  assert.deepEqual(await registros(c, s6), { F: 12 });
  assert.deepEqual(await registros(c, s7), { F: 12 });
  await c.query("UPDATE public.produtos SET custo = 30 WHERE id = $1", [P.F]);
  const item = async (pedido) =>
    (
      await c.query(
        "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 AND product_id = $2",
        [pedido, P.F],
      )
    ).rows[0].id;
  // Antes de qualquer devolução: cada janela só tem a sua venda, pelo custo do DIA (12), e nada é estimado.
  let w = await dreEm(c, 10, 5);
  assert.equal(num(w.cmv), 36, "S7 a custo do dia: 3 x 12");
  assert.equal(
    w.cmv_estimado,
    false,
    "toda venda da janela tem o custo do dia: nada é estimado",
  );
  const w0 = await dreEm(c, 25, 15);
  assert.equal(num(w0.cmv), 24, "S6 a custo do dia: 2 x 12");
  assert.equal(w0.cmv_estimado, false);
  // Devolução em OUTRO período (a venda é de -20, a devolução cai em -7): credita o custo do dia (12), não o de hoje (30).
  await devolver(c, s6, await item(s6), P.F, 1, 7, "DV-OUTRO-PERIODO");
  w = await dreEm(c, 10, 5);
  assert.equal(
    num(w.cmv),
    24,
    "janela da devolução: 36 - 12 (o custo do DIA do item devolvido); com o custo de hoje daria 6",
  );
  assert.equal(w.cmv_estimado, false);
  // Devolução no MESMO período da venda (S7, dia -6): credita o custo do dia.
  await devolver(c, s7, await item(s7), P.F, 1, 6, "DV-MESMO-PERIODO");
  w = await dreEm(c, 10, 5);
  assert.equal(
    num(w.cmv),
    12,
    "36 - 12 - 12: as duas devoluções creditam o custo do dia (12)",
  );
}

PROVAS.push({
  nome: "(11) devolução com o custo trocado entre a venda e a volta (mesmo período e período diferente) credita o custo do DIA; cmv_estimado deixou de ser constante (false quando todo item tem o custo do dia, true quando algum usa o custo de hoje)",
  corpo: async (c) => {
    await emTx(c, () => provaDevolucaoComCustoTrocado(c));
    // cmv_estimado: um item da janela SEM registro (venda de antes) volta a marcar estimado = true, e o CMV usa o custo de hoje.
    await emTx(c, async () => {
      await c.query("UPDATE public.produtos SET custo = 12 WHERE id = $1", [
        P.F,
      ]);
      await pedidoAntigo(c, 8, [[P.F, 3, 15]]);
      const semRegistro = await pedidoAntigo(c, 9, [[P.F, 1, 15]]);
      await c.query(
        `DELETE FROM ${TABELA} WHERE item_id IN (SELECT id FROM public.marketplace_order_items WHERE order_id = $1)`,
        [semRegistro],
      );
      await c.query("UPDATE public.produtos SET custo = 30 WHERE id = $1", [
        P.F,
      ]);
      const w = await dreEm(c, 10, 5);
      assert.equal(
        num(w.cmv),
        36 + 30,
        "3 x 12 (do dia) + 1 x 30 (sem registro: o custo de hoje)",
      );
      assert.equal(
        w.cmv_estimado,
        true,
        "um item sem o custo do dia: o CMV é estimado",
      );
      // Janela vazia: nada a estimar.
      const vazia = await dreEm(c, 400, 390);
      assert.equal(
        vazia.cmv_estimado,
        false,
        "sem nenhum item na janela, nada é estimado",
      );
      assert.equal(num(vazia.cmv), 0);
    });
    // O dataset desta prova (que ainda tem a semente) segue dizendo true: há venda antiga sem registro.
    assert.equal((await dre(c)).cmv_estimado, true);
  },
});

// ---------------------------------------- (12) a trava do apply: sem fila, sem gravar

PROVAS.push({
  nome: "(12) a TRAVA do apply: com uma venda segurando a tabela de itens, a migration NÃO entra na fila (a venda nova passa na hora), recusa em ~4 s com 55P03 sem gravar nada, e, se a venda terminar antes do prazo, aplica",
  corpo: async (c) => {
    const url = lerDatabaseUrlEfemera();
    const venda = new Client({ connectionString: url });
    const outraVenda = new Client({ connectionString: url });
    await venda.connect();
    await outraVenda.connect();
    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const antes = await digital(c);
      // (a) a venda segura a tabela além do prazo: a migration recusa sem gravar.
      await venda.query("BEGIN");
      await venda.query(
        "LOCK TABLE public.marketplace_order_items IN ROW EXCLUSIVE MODE",
      );
      await c.query("BEGIN");
      const t0 = Date.now();
      const aplicando = c.query(MIGRATION).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, code: e.code, message: e.message }),
      );
      await dormir(700);
      // ENQUANTO a migration espera: outra venda nova pega a mesma trava na hora (ela não está na fila).
      await outraVenda.query("BEGIN");
      await outraVenda.query("SET LOCAL lock_timeout = '1s'");
      const t1 = Date.now();
      await outraVenda.query(
        "LOCK TABLE public.marketplace_order_items IN ROW EXCLUSIVE MODE",
      );
      const dtVenda = Date.now() - t1;
      await outraVenda.query("ROLLBACK");
      assert.ok(
        dtVenda < 400,
        `a venda nova esperou ${dtVenda} ms atrás da migration (devia passar na hora)`,
      );
      const r = await aplicando;
      const dt = Date.now() - t0;
      assert.equal(r.ok, false, "a migration tinha de recusar");
      assert.equal(r.code, "55P03", `código ${r.code}: ${r.message}`);
      assert.match(r.message, /PREFLIGHT_20261242/);
      assert.ok(
        dt >= 3500 && dt <= 8000,
        `recusou em ${dt} ms (esperado ~4 s)`,
      );
      await c.query("ROLLBACK");
      await venda.query("ROLLBACK");
      assert.deepEqual(await digital(c), antes, "a recusa gravou algo");
      // (b) a venda termina antes do prazo: a migration (reaplicação) entra e conclui.
      await venda.query("BEGIN");
      await venda.query(
        "LOCK TABLE public.marketplace_order_items IN ROW EXCLUSIVE MODE",
      );
      await c.query("BEGIN");
      const t2 = Date.now();
      const concluindo = c.query(MIGRATION).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, message: e.message }),
      );
      await dormir(1000);
      await venda.query("ROLLBACK");
      const r2 = await concluindo;
      const dt2 = Date.now() - t2;
      assert.equal(
        r2.ok,
        true,
        `a migration devia aplicar depois que a venda saiu: ${r2.message}`,
      );
      assert.ok(dt2 >= 900 && dt2 < 4000, `aplicou em ${dt2} ms`);
      await c.query("ROLLBACK");
      assert.deepEqual(await digital(c), antes);
      console.log(
        `    venda nova passou em ${dtVenda} ms com a migration esperando; recusa em ${dt} ms; aplicou em ${dt2} ms depois de a venda sair`,
      );
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      await venda.query("ROLLBACK").catch(() => {});
      await outraVenda.query("ROLLBACK").catch(() => {});
      await venda.end().catch(() => {});
      await outraVenda.end().catch(() => {});
    }
  },
});

// ------------------------------------ (13) venda grande: 200 itens no balcão, em uma transação

PROVAS.push({
  nome: "(13) CARGA: uma venda de balcão de 200 itens grava os 200 custos do dia, sem aviso e sem derrubar a venda; o custo do bloco EXCEPTION (subtransações) é MEDIDO contra a mesma venda com o gatilho desligado",
  corpo: async (c) => {
    const mil = async (rotulo, sufixo) => {
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
         SELECT gen_random_uuid(), 'Carga ${sufixo} ' || g, 10, 3, 1000, true, false FROM generate_series(1, 200) g`,
      );
      const ids = (
        await c.query(
          `SELECT id FROM public.produtos WHERE nome LIKE 'Carga ${sufixo} %' ORDER BY nome`,
        )
      ).rows.map((l) => l.id);
      assert.equal(ids.length, 200, rotulo);
      return ids;
    };
    // Cada subtransação que ESCREVE consome um xid. Com o banco quieto e uma só conexão escrevendo, o avanço do
    // xmax do snapshot ENTRE ANTES E DEPOIS da transação (que se desfaz) é o número de xids que a venda gastou
    // (1 da transação + 1 por subtransação aberta). Passar de 64 subtransações estoura o cache do backend
    // (PGPROC_MAX_CACHED_SUBXIDS): as consultas dos outros passam a olhar pg_subtrans enquanto a venda não termina.
    const xmax = async () =>
      Number(
        (
          await c.query(
            "SELECT pg_snapshot_xmax(pg_current_snapshot())::text AS x",
          )
        ).rows[0].x,
      );
    const medir = async (comGatilho) => {
      const x0 = await xmax();
      const r = await medirNaTx(comGatilho);
      r.xids = (await xmax()) - x0;
      return r;
    };
    const medirNaTx = async (comGatilho) =>
      emTx(c, async () => {
        const ids = await mil("200 produtos", comGatilho ? "com" : "sem");
        if (!comGatilho) {
          await c.query(
            "ALTER TABLE public.marketplace_order_items DISABLE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia",
          );
        }
        const ouvinte = ouvirAvisos(c);
        try {
          const t = Date.now();
          const pedido = await venderBalcaoNaTx(
            c,
            ids.map((id) => [id, 1]),
          );
          const ms = Date.now() - t;
          const gravados = (
            await c.query(
              `SELECT count(*)::int AS n FROM ${TABELA} k JOIN public.marketplace_order_items oi ON oi.id = k.item_id WHERE oi.order_id = $1`,
              [pedido],
            )
          ).rows[0].n;
          const itens = (
            await c.query(
              "SELECT count(*)::int AS n FROM public.marketplace_order_items WHERE order_id = $1",
              [pedido],
            )
          ).rows[0].n;
          return {
            ms,
            gravados,
            itens,
            avisos: ouvinte.avisos.filter((a) =>
              a.includes("guarda_o_custo_do_dia"),
            ),
          };
        } finally {
          ouvinte.parar();
        }
      });
    const com = await medir(true);
    assert.equal(com.itens, 200, "a venda de 200 itens passou");
    assert.equal(com.gravados, 200, "os 200 custos do dia foram gravados");
    assert.deepEqual(com.avisos, [], "nenhum aviso do gatilho");
    const sem = await medir(false);
    assert.equal(sem.itens, 200);
    assert.equal(
      sem.gravados,
      0,
      "com o gatilho desligado nada é gravado (controle)",
    );
    console.log(
      `    200 itens COM o gatilho: ${com.ms} ms, xids consumidos=${com.xids}, estouro do cache de subtransações (>64)=${com.xids > 64}`,
    );
    console.log(
      `    200 itens SEM o gatilho: ${sem.ms} ms, xids consumidos=${sem.xids}, estouro do cache de subtransações (>64)=${sem.xids > 64}`,
    );
  },
});

// ------------------------------------------------------------------- main

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva do custo do dia da venda (rpc-ci)";
  try {
    // Mede a 42 isolada; a 45 redefine seu analytics e os pre-voos antigos devem continuar recusando.
    await require("./lucro-com-desconto-posterior.cjs").desfazerLucroComDescontoNaTransacao(
      cliente,
    );
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        if (erro.actual !== undefined) {
          console.error(
            `    visto:    ${JSON.stringify(erro.actual)}\n    esperado: ${JSON.stringify(erro.expected)}`,
          );
        }
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "O lucro não usa o custo do dia da venda — ver acima qual.",
        );
      }
    }
    console.log(
      `\n[custo-do-dia] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
    );
    anexarAoSummary(
      titulo,
      `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
