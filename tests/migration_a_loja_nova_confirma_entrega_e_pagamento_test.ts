// A LOJA NOVA CONFIRMA A ENTREGA E O PAGAMENTO QUE VIERAM DE FABRICA: prova offline do par 20261652000000 + rollback.
// O COMPORTAMENTO (a loja que ja existe nasce confirmada, a loja nova nasce pendente, a RPC grava a confirmacao com o
// relogio do banco, nao-admin recusado, reaplicar e rollback) e' provado em
// tests/banco/a-loja-nova-confirma-entrega-e-pagamento-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que
// se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome = "20261652000000_a_loja_nova_confirma_entrega_e_pagamento.sql";
const nome1643 =
  "20261643000000_as_listas_dos_ajustes_nao_somem_entre_aparelhos.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql1643 = ler(`supabase/migrations/${nome1643}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ANTES = "2f772ffd1370359ba6c64540b71c35b2";
const H_NOVO = "3c62896ca905200f1a931ac6ccfed297";
const MARCA = "CREATE OR REPLACE FUNCTION public.upsert_store_config(";

/** A UNICA definicao de upsert_store_config do arquivo: cabecalho (ate o AS) e corpo (entre os $$). */
function definicao(arquivo: string): { cabeca: string; corpo: string } {
  assert.equal(arquivo.split(MARCA).length - 1, 1, "uma definicao so");
  const i = arquivo.indexOf(MARCA);
  const a = arquivo.indexOf("AS $$", i);
  assert.ok(a > i, "sem delimitador de dolar");
  return {
    cabeca: arquivo.slice(i, a),
    corpo: arquivo.slice(a + "AS $$".length, arquivo.indexOf("$$;", a)),
  };
}

// O que a migration acrescenta ao corpo da 1643, exatamente (de -> para). Nada mais muda.
const TROCAS: Array<[string, string]> = [
  [
    "  -- AS LISTAS NAO SOMEM ENTRE APARELHOS (20261643000000): vitrines e formas\n",
    "  -- 20261652000000: a lojista CONFIRMA o que a loja nova traz de fabrica (a entrega na\n" +
      "  -- cidade e as formas de pagamento na entrega). A chave so aceita `true`: quem carimba e o\n" +
      "  -- relogio do banco, nunca o do aparelho, e a primeira confirmacao fica (confirmar de novo\n" +
      '  -- nao muda a data; nao existe "desconfirmar"). Qualquer outro valor (false, null, texto,\n' +
      "  -- data) recusa ANTES de gravar qualquer coisa.\n" +
      "  IF (config_json ? 'entrega_confirmada_em'\n" +
      "        AND config_json->'entrega_confirmada_em' IS DISTINCT FROM 'true'::jsonb)\n" +
      "     OR (config_json ? 'pagamento_confirmado_em'\n" +
      "        AND config_json->'pagamento_confirmado_em' IS DISTINCT FROM 'true'::jsonb) THEN\n" +
      "    RAISE EXCEPTION 'Confirmação inválida.' USING ERRCODE = '22023';\n" +
      "  END IF;\n\n" +
      "  -- AS LISTAS NAO SOMEM ENTRE APARELHOS (20261643000000): vitrines e formas\n",
  ],
  [
    "    local_delivery_enabled, local_delivery_days, free_shipping_card_style\n  )\n",
    "    local_delivery_enabled, local_delivery_days, free_shipping_card_style,\n" +
      "    entrega_confirmada_em, pagamento_confirmado_em\n  )\n",
  ],
  [
    "    COALESCE(config_json->>'free_shipping_card_style', 'completo')\n  )\n",
    "    COALESCE(config_json->>'free_shipping_card_style', 'completo'),\n" +
      "    -- 20261652000000: com a chave, a confirmacao nasce do relogio do banco; sem ela, NULL\n" +
      "    -- (a loja nova ainda nao confirmou).\n" +
      "    CASE WHEN config_json ? 'entrega_confirmada_em' THEN now() END,\n" +
      "    CASE WHEN config_json ? 'pagamento_confirmado_em' THEN now() END\n  )\n",
  ],
  [
    "      ELSE store_config.free_shipping_card_style END,\n    updated_at = now()\n",
    "      ELSE store_config.free_shipping_card_style END,\n" +
      "    -- 20261652000000: a PRIMEIRA confirmacao fica (COALESCE); sem a chave, nada muda.\n" +
      "    entrega_confirmada_em = CASE WHEN config_json ? 'entrega_confirmada_em'\n" +
      "      THEN COALESCE(store_config.entrega_confirmada_em, now())\n" +
      "      ELSE store_config.entrega_confirmada_em END,\n" +
      "    pagamento_confirmado_em = CASE WHEN config_json ? 'pagamento_confirmado_em'\n" +
      "      THEN COALESCE(store_config.pagamento_confirmado_em, now())\n" +
      "      ELSE store_config.pagamento_confirmado_em END,\n" +
      "    updated_at = now()\n",
  ],
];

Deno.test("1652: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
});

Deno.test("1652: a ultima migration que definiu upsert_store_config e' a 20261643000000; o rollback devolve o corpo DELA byte a byte", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const definem = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .filter((n) => ler(`supabase/migrations/${n}`).includes(MARCA))
    .sort();
  assert.deepEqual(definem.slice(-2), [nome1643, nome]);
  // A 1643 define DUAS funcoes; o corpo dela de upsert e' o primeiro.
  const i = sql1643.indexOf(MARCA);
  const a = sql1643.indexOf("AS $$", i) + "AS $$".length;
  const corpo1643 = sql1643.slice(a, sql1643.indexOf("$$;", a));
  assert.equal(md5(corpo1643), H_ANTES);
  assert.equal(definicao(rb).corpo, corpo1643);
  assert.equal(md5(definicao(rb).corpo), H_ANTES);
  // MESMA assinatura e atributos (o cabecalho e' o de antes, nos dois arquivos).
  assert.equal(
    definicao(sql).cabeca,
    sql1643.slice(i, sql1643.indexOf("AS $$", i)),
  );
  assert.equal(definicao(rb).cabeca, definicao(sql).cabeca);
});

Deno.test("1652: o corpo novo so acrescenta as duas chaves de confirmacao; travas, listas vistas e o resto iguais", () => {
  const novo = definicao(sql).corpo;
  assert.equal(md5(novo), H_NOVO);
  let desfeito = novo;
  for (const [de, para] of TROCAS) {
    assert.equal(desfeito.split(para).length - 1, 1, para);
    desfeito = desfeito.replace(para, () => de);
  }
  assert.equal(
    md5(desfeito),
    H_ANTES,
    "desfeitas as trocas, sobra o corpo da 1643",
  );
  for (const trecho of [
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
    "USING ERRCODE = 'LST01', DETAIL = 'formas_pagamento_entrega';",
    "RAISE EXCEPTION 'Confirmação inválida.' USING ERRCODE = '22023';",
    "THEN COALESCE(store_config.entrega_confirmada_em, now())",
    "THEN COALESCE(store_config.pagamento_confirmado_em, now())",
  ])
    assert.equal(novo.split(trecho).length - 1, 1, trecho);
  // A validacao vem DEPOIS das duas travas de admin (o nao-admin recebe sempre "Nao autorizado") e ANTES de qualquer escrita.
  const iAdmin = novo.indexOf("IF NOT public.is_admin_atual() THEN");
  const iValida = novo.indexOf("'Confirmação inválida.'");
  const iInsert = novo.indexOf("INSERT INTO public.store_config");
  const iTrava = novo.indexOf("FOR UPDATE;");
  assert.ok(iAdmin < iValida && iValida < iTrava && iValida < iInsert, "ordem");
  // A hora vem do BANCO: o valor do payload nunca e' gravado.
  assert.ok(
    !/config_json->>?'(entrega_confirmada_em|pagamento_confirmado_em)'\)?::timestamptz/.test(
      novo,
    ),
  );
});

Deno.test("1652: pre-voo antes, colunas, corpo, conferencia; a loja que ja existe nasce confirmada sem UPDATE e a nova (marca de instalacao) nasce NULL", () => {
  const iPre = sql.indexOf("DO $preflight_20261652000000$");
  const iCol = sql.indexOf("DO $colunas_20261652000000$");
  const iCria = sql.indexOf(MARCA);
  const iConf = sql.indexOf("DO $conferencia_20261652000000$");
  assert.ok(iPre > 0 && iPre < iCol && iCol < iCria && iCria < iConf, "ordem");
  // Sem os comentarios de linha, mas COM o miolo dos blocos DO (o ALTER das colunas mora dentro de um).
  const semRuido = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
  for (const proibido of [
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\s+(TABLE|FUNCTION|VIEW|TRIGGER|POLICY|INDEX|COLUMN)\b/i,
  ])
    assert.ok(!proibido.test(semRuido), `proibido: ${proibido}`);
  // So as duas colunas novas: anulaveis, sem NOT NULL; o DEFAULT now() so existe no ramo da loja que ja existe e sai logo depois.
  const adds = [
    ...semRuido.matchAll(/ADD COLUMN (\w+) timestamptz( DEFAULT now\(\))?;/g),
  ].map((m) => `${m[1]}${m[2] ?? ""}`);
  assert.deepEqual(adds, [
    "entrega_confirmada_em",
    "pagamento_confirmado_em",
    "entrega_confirmada_em DEFAULT now()",
    "pagamento_confirmado_em DEFAULT now()",
  ]);
  assert.equal(semRuido.split("DROP DEFAULT;").length - 1, 2);
  assert.ok(
    !/NOT NULL/i.test(semRuido.slice(iCol, iCria)),
    "as colunas sao anulaveis",
  );
  const bloco = sql.slice(iCol, iCria);
  const iMarca = bloco.indexOf(
    "SELECT EXISTS (SELECT 1 FROM supabase_migrations.ikcous_instalacao WHERE id = 1 AND concluida_em IS NULL)",
  );
  const iSemDefault = bloco.indexOf(
    "ADD COLUMN entrega_confirmada_em timestamptz;",
  );
  const iComDefault = bloco.indexOf(
    "ADD COLUMN entrega_confirmada_em timestamptz DEFAULT now();",
  );
  assert.ok(
    iMarca > 0 && iMarca < iSemDefault && iSemDefault < iComDefault,
    "marca de instalacao decide o ramo",
  );
  assert.ok(bloco.includes("IF v_loja_em_instalacao THEN"));
  // Reaplicar nao recarimba: o ADD so roda com a coluna ausente.
  assert.ok(bloco.includes("AND a.attname = 'entrega_confirmada_em') THEN"));
  // O pre-voo aceita SO o corpo da 1643 ou o desta (tupla que sucessoras-da-99.cjs le); a conferencia exige o desta.
  assert.ok(
    sql.includes(
      `('public.upsert_store_config(jsonb)', '${H_ANTES}', '${H_NOVO}')`,
    ),
  );
  assert.ok(sql.includes(`IS DISTINCT FROM '${H_NOVO}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.confirma1652_upsert')::jsonb"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  // O rollback aceita SO o desta, devolve o da 1643 e apaga SO as duas colunas.
  assert.ok(rb.includes(`IS DISTINCT FROM '${H_NOVO}' THEN`));
  assert.ok(rb.includes(`IS DISTINCT FROM '${H_ANTES}' THEN`));
  const rbSemRuido = removerRuido(rb);
  assert.deepEqual(
    [...rbSemRuido.matchAll(/DROP COLUMN IF EXISTS (\w+);/g)].map((m) => m[1]),
    ["entrega_confirmada_em", "pagamento_confirmado_em"],
  );
  assert.ok(
    !/\bDROP\s+(TABLE|FUNCTION|VIEW|TRIGGER|POLICY|INDEX)\b/i.test(rbSemRuido),
  );
  assert.ok(!/\bDELETE\s+FROM\b|\bUPDATE\s+public\./i.test(rbSemRuido));
  assert.ok(
    rb.indexOf("$$;") <
      rb.indexOf("DROP COLUMN IF EXISTS entrega_confirmada_em;"),
    "colunas saem depois do corpo",
  );
});

Deno.test("1652: entra na cadeia das sucessoras da 99, e as provas da 1643 a tiram antes", () => {
  const sucessoras = ler("tests/banco/sucessoras-da-99.cjs");
  const iMinha = sucessoras.indexOf(`  "${nome}",\n];`);
  assert.ok(
    iMinha > sucessoras.indexOf(`  "${nome1643}",`),
    "depois da 1643, a ultima",
  );
  const posterior = ler("tests/banco/a-loja-nova-confirma-posterior.cjs");
  assert.ok(posterior.includes(`"${H_NOVO}"`));
  assert.ok(posterior.includes(nome));
  // Quem desfaz a 1643 desfaz esta primeiro (ela redefine o mesmo corpo).
  const listas = ler("tests/banco/as-listas-dos-ajustes-posterior.cjs");
  const iChama = listas.indexOf("desfazerConfirmacaoDaLojaNovaNaTransacao(");
  assert.ok(
    iChama > 0 && iChama < listas.indexOf("const vivo = await c.query("),
  );
  const viva1643 = ler("tests/banco/as-listas-dos-ajustes-viva.cjs");
  const main = viva1643.slice(viva1643.indexOf("async function main()"));
  const iDesfaz = main.indexOf("desfazerConfirmacaoDaLojaNovaNaTransacao(");
  assert.ok(
    iDesfaz > 0 && iDesfaz < main.indexOf('"a 1643 no ar"'),
    "a prova da 1643 tira esta antes",
  );
});

Deno.test("1652: as consultas da cadeia (203a, 60a, 47a, 40a, 8e e 9a) aceitam o corpo desta como sucessor", () => {
  const consulta = (n: string) => ler(`scripts/publicacao/consultas/${n}.sql`);
  for (const n of [
    "203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado",
    "60a-conferir-estilo-card-frete-aplicado",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
    "40a-conferir-identidade-legal-da-loja-aplicado",
  ])
    assert.ok(consulta(n).includes(`'${H_NOVO}'`), n);
  assert.ok(
    consulta("8e-conferir-92-a-202-aplicado").includes(
      `('upsert_store_config', '${H_NOVO}', '20261652000000')`,
    ),
  );
  assert.ok(
    consulta("9a-conferir-60-a-66-aplicado").includes(
      `('upsert_store_config', '${H_NOVO}')`,
    ),
  );
  // As fichas desta: 208a (depois) e 208b (antes), so catalogo.
  const a = consulta(
    "208a-conferir-a-loja-nova-confirma-entrega-e-pagamento-aplicado",
  );
  const b = consulta(
    "208b-antes-a-loja-nova-confirma-entrega-e-pagamento-base-vigente",
  );
  assert.ok(a.includes(`'${H_NOVO}'`));
  assert.ok(b.includes(`'${H_ANTES}'`) && b.includes(`'${H_NOVO}'`));
  for (const c of [a, b]) {
    assert.ok(
      !/\bFROM\s+public\.store_config\b/i.test(c),
      "so catalogo, nenhuma linha lida",
    );
  }
});

Deno.test("1652: a prova viva roda no job do dinheiro e tem linha no LEIA-ME", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nova-confirma-entrega-e-pagamento-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-loja-nova-confirma-entrega-e-pagamento-viva.cjs",
    ),
  );
});
