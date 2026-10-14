// @ts-nocheck
// A MEDIA DE AVALIACOES SO RESPONDE AO ADMINISTRADOR — prova offline do par 20261222000000 + rollback
// (permissao; ordem do dono de 14/10/2026). O COMPORTAMENTO por papel (anon 42501, nao-admin recusado pela
// guarda, admin e service_role com a MESMA linha de antes, rollback com o mesmo md5, pre-voo, conferencia,
// concorrencia) e' provado em tests/banco/media-de-avaliacoes-so-admin-viva.cjs, o portao da release em
// tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs e a lista de portas em
// tests/banco/portas-do-visitante-so-as-permitidas-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o antigo MAIS a guarda (nada mais), o corpo do rollback tem de ser o da
// baseline BYTE A BYTE (as linhas com espaco no fim sao a armadilha), os atributos (SECURITY DEFINER,
// VOLATILE, search_path, tipo de retorno) nao podem mudar, nenhum GRANT/REVOKE pode entrar (a ACL e' da
// 20261221000000), o pre-voo vem antes da troca e a conferencia depois, e o front nao pode quebrar pior.
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
  "20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_ANTIGO = "f7fb638c20dce1ae26509f4ffc563120";
const corpoDe = (sql, de = 0) => {
  const i = sql.indexOf("AS $$", de) + 5;
  return sql.slice(i, sql.indexOf("$$;", i));
};
const CORPO_ANTIGO = corpoDe(
  baseline,
  baseline.indexOf("CREATE FUNCTION public.get_reviews_metrics("),
);
const CORPO_NOVO = corpoDe(migration);
const H_NOVO = md5(CORPO_NOVO);
const GUARDA =
  "  -- Só o administrador lê a média e as contagens de TODAS as avaliações (as pendentes\n" +
  "  -- entram na conta). Mesma guarda da irmã get_admin_reviews_paged.\n" +
  "  IF NOT public.is_admin() THEN\n" +
  "    RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';\n" +
  "  END IF;\n\n";

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

Deno.test("o corpo antigo e' o da baseline (md5 conhecido, com linhas de espaco no fim) e o corpo novo e' ele MAIS a guarda, na primeira instrucao, e nada mais", () => {
  assert.equal(md5(CORPO_ANTIGO), H_ANTIGO);
  assert.ok(
    /[ \t]\n/.test(CORPO_ANTIGO),
    "a baseline tem linhas com espaco no fim (a armadilha do byte a byte)",
  );
  const esperado = CORPO_ANTIGO.replace(
    "BEGIN\n  IF p_search IS NOT NULL",
    `BEGIN\n${GUARDA}  IF p_search IS NOT NULL`,
  );
  assert.notEqual(esperado, CORPO_ANTIGO);
  assert.equal(CORPO_NOVO, esperado, "corpo novo = corpo antigo + a guarda");
  // tirando a guarda sobra o corpo antigo, byte a byte
  assert.equal(CORPO_NOVO.replace(GUARDA, ""), CORPO_ANTIGO);
  // a guarda e' a primeira instrucao depois do BEGIN, antes de qualquer leitura de dado
  assert.ok(
    CORPO_NOVO.indexOf("IF NOT public.is_admin() THEN") <
      CORPO_NOVO.indexOf("public_profiles"),
  );
  assert.ok(
    CORPO_NOVO.indexOf("IF NOT public.is_admin() THEN") <
      CORPO_NOVO.indexOf("FROM reviews"),
  );
  // a mesma mensagem da irma get_admin_reviews_paged (20261002000000)
  const irma = ler("20261002000000_kpis_de_avaliacoes_globais_de_verdade.sql");
  assert.ok(
    irma.includes(
      "RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';",
    ),
  );
  assert.ok(irma.includes("IF NOT public.is_admin() THEN"));
});

Deno.test("o rollback recria o corpo ANTIGO byte a byte (as linhas com espaco no fim sobrevivem), com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_ANTIGO);
  assert.equal(md5(corpoDe(rollback)), H_ANTIGO);
  for (const [sql, hashes] of [
    [migration, [H_ANTIGO, H_NOVO]],
    [rollback, [H_ANTIGO, H_NOVO]],
  ])
    for (const h of hashes) assert.ok(sql.includes(`'${h}'`), h);
  // o corpo do rollback nao tem a guarda
  assert.ok(!corpoDe(rollback).includes("is_admin"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER nem DML", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)\n" +
    " RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)\n" +
    " LANGUAGE plpgsql\n" +
    " SECURITY DEFINER\n" +
    " SET search_path TO 'public'\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(sql.split("\nCREATE OR REPLACE FUNCTION").length - 1, 1);
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const c = limpo(sql);
    assert.doesNotMatch(c, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(c, /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    assert.doesNotMatch(c, /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(c, /\bincrement_helpful\b/);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  // a assinatura original da baseline: mesmos nomes, padroes e retorno
  assert.ok(
    baseline.includes(
      'CREATE FUNCTION public.get_reviews_metrics("p_search" "text" DEFAULT NULL::"text", "p_rating" integer DEFAULT NULL::integer) RETURNS TABLE("average_rating" numeric, "total_verified" bigint, "total_replied" bigint)\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO \'public\'',
    ),
  );
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos e a ACL de depois da 20261221, confere atributos, is_admin e sobrecarga; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261222$");
  const fimPre = migration.indexOf("END $preflight_20261222$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261222$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "to_regprocedure('public.get_reviews_metrics(text,integer)')",
    "md5(replace(prosrc, E'\\r', ''))",
    `v_hash IS DISTINCT FROM '${H_ANTIGO}' AND v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer'",
    "pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)'",
    "<> 1",
    "to_regprocedure('public.is_admin()') IS NULL",
    "has_function_privilege((SELECT proowner FROM pg_proc WHERE oid = v_oid)",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico)",
    "aplique a 20261221000000 antes",
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
    "RAISE EXCEPTION 'conferencia 20261222:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (corpo conhecido, atributos, PUBLIC fechado) e conferencia (corpo volta ao antigo); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261222$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261222$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_ANTIGO}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.ok(rollback.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.doesNotMatch(limpo(rollback), /GRANT|REVOKE/i);
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
  for (const sql of [migration, rollback]) {
    for (const trecho of [
      "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
      "TO PUBLIC",
    ])
      assert.ok(sql.includes(trecho), trecho);
  }
  // a ordem de desfazer: o rollback desta vem ANTES do da 20261221000000
  assert.ok(migration.includes("ANTES do da 20261221"));
  assert.ok(rollback.includes("ANTES do rollback da 20261221000000"));
  // o cabecalho diz o que is_admin() faz em cada papel e a consequencia aceita do admin rebaixado
  for (const trecho of [
    "anon (visitante)",
    "authenticated NÃO-admin",
    "service_role",
    "sessão direta `postgres` SEM `SET ROLE`",
    "admin rebaixado continua lendo",
  ])
    assert.ok(migration.includes(trecho), trecho);
});

Deno.test("so a baseline define get_reviews_metrics, e nenhuma view, politica, gatilho ou funcao do banco a chama: os arquivos que a citam sao exatamente os esperados", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const citam = [];
  for (const n of todas) {
    if (n === NOME || n === `rollback-manual-${NOME}`) continue;
    if (/\bget_reviews_metrics\b/.test(removerRuido(ler(n)))) citam.push(n);
  }
  assert.deepEqual(citam.sort(), [
    "20260806000000_baseline_do_schema_vivo.sql", // a definicao (e a ACL)
    "20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql", // so REVOKE/lista de ACL
    "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql", // so ACL
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql", // so GRANT
    "rollback-manual-20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql", // so GRANT
  ]);
  // definicao so na baseline
  for (const n of todas) {
    if (
      n === "20260806000000_baseline_do_schema_vivo.sql" ||
      n === NOME ||
      n === `rollback-manual-${NOME}`
    )
      continue;
    assert.doesNotMatch(
      limpo(ler(n)),
      /(?:CREATE|REPLACE) FUNCTION public\.get_reviews_metrics\b/i,
      n,
    );
  }
});

Deno.test("o front: so o ramo NAO-admin de getAllReviews chama a RPC, e o erro dela so e' registrado (nao quebra a tela)", () => {
  const src = Deno.readTextFileSync(
    new URL("src/hooks/useReviews.ts", DIR),
  ).replace(/\r\n/g, "\n");
  assert.equal(
    src.split("get_reviews_metrics").length - 1,
    1,
    "um unico chamador",
  );
  const iChamada = src.indexOf("get_reviews_metrics");
  const iAdmin = src.indexOf("get_admin_reviews_paged");
  const iFallback = src.indexOf("Guest/Non-admin fallback flow");
  assert.ok(iAdmin > 0 && iFallback > iAdmin && iChamada > iFallback);
  // o ramo admin retorna antes do fallback
  const ramoAdmin = src.slice(src.indexOf("if (isAdmin) {"), iFallback);
  assert.ok(ramoAdmin.includes("return {"));
  // o erro da RPC de metricas: so console.error, nada de throw nem toast
  const trecho = src.slice(iChamada, src.indexOf("const formatted", iChamada));
  assert.ok(trecho.includes("else if (metricsError) {"));
  assert.ok(trecho.includes("console.error"));
  assert.doesNotMatch(trecho, /throw|toast/);
  // e nenhum outro lugar do app (nem edge function) a chama
  for (const raiz of ["src/", "supabase/functions/"]) {
    for (const f of walk(new URL(raiz, DIR))) {
      if (
        f.endsWith("src/hooks/useReviews.ts") ||
        f.endsWith("database.types.ts")
      )
        continue;
      const t = Deno.readTextFileSync(f);
      assert.ok(!t.includes("get_reviews_metrics"), f);
    }
  }
});

function* walk(url) {
  for (const e of Deno.readDirSync(url)) {
    const filho = new URL(e.name + (e.isDirectory ? "/" : ""), url);
    if (e.isDirectory) yield* walk(filho);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name))
      yield filho.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  }
}

Deno.test("a lista L8 diz o que o banco ficou: get_reviews_metrics 'logado' (so authenticated, volatil, SECURITY DEFINER), com o porque honesto; db-prove-grants-convergem e a 24a nao mudam (so ACL)", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
    ),
  ).funcoes;
  const m = lista.find(
    (l) =>
      l.funcao ===
      "public.get_reviews_metrics(p_search text, p_rating integer)",
  );
  assert.deepEqual(m.executa, ["authenticated"]);
  assert.equal(m.tipo, "volatil");
  assert.equal(m.secdef, true);
  assert.equal(m.situacao, "logado");
  assert.match(m.porque, /is_admin\(\)/);
  assert.match(m.porque, /20261222000000/);
  assert.match(m.porque, /20261221000000/);
  // o ALVO de ACL continua o da 20261221000000 (CREATE OR REPLACE preserva a ACL)
  const script = Deno.readTextFileSync(
    new URL("scripts/db-prove-grants-convergem.cjs", DIR),
  )
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ");
  assert.ok(
    script.includes(
      '"get_reviews_metrics(text,integer)": { PUBLIC: false, anon: false, authenticated: true, },',
    ),
  );
});
