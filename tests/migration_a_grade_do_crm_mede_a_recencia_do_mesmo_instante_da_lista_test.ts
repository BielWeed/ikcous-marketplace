// @ts-nocheck
// A GRADE DO CRM MEDE A RECENCIA DO MESMO INSTANTE DA LISTA — prova offline do par 20261232000000 + rollback
// (numeros do painel; cacada de 14/10/2026). O COMPORTAMENTO (cada virada de recencia, o conjunto, as outras tres
// chamadas, periodo que nao termina hoje, ACL, travas, rollback, pre-voo, concorrencia, mutantes) e' provado em
// tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs e o portao da release em
// tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261227000000 com UMA linha trocada (a ancora do periodo) e nada mais;
// o corpo do rollback tem de ser o da 20261227000000 BYTE A BYTE; os atributos (SECURITY DEFINER, STABLE,
// search_path, retorno) e a ACL nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes da troca (e recusa o
// corpo da 20261199000000: a 32 so vale depois da 27) e a conferencia depois; sem BEGIN/COMMIT de nivel superior.
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
  "20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql";
const NOME_27 = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration27 = ler(NOME_27);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_99 = "7f6ec1bc0fa9f40591c0b577201b7c36";
const H_VIGENTE = "c33073503fccc6caa5f1085265501eae"; // o corpo da 20261227000000
const H_NOVO = "0dfda3ea5129c6f8aabfcf0052fd2936";

const LINHA_VELHA =
  "v_fim_ts := ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');";
const LINHA_NOVA =
  "v_fim_ts := LEAST(((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'), now());";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.crm_visao(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.crm_visao(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao de crm_visao");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migration27);
const CORPO_NOVO = corpoDe(migration);

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

Deno.test("o corpo vigente e' o da 20261227000000 (md5 conhecido) e o corpo novo e' ele com UMA linha trocada (a ancora do periodo), md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  assert.equal(
    CORPO_VIGENTE.split(LINHA_VELHA).length - 1,
    1,
    "a linha antiga existe UMA vez",
  );
  const esperado = CORPO_VIGENTE.replace(LINHA_VELHA, () => LINHA_NOVA);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + a troca da linha");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(LINHA_NOVA, () => LINHA_VELHA),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
  // so UMA linha difere
  const a = CORPO_VIGENTE.split("\n");
  const b = CORPO_NOVO.split("\n");
  assert.equal(a.length, b.length);
  assert.equal(a.filter((l, i) => l !== b.at(i)).length, 1);
  // o que NAO pode ter mudado: o formato do JSON (as chaves) e as duas travas de admin
  for (const chave of [
    "'receita_anterior'",
    "'taxa_devolucao'",
    "'segmentos'",
    "'pediu_nao_pagou'",
    "'nunca_comprou'",
    "'receita_em_risco'",
  ])
    assert.equal(
      CORPO_NOVO.split(chave).length,
      CORPO_VIGENTE.split(chave).length,
      `a chave ${chave} mudou de numero de ocorrencias`,
    );
  assert.equal(CORPO_NOVO.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(
    CORPO_NOVO.split("IF NOT public.is_admin_atual() THEN").length - 1,
    1,
  );
});

Deno.test("a regra nova: UMA ancora (o menor entre a meia-noite de amanha e agora) para as QUATRO chamadas; nenhuma delas recebe outra ancora; o fuso e' o fixo da casa", () => {
  assert.equal(CORPO_NOVO.split(LINHA_NOVA).length - 1, 1);
  // a unica leitura de (p_fim + 1) e' a da ancora
  assert.equal(CORPO_NOVO.split("(p_fim + 1)").length - 1, 1);
  for (const chamada of [
    "public.crm__vendas(v_fim_ts)",
    "public.crm__clientes_rfm(v_fim_ts)",
    "public.crm__pedidos_nao_pagos(v_fim_ts)",
    "public.crm__nunca_comprou(v_fim_ts)",
  ])
    assert.equal(CORPO_NOVO.split(chamada).length - 1, 1, chamada);
  assert.equal(
    CORPO_NOVO.split("v_fim_ts").length - 1,
    6,
    "declaracao, atribuicao e as quatro chamadas",
  );
  // o fuso e' o fixo da casa, nunca o da sessao
  assert.ok(CORPO_NOVO.includes("AT TIME ZONE 'America/Sao_Paulo'"));
  // LEAST (nunca GREATEST) e now() (o MESMO instante que a lista usa)
  assert.doesNotMatch(CORPO_NOVO, /GREATEST\(/);
  assert.ok(!/clock_timestamp|statement_timestamp/i.test(CORPO_NOVO));
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261232000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1 no corpo novo", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  // o biome quebra a linha depois da chave (`"nome":\n    [`) por ela ser comprida: a entrada acaba em `\n    ],`
  const i = src.indexOf(`"${NOME}":`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n    ],", i));
  assert.ok(entrada.includes('funcao: "crm_visao"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    LINHA_NOVA,
    "public.crm__vendas(v_fim_ts)",
    "public.crm__clientes_rfm(v_fim_ts)",
    "public.crm__pedidos_nao_pagos(v_fim_ts)",
    "public.crm__nunca_comprou(v_fim_ts)",
    "ELSE LEAST(t.total,",
    "IF NOT public.is_admin() THEN",
    "IF NOT public.is_admin_atual() THEN",
  ]) {
    assert.ok(entrada.includes(trecho), trecho);
    assert.equal(CORPO_NOVO.split(trecho).length - 1, 1, trecho);
  }
  // a entrada da 27 segue valendo com o corpo novo (a cadeia: o `crm_visao` vivo pode ser o da 27 OU o da 32)
  const entrada27 = src.slice(
    src.indexOf(`"${NOME_27}": [`),
    src.indexOf("\n  ],", src.indexOf(`"${NOME_27}": [`)),
  );
  for (const m of entrada27.matchAll(/texto:\s*\n?\s*"([^"]+)"/g))
    assert.equal(
      CORPO_NOVO.split(m[1]).length,
      CORPO_VIGENTE.split(m[1]).length,
      `marcador da 27 mudou de contagem no corpo novo: ${m[1]}`,
    );
});

Deno.test("o rollback recria o corpo da 20261227000000 byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    assert.ok(
      sql.includes(`'${H_VIGENTE}', '${H_NOVO}')`),
      "o par (vigente, desta)",
    );
  assert.ok(!corpoDe(rollback).includes("LEAST(((p_fim + 1)"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)\n" +
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
  // a assinatura original e' a da 20261227000000
  assert.ok(migration27.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, recusa o da 20261199000000 com mensagem propria (a 27 vem antes), confere a ACL de hoje, atributos, colunas e funcoes; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261232$");
  const fimPre = migration.indexOf("END $preflight_20261232$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261232$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.crm_visao(date,date)')",
    "md5(replace(prosrc, E'\\r', ''))",
    `('public.crm_visao(date,date)', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    `= '${H_99}' THEN`,
    "aplique antes a 20261227000000",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "'public.crm__vendas(timestamptz)'",
    "'public.crm__clientes_rfm(timestamptz)'",
    "'public.crm__pedidos_nao_pagos(timestamptz)'",
    "'public.crm__nunca_comprou(timestamptz)'",
    "'public.fin__hoje()'",
    "'public.is_admin_atual()'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // o pre-voo recusa o corpo da 99 ANTES de olhar o par (a mensagem propria vem primeiro)
  assert.ok(pre.indexOf(`= '${H_99}' THEN`) < pre.indexOf("FOR r IN"));
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
    "RAISE EXCEPTION 'conferencia 20261232:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o vigente, atributos, ACL) e conferencia (o corpo volta ao da 27); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261232$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261232$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_NOVO}'`));
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

Deno.test("o cabecalho avisa a ORDEM (so depois da 20261227000000, que espera o dono), o que muda, o que nao muda, a ordem de desfazer e a cadeia da 8e; a 8e e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "ATENÇÃO — ORDEM DE APLICAÇÃO",
    "só pode ser APLICADA DEPOIS da 20261227000000",
    "AINDA ESPERA A DECISÃO DO DONO",
    "taxa de devolução",
    "NADA MUDA",
    "ROLLBACK MANUAL",
    "ANTES do rollback da 20261227000000",
    "20261199000000 → 20261227000000 → 20261232000000",
    "tuple concurrently updated",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c8e.includes(`('crm_visao', '${H_NOVO}', '20261232000000')`));
  assert.ok(c8e.includes(`('crm_visao', '${H_VIGENTE}', '20261227000000')`));
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
  // a ordem das sucessoras no modulo e' a de aplicacao (a de nome de arquivo)
  const nomes = [...sucessoras.matchAll(/"(2026\d{10}_[a-z0-9_]+\.sql)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual([...nomes].sort(), nomes, "NOMES em ordem de aplicacao");
});

Deno.test("so a baseline, a 20261199000000 e os dois pares (a 27 e a 32) definem crm_visao com este contrato", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > "20261199000000" &&
      /create (?:or replace )?function public\.crm_visao\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(
    posteriores.sort(),
    [
      NOME_27,
      NOME,
      `rollback-manual-${NOME_27}`,
      `rollback-manual-${NOME}`,
    ].sort(),
  );
});
