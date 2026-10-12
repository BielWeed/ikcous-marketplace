// @ts-nocheck
// O LEDGER REGISTRA CADA ESTORNO DO MP UMA VEZ — prova offline do par
// 20261192000000 + rollback (Lote A, 04/10/2026). O COMPORTAMENTO (índice no
// banco nascido das migrations, corrida real entre duas conexões, preflight
// que recusa duplicata com contagem, reaplicar e desfazer) é provado no CI
// contra Postgres efêmero: tests/banco/invariantes-dinheiro.cjs, prova (f).
// Aqui fica o que se prova só lendo o texto, no `npm run test:unit`.
//
// Riscos amarrados: transação de nível superior (o ROLLBACK da prova viraria
// no-op); preflight que só AVISA em vez de recusar; definição do índice
// divergindo entre o preflight da migration, o do rollback e a prova viva
// (um banco CORRETO seria recusado como divergente); a migration tocando
// linha do ledger (DELETE/UPDATE — resolver duplicata é decisão do dono).
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
const NOME = "20261192000000_o_ledger_registra_cada_estorno_do_mp_uma_vez.sql";
const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const migration = lerArquivo(`supabase/migrations/${NOME}`);
const rollback = lerArquivo(`supabase/migrations/rollback-manual-${NOME}`);
const provaViva = lerArquivo("tests/banco/invariantes-dinheiro.cjs");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const DEF_INDICE_REFUND =
  "CREATE UNIQUE INDEX uq_order_refunds_pedido_refund_mp ON public.order_refunds USING btree (order_id, mp_refund_id) WHERE (mp_refund_id IS NOT NULL)";
const DEF_INDICE_CONTESTACAO =
  "CREATE UNIQUE INDEX uq_order_refunds_pedido_contestacao ON public.order_refunds USING btree (order_id, mp_chargeback_id) WHERE (mp_chargeback_id IS NOT NULL)";

Deno.test("avaliarFase0 não recusa o par; nenhum dos dois abre ou fecha transação de nível superior", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("o preflight é o PRIMEIRO comando e recusa com RAISE EXCEPTION (divergência e duplicata com contagem)", () => {
  const codigo = semComentarios(migration);
  const primeiro = codigo.search(
    /\b(DO|CREATE|ALTER|REVOKE|GRANT|COMMENT|DROP|INSERT|UPDATE|DELETE)\b/,
  );
  assertEquals(
    codigo.slice(primeiro, primeiro + "DO $preflight_20261192$".length),
    "DO $preflight_20261192$",
  );
  const bloco = migration.slice(
    migration.indexOf("DO $preflight_20261192$"),
    migration.indexOf("END $preflight_20261192$;"),
  );
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  assertStringIncludes(
    bloco,
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_refund_mp",
  );
  assertStringIncludes(bloco, "RAISE EXCEPTION 'LEDGER_DUPLICADO: % par(es)");
  assertStringIncludes(bloco, "HAVING count(*) > 1");
  assertStringIncludes(
    bloco,
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_contestacao",
  );
  assertStringIncludes(
    bloco,
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.mp_chargeback_id já existe como %",
  );
  assertStringIncludes(bloco, "par(es) (pedido, mp_chargeback_id)");
});

Deno.test("a definição do índice é a MESMA no preflight da migration, no do rollback e na prova viva do CI", () => {
  assertStringIncludes(migration, `'${DEF_INDICE_REFUND}'`);
  assertStringIncludes(rollback, `'${DEF_INDICE_REFUND}'`);
  assertStringIncludes(provaViva, `"${DEF_INDICE_REFUND}"`);
  assertStringIncludes(migration, `'${DEF_INDICE_CONTESTACAO}'`);
  assertStringIncludes(rollback, `'${DEF_INDICE_CONTESTACAO}'`);
  assertStringIncludes(provaViva, `"${DEF_INDICE_CONTESTACAO}"`);
  assertStringIncludes(
    semComentarios(migration),
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_pedido_contestacao\n  ON public.order_refunds (order_id, mp_chargeback_id)\n  WHERE mp_chargeback_id IS NOT NULL;",
  );
  // A coluna é aditiva e nasce NULL (sem default, sem backfill, sem NOT NULL).
  assertStringIncludes(
    semComentarios(migration),
    "ADD COLUMN IF NOT EXISTS mp_chargeback_id text;",
  );
  assertStringIncludes(
    semComentarios(migration),
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_pedido_refund_mp\n  ON public.order_refunds (order_id, mp_refund_id)\n  WHERE mp_refund_id IS NOT NULL;",
  );
});

Deno.test("a migration não reescreve nem apaga linha do ledger (resolver duplicata é decisão do dono)", () => {
  const codigo = semComentarios(migration);
  assert(
    !/\b(DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(codigo),
    "nenhuma escrita de dado",
  );
  assert(!/\bDROP\b/i.test(codigo), "nada é apagado");
  const codigoRollback = semComentarios(rollback);
  assert(!/\b(DELETE|UPDATE|INSERT|TRUNCATE)\b/i.test(codigoRollback));
  // O rollback NÃO apaga a coluna (identidade de contestação já registrada).
  assert(!/DROP\s+COLUMN/i.test(codigoRollback));
});

Deno.test("o aviso do rollback diz que, sem os índices, a edge nova CONCLUI e SOMA o mesmo estorno do MP duas vezes", () => {
  // Quem opera lê este cabeçalho ANTES de rodar o rb92. Medido pelo revisor
  // (C5): sem o índice, concluir_estorno com um mp_refund_id que já é de outra
  // linha do pedido conclui e soma (1 id, valor_estornado 100 em vez de 50).
  const aviso = rollback
    .split("\n")
    .filter((l) => l.startsWith("--"))
    .map((l) => l.replace(/^--\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
  assert(
    !aviso.includes("só deixa de acontecer"),
    "o aviso antigo subestimava o C5",
  );
  assertStringIncludes(aviso, "concluir_estorno");
  assertStringIncludes(aviso, "CONCLUI e SOMA");
  assertStringIncludes(aviso, "webhook ANTIGO");
  assertStringIncludes(aviso, "defeito anterior à 20261192000000");
  // C1/C2 medidos: as RPCs da 96 conferem a duplicata sob a trava do pedido
  // e ficam com 1 linha mesmo sem índice — o aviso não pode negar isso.
  assert(!aviso.includes("nenhuma função confere"), "contradiz C1/C2");
  assertStringIncludes(aviso, "registrar_estorno_externo_do_mp");
  assertStringIncludes(aviso, "registrar_contestacao_no_ledger");
  // A contestação duplicada pelo webhook antigo NÃO foi medida.
  assert(!aviso.includes("ou da mesma contestação"), "afirmação não medida");
});
