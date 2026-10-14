// @ts-nocheck
// O INICIO COMPARA ATE A MESMA HORA — prova offline do par 20261228000000 + rollback (numeros do painel;
// ordem do dono de 14/10/2026). O COMPORTAMENTO (a semana passada cortada na mesma hora de hoje, o chip em 0%
// e nao em -66,7%, formato, ACL, travas de admin, rollback, pre-voo) e' provado em
// tests/banco/numeros-do-painel-viva.cjs e o portao da release em tests/banco/numeros-do-painel-portao-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261212000000 (o do lote 17, com a regra de estoque baixo) com SO as
// duas trocas declaradas; o corpo do rollback tem de ser o da 20261212000000 BYTE A BYTE; os atributos e a ACL
// nao podem mudar (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT
// de nivel superior; o formato do JSON e' o mesmo.
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
const NOME = "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql";
const VIGENTE =
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql";
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

const H_VIGENTE = "f11d22d076c59ab54d1beb280954dd15";
const H_NOVO = "ad5620273997ba9266f240f272bf399b";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.painel_inicio(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.painel_inicio(";
  assert.equal(
    sql.split(marca).length - 1,
    1,
    "uma definicao de painel_inicio",
  );
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// As duas trocas: o corpo novo e' EXATAMENTE o vigente com elas.
const TROCAS = [
  [
    "  v_mes_ant_fim date;\n  v_lucro numeric;\n",
    "  v_mes_ant_fim date;\n" +
      "  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;\n" +
      "  v_lucro numeric;\n",
  ],
  [
    "      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje - 7)\n",
    "      -- Hoje só vai até agora: a semana passada também, até a MESMA hora (20261228000000).\n" +
      "      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v\n" +
      "                                  WHERE dia = v_hoje - 7\n" +
      "                                    AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)\n",
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

Deno.test("o corpo vigente e' o da 20261212000000 (md5 conhecido) e o corpo novo e' ele com SO as duas trocas declaradas, md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
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
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as duas trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE, "desfazer as trocas devolve o vigente");
  // o que NAO pode ter mudado: as chaves do JSON (as quatro secoes do Inicio e o resto) e as travas de admin
  for (const chave of [
    "'hoje'",
    "'receita'",
    "'receita_semana_passada'",
    "'mes'",
    "'receita_mes_anterior'",
    "'estoque_baixo'",
    "'a_receber_7d'",
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
  // a regra de estoque baixo do lote 17 sobrevive
  assert.ok(CORPO_NOVO.includes("<= COALESCE(p.estoque_minimo, 5))"));
});

Deno.test("a regra nova: so a semana passada de HOJE e' cortada, com <= (a venda na propria hora entra), no fuso fixo da casa, nunca no da sessao; o mes e o resto do Inicio nao mudam", () => {
  assert.ok(
    CORPO_NOVO.includes(
      "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes(
      "WHERE dia = v_hoje - 7\n                                    AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
    ),
  );
  assert.doesNotMatch(CORPO_NOVO, /::time\s*<\s*v_hora/);
  // o corte aparece UMA vez no codigo: o mes (receita_mes_anterior) segue comparando os mesmos dias
  assert.equal(CORPO_NOVO.split("<= v_hora").length - 1, 1);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261228000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(entrada.includes('funcao: "painel_inicio"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;",
    "AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
    "<= COALESCE(p.estoque_minimo, 5))",
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
  assert.ok(!corpoDe(rollback).includes("v_hora"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.painel_inicio()\n" +
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

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje e confere atributos, colunas e funcoes que o corpo novo le; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261228$");
  const fimPre = migration.indexOf("END $preflight_20261228$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261228$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.painel_inicio()')",
    "md5(replace(prosrc, E'\\r', ''))",
    `('public.painel_inicio()', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = ''",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "<> 1",
    "'produtos.estoque_minimo'",
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
    "RAISE EXCEPTION 'conferencia 20261228:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (so aceita o corpo desta migration) e conferencia (o corpo volta ao vigente, atributos e ACL intactos); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261228$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261228$");
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

Deno.test("a cadeia 99 -> 12 -> 28 esta declarada: o cabecalho cita a ordem de desfazer, a 8e aceita a 28 como sucessora e a 17a aceita o corpo dela ao lado do da 12", () => {
  for (const trecho of ["ROLLBACK MANUAL", "20261212000000", "ANTES"])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c8e.includes(`('painel_inicio', '${H_NOVO}', '20261228000000')`));
  assert.ok(
    c8e.includes(
      "('painel_inicio', 'f11d22d076c59ab54d1beb280954dd15', '20261212000000')",
    ),
  );
  const sucessoras = Deno.readTextFileSync(
    new URL("tests/banco/sucessoras-da-99.cjs", DIR),
  );
  assert.ok(sucessoras.includes(NOME));
  const c17a = Deno.readTextFileSync(
    new URL(
      "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
      DIR,
    ),
  );
  assert.ok(c17a.includes("20261228"), "a 17a cita a 20261228000000");
});

Deno.test("so a baseline, a 20261199000000, a 20261212000000 e este par definem painel_inicio; depois da 20261212 ninguem mais a redefine", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > "20261212000000" &&
      /create (?:or replace )?function public\.painel_inicio\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});
