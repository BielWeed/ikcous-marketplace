import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename -- teste: escreve só em pasta temporária criada aqui. */
// A TRAVA DAS TABELAS NOVAS (scripts/ci/acesso-das-tabelas-novas.cjs,
// 26/11/2026): migration DEPOIS do corte que cria tabela em public tem de
// dizer, no mesmo arquivo, quem pode usá-la (GRANT … ON [TABLE] public.X ou
// REVOKE ALL ON [TABLE] public.X). Projeto Supabase novo não dá mais acesso
// automático a tabela nova desde 30/05/2026; as lojas antigas dão.
//
// Este arquivo É a trava no CI: o último teste confere a pasta REAL de
// supabase/migrations (roda no test:unit do ci.yml, junto dos tests/migration_*).
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  CORTE_DE_VERSAO,
  ehMigrationNova,
  tabelasSemDecisao,
  conferirPasta,
  mensagem,
} = require("../scripts/ci/acesso-das-tabelas-novas.cjs");

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);

Deno.test("corte: fixado na maior versão de 14 dígitos que existia quando a trava nasceu", () => {
  assertEquals(CORTE_DE_VERSAO, "20261480000000");
  const versoes14 = [...Deno.readDirSync(MIGRATIONS)]
    .map((e) => /^(\d{14})_.*\.sql$/.exec(e.name)?.[1])
    .filter(Boolean)
    .sort();
  assert(versoes14.length > 200);
  // (quando nascer migration nova, ela passa do corte: o corte não anda junto)
  assert(versoes14.includes(CORTE_DE_VERSAO), "o corte é uma versão real");
});

Deno.test("nova ou antiga: maior que o corte é nova; 13 dígitos só as duas de antes são antigas; rollback e subpasta nunca", () => {
  for (const [arquivo, nova] of [
    ["20261480000000_a_caderneta_fecha_para_o_service_role.sql", false],
    ["20260806000000_baseline_do_schema_vivo.sql", false],
    ["2026110000000_o_estorno_nasce_no_ledger.sql", false],
    ["2026110000100_concluir_estorno.sql", false],
    ["20261480000001_x.sql", true],
    ["20261490000000_x.sql", true],
    ["2026149000000_x.sql", true],
    ["2026100000000_x.sql", true],
    ["rollback-manual-20261490000000_x.sql", false],
    ["_arquivadas/20261490000000_x.sql", false],
    ["20261490000000_x.sql.bak", false],
    ["LEIA-ME.md", false],
  ]) {
    assertEquals(ehMigrationNova(arquivo), nova, arquivo);
  }
});

Deno.test("CREATE TABLE em public sem GRANT nem REVOKE ALL → acusa (com e sem schema, IF NOT EXISTS, aspas, UNLOGGED, AS SELECT)", () => {
  for (const [sql, tabela] of [
    ["CREATE TABLE public.recibos (id int);", "public.recibos"],
    ["create table if not exists public.recibos (id int);", "public.recibos"],
    ["CREATE TABLE recibos (id int);", "public.recibos"],
    ['CREATE TABLE "public"."Recibos" (id int);', "public.Recibos"],
    ["CREATE TABLE Public.Recibos (id int);", "public.recibos"],
    ["CREATE UNLOGGED TABLE public.fila (id int);", "public.fila"],
    ["CREATE TABLE public.copia AS SELECT 1 AS x;", "public.copia"],
    [
      "DO $$ BEGIN\n  CREATE TABLE public.dentro_do_do (id int);\nEND $$;",
      "public.dentro_do_do",
    ],
  ]) {
    assertEquals(tabelasSemDecisao(sql), [tabela], sql);
  }
});

Deno.test("decisão explícita no mesmo arquivo → nada a acusar (GRANT, REVOKE ALL, lista, TABLE opcional, coluna, aspas)", () => {
  for (const sql of [
    "CREATE TABLE public.t (id int);\nGRANT SELECT ON public.t TO anon;",
    "CREATE TABLE public.t (id int);\nGRANT SELECT, INSERT ON TABLE public.t TO authenticated, service_role;",
    "CREATE TABLE public.t (id int);\nREVOKE ALL ON TABLE public.t FROM anon, authenticated, service_role;",
    "CREATE TABLE public.t (id int);\nREVOKE ALL PRIVILEGES ON public.t FROM PUBLIC;",
    "CREATE TABLE public.t (id int);\nCREATE TABLE public.u (id int);\nREVOKE ALL ON TABLE public.t, public.u FROM anon;",
    "CREATE TABLE public.t (id int, nome text);\nGRANT SELECT (id, nome) ON public.t TO anon;",
    "CREATE TABLE t (id int);\nGRANT ALL ON t TO service_role;",
    'CREATE TABLE "public"."T" (id int);\nGRANT SELECT ON public."T" TO anon;',
    "CREATE TABLE public.t (id int);\ngrant select on table PUBLIC.T to anon;",
  ]) {
    assertEquals(tabelasSemDecisao(sql), [], sql);
  }
});

Deno.test("o que NÃO é decisão sobre a tabela não conta: comentário, outra tabela, GRANT em função/sequência/schema, ON ALL TABLES, REVOKE parcial, GRANT OPTION", () => {
  for (const sql of [
    "CREATE TABLE public.t (id int);\n-- GRANT SELECT ON public.t TO anon;",
    "CREATE TABLE public.t (id int);\n/* REVOKE ALL ON public.t FROM anon; */",
    "CREATE TABLE public.t (id int);\n/* aninhado /* x */ GRANT SELECT ON public.t TO anon; */",
    "CREATE TABLE public.t (id int);\nGRANT SELECT ON public.outra TO anon;",
    "CREATE TABLE public.t (id int);\nGRANT USAGE ON SEQUENCE public.t_id_seq TO anon;",
    "CREATE TABLE public.t (id int);\nGRANT EXECUTE ON FUNCTION public.t(int) TO anon;",
    "CREATE TABLE public.t (id int);\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;",
    "CREATE TABLE public.t (id int);\nREVOKE INSERT ON public.t FROM anon;",
    "CREATE TABLE public.t (id int);\nREVOKE GRANT OPTION FOR ALL ON public.t FROM anon;",
    "CREATE TABLE public.t (id int);\nGRANT SELECT ON public.tt TO anon;",
  ]) {
    assertEquals(tabelasSemDecisao(sql), ["public.t"], sql);
  }
});

Deno.test("fora da regra: TEMP, outro schema, CREATE TABLE só em comentário, texto de string que tem '--' não come o resto", () => {
  for (const sql of [
    "CREATE TEMP TABLE t (id int);",
    "CREATE TEMPORARY TABLE IF NOT EXISTS t (id int);",
    "CREATE LOCAL TEMP TABLE t (id int);",
    "CREATE TABLE storage.t (id int);",
    "CREATE TABLE supabase_migrations.t (version text);",
    "-- CREATE TABLE public.t (id int);\nSELECT 1;",
    "/* CREATE TABLE public.t (id int); */ SELECT 1;",
  ]) {
    assertEquals(tabelasSemDecisao(sql), [], sql);
  }
  // o '--' dentro da string não é comentário: o GRANT da mesma linha conta
  assertEquals(
    tabelasSemDecisao(
      "CREATE TABLE public.t (id int);\nSELECT '-- não é comentário'; GRANT SELECT ON public.t TO anon;",
    ),
    [],
  );
  // E'\'' não abre string infinita que engoliria o GRANT
  assertEquals(
    tabelasSemDecisao(
      "CREATE TABLE public.t (id int);\nSELECT E'\\''; GRANT SELECT ON public.t TO anon;",
    ),
    [],
  );
});

Deno.test("várias tabelas: acusa só as sem decisão, uma vez cada, na ordem", () => {
  assertEquals(
    tabelasSemDecisao(
      "CREATE TABLE public.a (id int);\nCREATE TABLE public.b (id int);\nCREATE TABLE IF NOT EXISTS public.a (id int);\nCREATE TABLE public.c (id int);\nREVOKE ALL ON public.b FROM anon;",
    ),
    ["public.a", "public.c"],
  );
});

Deno.test("conferirPasta: só migration NOVA da raiz entra; antiga, rollback e subpasta ficam de fora; a mensagem diz o que acrescentar", () => {
  const pasta = mkdtempSync(join(tmpdir(), "acesso-tabelas-"));
  try {
    const t = "CREATE TABLE public.recibos (id int);\n";
    writeFileSync(join(pasta, "20261470000000_antiga.sql"), t);
    writeFileSync(join(pasta, "2026110000000_antiga_13.sql"), t);
    writeFileSync(join(pasta, "rollback-manual-20261490000000_x.sql"), t);
    mkdirSync(join(pasta, "_arquivadas"));
    writeFileSync(join(pasta, "_arquivadas", "20261490000000_x.sql"), t);
    writeFileSync(
      join(pasta, "20261490000000_com_grant.sql"),
      `${t}GRANT SELECT ON public.recibos TO authenticated;\n`,
    );
    writeFileSync(join(pasta, "20261500000000_sem_decisao.sql"), t);
    const achados = conferirPasta(pasta);
    assertEquals(
      achados.map((a) => [a.arquivo, a.tabela]),
      [["20261500000000_sem_decisao.sql", "public.recibos"]],
    );
    const m = achados[0].mensagem;
    assertEquals(
      m,
      mensagem("20261500000000_sem_decisao.sql", "public.recibos"),
    );
    for (const trecho of [
      "supabase/migrations/20261500000000_sem_decisao.sql",
      "cria a tabela public.recibos sem dizer quem pode usá-la",
      "Acrescente no MESMO arquivo",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recibos TO",
      "REVOKE ALL ON TABLE public.recibos FROM anon, authenticated, service_role;",
      "30/05/2026",
    ])
      assertStringIncludes(m, trecho);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

Deno.test("o programa: sai 1 e imprime a mensagem quando acha; 0 quando não", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "acesso-tabelas-cli-"));
  try {
    const script = new URL(
      "../scripts/ci/acesso-das-tabelas-novas.cjs",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const rodar = async () => {
      const r = await new Deno.Command("node", {
        args: [script, pasta],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        code: r.code,
        saida: dec.decode(r.stdout) + dec.decode(r.stderr),
      };
    };
    writeFileSync(
      join(pasta, "20261500000000_ok.sql"),
      "CREATE TABLE public.r (id int);\nREVOKE ALL ON public.r FROM anon;\n",
    );
    const ok = await rodar();
    assertEquals(ok.code, 0, ok.saida);
    assertStringIncludes(ok.saida, "OK");
    writeFileSync(
      join(pasta, "20261510000000_sem.sql"),
      "CREATE TABLE public.s (id int);\n",
    );
    const ruim = await rodar();
    assertEquals(ruim.code, 1, ruim.saida);
    assertStringIncludes(ruim.saida, "cria a tabela public.s sem dizer");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

Deno.test("A TRAVA: nenhuma migration NOVA do repositório cria tabela em public sem GRANT ou REVOKE ALL", () => {
  const achados = conferirPasta();
  assertEquals(
    achados.map((a) => a.mensagem),
    [],
  );
});
