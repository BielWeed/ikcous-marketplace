"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Chaves e caminhos são constantes do teste ou resultados das RPCs no clone efêmero. */

/**
 * Prova VIVA da 20261245, só no clone descartável de rodar-isolado.cjs (Postgres 17).
 * Vendas REAIS por v24 + cupom e registrar_venda_presencial(p_desconto); a confirmação
 * online é carimbada pela fixture, como em custo-do-dia-viva.cjs (sem gateway externo).
 * Casos de legado impossível de criar hoje (discount > itens, subtotal NULL, item sem
 * produto) são montados explicitamente na fixture, nunca alterando as RPCs de compra.
 * A semente só vive no clone; cada cenário abre transação e SEMPRE desfaz.
 * Nenhum dado de loja é usado.
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/lucro-com-desconto-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const ler = (n) => fs.readFileSync(path.join(DIR, n), "utf8");
const NOME = "20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql";
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const BASE = ler("20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql");
const ASSINATURA = "public.get_admin_analytics_v2(integer)";
const H_ANTES = "dceb62881ebf8fa404ba3ac295041691";
function definicao(sql) {
  const i = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  assert.ok(i >= 0);
  return sql.slice(i, sql.indexOf("$$;", i) + 3);
}
const DEFINICAO = definicao(MIGRATION);
const H_DEPOIS = crypto
  .createHash("md5")
  .update(
    DEFINICAO.slice(DEFINICAO.indexOf("AS $$") + 5, -3).replace(/\r/g, ""),
  )
  .digest("hex");
const ADMIN = "d1450000-0000-4000-8000-000000000001";
const CLIENTE = "d1450000-0000-4000-8000-000000000002";
const P = {
  A: "d1450000-0000-4000-8000-0000000000a1", // preço 100, custo 60
  B: "d1450000-0000-4000-8000-0000000000b1", // preço 50, custo 20
  C: "d1450000-0000-4000-8000-0000000000c1", // preço 100, sem custo
  Z: "d1450000-0000-4000-8000-0000000000d1", // preço 0, custo 0
};

async function emTx(c, f) {
  await c.query("BEGIN");
  try {
    return await f();
  } finally {
    await c.query("ROLLBACK");
  }
}

// As chamadas de compra e de leitura passam pelo papel e gates reais do admin/cliente.
async function como(c, uid, sql, params = []) {
  await c.query("SAVEPOINT como");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role: "authenticated",
          app_metadata: uid === ADMIN ? { role: "admin" } : {},
        }),
      ],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT como");
    return r;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT como");
    await c.query("RELEASE SAVEPOINT como");
    throw e;
  }
}

const itens = (lista) =>
  JSON.stringify(
    lista.map(([p, q]) => ({ product_id: p, variant_id: null, quantity: q })),
  );
async function balcao(c, lista = [[P.A, 1]], desconto = 30) {
  const r = await como(
    c,
    ADMIN,
    "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL, NULL, $2::numeric, 'prova do desconto', $3::uuid) AS r",
    [itens(lista), desconto, crypto.randomUUID()],
  );
  return r.rows[0].r.order.id;
}

async function online(c) {
  const r = await como(
    c,
    CLIENTE,
    `SELECT public.create_marketplace_order_v24($1::jsonb, 70::numeric, 0::numeric, 'pix', NULL::uuid, 'LUCRO30',
       'Comprador', '5539000000000', NULL::text, $2::jsonb, '38500-000', 'local-delivery', $3::uuid) AS id`,
    [
      itens([[P.A, 1]]),
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      crypto.randomUUID(),
    ],
  );
  const id = r.rows[0].id;
  await c.query(
    "UPDATE public.marketplace_orders SET payment_status = 'pago', paid_at = now() WHERE id = $1",
    [id],
  );
  return id;
}

async function analytics(c) {
  const r = await como(
    c,
    ADMIN,
    "SELECT public.get_admin_analytics_v2(30)::text AS r",
  );
  return { texto: r.rows[0].r, json: JSON.parse(r.rows[0].r) };
}

// Números fechados, calculados independentemente da fórmula SQL em teste.
function conferir({ json }, lucro, custo, ranking, semCusto = 0) {
  assert.equal(
    json.revenueHistory.reduce((s, h) => s + Number(h.profit), 0),
    lucro,
    "lucro do gráfico diário",
  );
  assert.equal(
    json.revenueHistory.reduce((s, h) => s + Number(h.cost_sold), 0),
    custo,
    "cost_sold não muda",
  );
  assert.deepEqual(
    json.topProducts.map((t) => [t.name, Number(t.total), t.quantity]).sort(),
    ranking.slice().sort(),
    "lucro E quantidade por produto",
  );
  assert.equal(Number(json.productsWithoutCost), semCusto);
}

function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

async function catalogo(c) {
  return (
    await c.query(
      `SELECT md5(replace(prosrc, chr(13), '')) AS hash,
    pg_get_functiondef(oid) AS def, proacl::text AS acl, proowner::regrole::text AS dono,
    prosecdef, proconfig, provolatile, proisstrict, proretset,
    pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS resultado
    FROM pg_proc WHERE oid = to_regprocedure($1)`,
      [ASSINATURA],
    )
  ).rows[0];
}

// Impressão de todas as funções: uma recusa não pode alterar nem o próprio corpo estranho.
async function digital(c) {
  return (
    await c.query(`SELECT n.nspname, p.proname, p.oid::text,
    md5(replace(p.prosrc, chr(13), '')) AS hash, p.proacl::text AS acl, p.proconfig,
    p.prosecdef, p.provolatile, p.proisstrict, p.proowner::text,
    pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS resultado
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'auth') ORDER BY p.oid`)
  ).rows;
}
async function dados(c) {
  return (
    await c.query(`SELECT 'pedidos' AS tabela, count(*)::int AS n,
    md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.marketplace_orders x
    UNION ALL SELECT 'itens', count(*)::int, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_order_items x
    UNION ALL SELECT 'custos', count(*)::int, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.marketplace_order_item_custo x
    UNION ALL SELECT 'produtos', count(*)::int, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.produtos x`)
  ).rows;
}

async function semEscritaNaRecusa(c, sql) {
  const antes = { funcoes: await digital(c), dados: await dados(c) };
  await c.query("SAVEPOINT recusa");
  await assert.rejects(c.query(sql), /B1_BASELINE_DIVERGENT/);
  await c.query("ROLLBACK TO SAVEPOINT recusa");
  assert.deepEqual(
    { funcoes: await digital(c), dados: await dados(c) },
    antes,
    "a recusa escreveu",
  );
  await c.query("RELEASE SAVEPOINT recusa");
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("semente limpa, usuários, produtos e cupom reais", async (c) => {
  assert.equal(
    Number(
      (await c.query("SELECT count(*) AS n FROM public.marketplace_orders"))
        .rows[0].n,
    ),
    0,
  );
  assert.equal(
    (await catalogo(c)).hash,
    H_DEPOIS,
    "a 45 tem de estar no ar desde o apply do clone",
  );
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    ($1, 'admin@lucro.teste', '{"role":"admin"}'), ($2, 'cliente@lucro.teste', '{}')`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
    ($1, 'Admin Lucro', 'admin'), ($2, 'Cliente Lucro', 'customer')`,
    [ADMIN, CLIENTE],
  );
  await c.query(`INSERT INTO public.store_config (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
    VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
    ON CONFLICT (id) DO UPDATE SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
      free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage, enable_coupons = true,
      local_delivery_enabled = true`);
  for (const [id, nome, preco, custo] of [
    [P.A, "Anel", 100, 60],
    [P.B, "Brinco", 50, 20],
    [P.C, "Colar", 100, null],
    [P.Z, "Zero", 0, 0],
  ])
    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
      VALUES ($1, $2, $3, $4, 1000, true, false)`,
      [id, nome, preco, custo],
    );
  await c.query(
    "INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit) VALUES ('LUCRO30', 'fixed', 30, true, 0, 100)",
  );
});

for (const [nome, vender] of [
  ["v24 com cupom", online],
  ["balcão com p_desconto", balcao],
]) {
  prova(
    `${nome}: venda 100/custo 60/desconto 30 = lucro 10 diário E ranking (antes dava 40)`,
    (c) =>
      emTx(c, async () => {
        const id = await vender(c);
        const pedido = (
          await c.query(
            "SELECT subtotal::numeric, discount::numeric, total::numeric FROM public.marketplace_orders WHERE id = $1",
            [id],
          )
        ).rows[0];
        assert.deepEqual(
          Object.values(pedido).map(Number),
          [100, 30, 70],
          "a semente gravou o desconto real",
        );
        conferir(await analytics(c), 10, 60, [["Anel", 10, 1]]);
        await c.query(definicao(BASE));
        conferir(await analytics(c), 40, 60, [["Anel", 40, 1]]);
      }),
  );
}

async function proporcional(c) {
  await balcao(
    c,
    [
      [P.A, 2],
      [P.B, 1],
    ],
    50,
  );
  const a = await analytics(c);
  conferir(a, 60, 140, [
    ["Anel", 40, 2],
    ["Brinco", 20, 1],
  ]);
  return a;
}
prova(
  "dois preços e quantidade 2: rateio 40/10 do desconto 50 sobre itens 200/50",
  (c) => emTx(c, () => proporcional(c)),
);

async function teto(c) {
  const id = await balcao(c);
  // Os caminhos novos recusam isto; o relatório também precisa suportar um legado inconsistente.
  await c.query(
    "UPDATE public.marketplace_orders SET discount = 150, total = 0 WHERE id = $1",
    [id],
  );
  conferir(await analytics(c), -60, 60, [["Anel", -60, 1]]);
}
prova(
  "desconto acima dos itens: teto 1, lucro mínimo -custo (sem receita negativa)",
  (c) => emTx(c, () => teto(c)),
);

async function legado(c) {
  const id = await balcao(c);
  await c.query(
    "UPDATE public.marketplace_orders SET subtotal = 0, created_at = now() - interval '3 days' WHERE id = $1",
    [id],
  );
  await c.query(
    "DELETE FROM public.marketplace_order_item_custo WHERE item_id IN (SELECT id FROM public.marketplace_order_items WHERE order_id = $1)",
    [id],
  );
  await c.query("UPDATE public.produtos SET custo = 50 WHERE id = $1", [P.A]);
  conferir(await analytics(c), 20, 50, [["Anel", 20, 1]]);
}
prova(
  "pedido antigo, subtotal gravado 0 (inconsistente) e sem custo do dia: usa soma real dos itens e custo atual",
  (c) => emTx(c, () => legado(c)),
);

prova(
  "item sem custo: fora do lucro e do ranking, sua parte do desconto não vai ao outro item",
  (c) =>
    emTx(c, async () => {
      await balcao(
        c,
        [
          [P.A, 1],
          [P.C, 1],
        ],
        60,
      );
      conferir(await analytics(c), 10, 60, [["Anel", 10, 1]], 1);
    }),
);

prova("denominador inclui item SEM produto (não vem do JOIN filtrado)", (c) =>
  emTx(c, async () => {
    const id = await balcao(c);
    await c.query(
      "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, NULL, 'Legado sem produto', 1, 100)",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET subtotal = 200, discount = 60, total = 140 WHERE id = $1",
      [id],
    );
    conferir(await analytics(c), 10, 60, [["Anel", 10, 1]]);
  }),
);

prova(
  "custo do dia continua prevalecendo; apagar custo atual não tira a venda do lucro",
  (c) =>
    emTx(c, async () => {
      await balcao(c);
      await c.query("UPDATE public.produtos SET custo = 99 WHERE id = $1", [
        P.A,
      ]);
      conferir(await analytics(c), 10, 60, [["Anel", 10, 1]]);
      await c.query("UPDATE public.produtos SET custo = NULL WHERE id = $1", [
        P.A,
      ]);
      conferir(await analytics(c), 10, 60, [["Anel", 10, 1]]);
    }),
);

prova(
  "cancelado e não pago ficam fora; frete não altera o lucro; desconto negativo não o infla",
  (c) =>
    emTx(c, async () => {
      const id = await balcao(c);
      const cancelado = await balcao(c, [[P.B, 1]], 0);
      const naoPago = await balcao(c, [[P.B, 1]], 0);
      await c.query(
        "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
        [cancelado],
      );
      await c.query(
        "UPDATE public.marketplace_orders SET payment_status = NULL WHERE id = $1",
        [naoPago],
      );
      await c.query(
        "UPDATE public.marketplace_orders SET shipping = 25, total = 95 WHERE id = $1",
        [id],
      );
      conferir(await analytics(c), 10, 60, [["Anel", 10, 1]]);
      await c.query(
        "UPDATE public.marketplace_orders SET discount = -30 WHERE id = $1",
        [id],
      );
      conferir(await analytics(c), 40, 60, [["Anel", 40, 1]]);
    }),
);

prova("soma de itens zero não divide por zero (legado de item grátis)", (c) =>
  emTx(c, async () => {
    const id = await balcao(c);
    await c.query(
      "UPDATE public.marketplace_order_items SET price = 0 WHERE order_id = $1",
      [id],
    );
    conferir(await analytics(c), -60, 60, [["Anel", -60, 1]]);
  }),
);

prova(
  "desconto NULL e 0: mesmo JSON byte a byte do corpo anterior no MESMO banco",
  (c) =>
    emTx(c, async () => {
      const nulo = await balcao(c, [[P.A, 1]], 0);
      await balcao(
        c,
        [
          [P.B, 2],
          [P.C, 1],
        ],
        0,
      );
      await c.query(
        "UPDATE public.marketplace_orders SET discount = NULL WHERE id = $1",
        [nulo],
      );
      const depois = await analytics(c);
      await c.query(definicao(BASE));
      const antes = await analytics(c);
      assert.equal(
        depois.texto,
        antes.texto,
        "não muda nem a representação dos números sem desconto",
      );
    }),
);

prova(
  "mesmas chaves/tipos do JSON com desconto: só lucro diário e total do ranking mudam",
  (c) =>
    emTx(c, async () => {
      const depois = await proporcional(c);
      await c.query(definicao(BASE));
      const antes = await analytics(c);
      assert.deepEqual(formato(depois.json), formato(antes.json));
      const semLucro = (j) => ({
        ...j,
        revenueHistory: j.revenueHistory.map(({ profit: _profit, ...h }) => h),
        topProducts: j.topProducts
          .map(({ total: _total, ...p }) => p)
          .sort((a, b) => a.id.localeCompare(b.id)),
      });
      assert.deepEqual(semLucro(depois.json), semLucro(antes.json));
    }),
);

prova(
  "fin_dre já desconta o cupom via total pago; corpo, ACL e números intocados",
  (c) =>
    emTx(c, async () => {
      await balcao(c);
      const lerDre = () =>
        como(
          c,
          ADMIN,
          `SELECT public.fin_dre((now() AT TIME ZONE 'America/Sao_Paulo')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS r`,
        );
      const dre = (await lerDre()).rows[0].r;
      assert.equal(Number(dre.receita_balcao), 70);
      assert.equal(Number(dre.cmv), 60);
      assert.equal(Number(dre.lucro_bruto), 10);
      const antes = (
        await c.query(
          "SELECT pg_get_functiondef('public.fin_dre(date,date)'::regprocedure) AS def, proacl::text AS acl FROM pg_proc WHERE oid = 'public.fin_dre(date,date)'::regprocedure",
        )
      ).rows[0];
      await c.query(ROLLBACK);
      await c.query(MIGRATION);
      assert.deepEqual((await lerDre()).rows[0].r, dre);
      assert.deepEqual(
        (
          await c.query(
            "SELECT pg_get_functiondef('public.fin_dre(date,date)'::regprocedure) AS def, proacl::text AS acl FROM pg_proc WHERE oid = 'public.fin_dre(date,date)'::regprocedure",
          )
        ).rows[0],
        antes,
      );
    }),
);

prova(
  "rollback byte a byte, ACL/dono iguais, aplicar 2x e CRLF idênticos; só uma função muda",
  (c) =>
    emTx(c, async () => {
      await balcao(c);
      const estado = await digital(c);
      const catalogoNovo = await catalogo(c);
      const linhas = await dados(c);
      await c.query(ROLLBACK);
      const antigo = await catalogo(c);
      assert.equal(antigo.hash, H_ANTES);
      // pg_get_functiondef pode normalizar o delimitador: o prosrc é a autoridade byte a byte.
      const vivo = (
        await c.query(
          "SELECT replace(prosrc, chr(13), '') AS corpo FROM pg_proc WHERE oid = to_regprocedure($1)",
          [ASSINATURA],
        )
      ).rows[0].corpo;
      const base = definicao(BASE).replace(/\r/g, "");
      assert.equal(vivo, base.slice(base.indexOf("AS $$") + 5, -3));
      const metadados = ({ hash: _h, def: _d, ...resto }) => resto;
      assert.deepEqual(metadados(antigo), metadados(catalogoNovo));
      const isolado = await digital(c);
      await c.query(ROLLBACK);
      assert.deepEqual(await digital(c), isolado, "rollback 2x");
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), estado);
      await c.query(MIGRATION);
      await c.query(MIGRATION.replace(/\r?\n/g, "\r\n"));
      assert.deepEqual(await digital(c), estado, "apply 2x/CRLF");
      assert.deepEqual(await dados(c), linhas, "nenhuma linha tocada");
    }),
);

prova(
  "pré-voo e rollback recusam corpo estranho, atributos, ACL e sobrecarga SEM escrever",
  async (c) => {
    for (const sql of [MIGRATION, ROLLBACK]) {
      for (const preparar of [
        async () => {
          const def = (await catalogo(c)).def;
          const estranho = def.replace(
            "-- 0. Security Check",
            "-- 0. Security Check (corpo estranho)",
          );
          assert.notEqual(estranho, def);
          await c.query(estranho);
        },
        () =>
          c.query(
            "ALTER FUNCTION public.get_admin_analytics_v2(integer) STABLE",
          ),
        () =>
          c.query(
            "GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO PUBLIC",
          ),
        () =>
          c.query(
            "REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM authenticated",
          ),
        () =>
          c.query(
            "CREATE FUNCTION public.get_admin_analytics_v2(text) RETURNS json LANGUAGE sql AS $$ SELECT '{}'::json $$",
          ),
      ])
        await emTx(c, async () => {
          await preparar();
          await semEscritaNaRecusa(c, sql);
        });
    }
  },
);

prova(
  "portões 48a/48b: antes/depois, rol fechado, hash estranho/atributos/ACL reprovam",
  (c) =>
    emTx(c, async () => {
      const a = "48a-conferir-lucro-com-desconto-aplicado";
      const b = "48b-antes-lucro-com-desconto-base-vigente";
      const consulta = async (nome) => {
        const sql = fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "scripts",
            "publicacao",
            "consultas",
            `${nome}.sql`,
          ),
          "utf8",
        );
        const r = await como(c, ADMIN, sql);
        assert.equal(r.rows.length, 4);
        assert.equal(
          CONF.estruturaDoRolFechado(
            r.rows,
            CONF.ROL_FECHADO_POR_CONSULTA[nome],
          ),
          null,
        );
        return r.rows.filter((l) => l.ok !== true).map((l) => l.item);
      };
      assert.deepEqual(await consulta(a), []);
      assert.equal((await consulta(b)).length, 1);
      await c.query(ROLLBACK);
      assert.deepEqual(await consulta(b), []);
      assert.equal((await consulta(a)).length, 1);
      await c.query(MIGRATION);
      for (const [alterar, trecho] of [
        [
          async () =>
            c.query(
              (await catalogo(c)).def.replace(
                "-- 0. Security Check",
                "-- 0. Security Check (estranho)",
              ),
            ),
          ": corpo",
        ],
        [
          () =>
            c.query(
              "ALTER FUNCTION public.get_admin_analytics_v2(integer) STABLE",
            ),
          ": uma assinatura",
        ],
        [
          () =>
            c.query(
              "GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO PUBLIC",
            ),
          ": EXECUTE",
        ],
      ]) {
        await c.query("SAVEPOINT negativo");
        await alterar();
        const falhas = await consulta(a);
        assert.equal(falhas.length, 1);
        assert.ok(falhas[0].includes(trecho));
        await c.query("ROLLBACK TO SAVEPOINT negativo");
        await c.query("RELEASE SAVEPOINT negativo");
      }
      // Os portões ancestrais aceitam a 45 EXATA, sem fazer os rollbacks de montagem das provas antigas.
      for (const nome of [
        "45a-conferir-custo-do-dia-aplicado",
        "35a-conferir-lucro-so-com-custo-aplicado",
        "17a-conferir-estoque-do-painel-aplicado",
        "8e-conferir-92-a-202-aplicado",
      ]) {
        const sql = fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "scripts",
            "publicacao",
            "consultas",
            `${nome}.sql`,
          ),
          "utf8",
        );
        const r = await c.query(sql);
        assert.deepEqual(
          r.rows.filter((l) => l.ok !== true),
          [],
          `${nome}: a 45 não pode invalidar o ancestral`,
        );
      }
    }),
);

// Cada mutante é controlado: a MESMA prova passa no original e falha por ASSERTION no mutado.
async function mutante(c, nome, mudar, verificar) {
  await emTx(c, () => verificar(c));
  await emTx(c, async () => {
    const def = (await catalogo(c)).def;
    const outro = mudar(def);
    assert.notEqual(outro, def, `mutante sem alteração: ${nome}`);
    await c.query(outro); // erro SQL não mata o mutante: a criação tem de funcionar.
    let morto = false;
    try {
      await verificar(c);
    } catch (e) {
      if (e.code !== "ERR_ASSERTION") throw e;
      morto = true;
    }
    assert.equal(morto, true, `mutante SOBREViVEU: ${nome}`);
    console.log(`    mutante morto por asserção: ${nome}`);
  });
}
prova(
  "MUTANTES: tirar teto, usar subtotal, esquecer ranking, denominator só com custo",
  async (c) => {
    await mutante(
      c,
      "sem cap em 1",
      (s) =>
        s.replaceAll(
          "LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(",
          "(GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(",
        ),
      teto,
    );
    await mutante(
      c,
      "usar o.subtotal",
      (s) =>
        s.replace(
          /\(SELECT SUM\(desconto_item\.quantity \* desconto_item\.price\)\s+FROM public\.marketplace_order_items desconto_item\s+WHERE desconto_item\.order_id = o\.id\)/g,
          "o.subtotal",
        ),
      legado,
    );
    await mutante(
      c,
      "desconto só no daily, ranking antigo",
      (s) => {
        const inicio = s.indexOf("-- 5. Top Products");
        const de = s
          .slice(inicio)
          .replace(
            /oi\.quantity \* \(oi\.price - COALESCE\(oic\.custo, p\.custo\) - CASE[\s\S]*?END\)/,
            "oi.quantity * (oi.price - COALESCE(oic.custo, p.custo))",
          );
        return s.slice(0, inicio) + de;
      },
      proporcional,
    );
    await mutante(
      c,
      "denominador exclui item sem custo",
      (s) =>
        s.replaceAll(
          "WHERE desconto_item.order_id = o.id",
          "WHERE desconto_item.order_id = o.id AND desconto_item.product_id <> 'd1450000-0000-4000-8000-0000000000c1'::uuid",
        ),
      async (db) => {
        await balcao(
          db,
          [
            [P.A, 1],
            [P.C, 1],
          ],
          60,
        );
        conferir(await analytics(db), 10, 60, [["Anel", 10, 1]], 1);
      },
    );
  },
);

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  const linhas = [];
  const titulo = "Prova viva do lucro com desconto (rpc-ci)";
  try {
    await c.query("BEGIN");
    await require("./faturamento-potencial-posterior.cjs").desfazerFaturamentoPotencialNaTransacao(c);
    await c.query("COMMIT");
    for (const { nome, corpo } of PROVAS) {
      await corpo(c);
      console.log(`  PASSOU ${nome}`);
      linhas.push(`- ✅ ${nome}`);
    }
    console.log(
      `\n[lucro-com-desconto] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
    );
    anexarAoSummary(titulo, linhas.join("\n"));
  } catch (e) {
    console.error(e);
    anexarAoSummary(titulo, `${linhas.join("\n")}\n- ❌ ${e.message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.message));
