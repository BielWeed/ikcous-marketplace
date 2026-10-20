// @ts-nocheck
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const ler = (p) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");
const NOME = "20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql";
const BASE = "20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql";
const anterior = ler(`supabase/migrations/${BASE}`);
const fn = (s) => {
  const i = s.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  assert.ok(i >= 0, "definicao do analytics ausente");
  return s.slice(i, s.indexOf("$$;", i) + 3);
};
const corpo = (s) => fn(s).slice(fn(s).indexOf("AS $$") + 5, -3);
const hash = (s, tipo = "md5") => createHash(tipo).update(s).digest("hex");
const VIGENTE = hash(corpo(anterior));
let migration;
try {
  migration = ler(`supabase/migrations/${NOME}`);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  // Sem a feature, mede o comportamento que o banco ainda entrega.
  migration = anterior;
}
const DESTA = hash(corpo(migration));

Deno.test("faturamento potencial — usa o preco proprio da variante e inclui preco zero", () => {
  assert.ok(
    fn(migration).includes("COALESCE(pv.price_override, p.preco_venda)"),
    "o faturamento precisa usar o mesmo preco da variacao que a venda cobra",
  );
});

Deno.test("faturamento potencial — soma toda a venda sem retirar a protecao do lucro sem custo", () => {
  assert.match(fn(migration), /'totalRevenue', inv_revenue_total/);
  assert.match(fn(migration), /COALESCE\(SUM\(faturamento\), 0\)/);
  assert.match(
    fn(migration),
    /SUM\(preco_venda \* estoque\) FILTER \(WHERE custo IS NOT NULL\)/,
  );
  const devolvido = fn(migration)
    .replace("    inv_revenue_total numeric;\n", "")
    .replace(",\n        COALESCE(SUM(faturamento), 0)", "")
    .replace(
      ",\n            CASE\n                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_venda, 0)\n                ELSE p.preco_venda * p.estoque\n            END AS faturamento",
      "",
    )
    .replace(
      ",\n                SUM(COALESCE(pv.price_override, p.preco_venda) * COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_venda",
      "",
    )
    .replace("inv_value_total, inv_revenue_total", "inv_value_total")
    .replace(",\n            'totalRevenue', inv_revenue_total", "");
  assert.equal(
    devolvido,
    fn(anterior),
    "fora o agregado novo, corpo anterior deve ser identico",
  );
});

Deno.test("faturamento potencial — rollback exato e pre/pos-voos com hashes reais e ACL preservada", () => {
  const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
  assert.equal(fn(rollback), fn(anterior));
  assert.equal(VIGENTE, "ab25e738a3101cccbb0c09450b660ee0");
  assert.notEqual(DESTA, VIGENTE);
  for (const s of [migration, rollback]) {
    assert.ok(
      s.indexOf("DO $preflight$") < s.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    for (const trecho of [
      VIGENTE,
      DESTA,
      "B1_BASELINE_DIVERGENT",
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30s';",
      "p.prosecdef",
      "ARRAY['search_path=public']::text[]",
      "has_function_privilege('anon'",
      "NOT has_function_privilege('authenticated'",
    ])
      assert.ok(s.includes(trecho), trecho);
  }
  assert.ok(migration.includes(`v_hash IS DISTINCT FROM '${DESTA}'`));
  assert.ok(rollback.includes(`v_hash IS DISTINCT FROM '${VIGENTE}'`));
});

Deno.test("faturamento potencial — portoes ancestrais aceitam apenas o sucessor conhecido", () => {
  for (const nome of [
    "8e-conferir-92-a-202-aplicado",
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "48a-conferir-lucro-com-desconto-aplicado",
  ]) {
    const s = ler(`scripts/publicacao/consultas/${nome}.sql`);
    assert.ok(s.includes(`'${VIGENTE}'`), nome);
    assert.ok(s.includes(`'${DESTA}'`), nome);
  }
  const s = ler(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  for (const b of [corpo(migration), corpo(migration).replace(/\n/g, "\r\n")])
    assert.ok(s.includes(hash(b, "sha256")));
});

Deno.test("faturamento potencial — lote proprio e prova viva entram no caminho normal", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const texto = JSON.stringify(canais);
  assert.ok(texto.includes("53a-conferir-faturamento-potencial-aplicado"));
  assert.ok(texto.includes("53b-antes-faturamento-potencial-base-vigente"));
  assert.ok(texto.includes("20261250000000"));
  const ci = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    ci.includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/faturamento-potencial-viva.cjs",
    ),
  );
  assert.ok(ler("scripts/db-apply.cjs").includes(NOME));
  assert.ok(ler("tests/banco/sucessoras-da-99.cjs").includes(NOME));
});

Deno.test("faturamento potencial — provas historicas reconhecem a sucessora sem mudar a base medida", () => {
  const estoque = ler("tests/banco/estoque-do-painel-portao-viva.cjs");
  assert.ok(
    estoque.includes(
      `        "${NOME}",\n        "public.get_admin_analytics_v2(integer)",`,
    ),
    "a lista fechada de posteriores do lote 17 deve incluir a 250 para desfazer em ordem inversa",
  );
  const prova8e = ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs");
  const filtro = prova8e.slice(
    prova8e.indexOf(
      "const SUCESSORAS_DA_99 = TODAS_AS_SUCESSORAS_DA_99.filter(",
    ),
    prova8e.indexOf("const REPO ="),
  );
  assert.ok(
    filtro.replace(/\s+/g, " ").includes(`s.nome !== "${NOME}"`),
    "a prova historica da 8e mede a base anterior a 42 e deve excluir a 250 ja desfeita",
  );
  assert.ok(prova8e.includes("await devolverAoEstadoAnteriorAoCustoDoDia(C)"));
  assert.ok(
    ler("tests/banco/lucro-com-desconto-posterior.cjs").includes(
      "desfazerFaturamentoPotencialNaTransacao",
    ),
  );
});

Deno.test("faturamento potencial — prova viva executa portoes ancestrais no corpo novo e no rollback", () => {
  const viva = ler("tests/banco/faturamento-potencial-viva.cjs");
  for (const nome of [
    "8e-conferir-92-a-202-aplicado",
    "17a-conferir-estoque-do-painel-aplicado",
    "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "48a-conferir-lucro-com-desconto-aplicado",
  ])
    assert.ok(viva.includes(`"${nome}"`), nome);
  assert.equal(
    viva.split("for (const nome of ANCESTRAIS) await consulta(c, nome, true);")
      .length - 1,
    2,
    "os portoes devem rodar com a 250 no ar e com a 245 restaurada",
  );
});
