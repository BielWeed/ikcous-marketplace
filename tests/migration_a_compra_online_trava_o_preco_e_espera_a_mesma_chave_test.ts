// @ts-nocheck
// Prova estática da 20261350000000 (a compra online trava o preço-base, tranca o carrinho numa ordem global e a mesma
// chave de idempotência espera a primeira).
// O comportamento e o rollback de verdade rodam no Postgres efêmero (tests/banco/compra-online-travas-viva.cjs).
/* eslint-disable security/detect-object-injection --
 * Os índices vêm de listas fechadas deste arquivo (V23, V24, HASH_244, HASH_NOVO) e de contadores, nunca de entrada de
 * rede; as migrations e as consultas lidas são do próprio repositório. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const nome =
  "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql";
const nome244 = "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql";
const A81 = "81a-conferir-compra-online-trava-preco-e-chave-aplicado";
const B81 = "81b-antes-compra-online-trava-preco-e-chave-base-vigente";
const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const HASH_244 = {
  [V23]: "79445d64a87843be2d42bf601c7090ec",
  [V24]: "85c37af4baa2f5ce1375bdd9e943c746",
};
const HASH_NOVO = {
  [V23]: "6b71cb823967518955407b532904ae91",
  [V24]: "e3c124d25632aaa9bcf1995153bc5a7e",
};
function ler(rel: string) {
  try {
    return Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
      /\r\n/g,
      "\n",
    );
  } catch {
    return "";
  }
}
const migration = () => ler(`supabase/migrations/${nome}`);
const rollback = () => ler(`supabase/migrations/rollback-manual-${nome}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
/** O corpo da declaração de `fn` (entre os delimitadores `$function$`). */
function corpo(sql: string, fn: string) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(inicio >= 0, `funcao ausente: ${fn}`);
  const ab = sql.indexOf("$function$", inicio) + "$function$".length;
  return sql.slice(ab, sql.indexOf("$function$", ab));
}
/** A cabeça da declaração (assinatura, atributos), até o delimitador. */
function cabeca(sql: string, fn: string) {
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  return sql.slice(inicio, sql.indexOf("$function$", inicio));
}
const TRAVA =
  "PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pedido_online:' || p_idempotency_key::text, 0));";
const INI_ORDEM = "-- >>> ordem global das travas (20261350000000)";
const FIM_ORDEM = "-- <<< ordem global das travas (20261350000000)";
const DECLARES_DA_ORDEM = [
  "v_trava_variantes uuid[] := ARRAY[]::uuid[];",
  "v_trava_produtos uuid[] := ARRAY[]::uuid[];",
];
// O código do bloco da ordem global (aparado), na ordem em que aparece: ids do carrinho -> variações por id -> produtos por id.
const LINHAS_DA_ORDEM = [
  "FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)",
  "LOOP",
  "BEGIN",
  "v_product_id := (v_item->>'product_id')::uuid;",
  "v_variant_id := (v_item->>'variant_id')::uuid;",
  "EXCEPTION WHEN invalid_text_representation THEN",
  "CONTINUE;",
  "END;",
  "IF v_product_id IS NOT NULL THEN",
  "v_trava_produtos := array_append(v_trava_produtos, v_product_id);",
  "END IF;",
  "IF v_variant_id IS NOT NULL THEN",
  "v_trava_variantes := array_append(v_trava_variantes, v_variant_id);",
  "END IF;",
  "END LOOP;",
  "IF cardinality(v_trava_variantes) > 0 THEN",
  "PERFORM 1",
  "FROM public.product_variants v",
  "WHERE v.id = ANY(v_trava_variantes)",
  "ORDER BY v.id",
  "FOR NO KEY UPDATE;",
  "END IF;",
  "IF cardinality(v_trava_produtos) > 0 THEN",
  "PERFORM 1",
  "FROM public.produtos p",
  "WHERE p.id = ANY(v_trava_produtos)",
  "ORDER BY p.id",
  "FOR NO KEY UPDATE;",
  "END IF;",
];

Deno.test("20261350 corpos: são os da 244 com SÓ as três edições (OF v, p; o advisory lock da chave; as variáveis e o bloco da ordem global), iguais nas duas funções; os hashes do arquivo são os dos corpos", () => {
  const sql = migration();
  assert(sql.length > 0, "migration ausente");
  const m244 = ler(`supabase/migrations/${nome244}`);
  const codigo = (l: string) => l.trim() !== "" && !l.trim().startsWith("--");
  for (const fn of [V23, V24]) {
    const antigo = corpo(m244, fn);
    const novo = corpo(sql, fn);
    assertEquals(md5(antigo), HASH_244[fn], `${fn}: corpo da 244`);
    assertEquals(md5(novo), HASH_NOVO[fn], `${fn}: corpo novo`);
    const a = antigo.split("\n").filter(codigo);
    const b = novo.split("\n").filter(codigo);
    // O bloco da ordem global: um só, entre dois marcadores, com o código EXATO do golden (e nada além).
    assertEquals(novo.split(INI_ORDEM).length - 1, 1, `${fn}: um bloco`);
    assertEquals(novo.split(FIM_ORDEM).length - 1, 1, `${fn}: um fim de bloco`);
    const iIni = novo.indexOf(INI_ORDEM);
    const iFim = novo.indexOf(FIM_ORDEM);
    assert(
      iIni < iFim && iFim < novo.indexOf("-- 3. Validation Loop"),
      `${fn}: o bloco vem antes do laço do passo 3`,
    );
    const bloco = novo.slice(iIni, iFim);
    assertEquals(
      bloco
        .split("\n")
        .filter(codigo)
        .map((l) => l.trim()),
      LINHAS_DA_ORDEM,
      `${fn}: o código do bloco é o golden`,
    );
    // As variações são trancadas ANTES dos produtos (a ordem que a trigger sync_produto_ultima_atualizacao já impõe ao
    // painel), cada grupo num único SELECT ordenado por id.
    assert(
      bloco.indexOf("public.product_variants v") <
        bloco.indexOf("public.produtos p"),
      `${fn}: variações antes dos produtos`,
    );
    // Sem o bloco e sem a trava da chave nem as variáveis, o código é o MESMO da 244, linha a linha.
    const semBloco = novo.slice(0, iIni) + novo.slice(iFim);
    const semAdicoes = semBloco
      .split("\n")
      .filter(codigo)
      .filter(
        (l) => l.trim() !== TRAVA && !DECLARES_DA_ORDEM.includes(l.trim()),
      );
    assertEquals(
      semAdicoes,
      a.map((l) =>
        l.trim() === "FOR NO KEY UPDATE OF v;"
          ? l.replace("OF v;", "OF v, p;")
          : l,
      ),
      `${fn}: só as três edições`,
    );
    assertEquals(
      b.length - a.length,
      1 + DECLARES_DA_ORDEM.length + LINHAS_DA_ORDEM.length,
      `${fn}: as linhas de código a mais`,
    );
    assertEquals(novo.split(TRAVA).length - 1, 1, `${fn}: um advisory lock`);
    assertEquals(novo.split("OF v, p;").length - 1, 1, `${fn}: um OF v, p`);
    assertEquals(novo.split("OF v;").length - 1, 0, `${fn}: nenhum OF v`);
    // A trava da chave é a PRIMEIRA coisa dentro do `IF p_idempotency_key IS NOT NULL`, antes da busca pela chave.
    const iTrava = novo.indexOf(TRAVA);
    assert(
      novo.lastIndexOf("IF p_idempotency_key IS NOT NULL THEN", iTrava) >= 0,
    );
    assert(iTrava < novo.indexOf("WHERE idempotency_key = p_idempotency_key"));
    // Declaração (assinatura, linguagem, SECURITY DEFINER, search_path): idêntica à da 244.
    assertEquals(
      cabeca(sql, fn),
      cabeca(m244, fn),
      `${fn}: a declaração mudou`,
    );
  }
  for (const fn of [V23, V24]) {
    assertEquals(
      sql.split(HASH_NOVO[fn]).length - 1 >= 3,
      true,
      "pré-voo, pós-voo e cabeçalho",
    );
    assertEquals(sql.split(HASH_244[fn]).length - 1 >= 2, true);
  }
});

Deno.test("20261350 migration: aditiva, sem transação própria, sem GRANT/REVOKE/DROP/DELETE/UPDATE, pré-voo antes da troca, pós-voo e NOTIFY depois", () => {
  const sql = migration();
  const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback(),
      temRollback: true,
    }).recusado,
    false,
  );
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql));
  // Fora dos CORPOS das funções (que escrevem pedido, item, estoque e cupom quando CHAMADOS) e fora dos comentários,
  // o arquivo não tem DDL de permissão nem escrita de dado: só os dois CREATE OR REPLACE, o pré-voo, o pós-voo e o NOTIFY.
  const fora = sql
    .replace(/\$function\$[\s\S]*?\$function\$/g, "")
    .replace(/^\s*--.*$/gm, "");
  assert(!/^\s*(?:GRANT|REVOKE|DROP|DELETE|TRUNCATE|ALTER)\s+/im.test(fora));
  assert(!/^\s*UPDATE\s+/im.test(fora), "nenhuma linha de dado é escrita");
  assert(!/^\s*INSERT\s+/im.test(fora));
  const pre = sql.indexOf("B1_BASELINE_DIVERGENT");
  const troca23 = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${V23}(`);
  const troca24 = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${V24}(`);
  const pos = sql.indexOf("POSVOO_20261350000000");
  const notify = sql.indexOf("NOTIFY pgrst, 'reload schema';");
  assert(
    pre >= 0 && pre < troca23 && troca23 < troca24 && troca24 < pos,
    "ordem",
  );
  assert(pos < notify);
  assertEquals(
    (sql.match(/^CREATE OR REPLACE FUNCTION/gm) ?? []).length,
    2,
    "só as duas funções",
  );
  assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
  // O pré-voo aceita exatamente DOIS corpos por função: o da 244 e o desta migration.
  assertStringIncludes(
    sql,
    `('public.${V23}(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '${HASH_244[V23]}', '${HASH_NOVO[V23]}')`,
  );
  assertStringIncludes(
    sql,
    `('public.${V24}(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '${HASH_244[V24]}', '${HASH_NOVO[V24]}')`,
  );
  assertStringIncludes(sql, "ARRAY['search_path=public']");
  assertStringIncludes(sql, "has_function_privilege('anon'");
  assertStringIncludes(sql, "has_function_privilege('authenticated'");
  assertStringIncludes(sql, "has_function_privilege('service_role'");
  // O pré-voo e o pós-voo conferem o mesmo conjunto de atributos que a 244 reescreve.
  assertStringIncludes(sql, "p.provolatile = 'v'");
  assertStringIncludes(sql, "p.prosecdef");
  // A 350 não redefine nenhum dos 42 corpos da 99 (só v23 e v24), mas o rollback da 244 recusa com o corpo novo no ar:
  // ela entra na cadeia de sucessoras (depois da 310, com os dois pares do pré-voo) para cair ANTES da 244.
  const suc = ler("tests/banco/sucessoras-da-99.cjs");
  assertStringIncludes(suc, `"${nome}",`);
  assert(
    new RegExp(`\\[\\s*"${nome}",\\s*2,?\\s*\\]`).test(suc),
    "a 350 declara 2 pares no preflight (v23 e v24)",
  );
  assert(
    suc.indexOf(`"${nome}",`) >
      suc.indexOf('"20261310000000_estilo_do_card_de_frete.sql",'),
    "a 350 vem depois da 310 na ordem de aplicação",
  );
});

Deno.test("20261350 rollback executavel: devolve os dois corpos da 244 byte a byte, recusa corpo desconhecido/já desfeito e termina com NOTIFY", () => {
  const sql = rollback();
  assert(sql.length > 0, "rollback-manual executavel ausente");
  const m244 = ler(`supabase/migrations/${nome244}`);
  for (const fn of [V23, V24]) {
    assertEquals(corpo(sql, fn), corpo(m244, fn), `${fn}: byte a byte`);
    assertEquals(md5(corpo(sql, fn)), HASH_244[fn]);
    assertEquals(cabeca(sql, fn), cabeca(m244, fn), `${fn}: a declaração`);
    assertStringIncludes(sql, `'${HASH_NOVO[fn]}'`); // o pré-voo exige o corpo desta migration
    assertStringIncludes(sql, `'${HASH_244[fn]}'`); // o pós-voo exige o da 244
  }
  assert(
    sql.indexOf("B1_BASELINE_DIVERGENT") <
      sql.indexOf(`CREATE OR REPLACE FUNCTION public.${V23}(`),
    "pré-voo antes da troca",
  );
  assertStringIncludes(sql, "POSVOO_ROLLBACK_20261350000000");
  assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql));
  assert(!/^\s*(?:GRANT|REVOKE|DROP)\s+/im.test(sql));
  assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
});

Deno.test("20261350 publicacao: lote unico de apply normal, DEPOIS da 244, vale para IKCOUS e Savy; as entradas novas vão no FIM da lista", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    (p) => p.versoes?.includes("20261350000000") || p.consulta === A81,
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A81);
  assertEquals(lotes[0].versoes, ["20261350000000"]);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B81);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(
      Object.entries(lotes[0]).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  // A 350 vem DEPOIS da 244; a 360 e a 370 foram anexadas logo depois dela
  // (lotes novos no fim, nesta ordem).
  const versoes = canais.provasDeObjetos.flatMap((p) => p.versoes ?? []);
  assert(versoes.indexOf("20261244000000") < versoes.indexOf("20261350000000"));
  assertEquals(
    canais.provasDeObjetos.slice(-3).map((p) => p.consulta),
    [
      A81,
      "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas",
      "83a-conferir-caixa-so-na-conta-da-loja-aplicado",
    ],
    "a 82a e a 83a sucedem a 81a no fim, sem reordenar lotes anteriores",
  );
  for (const loja of ["IKCOUS", "Savy"])
    assert(
      Object.values(canais.canais).some((c) => c.nome === loja && c.migrations),
    );
});

Deno.test("20261350 publicacao: as consultas 81a/81b trazem o corpo certo de cada lado; 31a, 37a e 47a aceitam o corpo novo como sucessor e as 'b' não o citam", () => {
  for (const [consulta, hashes, trava, lock] of [
    [A81, HASH_NOVO, "v23=2/1/0 v24=2/1/0", "v23=1 v24=1"],
    [B81, HASH_244, "v23=0/0/1 v24=0/0/1", "v23=0 v24=0"],
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    assert(sql.length > 0, consulta);
    assertStringIncludes(sql, `'${hashes[V23]}'`);
    assertStringIncludes(sql, `'${hashes[V24]}'`);
    assertStringIncludes(sql, `'${trava}'`);
    assertStringIncludes(sql, `'${lock}'`);
    assertStringIncludes(sql, "COALESCE");
    assertStringIncludes(sql, "vivo = esperado AS ok");
    assert(
      !/marketplace_orders|order_refunds|marketplace_order_items/.test(
        sql.replace(/^--.*$/gm, ""),
      ),
      "so catalogo: nao le pedido",
    );
  }
  const novos = Object.values(HASH_NOVO);
  const a31 = ler(
    "scripts/publicacao/consultas/31a-conferir-endereco-da-compra-fica-no-pedido.sql",
  );
  const a37 = ler(
    "scripts/publicacao/consultas/37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
  );
  const a47 = ler(
    "scripts/publicacao/consultas/47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
  );
  assertStringIncludes(a31, `'${HASH_NOVO[V23]}'`);
  assertStringIncludes(a31, `'${HASH_NOVO[V24]}'`);
  assertStringIncludes(a37, `'${HASH_NOVO[V24]}'`);
  assertStringIncludes(a47, `WHEN f.m = '${HASH_NOVO[V23]}'`);
  assertStringIncludes(a47, `WHEN f.m = '${HASH_NOVO[V24]}'`);
  // A 37a só tem a v24; a 31b/37b/47b (ANTES) não citam o corpo desta migration.
  assert(!a37.includes(HASH_NOVO[V23]));
  for (const b of [
    "31b-antes-endereco-da-compra-so-no-ponteiro",
    "37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente",
    "47b-antes-a-loja-escolhe-como-entrega-base-vigente",
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${b}.sql`);
    assert(sql.length > 0, b);
    for (const h of novos) assert(!sql.includes(h), `${b} cita ${h}`);
  }
});

Deno.test("20261350 publicacao: rois fechados, menu e gatilhos do CI registram os dois lados", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const workflow = ler(".github/workflows/rpc-ci.yml");
  for (const consulta of [A81, B81]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    const itens = [...sql.matchAll(/\bSELECT '([^']+)'/g)].map((m) => m[1]);
    const rol = Object.entries(ROL_FECHADO_POR_CONSULTA).find(
      ([chave]) => chave === consulta,
    )?.[1];
    assert(rol, `rol ausente: ${consulta}`);
    assertEquals(itens.length, 7);
    assertEquals([...rol].sort(), itens.sort());
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    const linhas = rol.map((item) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    for (const invalida of [
      linhas.slice(1),
      [...linhas.slice(1), linhas[1]],
      [...linhas, { ...linhas[0], item: "estranho" }],
    ])
      assert(estruturaDoRolFechado(invalida, rol) !== null);
    assertStringIncludes(
      ler(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    const caminho = `"scripts/publicacao/consultas/${consulta}.sql"`;
    assertEquals(workflow.split(caminho).length - 1, 2);
    for (const evento of ["pull_request", "push"]) {
      const bloco = workflow
        .split(`  ${evento}:`)[1]
        ?.split(/\n {2}[a-z_]+:|\n[a-z_]+:/)[0];
      assertStringIncludes(bloco, caminho);
    }
  }
});

Deno.test("20261350 prova viva e encadeamento: registrada no rpc-ci, na lista do dinheiro, no LEIA-ME e no db-apply; o helper da 244 desfaz a 350 ANTES", () => {
  const prova = "tests/banco/compra-online-travas-viva.cjs";
  const workflow = ler(".github/workflows/rpc-ci.yml");
  assertEquals(workflow.split(prova).length - 1, 1);
  assertStringIncludes(
    ler("tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts"),
    `"${prova}"`,
  );
  assertStringIncludes(
    ler("tests/banco/LEIA-ME.md"),
    "compra-online-travas-viva.cjs",
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[nome];
  assert(entrada, "a migration tem entrada em VERIFICACOES");
  assertEquals(entrada.map((e) => e.funcao).sort(), [V23, V24].sort());
  // O helper da 244 chama o da 350 antes de qualquer outra coisa, e as duas provas da 244 também.
  const h244 = ler("tests/banco/a-loja-escolhe-como-entrega-posterior.cjs");
  const chamada = h244.indexOf("desfazerCompraOnlineTravaNaTransacao(");
  assert(chamada > 0, "falta chamar a sucessora 350 no helper da 244");
  assert(chamada < h244.indexOf("ENTREGA_NA_CIDADE.noAr", chamada));
  assert(
    h244.lastIndexOf("estilo-card-frete-posterior.cjs") > chamada,
    "a 350 cai antes da 310 (estilo do card)",
  );
  for (const p of [
    "tests/banco/a-loja-escolhe-como-entrega-viva.cjs",
    "tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs",
  ])
    assertStringIncludes(
      ler(p),
      "a-compra-online-trava-posterior.cjs",
      `${p}: não desfaz a 350 antes de medir a 244`,
    );
  const helper = ler("tests/banco/a-compra-online-trava-posterior.cjs");
  for (const h of [...Object.values(HASH_NOVO), ...Object.values(HASH_244)])
    assertStringIncludes(helper, h);
  assertStringIncludes(helper, nome);
  assertStringIncludes(helper, "return false");
});
