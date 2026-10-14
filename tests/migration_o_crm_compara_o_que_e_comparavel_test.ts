// @ts-nocheck
// O CRM COMPARA O QUE E COMPARAVEL — prova offline do par 20261227000000 + rollback (numeros do painel;
// ordem do dono de 14/10/2026). O COMPORTAMENTO (cada cenario da taxa de devolucao, o corte na mesma hora,
// formato, ACL, travas de admin, rollback, pre-voo) e' provado em tests/banco/numeros-do-painel-viva.cjs e o
// portao da release em tests/banco/numeros-do-painel-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261199000000 com SO as quatro trocas declaradas (nada mais); o corpo
// do rollback tem de ser o da 20261199000000 BYTE A BYTE; os atributos (SECURITY DEFINER, STABLE,
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
const NOME = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
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

const H_VIGENTE = "7f6ec1bc0fa9f40591c0b577201b7c36";
const H_NOVO = "c33073503fccc6caa5f1085265501eae";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.crm_visao(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.crm_visao(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao de crm_visao");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// As quatro trocas, uma por uma: o corpo novo e' EXATAMENTE o vigente com elas.
const TROCAS = [
  [
    "  v_fim_ts timestamptz;\n  v_res jsonb;\nBEGIN",
    "  v_fim_ts timestamptz;\n" +
      "  v_hoje date := public.fin__hoje();\n" +
      "  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;\n" +
      "  v_res jsonb;\nBEGIN",
  ],
  [
    "  ), anterior AS (\n    SELECT * FROM v WHERE v.dia BETWEEN v_ant_inicio AND v_ant_fim\n",
    "  ), anterior AS (\n" +
      "    -- Período que termina HOJE: hoje só vai até agora, então o último dia do anterior\n" +
      "    -- também só vale até a MESMA hora (20261227000000). Fora disso, dias inteiros.\n" +
      "    SELECT * FROM v WHERE v.dia BETWEEN v_ant_inicio AND v_ant_fim\n" +
      "       AND (p_fim <> v_hoje OR v.dia < v_ant_fim\n" +
      "            OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)\n",
  ],
  [
    "  ), devolvido AS (\n" +
      "    SELECT COALESCE(sum(r.amount), 0) AS valor FROM public.order_refunds r\n" +
      "     WHERE r.status = 'concluido' AND public.fin__dia(r.concluido_em) BETWEEN p_inicio AND p_fim\n" +
      "  ), devolvido_manual AS (\n" +
      "    SELECT COALESCE(sum(d.valor_reembolso), 0) AS valor FROM public.devolucoes d\n" +
      "     WHERE d.status = 'concluida' AND d.reembolso_manual AND public.fin__dia(d.concluida_em) BETWEEN p_inicio AND p_fim\n",
    "  ), turma AS (\n" +
      "    -- A turma da taxa de devolução: as vendas PAGAS no período, inclusive as que depois\n" +
      "    -- foram estornadas ou canceladas (a mesma régua de venda do Financeiro, fin__movimentos).\n" +
      "    -- Em cima só as devoluções DESSAS vendas: a taxa nunca passa de 100%.\n" +
      "    SELECT o.id, o.total::numeric AS total, o.payment_status\n" +
      "      FROM public.marketplace_orders o\n" +
      "     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')\n" +
      "       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL\n" +
      "       AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) BETWEEN p_inicio AND p_fim\n" +
      "  ), devolvido AS (\n" +
      "    -- Pedido estornado: o total voltou ao cliente (pelo app, fora dele ou no balcão). Senão, o\n" +
      "    -- que o ledger concluiu + o reembolso manual de devolução, nunca mais que o total do pedido.\n" +
      "    SELECT t.total,\n" +
      "           CASE WHEN t.payment_status = 'estornado' THEN t.total\n" +
      "                ELSE LEAST(t.total,\n" +
      "                           COALESCE((SELECT sum(r.amount) FROM public.order_refunds r\n" +
      "                                      WHERE r.order_id = t.id AND r.status = 'concluido'), 0)\n" +
      "                         + COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d\n" +
      "                                      WHERE d.order_id = t.id AND d.status = 'concluida' AND d.reembolso_manual), 0))\n" +
      "           END AS valor\n" +
      "      FROM turma t\n",
  ],
  [
    "                                     ELSE round(((SELECT valor FROM devolvido) + (SELECT valor FROM devolvido_manual)) / sum(total), 4) END\n" +
      "                           FROM atual)\n",
    "                                     ELSE round(sum(valor) / sum(total), 4) END\n" +
      "                           FROM devolvido)\n",
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

Deno.test("o corpo vigente e' o da 20261199000000 (md5 conhecido) e o corpo novo e' ele com SO as quatro trocas declaradas, md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
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
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as quatro trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE, "desfazer as trocas devolve o vigente");
  // o que NAO pode ter mudado: o formato do JSON (as chaves de cada bloco) e as duas travas de admin
  for (const chave of [
    "'receita_anterior'",
    "'pedidos_anterior'",
    "'ticket_medio_anterior'",
    "'taxa_devolucao'",
    "'canais'",
    "'formas'",
    "'funil'",
    "'pipeline'",
    "'segmentos'",
    "'pediu_nao_pagou'",
    "'nunca_comprou'",
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

Deno.test("a regra nova: o corte vale so quando o periodo termina hoje, so no ultimo dia do anterior e com <= (a venda na propria hora entra); a taxa nunca divide por zero e o pedido estornado conta o total", () => {
  assert.ok(
    CORPO_NOVO.includes(
      "AND (p_fim <> v_hoje OR v.dia < v_ant_fim\n            OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
    ),
  );
  // o fuso e' o fixo da casa, nunca o da sessao
  assert.ok(
    CORPO_NOVO.includes(
      "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;",
    ),
  );
  assert.ok(CORPO_NOVO.includes("v_hoje date := public.fin__hoje();"));
  assert.doesNotMatch(CORPO_NOVO, /::time\s*<\s*v_hora/);
  assert.ok(
    CORPO_NOVO.includes(
      "'taxa_devolucao', (SELECT CASE WHEN COALESCE(sum(total), 0) = 0 THEN 0",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes("WHEN t.payment_status = 'estornado' THEN t.total"),
  );
  assert.ok(CORPO_NOVO.includes("ELSE LEAST(t.total,"));
  // a regua de venda do Financeiro (fin__movimentos), e a do CRM nao entra aqui de proposito
  const fin = ler("20261177000000_o_financeiro_da_loja_nasce.sql");
  assert.ok(
    fin.includes(
      "'pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'",
    ) ||
      fin.includes(
        "'pago','pago_apos_expirar','recebido_na_entrega','estornado'",
      ),
    "a lista de payment_status da turma e' a de fin__movimentos",
  );
  // as CTEs antigas saíram: nenhum codigo morto empilhado
  assert.ok(!CORPO_NOVO.includes("devolvido_manual"));
  assert.ok(!CORPO_NOVO.includes("concluido_em"));
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261227000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(entrada.includes('funcao: "crm_visao"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;",
    "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
    "WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')",
    "WHEN t.payment_status = 'estornado' THEN t.total",
    "ELSE LEAST(t.total,",
    "AND d.status = 'concluida' AND d.reembolso_manual",
    "ELSE round(sum(valor) / sum(total), 4) END",
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
  assert.ok(!corpoDe(rollback).includes("turma"));
  assert.ok(!corpoDe(rollback).includes("v_hora"));
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
  // a assinatura original e' a da 20261199000000
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje e confere atributos, colunas e funcoes que o corpo novo le; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261227$");
  const fimPre = migration.indexOf("END $preflight_20261227$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261227$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.crm_visao(date,date)')",
    "md5(replace(prosrc, E'\\r', ''))",
    `('public.crm_visao(date,date)', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "'order_refunds.amount'",
    "'devolucoes.reembolso_manual'",
    "'marketplace_orders.pagamento_recebido_em'",
    "'public.fin__hoje()'",
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
    "p.provolatile = 's'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261227:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (so aceita o corpo desta migration, atributos, ACL) e conferencia (o corpo volta ao vigente); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261227$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261227$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_NOVO}'`));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a ordem de desfazer e o significado novo da taxa estao declarados no cabecalho; a 8e e o modulo das sucessoras conhecem a sucessora", () => {
  for (const trecho of [
    "SIGNIFICADO que muda",
    "ROLLBACK MANUAL",
    "ANTES do rollback da\n-- 20261199000000",
    "8e",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c8e.includes(`('crm_visao', '${H_NOVO}', '20261227000000')`));
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
});

Deno.test("so a baseline, a 20261199000000 e este par definem crm_visao com este contrato; depois da 20261183 ninguem mais a redefine alem das de sempre", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function public\.crm_visao\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});
