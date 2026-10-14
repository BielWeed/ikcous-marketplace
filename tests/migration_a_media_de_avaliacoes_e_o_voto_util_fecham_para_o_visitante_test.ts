// @ts-nocheck
// A MEDIA DE AVALIACOES E O VOTO "UTIL" FECHAM PARA O VISITANTE — prova offline do par 20261221000000 +
// rollback (menor privilegio, ordem do dono de 14/10/2026). O COMPORTAMENTO (anon recebe 42501 nas duas,
// authenticated chega ao corpo, so a ACL das duas muda, dados intactos, rollback identico, pre-voo,
// conferencia, atomicidade entre as duas funcoes, concorrencia) e' provado em
// tests/banco/avaliacoes-fechadas-ao-visitante-viva.cjs, e a lista de portas em
// tests/banco/portas-do-visitante-so-as-permitidas-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corte e' so ACL (nada de DROP nem de corpo novo: desfazer e' um GRANT); as DUAS funcoes
// fecham juntas ou nenhuma; REVOKE que so avisa (grantor diferente) passa calado sem a conferencia;
// reaplicar tem de ser idempotente; o rollback nao pode abrir PUBLIC; o ALVO do script de convergencia
// de grants e a lista L8 tem de dizer o mesmo que o banco.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const comandos = (s) =>
  limpo(s)
    .split(";")
    .map((x) => x.trim())
    .filter((x) => /^(GRANT|REVOKE)\b/i.test(x));
const METRICAS = "public.get_reviews_metrics(text, integer)";
const VOTO = "public.increment_helpful(uuid)";

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

Deno.test("a migration so tem REVOKE de PUBLIC e anon e GRANT a authenticated, nas duas funcoes; nada de DROP, CREATE, ALTER, DML nem service_role", () => {
  assert.deepEqual(comandos(migration), [
    `REVOKE EXECUTE ON FUNCTION ${METRICAS} FROM PUBLIC, anon`,
    `GRANT EXECUTE ON FUNCTION ${METRICAS} TO authenticated`,
    `REVOKE EXECUTE ON FUNCTION ${VOTO} FROM PUBLIC, anon`,
    `GRANT EXECUTE ON FUNCTION ${VOTO} TO authenticated`,
  ]);
  const sql = limpo(migration);
  assert.doesNotMatch(
    sql,
    /\b(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
  assert.ok(comandos(migration).every((c) => !/service_role/.test(c)));
});

Deno.test("o pre-voo vem antes de qualquer REVOKE, cobre as DUAS funcoes e recusa ACL fora das duas conhecidas", () => {
  const i = migration.indexOf("DO $preflight_20261221$");
  const fim = migration.indexOf("END $preflight_20261221$;");
  assert.ok(i >= 0 && fim > i);
  assert.ok(
    fim < migration.indexOf("REVOKE EXECUTE ON FUNCTION"),
    "pre-voo antes",
  );
  const p = migration.slice(i, fim);
  for (const trecho of [
    "'public.get_reviews_metrics(text,integer)'",
    "'public.increment_helpful(uuid)'",
    "to_regprocedure(v_fn) IS NULL",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_fn, 'EXECUTE')",
    "has_function_privilege('authenticated', v_fn, 'EXECUTE')",
    "has_function_privilege('service_role', v_fn, 'EXECUTE')",
    "(NOT v_public AND v_anon AND v_auth AND v_servico)",
    "(NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(p.includes(trecho), trecho);
});

Deno.test("a conferencia final usa aclexplode (PUBLIC) E has_function_privilege (heranca) e RECUSA se PUBLIC/anon alcancam ou se authenticated/service_role deixaram de executar, nas duas funcoes", () => {
  const i = migration.indexOf("DO $conferencia_20261221$");
  assert.ok(i > migration.lastIndexOf("GRANT EXECUTE ON FUNCTION"));
  const c = migration.slice(i);
  for (const trecho of [
    "'public.get_reviews_metrics(text,integer)'",
    "'public.increment_helpful(uuid)'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_fn, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_fn, 'EXECUTE')",
    "RAISE EXCEPTION",
  ])
    assert.ok(c.includes(trecho), trecho);
  for (const sql of [migration, rollback])
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
});

Deno.test("o rollback e SO GRANT EXECUTE a anon nas duas funcoes (nada a PUBLIC, nada a authenticated, nada de DROP/CREATE), com pre-voo e conferencia", () => {
  assert.deepEqual(comandos(rollback), [
    `GRANT EXECUTE ON FUNCTION ${METRICAS} TO anon`,
    `GRANT EXECUTE ON FUNCTION ${VOTO} TO anon`,
  ]);
  assert.doesNotMatch(limpo(rollback), /\b(DROP|CREATE|ALTER)\b/i);
  assert.ok(rollback.includes("DO $preflight_rollback_20261221$"));
  assert.ok(rollback.includes("DO $conferencia_rollback_20261221$"));
  assert.ok(rollback.includes("g.grantee = 0"), "PUBLIC continua fechado");
});

Deno.test("o aviso do rollback da 20261090500000 (GRANT TO PUBLIC) esta no cabecalho da migration E do rollback, e e' verdade", () => {
  const r1090 = ler(
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
  );
  assert.ok(
    r1090.includes(
      "GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text,integer) TO PUBLIC;",
    ),
  );
  assert.ok(
    r1090.includes(
      "GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO PUBLIC;",
    ),
  );
  for (const sql of [migration, rollback]) {
    for (const trecho of [
      "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
      "TO PUBLIC",
      "DEPOIS",
    ])
      assert.ok(sql.includes(trecho), trecho);
  }
});

Deno.test("nenhuma migration FORA do par mexe no EXECUTE das duas funcoes depois da 20261090500000: o corte e' o unico a tirar o anon, e nada reabre o anon por mecanismo automatico", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const quemMexe = [];
  for (const n of todas) {
    if (n === NOME || n === `rollback-manual-${NOME}`) continue;
    const sql = removerRuido(ler(n));
    if (
      /\b(GRANT|REVOKE)\b[^;]*\b(get_reviews_metrics|increment_helpful)\b/i.test(
        sql,
      ) ||
      /\bDROP\s+FUNCTION\b[^;]*\b(get_reviews_metrics|increment_helpful)\b/i.test(
        sql,
      )
    )
      quemMexe.push(n);
  }
  // so a clone-grants (REVOKE de PUBLIC, sem tocar anon) e o rollback dela (GRANT a PUBLIC, manual)
  assert.deepEqual(quemMexe.sort(), [
    "20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
  ]);
  // e a 20261090500000 nunca da GRANT (so REVOKE): rodar de novo nao devolve o anon
  const m1090 = removerRuido(
    ler("20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql"),
  );
  for (const f of ["get_reviews_metrics", "increment_helpful"])
    assert.doesNotMatch(m1090, new RegExp(`GRANT[^;]*${f}`, "i"));
});

Deno.test("o ALVO de scripts/db-prove-grants-convergem.cjs fecha o anon nas duas (e mantem authenticated)", () => {
  // Lido como TEXTO, nunca via require(): o script e' um CLI que abre conexao de banco.
  const script = Deno.readTextFileSync(
    new URL("scripts/db-prove-grants-convergem.cjs", DIR),
  )
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ");
  for (const f of [
    "get_reviews_metrics(text,integer)",
    "increment_helpful(uuid)",
  ])
    assert.ok(
      script.includes(
        `"${f}": { PUBLIC: false, anon: false, authenticated: true, },`,
      ),
      f,
    );
});

Deno.test("a lista L8 diz o que o banco ficou: increment_helpful 'logado' (so authenticated); get_reviews_metrics 'tolerada' so authenticated, com o follow-up de admin no porque", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
    ),
  ).funcoes;
  const voto = lista.find(
    (l) => l.funcao === "public.increment_helpful(review_id uuid)",
  );
  assert.deepEqual(voto.executa, ["authenticated"]);
  assert.equal(voto.situacao, "logado");
  const metricas = lista.find(
    (l) =>
      l.funcao ===
      "public.get_reviews_metrics(p_search text, p_rating integer)",
  );
  assert.deepEqual(metricas.executa, ["authenticated"]);
  assert.equal(metricas.situacao, "tolerada");
  assert.match(metricas.porque, /is_admin/);
});
