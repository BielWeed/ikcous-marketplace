// @ts-nocheck
// A BUSCA DO CRM IGNORA ACENTO — prova offline do par 20261231000000 + rollback (aba Clientes do CRM; ordem da
// cacada de 14/10/2026). O COMPORTAMENTO (joao x Joao, maiuscula, NULL, o filtro de segmento nos tres grupos, o
// numero, o resto do JSON identico, ACL, rollback, pre-voo) e' provado em tests/banco/busca-de-clientes-viva.cjs e
// o portao da release em tests/banco/busca-de-clientes-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261199000000 com SO a troca declarada (as duas linhas do filtro); o
// corpo do rollback tem de ser o da 20261199000000 BYTE A BYTE; os atributos (SECURITY DEFINER, STABLE,
// search_path, retorno) e a ACL nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a
// conferencia depois; sem BEGIN/COMMIT de nivel superior; o formato do JSON e' o mesmo.
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
const NOME = "20261231000000_a_busca_do_crm_ignora_acento.sql";
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

const H_VIGENTE = "d5823a661555bcee3813ab32aeee9117";
const H_NOVO = "9c4268178a50729b5f7b256b77882585";
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

// A troca (uma so): as duas linhas do filtro de texto passam por f_unaccent nos dois lados.
const TROCA = [
  "            OR COALESCE(nome_exibido, '') ILIKE '%' || v_busca || '%'\n" +
    "            OR COALESCE(email, '') ILIKE '%' || v_busca || '%'\n",
  "            -- Sem acento nos dois lados (f_unaccent, a mesma da busca de pedidos):\n" +
    '            -- "joao" acha "João" e "Joao" acha "João".\n' +
    "            OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')\n" +
    "            OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')\n",
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

Deno.test("o corpo vigente e' o da 20261199000000 (md5 conhecido) e o corpo novo e' ele com SO a troca declarada, md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  const [de, para] = TROCA;
  assert.equal(
    CORPO_VIGENTE.split(de).length - 1,
    1,
    "o trecho antigo existe UMA vez",
  );
  const esperado = CORPO_VIGENTE.replace(de, () => para);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + a troca");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(para, () => de),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // o que NAO pode ter mudado: o formato do JSON, o ramo do numero, a ordenacao, a paginacao e as duas travas
  for (const trecho of [
    "'total', (SELECT count(*) FROM filtrado),",
    "'clientes', COALESCE((",
    "'chave', b.chave, 'user_id', b.user_id, 'nome', b.nome_exibido, 'whatsapp', b.whatsapp, 'email', b.email,",
    "'valor_em_aberto', b.valor_em_aberto, 'cadastrado_em', b.cadastrado_em",
    ") ORDER BY b.grupo ASC, b.receita DESC, b.ordem_data DESC, b.chave ASC)",
    "LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200)",
    "OFFSET GREATEST(COALESCE(p_offset, 0), 0)) b), '[]'::jsonb)",
    "WHERE (p_segmento IS NULL OR segmento = p_segmento)",
    "AND (v_busca IS NULL",
    "OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'))",
    "v_digitos := NULLIF(regexp_replace(COALESCE(v_busca, ''), '\\D', '', 'g'), '');",
    "FROM public.crm__clientes_rfm(now()) c",
    "FROM public.crm__pedidos_nao_pagos(now()) np",
    "FROM public.crm__nunca_comprou(now()) nc",
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

Deno.test("a regra nova: nome e e-mail passam por f_unaccent nos DOIS lados, com COALESCE do lado da coluna (NULL nunca coincide) e o ILIKE (maiuscula) mantido; o ramo do numero nao leva f_unaccent", () => {
  assert.ok(
    CORPO_NOVO.includes(
      "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes(
      "OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    ),
  );
  // nenhum ILIKE cru de nome/e-mail sobrou
  assert.doesNotMatch(
    removerRuido(CORPO_NOVO),
    /COALESCE\((nome_exibido|email), ''\) ILIKE '%'/,
  );
  // o wrapper e' o da casa (IMMUTABLE, 20261068000000), nunca unaccent() cru (search_path = public)
  assert.doesNotMatch(removerRuido(CORPO_NOVO), /[^.]\bunaccent\(/);
  const wrapper = ler(
    "20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql",
  );
  assert.match(wrapper, /FUNCTION public\.f_unaccent\(/);
  assert.match(wrapper, /IMMUTABLE/);
  assert.match(wrapper, /STRICT/);
  // o ramo do numero (so digitos, 4 ou mais) segue sem f_unaccent
  assert.ok(
    CORPO_NOVO.includes("COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'"),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261231000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(entrada.includes('funcao: "crm_clientes"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    "OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')",
    "OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'))",
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
  assert.ok(!corpoDe(rollback).includes("f_unaccent"));
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
  // a assinatura original e' a da 20261199000000
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje, confere atributos, funcoes que o corpo chama (e que f_unaccent RESPONDE); a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261231$");
  const fimPre = migration.indexOf("END $preflight_20261231$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261231$");
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
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "'public.f_unaccent(text)'",
    "'public.crm__clientes_rfm(timestamptz)'",
    "'public.crm__pedidos_nao_pagos(timestamptz)'",
    "'public.crm__nunca_comprou(timestamptz)'",
    "'public.fin__dia(timestamptz)'",
    "'public.is_admin()'",
    "'public.is_admin_atual()'",
    "public.f_unaccent('João Álvaro Çedilha') IS DISTINCT FROM 'Joao Alvaro Cedilha'",
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
    "p.provolatile = 's'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261231:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o vigente, atributos, ACL) e conferencia (o corpo volta ao vigente); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261231$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261231$");
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

Deno.test("a ordem de desfazer e o custo aceito estao declarados no cabecalho; a 8e e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "ANTES do rollback da 20261199000000",
    "ACEITO",
    "mais lento",
    "8e",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c8e.includes(`('crm_clientes', '${H_NOVO}', '20261231000000')`));
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
});

Deno.test("so a baseline, a 20261199000000 e este par definem crm_clientes com este contrato; depois da 20261199000000 ninguem mais a redefine alem deste par", () => {
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
