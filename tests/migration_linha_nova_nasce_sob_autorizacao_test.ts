// @ts-nocheck
// LINHA NOVA NASCE SOB AUTORIZAÇÃO — prova offline do par 20261201000000 +
// rollback (Lote A, 04/10/2026, roteiro de publicação revisado pelo Opus,
// cenário D1). O DEFAULT true de order_refunds.criada_sob_autorizacao saiu da
// 20261196000000 e vive só aqui: aplicado ANTES de as edges novas estarem no
// ar, uma linha com POST da edge ANTIGA (sem carimbo) nasceria true e o cron
// novo a recusaria, liberando a reserva com dinheiro saído. O COMPORTAMENTO
// (nasce NULL só com a 96, nasce true com esta, preflight recusa sem
// escrever, 2º rollback recusa) é provado contra Postgres efêmero na prova
// (y) de tests/banco/contestacao-viva.cjs. Aqui fica o que se prova lendo o
// texto, no `npm run test:unit`.
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
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const NOME_96 = "20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql";
const lerArquivo = (rel) => Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const migration = lerArquivo(`supabase/migrations/${NOME}`);
const rollback = lerArquivo(`supabase/migrations/rollback-manual-${NOME}`);
const migration96 = lerArquivo(`supabase/migrations/${NOME_96}`);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const semBlocosDo = (s) =>
  semComentarios(s)
    .replace(/\bDO\s+\$(preflight_[a-z0-9_]+)\$[\s\S]*?\$\1\$\s*;/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
const preflight = (s, rotulo) => s.slice(s.indexOf(`DO $${rotulo}$`), s.indexOf(`END $${rotulo}$;`));

/** O corpo ($fn$ ... $fn$) da autorizar_post_do_estorno no arquivo da 96. */
const corpoDaAutorizarNa96 = () => {
  const i = migration96.indexOf("CREATE OR REPLACE FUNCTION public.autorizar_post_do_estorno(");
  const a = migration96.indexOf("$fn$", i) + "$fn$".length;
  const b = migration96.indexOf("$fn$", a);
  assert(i > 0 && a > i && b > a, "corpo da autorizar_post_do_estorno na 96");
  return migration96.slice(a, b);
};

Deno.test("20261201: avaliarFase0 não recusa o par; nenhum dos dois abre/fecha transação nem concede privilégio", () => {
  const res = avaliarFase0({ sqlMigration: migration, sqlRollback: rollback, temRollback: true });
  assertEquals(res.recusado, false, `motivos: ${(res.motivos || []).join("; ")}`);
  for (const sql of [migration, rollback]) {
    assertEquals(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    // Fora do bloco DO do preflight (cujo BEGIN/END é do plpgsql, não de
    // transação): nada de BEGIN/COMMIT/GRANT/REVOKE.
    assert(!/\b(BEGIN|COMMIT|GRANT|REVOKE)\b/i.test(semBlocosDo(sql)), "sem BEGIN/COMMIT/GRANT/REVOKE");
  }
});

Deno.test("20261201: fora do preflight, a migration é SÓ o SET DEFAULT true; o rollback é SÓ o DROP DEFAULT", () => {
  const comandos = (s) =>
    semBlocosDo(s)
      .split(";")
      .map((c) => c.replace(/\s+/g, " ").trim())
      .filter((c) => c !== "");
  assertEquals(comandos(migration), [
    "ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao SET DEFAULT true",
  ]);
  assertEquals(comandos(rollback), [
    "ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao DROP DEFAULT",
  ]);
});

Deno.test("20261201: o preflight é o PRIMEIRO comando, só RAISE EXCEPTION, e recusa coluna, default e corpo da autorizar", () => {
  const codigo = semComentarios(migration);
  const primeiro = codigo.search(/\b(DO|CREATE|ALTER|REVOKE|GRANT|COMMENT|DROP|INSERT|UPDATE|DELETE)\b/);
  assertEquals(codigo.slice(primeiro, primeiro + "DO $preflight_20261201$".length), "DO $preflight_20261201$");
  const bloco = preflight(migration, "preflight_20261201");
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  assert(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(semComentarios(bloco)), "o preflight não escreve");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao ausente ou com tipo");
  assertStringIncludes(bloco, "IS DISTINCT FROM 'boolean'");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao com default");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.autorizar_post_do_estorno(uuid, numeric) ausente");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.autorizar_post_do_estorno(uuid, numeric) não é o corpo da 20261196000000");
  // A régua da casa (97/99): md5 do corpo sem CR.
  assertStringIncludes(bloco, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("20261201: o hash do preflight é o md5 REAL do corpo da autorizar_post_do_estorno no arquivo da 96", () => {
  const real = md5(corpoDaAutorizarNa96());
  assertEquals(real, "e128f7ad54ebc82c97b97af4aa7baa08", "medido também no banco (04/10/2026)");
  assertStringIncludes(preflight(migration, "preflight_20261201"), `'${real}'`);
});

Deno.test("20261201: o rollback tem preflight que recusa sem o DEFAULT true (o 2º rollback recusa)", () => {
  const bloco = preflight(rollback, "preflight_rollback_20261201");
  assert(bloco.length > 0, "preflight do rollback");
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao sem DEFAULT true");
  const codigo = semComentarios(rollback);
  const primeiro = codigo.search(/\b(DO|ALTER|DROP)\b/);
  assertEquals(
    codigo.slice(primeiro, primeiro + "DO $preflight_rollback_20261201$".length),
    "DO $preflight_rollback_20261201$",
  );
});

Deno.test("20261201: o cabeçalho manda publicar DEPOIS das edges novas e do escoamento, e desfazer 201 -> edges -> 96 -> 92", () => {
  const cabecalho = migration.slice(0, migration.indexOf("DO $preflight_20261201$"));
  assertStringIncludes(cabecalho, "DEPOIS de as edges `estornar-pagamento` e `reconciliar-pagamentos` NOVAS");
  assertStringIncludes(cabecalho, "15 minutos");
  assertStringIncludes(cabecalho, "uma execução completa do cron");
  assertStringIncludes(cabecalho, "20261201000000 -> edges -> 20261196000000 -> 20261192000000");
});

Deno.test("20261196: o DEFAULT true NÃO está mais na 96 (ele só existe na 20261201000000)", () => {
  const topo = semBlocosDo(migration96).replace(/\$fn\$[\s\S]*?\$fn\$/g, "");
  assert(!/criada_sob_autorizacao\s+SET\s+DEFAULT/i.test(topo), "SET DEFAULT voltou para a 96");
});
