// @ts-nocheck
// A BUSCA DE CLIENTES ACHA PELO NUMERO DO WHATSAPP — prova offline do par 20261230000000 + rollback
// (tela Clientes, balcao e cupom exclusivo; ordem da cacada de 14/10/2026). O COMPORTAMENTO (cada forma de
// digitar o numero, o corte do 55, o termo curto, o resto do JSON identico, ACL, rollback, pre-voo) e' provado
// em tests/banco/busca-de-clientes-viva.cjs e o portao da release em tests/banco/busca-de-clientes-portao-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261199000000 com SO as tres trocas declaradas (nada mais); o corpo do
// rollback tem de ser o da 20261199000000 BYTE A BYTE; os atributos (SECURITY DEFINER, VOLATILE, search_path,
// retorno) e a ACL nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois;
// sem BEGIN/COMMIT de nivel superior; o formato do JSON e' o mesmo.
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
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql";
const VIGENTE = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
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

const H_VIGENTE = "3c4a0fc4ca6f5d1c9a017a38bff2ec49";
const H_NOVO = "d6c092c3e0d8069891af795147d65e9e";
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

// As tres trocas, uma por uma: o corpo novo e' EXATAMENTE o vigente com elas.
const TROCAS = [
  [
    "    v_clean_search TEXT;\nBEGIN\n",
    "    v_clean_search TEXT;\n    v_search_digitos TEXT;\nBEGIN\n",
  ],
  [
    "    v_clean_search := TRIM(p_search);\n",
    "    v_clean_search := TRIM(p_search);\n" +
      '    -- So os digitos do que a pessoa digitou (o WhatsApp e\' gravado MASCARADO, "(34) 99999-1234", e a\n' +
      "    -- comparacao crua de texto nunca casava quem digitava so os numeros). Com 12 ou 13 digitos que\n" +
      "    -- comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai: o cadastro nao o guarda.\n" +
      "    v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');\n" +
      "    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN\n" +
      "        v_search_digitos := substr(v_search_digitos, 3);\n" +
      "    END IF;\n",
  ],
  [
    "                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR\n",
    "                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR\n" +
      "                -- TELEFONE por DIGITOS, nos dois lados, so com 4 ou mais digitos (a mesma regra da\n" +
      "                -- busca de pedidos e do CRM: com menos, um digito solto casaria quase todo mundo).\n" +
      "                (length(v_search_digitos) >= 4 AND (\n" +
      "                    regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%' OR\n" +
      "                    regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'\n" +
      "                )) OR\n",
  ],
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

Deno.test("o corpo vigente e' o da 20261199000000 (md5 conhecido) e o corpo novo e' ele com SO as tres trocas declaradas, md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  let esperado = CORPO_VIGENTE;
  for (const [de, para] of TROCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `o trecho antigo existe UMA vez: ${de.slice(0, 60)}`,
    );
    esperado = esperado.replace(de, () => para);
  }
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as tres trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE, "desfazer as trocas devolve o vigente");
  // o que NAO pode ter mudado: o formato do JSON, as duas travas de admin, as buscas de texto de antes
  for (const trecho of [
    "'data', v_data,",
    "'total_count', v_total_count,",
    "'stats', v_stats",
    "'total_customers', v_global_total_customers,",
    "'new_customers_30d', v_global_new_customers_30d,",
    "'global_ltv', v_global_ltv,",
    "'global_orders', v_global_orders",
    "unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR",
    "unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')",
    "v_clean_search = '' OR (",
    "GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state",
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

Deno.test("a regra nova: so a partir de 4 digitos, nos dois lados (WhatsApp do perfil e telefone da conta), o 55 so sai com 12 ou 13 digitos e o texto de antes continua; cliente sem WhatsApp nunca da erro (COALESCE)", () => {
  // o piso de 4 digitos (a mesma regra da busca de pedidos): com menos, nada muda
  assert.ok(CORPO_NOVO.includes("length(v_search_digitos) >= 4 AND ("));
  assert.doesNotMatch(
    CORPO_NOVO,
    /length\(v_search_digitos\)\s*>=\s*[0-35-9]\b/,
  );
  // o corte do 55 vale so para 12 ou 13 digitos que COMECAM por 55
  assert.ok(
    CORPO_NOVO.includes(
      "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes("v_search_digitos := substr(v_search_digitos, 3);"),
  );
  // os dois lados da comparacao, nos dois campos, sempre por digitos e sempre com COALESCE
  assert.ok(
    CORPO_NOVO.includes(
      "regexp_replace(COALESCE(p.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes(
      "regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_search_digitos || '%'",
    ),
  );
  // e' um OR a MAIS: a busca de antes nao foi trocada nem tirada
  assert.ok(
    CORPO_NOVO.includes(
      "unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR\n" +
        "                -- TELEFONE por DIGITOS",
    ),
  );
  // a variavel nasce nula-segura: a busca vazia continua devolvendo todo mundo (v_clean_search = '')
  assert.ok(CORPO_NOVO.includes("v_clean_search = '' OR ("));
  assert.ok(
    CORPO_NOVO.includes(
      "v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');",
    ),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261230000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(entrada.includes('funcao: "get_admin_customers_paged"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "v_search_digitos TEXT;",
    "v_search_digitos := regexp_replace(COALESCE(v_clean_search, ''), '[^0-9]', '', 'g');",
    "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN",
    "(length(v_search_digitos) >= 4 AND (",
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ]) {
    assert.ok(entrada.includes(trecho), trecho);
    assert.equal(CORPO_NOVO.split(trecho).length - 1, 1, trecho);
  }
});

Deno.test("o rollback recria o corpo VIGENTE byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("v_search_digitos"));
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
  // a assinatura original e' a da 20261199000000
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje e confere atributos, colunas e funcoes que o corpo novo le; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261230$");
  const fimPre = migration.indexOf("END $preflight_20261230$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261230$");
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
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "'public.profiles.whatsapp'",
    "'auth.users.phone'",
    "'public.is_admin()'",
    "'public.is_admin_atual()'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
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
    "RAISE EXCEPTION 'conferencia 20261230:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o vigente, atributos, ACL) e conferencia (o corpo volta ao vigente); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261230$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261230$");
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

Deno.test("a ordem de desfazer e o aceite (so cresce) estao declarados no cabecalho; a 8e e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "ANTES do rollback da\n-- 20261199000000",
    "ACEITO",
    "MAIOR, nunca menor",
    "8e",
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
      `('get_admin_customers_paged', '${H_NOVO}', '20261230000000')`,
    ),
  );
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
});

Deno.test("so a baseline, a 20261199000000 e este par definem get_admin_customers_paged com este contrato; depois da 20261199000000 ninguem mais a redefine alem deste par", () => {
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
