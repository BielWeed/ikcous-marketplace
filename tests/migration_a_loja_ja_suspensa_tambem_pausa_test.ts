// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A LOJA JA SUSPENSA TAMBEM PAUSA — leitura do TEXTO da 20261630000000 e do rollback dela.
// O COMPORTAMENTO (a marca pela porta real, a loja antiga que ganha o dia, o controle com a marca da 1600, os mutantes, reaplicar sem tocar dados,
// rollback, pre/pos-voo e as consultas 199a/199b/196a) e' provado no Postgres efemero por tests/banco/a-loja-ja-suspensa-tambem-pausa-viva.cjs;
// aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM backfill: so redefine public.marcar_suspensa_desde();
//   - o corpo novo e' o da 20261600000000 com UM ramo a mais (o resto byte a byte, comentario fora);
//   - os md5 do pre-voo, do pos-voo e do rollback sao os dos corpos que os arquivos carregam;
//   - o rollback devolve o bloco da 1600 BYTE A BYTE e passa a Fase 0 do db-prove-rollback.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261630000000_a_loja_ja_suspensa_tambem_pausa.sql";
const NOME_1600 = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m1600 = lerMig(NOME_1600);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const codigo = semComentario(migration);

const CABECALHO = "CREATE OR REPLACE FUNCTION public.marcar_suspensa_desde()";
/** O prosrc (o texto entre os $function$) da marca no arquivo. */
const corpoDe = (sql: string) => {
  const i = sql.indexOf(CABECALHO);
  assert(i >= 0, "a marca nao esta no arquivo");
  const a = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(a, sql.indexOf("$function$", a));
};
/** O bloco inteiro: do CREATE OR REPLACE ate o fim da linha do COMMENT ON FUNCTION da marca. */
const blocoDaMarca = (sql: string) => {
  const i = sql.indexOf(CABECALHO);
  const c = sql.indexOf(
    "COMMENT ON FUNCTION public.marcar_suspensa_desde() IS",
    i,
  );
  return sql.slice(i, sql.indexOf("\n", c) + 1);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const H1600 = md5(corpoDe(m1600));
const H1630 = md5(corpoDe(migration));
const DEF_DO_GATILHO =
  "CREATE TRIGGER tr_assinatura_marca_suspensa_desde AFTER INSERT OR UPDATE OF status ON public.assinatura_da_loja FOR EACH ROW EXECUTE FUNCTION public.marcar_suspensa_desde()";
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};

Deno.test("20261630: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
  for (const arq of [NOME, `rollback-manual-${NOME}`])
    assert(
      !Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).includes(
        "\r",
      ),
      `${arq}: LF`,
    );
});

Deno.test("20261630: ADITIVA e sem backfill - so redefine a marca; nada de tabela, coluna, gatilho, DROP, DELETE, TRUNCATE nem escrita fora do corpo da marca", () => {
  // uma funcao so, a marca
  assertEquals(
    [
      ...codigo.matchAll(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi),
    ].map((m) => m[2]),
    ["public.marcar_suspensa_desde"],
  );
  // fora do corpo da marca: nenhuma escrita em dado, nenhum DDL de tabela/gatilho
  // (a definicao do gatilho aparece so como LITERAL de comparacao no pre/pos-voo: sai antes de procurar DDL)
  const foraDoCorpo = semComentario(
    migration
      .replace(corpoDe(migration), "")
      .replaceAll(`'${DEF_DO_GATILHO}'`, "''"),
  );
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    /\bCREATE\s+TABLE\b/i,
    /\bGRANT\b/i,
  ])
    assert(!proibido.test(foraDoCorpo), `fora do corpo: ${proibido}`);
  // dentro do corpo: so pausa_de_vendas e' escrita (o cartao nunca)
  const corpo = semComentario(corpoDe(migration));
  // (o "DO UPDATE SET" do ON CONFLICT escreve na mesma tabela do INSERT: fica de fora da conta)
  const escritas = [
    ...corpo.matchAll(/\b(?:INSERT\s+INTO|(?<!DO\s+)UPDATE)\s+([a-z_.]+)/gi),
  ].map((m) => m[1]);
  assert(escritas.length >= 3, `escritas: ${escritas.join(",")}`);
  for (const alvo of escritas) assertEquals(alvo, "public.pausa_de_vendas");
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.marcar_suspensa_desde() FROM PUBLIC, anon, authenticated, service_role;",
  );
});

Deno.test("20261630: o corpo novo e' o da 20261600000000 com UM ramo a mais (o resto byte a byte, comentario fora) e o mesmo cabecalho", () => {
  const RAMO_NOVO = `      ELSE
        INSERT INTO public.pausa_de_vendas AS p (id, suspensa_desde)
        VALUES (1, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (id) DO UPDATE SET suspensa_desde = EXCLUDED.suspensa_desde
        WHERE p.suspensa_desde IS NULL;
`;
  const novo = corpoDe(migration);
  assertEquals(novo.split(RAMO_NOVO).length, 2, "o ramo novo aparece 1x");
  const tirarComentarios = (s: string) =>
    s
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
  assertEquals(
    tirarComentarios(novo.replace(RAMO_NOVO, "")),
    tirarComentarios(corpoDe(m1600)),
  );
  // o cabecalho (RETURNS, LANGUAGE, SECURITY DEFINER, search_path) e' o mesmo da 1600
  const cab = (sql: string) => {
    const i = sql.indexOf(CABECALHO);
    return sql.slice(i, sql.indexOf("AS $function$", i));
  };
  assertEquals(cab(migration), cab(m1600));
  // a marca nova so grava o dia quando ele esta NULL: o reenvio nunca recomeca a contagem
  assertStringIncludes(novo, "WHERE p.suspensa_desde IS NULL;");
  // nunca liga a pausa
  assert(!/vale_pela_assinatura\s*=/.test(semComentario(novo)));
  assert(!/ligada_em\s*=/.test(semComentario(novo)));
});

Deno.test("20261630: os md5 do pre-voo, do pos-voo e do rollback sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261630000000");
  const pos = blocoDo(migration, "conferencia_20261630000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261630000000");
  const rbPos = blocoDo(rollback, "conferencia_rollback_20261630000000");
  assertStringIncludes(pre, `v_hash NOT IN ('${H1600}', '${H1630}')`);
  assertStringIncludes(pos, `IS DISTINCT FROM '${H1630}'`);
  assert(!pos.includes(H1600), "o pos-voo aceita so o corpo desta");
  assertStringIncludes(rbPre, `v_hash NOT IN ('${H1630}', '${H1600}')`);
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H1600}'`);
  assert(!rbPos.includes(H1630), "a conferencia do rollback aceita so a 1600");
  // o pre-voo vem ANTES do CREATE; o pos-voo DEPOIS do REVOKE; ambos conferem o gatilho pela definicao exata
  const iCreate = migration.indexOf(CABECALHO);
  assert(migration.indexOf("DO $preflight_20261630000000$") < iCreate);
  assert(
    migration.indexOf("DO $conferencia_20261630000000$") >
      migration.indexOf(
        "REVOKE ALL ON FUNCTION public.marcar_suspensa_desde()",
      ),
  );
  const DEF = DEF_DO_GATILHO;
  assertStringIncludes(pre, DEF);
  assertStringIncludes(pos, DEF);
  for (const trecho of [
    "t.tgenabled = 'O'",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "a.grantee = 0 AND a.privilege_type = 'EXECUTE'",
    "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]",
  ])
    assertStringIncludes(pos, trecho);
});

Deno.test("20261630: o rollback devolve o bloco da 20261600000000 BYTE A BYTE, passa a Fase 0 e nao apaga nada", () => {
  assertEquals(
    rollback.split(blocoDaMarca(m1600)).length,
    2,
    "o bloco da marca da 1600 (CREATE, REVOKE e COMMENT) nao esta letra por letra no rollback",
  );
  assertEquals(md5(corpoDe(rollback)), H1600);
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  const cod = semComentario(rollback.replace(corpoDe(rollback), ""));
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\b/i,
    /\bINSERT\b/i,
    /current_setting\('app\./i,
  ])
    assert(!proibido.test(cod), `rollback: ${proibido}`);
  // um degrau so: nao existe o destrutivo
  let destrutivo = true;
  try {
    Deno.statSync(
      `${RAIZ}/supabase/migrations/rollback-manual-destrutivo-${NOME}`,
    );
  } catch {
    destrutivo = false;
  }
  assertEquals(destrutivo, false);
});

Deno.test("20261630: o db-apply confere a marca nova pelos marcadores, na contagem do arquivo", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  assertEquals(
    entrada.map((c) => c.funcao),
    ["marcar_suspensa_desde"],
  );
  const corpo = corpoDe(migration);
  for (const { texto, vezes } of entrada[0].esperado)
    assertEquals(corpo.split(texto).length - 1, vezes, texto);
});
