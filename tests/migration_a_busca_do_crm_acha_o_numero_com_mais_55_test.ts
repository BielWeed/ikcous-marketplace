// @ts-nocheck
// A BUSCA DO CRM ACHA O NUMERO COM O +55 — prova offline do par 20261392100000 + rollback (aba Clientes do CRM;
// cacada de 26/10/2026). O COMPORTAMENTO ("5534999991234" acha a cliente guardada como 34999991234, o numero sem
// o 55 continua achando, DDD 55 com 11 digitos nao perde o 55, o resto do JSON identico, rollback, pre-voo,
// consultas 102a/102b) e' provado em tests/banco/a-busca-do-crm-acha-o-numero-com-mais-55-viva.cjs. Aqui fica o
// que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261231000000 com SO o corte declarado; o corpo do rollback tem de ser o
// da 20261231000000 BYTE A BYTE; os atributos (SECURITY DEFINER, STABLE, search_path) e a ACL nao podem mudar;
// o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior.
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
const NOME = "20261392100000_a_busca_do_crm_acha_o_numero_com_mais_55.sql";
const VIGENTE = "20261231000000_a_busca_do_crm_ignora_acento.sql";
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

const H_VIGENTE = "9c4268178a50729b5f7b256b77882585";
const H_NOVO = "39a2a6de59041e09b6f1e466a6782dca";
const ASSINATURA = "public.crm_clientes(text,text,integer,integer)";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.crm_clientes(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.crm_clientes(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao de crm_clientes");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

const LINHA_DIGITOS =
  "  v_digitos := NULLIF(regexp_replace(COALESCE(v_busca, ''), '\\D', '', 'g'), '');\n";
// A troca (uma so): depois da linha que calcula v_digitos, o corte do 55.
const CORTE_DO_55 =
  "  -- Com 12 ou 13 digitos que comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai antes de\n" +
  "  -- comparar: o WhatsApp do CRM e so digitos e o cadastro guarda o numero sem o 55 (a mesma regra da busca\n" +
  "  -- de clientes, 20261230000000). Um numero guardado COM o 55 continua casando (a comparacao e 'contem').\n" +
  "  IF length(v_digitos) IN (12, 13) AND left(v_digitos, 2) = '55' THEN\n" +
  "    v_digitos := substr(v_digitos, 3);\n" +
  "  END IF;\n";
const TROCA = [LINHA_DIGITOS, `${LINHA_DIGITOS}${CORTE_DO_55}`];

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

Deno.test("o corpo vigente e' o da 20261231000000 (md5 conhecido) e o corpo novo e' ele com SO o corte declarado, md5 dos dois conhecido; desfazer a troca devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  const [de, para] = TROCA;
  assert.equal(
    CORPO_VIGENTE.split(de).length - 1,
    1,
    "o trecho antigo existe UMA vez",
  );
  const esperado = CORPO_VIGENTE.replace(de, () => para);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + o corte");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(para, () => de),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // o que NAO pode ter mudado: o formato do JSON, a busca sem acento, o ramo do numero, ordem e paginacao
  for (const trecho of [
    "'total', (SELECT count(*) FROM filtrado),",
    "'clientes', COALESCE((",
    ") ORDER BY b.grupo ASC, b.receita DESC, b.ordem_data DESC, b.chave ASC)",
    "LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200)",
    "OFFSET GREATEST(COALESCE(p_offset, 0), 0)) b), '[]'::jsonb)",
    "WHERE (p_segmento IS NULL OR segmento = p_segmento)",
    "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    "OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    "OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'))",
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

Deno.test("a regra nova e' a MESMA da busca de clientes (20261230000000): so 12 ou 13 digitos que comecam por 55; vem DEPOIS de v_digitos e ANTES de qualquer comparacao", () => {
  const corte =
    "IF length(v_digitos) IN (12, 13) AND left(v_digitos, 2) = '55' THEN";
  const regra230 = ler(
    "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql",
  );
  assert.ok(
    regra230.includes(
      "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    ),
  );
  const iCalc = CORPO_NOVO.indexOf(LINHA_DIGITOS);
  const iCorte = CORPO_NOVO.indexOf(corte);
  const iUso = CORPO_NOVO.indexOf("LIKE '%' || v_digitos || '%'");
  assert.ok(iCalc >= 0 && iCorte > iCalc && iUso > iCorte);
  // so um corte (nada de cortar duas vezes) e o resto e' substr a partir do 3o digito
  assert.equal(CORPO_NOVO.split(corte).length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("v_digitos := substr(v_digitos, 3);").length - 1,
    1,
  );
  // 11 digitos (DDD 55 + celular) nao entra no corte
  assert.doesNotMatch(
    CORPO_NOVO,
    /IN \([^)]*\b11\b[^)]*\) AND left\(v_digitos/,
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261392100000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  //", i));
  assert.ok(entrada.includes('funcao: "crm_clientes"'));
  const pares = [
    ...entrada.matchAll(/texto:\s*"((?:[^"\\]|\\.)*)",\s*vezes:\s*(\d+)/g),
  ].map((m) => [JSON.parse(`"${m[1]}"`), Number(m[2])]);
  assert.equal(pares.length, 5, "cinco marcadores");
  for (const [texto, vezes] of pares) {
    assert.equal(vezes, 1, texto);
    assert.equal(CORPO_NOVO.split(texto).length - 1, 1, texto);
  }
  // o corte NAO existe no corpo da 231: sem a troca, a entrada reprova
  assert.ok(!CORPO_VIGENTE.includes("v_digitos := substr(v_digitos, 3);"));
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261231000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("substr(v_digitos, 3)"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.crm_clientes(p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)\n" +
    " RETURNS jsonb\n" +
    " LANGUAGE plpgsql\n" +
    " STABLE SECURITY DEFINER\n" +
    " SET search_path TO 'public'\n" +
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
    assert.doesNotMatch(fora, /\b(VOLATILE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 231 e o desta), a ACL de hoje e confere atributos e argumentos; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261392100000$");
  const fimPre = migration.indexOf("END $preflight_20261392100000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261392100000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${ASSINATURA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `('${ASSINATURA}', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo NAO aceita o corpo da 20261199000000 (a cadeia e' 99 -> 231 -> esta)
  assert.ok(!pre.includes("d5823a661555bcee3813ab32aeee9117"));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 's'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261392100000:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o da 231, atributos, ACL) e conferencia (o corpo volta ao da 231); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261392100000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261392100000$");
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
    "Este rollback vem ANTES do rollback da 20261231000000",
    "DDD 55",
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
  assert.ok(c8e.includes(`('crm_clientes', '${H_NOVO}', '20261392100000')`));
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

Deno.test("depois da 20261231000000 so este par redefine crm_clientes", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function public\.crm_clientes\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});
