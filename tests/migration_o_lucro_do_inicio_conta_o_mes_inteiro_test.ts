// @ts-nocheck
// O LUCRO DO INICIO CONTA O MES INTEIRO — prova offline do par 20261390000000 + rollback (decisao do socio de 26/10/2026).
// O COMPORTAMENTO (o "Lucro estimado" do Inicio bate com o fin_dre do Financeiro no mes inteiro: despesa PREVISTA no ultimo dia
// entra, a de outro mes e a cancelada nao; fevereiro, 30 e 31 dias; a virada do ano; o resto do Inicio nao muda; pre-voo, ACL,
// rollback e idempotencia) e' provado em tests/banco/crm-inicio-viva.cjs (prova (e)) e em
// tests/banco/o-lucro-do-inicio-conta-o-mes-inteiro-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261228000000 com SO as duas trocas declaradas (a variavel v_mes_fim e a janela do
// fin_dre do lucro); o corpo do rollback tem de ser o da 20261228000000 BYTE A BYTE; os atributos e a ACL nao podem mudar
// (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT de nivel superior; o formato
// do JSON e' o mesmo; a funcao alimenta a tela inicial de TODAS as lojas, entao um erro de copia derruba o Inicio.
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
const NOME = "20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql";
const VIGENTE = "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "ad5620273997ba9266f240f272bf399b";
const H_NOVO = "b4aa318b777824bd49aab4175d9133f8";

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
    "  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;\n  v_lucro numeric;\n",
    "  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;\n  v_mes_fim date;\n  v_lucro numeric;\n",
  ],
  [
    "  v_lucro := (public.fin_dre(v_mes_inicio, v_hoje) ->> 'lucro_liquido')::numeric;\n",
    '  -- O lucro estimado conta o MÊS INTEIRO (dia 1 até o último dia), previstos inclusos: a conta do "Mês atual"\n' +
      "  -- do Financeiro (20261390000000). Os demais números do mês seguem até hoje. Aritmética de DATA (sem fuso):\n" +
      "  -- primeiro dia + 1 mês - 1 dia = 28/29 em fevereiro, 30 ou 31 nos outros meses.\n" +
      "  v_mes_fim := (v_mes_inicio + interval '1 month')::date - 1;\n" +
      "  v_lucro := (public.fin_dre(v_mes_inicio, v_mes_fim) ->> 'lucro_liquido')::numeric;\n",
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

Deno.test("o corpo vigente e' o da 20261228 (md5 conhecido) e o corpo novo e' ele com SO as duas trocas declaradas, md5 dos dois conhecido; trocar de volta devolve o vigente byte a byte", () => {
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
  // o que NAO pode ter mudado: as chaves do JSON (as secoes do Inicio) e as travas de admin
  for (const chave of [
    "'hoje'",
    "'receita'",
    "'receita_semana_passada'",
    "'mes'",
    "'receita_mes_anterior'",
    "'lucro_estimado'",
    "'saldo_total'",
    "'a_receber_7d'",
    "'a_pagar_7d'",
    "'contas_vencidas'",
    "'pendencias'",
    "'estoque_baixo'",
    "'serie_14d'",
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
  // a regra de estoque baixo do lote 17 e o corte da semana passada da 228 sobrevivem
  assert.ok(CORPO_NOVO.includes("<= COALESCE(p.estoque_minimo, 5))"));
  assert.equal(CORPO_NOVO.split("<= v_hora").length - 1, 1);
});

Deno.test("a regra nova: SO o lucro estimado vai ate o ultimo dia do mes (aritmetica de data, sem fuso); receita, pedidos e ticket do mes seguem ate hoje", () => {
  assert.ok(
    CORPO_NOVO.includes(
      "v_mes_fim := (v_mes_inicio + interval '1 month')::date - 1;",
    ),
  );
  assert.ok(
    CORPO_NOVO.includes(
      "v_lucro := (public.fin_dre(v_mes_inicio, v_mes_fim) ->> 'lucro_liquido')::numeric;",
    ),
  );
  // a janela antiga (ate hoje) nao sobra em lugar nenhum do codigo
  assert.ok(!CORPO_NOVO.includes("fin_dre(v_mes_inicio, v_hoje)"));
  assert.equal(CORPO_NOVO.split("public.fin_dre(").length - 1, 1);
  // v_mes_fim so e' lido pelo lucro; as vendas do mes continuam de v_mes_inicio ate v_hoje
  // declaracao, atribuicao e a leitura pelo fin_dre: tres ocorrencias, nenhuma outra
  assert.equal(CORPO_NOVO.split("v_mes_fim").length - 1, 3);
  assert.equal(
    CORPO_NOVO.split("BETWEEN v_mes_inicio AND v_hoje").length - 1,
    3,
    "receita, pedidos e ticket do mes seguem ate hoje",
  );
  assert.equal(
    CORPO_NOVO.split("BETWEEN v_mes_inicio AND v_hoje").length,
    CORPO_VIGENTE.split("BETWEEN v_mes_inicio AND v_hoje").length,
  );
  // o mes anterior compara os mesmos dias e a serie de 14 dias termina hoje: intocados
  assert.ok(
    CORPO_NOVO.includes(
      "v_mes_ant_fim := LEAST(v_mes_ant_inicio + (v_hoje - v_mes_inicio), v_mes_inicio - 1);",
    ),
  );
  assert.ok(CORPO_NOVO.includes("generate_series((v_hoje - 13)::timestamp"));
  // a data final nao depende da sessao: nada de date_trunc nem now() na linha nova
  const linha = CORPO_NOVO.split("\n").find((l) =>
    l.startsWith("  v_mes_fim :="),
  );
  assert.doesNotMatch(linha, /date_trunc|now\(\)|CURRENT_DATE/i);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261390000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = lerRepo("scripts/db-apply.cjs");
  const i = src.indexOf(`"${NOME}": {`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  },", i));
  assert.ok(entrada.includes('funcao: "painel_inicio"'));
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "v_mes_fim date;",
    "v_mes_fim := (v_mes_inicio + interval '1 month')::date - 1;",
    "v_lucro := (public.fin_dre(v_mes_inicio, v_mes_fim) ->> 'lucro_liquido')::numeric;",
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
  assert.ok(!corpoDe(rollback).includes("v_mes_fim"));
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

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje e confere atributos, dono, funcoes que o corpo le e fotografa o registro inteiro; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261390$");
  const fimPre = migration.indexOf("END $preflight_20261390$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261390$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  // so SET LOCAL de timeout antes do pre-voo (nada que escreva)
  assert.ok(
    migration.indexOf("SET LOCAL lock_timeout = '5s';") >= 0 &&
      migration.indexOf("SET LOCAL lock_timeout = '5s';") < iPre,
  );
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.painel_inicio()')",
    "md5(replace(p.prosrc, E'\\r', ''))",
    `('public.painel_inicio()', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = ''",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))",
    "<> 1",
    "'public.fin_dre(date,date)'",
    "'public.fin__hoje()'",
    "'public.is_admin_atual()'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "to_jsonb(p) - 'prosrc'",
    "set_config('ikcous.inicio390_atributos'",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.inicio390_atributos')::jsonb",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261390:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (so aceita o corpo desta migration) e conferencia (o corpo volta ao vigente, atributos e ACL intactos); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261390$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261390$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_NOVO}'`));
  assert.ok(pre.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("g.grantee = 0") || pre.includes("a.grantee = 0"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(
    conf.includes(
      "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.inicio390_atributos')::jsonb",
    ),
  );
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a cadeia 99 -> 12 -> 28 -> 390 esta declarada: o cabecalho cita a ordem de desfazer, a 8e, a 17a e a 30a aceitam a 390 como sucessora, e a lista de sucessoras da 99 a inclui", () => {
  for (const trecho of ["ROLLBACK MANUAL", "20261228000000", "ANTES"])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRepo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(c8e.includes(`('painel_inicio', '${H_NOVO}', '20261390000000')`));
  assert.ok(
    c8e.includes(`('painel_inicio', '${H_VIGENTE}', '20261228000000')`),
  );
  const sucessoras = lerRepo("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  const c17a = lerRepo(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  assert.ok(c17a.includes("20261390"), "a 17a cita a 20261390000000");
  const c30a = lerRepo(
    "scripts/publicacao/consultas/30a-conferir-numeros-do-painel-aplicado.sql",
  );
  assert.ok(c30a.includes(`'${H_NOVO}'`), "a 30a aceita o corpo da 390");
  const c30b = lerRepo(
    "scripts/publicacao/consultas/30b-antes-numeros-do-painel-corpos-vigentes.sql",
  );
  assert.ok(!c30b.includes(H_NOVO), "a 30b (o ANTES) nunca cita a 390");
});

Deno.test("so a baseline, a 20261199, a 20261212, a 20261228 e este par definem painel_inicio; depois da 20261228 ninguem mais a redefine", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > "20261228000000" &&
      /create (?:or replace )?function public\.painel_inicio\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});

Deno.test("publicacao: lote unico de apply normal (97a/97b), rol fechado de 4 linhas, consultas so leem catalogo e citam os md5 certos, registrado nos dois workflows", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261390000000"),
  );
  assert.equal(lote.length, 1, "UM lote para a 20261390000000");
  assert.deepEqual(lote[0].versoes, ["20261390000000"]);
  assert.equal(
    lote[0].consulta,
    "97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado",
  );
  assert.equal(
    lote[0].ausenciaConfirmadaPor,
    "97b-antes-o-lucro-do-inicio-conta-o-mes-inteiro-base-vigente",
  );
  assert.ok(!("backfillLedger" in lote[0]) && !("nuncaAplicar" in lote[0]));
  const a = lerRepo(`scripts/publicacao/consultas/${lote[0].consulta}.sql`);
  const b = lerRepo(
    `scripts/publicacao/consultas/${lote[0].ausenciaConfirmadaPor}.sql`,
  );
  assert.ok(a.includes(`'${H_NOVO}'`) && !a.includes(`'${H_VIGENTE}'`));
  assert.ok(b.includes(`'${H_VIGENTE}'`) && !b.includes(`'${H_NOVO}'`));
  for (const sql of [a, b]) {
    const semComentarios = limpo(sql);
    assert.doesNotMatch(
      semComentarios,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      semComentarios,
      /\bFROM\s+(public\.)?(marketplace_orders|fin_lancamentos|profiles|produtos)\b/i,
    );
    assert.ok(sql.includes("md5(replace(p.prosrc, chr(13), ''))"));
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [lote[0].consulta, lote[0].ausenciaConfirmadaPor]) {
    // eslint-disable-next-line security/detect-object-injection -- `nome` vem do lote literal lido do JSON do repositorio.
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    assert.equal(rol.length, 4, `${nome}: rol fechado de 4 linhas`);
    for (const item of rol)
      assert.ok(
        (nome.startsWith("97a") ? a : b).includes(`'${item}'`),
        `${nome}: item "${item}" fora do .sql`,
      );
  }
  assert.ok(
    lerRepo("scripts/frota/publicar-release.mjs").includes(
      `"${lote[0].consulta}"`,
    ),
  );
  for (const wf of [
    ".github/workflows/conferir-banco-da-loja.yml",
    ".github/workflows/rpc-ci.yml",
  ]) {
    const yaml = lerRepo(wf);
    assert.ok(yaml.includes(lote[0].consulta), `${wf}: falta a 97a`);
    assert.ok(
      yaml.includes(lote[0].ausenciaConfirmadaPor),
      `${wf}: falta a 97b`,
    );
  }
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "tests/banco/o-lucro-do-inicio-conta-o-mes-inteiro-viva.cjs",
    ),
    "o rpc-ci roda a prova viva da 390",
  );
});
