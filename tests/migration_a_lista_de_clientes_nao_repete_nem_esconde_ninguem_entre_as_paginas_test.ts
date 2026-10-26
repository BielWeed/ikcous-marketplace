// @ts-nocheck
// A LISTA DE CLIENTES NAO REPETE NEM ESCONDE NINGUEM ENTRE AS PAGINAS — prova offline do par 20261392000000 +
// rollback (tela Clientes do painel, busca do balcao e do cupom exclusivo; cacada de 26/10/2026). O COMPORTAMENTO
// (as paginas 0, 1 e 2 lidas por conexoes e planos diferentes devolvem cada cliente UMA vez; o corpo anterior
// repete e esconde; o conjunto achado e o total nao mudam; rollback, pre-voo, consultas 101a/101b) e' provado em
// tests/banco/a-lista-de-clientes-nao-repete-ninguem-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261230000000 com SO o desempate declarado (nada mais); o corpo do
// rollback tem de ser o da 20261230000000 BYTE A BYTE; os atributos e a ACL nao podem mudar (nenhum
// GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql";
const VIGENTE =
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "d6c092c3e0d8069891af795147d65e9e";
const H_NOVO = "1c71829d75e3d8f17bf7fb01019c05ec";
const ASSINATURA =
  "public.get_admin_customers_paged(text,text,text,integer,integer)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(";
  assert.equal(
    sql.split(marca).length - 1,
    1,
    "uma definicao de get_admin_customers_paged",
  );
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// A troca (uma so): o ultimo termo do ORDER BY de sorted_data ganha o desempate pelo id.
const TROCA = [
  "            END DESC\n    ),\n    paginated_data AS (\n",
  "            END DESC,\n" +
    "            -- Desempate pelo id (unico): sem ele, quem empata no criterio escolhido (toda conta nova\n" +
    "            -- tem total 0) sai numa ordem que pode mudar de uma chamada para outra, e a paginacao por\n" +
    "            -- OFFSET repete a mesma cliente em duas paginas e esconde outra (20261392000000).\n" +
    "            id\n    ),\n    paginated_data AS (\n",
];

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o corpo vigente e' o da 20261230000000 (md5 conhecido) e o corpo novo e' ele com SO o desempate declarado, md5 dos dois conhecido; desfazer a troca devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  const [de, para] = TROCA;
  assert.equal(
    CORPO_VIGENTE.split(de).length - 1,
    1,
    "o trecho antigo existe UMA vez",
  );
  const esperado = CORPO_VIGENTE.replace(de, () => para);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + o desempate");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(para, () => de),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // o que NAO pode ter mudado: o formato do JSON, as travas, a busca (texto, digitos, corte do 55), a paginacao
  for (const trecho of [
    "'data', v_data,",
    "'total_count', v_total_count,",
    "'stats', v_stats",
    "'total_customers', v_global_total_customers,",
    "'global_orders', v_global_orders",
    "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    "(length(v_search_digitos) >= 4 AND (",
    "unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state",
    "LIMIT p_page_size",
    "OFFSET v_offset",
    "END ASC,",
  ])
    assert.equal(
      CORPO_NOVO.split(trecho).length,
      CORPO_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  assert.equal(CORPO_NOVO.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
});

Deno.test("a regra nova: o desempate e' o ULTIMO termo do ORDER BY de sorted_data (a ordem escolhida continua mandando) e e' o id, unico em sorted_data", () => {
  const iSorted = CORPO_NOVO.indexOf("sorted_data AS (");
  const iPag = CORPO_NOVO.indexOf("paginated_data AS (");
  assert.ok(iSorted > 0 && iPag > iSorted);
  const sorted = CORPO_NOVO.slice(iSorted, iPag);
  const iOrder = sorted.indexOf("ORDER BY");
  assert.ok(iOrder > 0, "sorted_data tem ORDER BY");
  const termos = removerRuido(sorted.slice(iOrder)).replace(/\s+/g, " ").trim();
  // o ultimo termo, antes do fecha-parenteses do CTE, e' `id` sozinho (crescente)
  assert.match(termos, /END DESC, id \),\s*$/);
  // o id vem de profiles (p.id e' a chave primaria; o GROUP BY e' por p.id): uma linha por cliente
  assert.ok(CORPO_NOVO.includes("GROUP BY p.id, u.email"));
  // nenhum outro ORDER BY do corpo mudou
  assert.equal(
    CORPO_NOVO.split("ORDER BY").length,
    CORPO_VIGENTE.split("ORDER BY").length,
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261392000000 (sem ela a migration sai PULADA, codigo 2) e cada contagem bate com o corpo novo", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  //", i));
  assert.ok(entrada.includes('funcao: "get_admin_customers_paged"'));
  const pares = [
    ...entrada.matchAll(/texto:\s*"((?:[^"\\]|\\.)*)",\s*vezes:\s*(\d+)/g),
  ].map((m) => [JSON.parse(`"${m[1]}"`), Number(m[2])]);
  assert.equal(pares.length, 5, "cinco marcadores");
  for (const [texto, vezes] of pares)
    assert.equal(CORPO_NOVO.split(texto).length - 1, vezes, texto);
  // o marcador do desempate NAO existe no corpo da 230: sem a troca, a entrada reprova
  assert.equal(CORPO_VIGENTE.split("END DESC,").length - 1, 2);
  assert.ok(!CORPO_VIGENTE.includes("(20261392000000)"));
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261230000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("Desempate pelo id"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public, extensions); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public', 'extensions'\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(corpoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 230 e o desta), a ACL de hoje e confere atributos e argumentos; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261392$");
  const fimPre = migration.indexOf("END $preflight_20261392$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261392$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${ASSINATURA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `('${ASSINATURA}', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 'v'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public, extensions']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_sort_field text DEFAULT ''created_at''::text, p_sort_direction text DEFAULT ''desc''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo NAO aceita o corpo da 20261199000000 (a cadeia e' 99 -> 230 -> esta)
  assert.ok(!pre.includes("3c4a0fc4ca6f5d1c9a017a38bff2ec49"));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261392:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o da 230, atributos, ACL) e conferencia (o corpo volta ao da 230); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261392$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261392$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`('${ASSINATURA}', '${H_VIGENTE}', '${H_NOVO}')`));
  assert.ok(pre.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer esta declarada no cabecalho; a 8e, a 32a e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "Este rollback vem ANTES do rollback da 20261230000000",
    "NÃO RESOLVE",
    "8e",
    "32a",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(
    c8e.includes(
      `('get_admin_customers_paged', '${H_NOVO}', '20261392000000')`,
    ),
  );
  const c32a = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/32a-conferir-busca-de-clientes-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c32a.includes(`WHEN f.m = '${H_NOVO}' THEN '${H_VIGENTE}'`));
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
});

Deno.test("depois da 20261230000000 so este par redefine get_admin_customers_paged", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function public\.get_admin_customers_paged\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});
