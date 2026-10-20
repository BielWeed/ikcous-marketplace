// @ts-nocheck
// Prova de texto; comportamento e mutantes: tests/banco/lucro-com-desconto-viva.cjs.
/* eslint-disable security/detect-object-injection -- As chaves indexadas são constantes do próprio teste. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const DEFINE_ANALYTICS = /create function[^(]*get_admin_analytics_v2/i;
const normaliza = (t) =>
  t
    .replace(/create or replace function/gi, "create function")
    .replace(/\s+/g, " ");
const ler = (p) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");
const NOME = "20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql";
const BASE = "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const anterior = ler(`supabase/migrations/${BASE}`);
const fn = (s) => {
  const i = s.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  assert.ok(i >= 0);
  return s.slice(i, s.indexOf("$$;", i) + 3);
};
const corpo = (s) => fn(s).slice(fn(s).indexOf("AS $$") + 5, -3);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const VIGENTE = "dceb62881ebf8fa404ba3ac295041691";
const DESTA = md5(corpo(migration));
const ORIGINAL = "oi.quantity * (oi.price - COALESCE(oic.custo, p.custo))";
const DESCONTO = `oi.quantity * (oi.price - COALESCE(oic.custo, p.custo) - CASE
                    WHEN COALESCE(o.discount, 0) <= 0 THEN 0
                    ELSE oi.price * LEAST(1, GREATEST(0, COALESCE(o.discount, 0)) / NULLIF(
                        (SELECT SUM(desconto_item.quantity * desconto_item.price)
                           FROM public.marketplace_order_items desconto_item
                          WHERE desconto_item.order_id = o.id), 0))
                END)`;

Deno.test("20261245 — corpo anterior confirmado e rollback byte a byte; só as DUAS fórmulas mudam", () => {
  assert.equal(md5(corpo(anterior)), VIGENTE);
  assert.equal(fn(rollback), fn(anterior));
  assert.equal(corpo(migration).split(DESCONTO).length - 1, 2);
  assert.equal(fn(migration).replaceAll(DESCONTO, ORIGINAL), fn(anterior));
  assert.notEqual(DESTA, VIGENTE);
  for (const s of [migration, rollback]) {
    assert.ok(s.includes(VIGENTE));
    assert.ok(s.includes(DESTA));
    assert.deepEqual(
      [
        ...s.matchAll(/^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm),
      ].map((m) => m[1]),
      ["get_admin_analytics_v2"],
    );
  }
});

Deno.test("20261245 — pré-voo antes da escrita, hash real, atributos e ACL; sem transação de topo nem escrita em dado", () => {
  for (const s of [migration, rollback]) {
    const limpo = removerRuido(s);
    const tx = detectarTransacaoExplicita(limpo);
    assert.equal(tx.begin, false);
    assert.equal(tx.commit, false);
    assert.ok(
      !/\b(GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(limpo),
    );
    assert.ok(
      s.indexOf("DO $preflight$") < s.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(s.includes("B1_BASELINE_DIVERGENT"));
    assert.ok(s.includes("SET LOCAL lock_timeout = '5s';"));
    assert.ok(s.includes("SET LOCAL statement_timeout = '30s';"));
    assert.ok(s.includes("md5(replace(prosrc, E'\\r', ''))"));
    for (const t of [
      "p.prosecdef",
      "p.provolatile = 'v'",
      "NOT p.proisstrict",
      "NOT p.proretset",
      "p.pronargs = 1",
      "p_limit_days integer DEFAULT 90",
      "ARRAY['search_path=public']::text[]",
      "pg_get_function_result(p.oid) = 'json'",
      "g.grantee = 0",
      "has_function_privilege('anon'",
      "NOT has_function_privilege('authenticated'",
      "NOT has_function_privilege('service_role'",
    ])
      assert.ok(s.includes(t), t);
  }
  assert.ok(
    migration.includes(
      `('public.get_admin_analytics_v2(integer)', '${VIGENTE}', '${DESTA}')`,
    ),
  );
  assert.ok(migration.includes(`v_hash IS DISTINCT FROM '${DESTA}'`));
  assert.ok(rollback.includes(`v_hash IS DISTINCT FROM '${VIGENTE}'`));
});

Deno.test("20261245 — a 42 era vigente; posteriores são lista fechada, e o registro de sucessoras prende a cadeia", () => {
  const posteriores = [
    ...Deno.readDirSync(new URL("../supabase/migrations/", import.meta.url)),
  ]
    .filter((f) => /^\d{14}_.*\.sql$/.test(f.name) && f.name > BASE)
    .filter((f) =>
      DEFINE_ANALYTICS.test(normaliza(ler(`supabase/migrations/${f.name}`))),
    )
    .map((f) => f.name)
    .sort();
  assert.deepEqual(posteriores, [
    NOME,
    "20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql",
    "20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql",
  ]);
  const sucessoras = require("./banco/sucessoras-da-99.cjs");
  sucessoras.conferirLista();
  const entrada = sucessoras.SUCESSORAS_DA_99.find((s) => s.nome === NOME);
  assert.equal(entrada.hashVigente, VIGENTE);
  assert.equal(entrada.hashDesta, DESTA);
});

Deno.test("20261245 — portões anteriores aceitam o sucessor exato, e não se trocam os hashes históricos", () => {
  for (const p of [
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "8e-conferir-92-a-202-aplicado",
  ]) {
    const s = ler(`scripts/publicacao/consultas/${p}.sql`);
    assert.ok(s.includes(`'${VIGENTE}'`), p);
    assert.ok(s.includes(`'${DESTA}'`), p);
  }
  const a17 = ler(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  for (const b of [corpo(migration), corpo(migration).replace(/\n/g, "\r\n")])
    assert.ok(a17.includes(createHash("sha256").update(b).digest("hex")));
  assert.ok(
    !ler(
      "scripts/publicacao/consultas/45b-antes-custo-do-dia-base-vigente.sql",
    ).includes(DESTA),
  );
});

Deno.test("20261245 — db-apply verifica as duas fórmulas e o CI exige a prova viva no clone", () => {
  const { VERIFICACOES, conferirMarcador } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert.ok(entrada);
  const checagens = Array.isArray(entrada) ? entrada : [entrada];
  assert.equal(checagens.length, 1);
  assert.equal(checagens[0].funcao, "get_admin_analytics_v2");
  for (const m of checagens[0].esperado)
    assert.ok(conferirMarcador(fn(migration), m).ok);
  assert.ok(
    checagens[0].esperado.some((m) => !conferirMarcador(fn(anterior), m).ok),
  );
  const ci = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    ci.includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/lucro-com-desconto-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes("lucro-com-desconto-viva.cjs"),
  );
});

Deno.test("20261245 — lote 48 registrado, consultas prendem os hashes reais e têm rol fechado", () => {
  const a = "48a-conferir-lucro-com-desconto-aplicado";
  const b = "48b-antes-lucro-com-desconto-base-vigente";
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.find((p) => p.consulta === a);
  assert.deepEqual(lote.versoes, ["20261245000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, b);
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [n, h] of [
    [a, DESTA],
    [b, VIGENTE],
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${n}.sql`);
    assert.ok(sql.includes(`'${h}'`));
    assert.equal(conf.contarStatements(sql), 1);
    assert.equal(conf.ROL_FECHADO_POR_CONSULTA[n].length, 4);
    for (const item of conf.ROL_FECHADO_POR_CONSULTA[n])
      assert.ok(sql.includes(`'${item}'`));
    assert.ok(ler("scripts/frota/publicar-release.mjs").includes(`"${n}"`));
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(`- ${n}`),
    );
  }
});
