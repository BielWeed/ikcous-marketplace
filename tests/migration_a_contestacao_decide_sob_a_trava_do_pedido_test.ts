// @ts-nocheck
// A CONTESTAÇÃO DECIDE SOB A TRAVA DO PEDIDO — prova offline do par
// 20261196000000 + rollback (Lote A, 04/10/2026). O COMPORTAMENTO (trava do
// pedido com duas conexões, estimativa que só reserva, multicaso, corrida do
// mesmo CBK, refund regular sem recorte) é provado contra Postgres efêmero:
// tests/banco/contestacao-viva.cjs. Aqui fica o que se prova lendo o texto,
// no `npm run test:unit`.
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
const NOME = "20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql";
const lerArquivo = (rel) => Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const migration = lerArquivo(`supabase/migrations/${NOME}`);
const rollback = lerArquivo(`supabase/migrations/rollback-manual-${NOME}`);
const workflow = lerArquivo(".github/workflows/rpc-ci.yml");
const semComentarios = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
/** O texto FORA dos corpos de função ($fn$ ... $fn$), do preflight e dos
 * literais de texto (os COMMENT ON citam "FOR UPDATE" em prosa). */
const nivelSuperior = (s) =>
  semComentarios(s)
    .replace(/\$fn\$[\s\S]*?\$fn\$/g, "")
    .replace(/\$preflight_20261196\$[\s\S]*?\$preflight_20261196\$/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
const corpos = (s) => [...s.matchAll(/\$fn\$([\s\S]*?)\$fn\$/g)].map((m) => m[1]);

Deno.test("20261196: avaliarFase0 não recusa o par; nenhum dos dois abre ou fecha transação de nível superior", () => {
  const res = avaliarFase0({ sqlMigration: migration, sqlRollback: rollback, temRollback: true });
  assertEquals(res.recusado, false, `motivos: ${(res.motivos || []).join("; ")}`);
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("20261196: o preflight é o PRIMEIRO comando, recusa com RAISE EXCEPTION e exige a 20261192000000", () => {
  const codigo = semComentarios(migration);
  const primeiro = codigo.search(/\b(DO|CREATE|ALTER|REVOKE|GRANT|COMMENT|DROP|INSERT|UPDATE|DELETE)\b/);
  assertEquals(codigo.slice(primeiro, primeiro + "DO $preflight_20261196$".length), "DO $preflight_20261196$");
  const bloco = migration.slice(migration.indexOf("DO $preflight_20261196$"), migration.indexOf("END $preflight_20261196$;"));
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.mp_chargeback_id ausente");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_contestacao ausente");
  assertStringIncludes(bloco, "'CREATE UNIQUE INDEX uq_order_refunds_pedido_contestacao ON public.order_refunds USING btree (order_id, mp_chargeback_id) WHERE (mp_chargeback_id IS NOT NULL)'");
});

Deno.test("20261196: fora das funções, nenhuma escrita de dado; colunas novas nascem NULL; nada apagado além das funções recriadas", () => {
  const topo = nivelSuperior(migration);
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(topo), "a migration não reescreve linha existente");
  assertStringIncludes(topo, "ADD COLUMN IF NOT EXISTS mp_chargeback_case_id text;");
  assertStringIncludes(topo, "ADD COLUMN IF NOT EXISTS mp_chargeback_valor_do_caso numeric(12,2)");
  // Sem default nas colunas novas de order_refunds (sem backfill implícito).
  for (const linha of topo.split("\n").filter((l) => /ADD COLUMN/i.test(l))) {
    assert(!/\bDEFAULT\b/i.test(linha), linha);
  }
  // A decisão final: tabela nova, fora do alcance do cliente, nunca apagada.
  assertStringIncludes(topo, "CREATE TABLE IF NOT EXISTS public.contestacoes_decisao_final (");
  assertStringIncludes(topo, "PRIMARY KEY (order_id, mp_chargeback_id)");
  assertStringIncludes(topo, "ALTER TABLE public.contestacoes_decisao_final ENABLE ROW LEVEL SECURITY;");
  assertStringIncludes(topo, "REVOKE ALL ON TABLE public.contestacoes_decisao_final FROM PUBLIC, anon, authenticated;");
  assert(!/CREATE\s+POLICY/i.test(topo), "sem política: só a função SECURITY DEFINER lê e escreve");
  assert(!/DROP\s+TABLE/i.test(semComentarios(rollback)), "o rollback não apaga o histórico da decisão final");
  const drops = [...topo.matchAll(/\bDROP\b[^(;]*/gi)].map((m) => m[0].replace(/\s+/g, " ").trim());
  assertEquals(drops, [
    "DROP FUNCTION IF EXISTS public.registrar_contestacao_no_ledger",
    "DROP FUNCTION IF EXISTS public.registrar_estorno_externo_do_mp",
  ]);
  assert(!/DROP\s+COLUMN/i.test(semComentarios(rollback)), "o rollback não apaga coluna");
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(semComentarios(rollback)));
});

Deno.test("20261196: as duas funções travam o PEDIDO (FOR UPDATE) antes de decidir, e só a service_role executa", () => {
  const [contestacao, externo] = corpos(migration);
  // ORDEM GLOBAL (04/10/2026): as LINHAS (ORDER BY id) antes do PEDIDO — a
  // ordem da concluir_estorno e da registrar_estorno_manual.
  for (const { corpo, apelido, travaDasLinhas } of [
    {
      corpo: contestacao,
      apelido: "linha_do_sistema",
      travaDasLinhas:
        /FROM public\.order_refunds linha_do_sistema\s+WHERE linha_do_sistema\.order_id = p_order_id[\s\S]*?ORDER BY linha_do_sistema\.id\s+FOR UPDATE OF linha_do_sistema;/,
    },
    {
      corpo: externo,
      apelido: "linha_tocada",
      travaDasLinhas:
        /FROM public\.order_refunds linha_tocada\s+WHERE linha_tocada\.order_id = p_order_id[\s\S]*?ORDER BY linha_tocada\.id\s+FOR UPDATE OF linha_tocada;/,
    },
  ]) {
    const trava = corpo.search(/FROM public\.marketplace_orders\s+WHERE id = p_order_id\s+FOR UPDATE;/);
    assert(trava > 0, "trava do pedido");
    const travaLinhas = corpo.search(travaDasLinhas);
    assert(travaLinhas > 0 && travaLinhas < trava, `${apelido}: linhas travadas ANTES do pedido`);
    const primeiraEscrita = corpo.search(/\b(INSERT INTO|UPDATE public\.order_refunds|PERFORM public\.concluir_estorno)\b/);
    assert(primeiraEscrita > trava, "nenhuma escrita antes da trava");
  }
  assertStringIncludes(contestacao, "AND linha_do_sistema.solicitado_por = 'sistema'");
  assertStringIncludes(
    externo,
    "AND (linha_tocada.solicitado_por = 'sistema' OR linha_tocada.mp_refund_id = p_mp_refund_id)",
  );
  assertStringIncludes(migration, "ORDEM GLOBAL DAS TRAVAS");
  for (const fn of [
    "public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)",
    "public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)",
  ]) {
    assertStringIncludes(migration, `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated;`);
    assertStringIncludes(migration, `GRANT EXECUTE ON FUNCTION ${fn}\n  TO service_role;`);
  }
  assertEquals((semComentarios(migration).match(/SECURITY DEFINER\s+SET search_path = public/g) || []).length, 2);
});

Deno.test("rpc-ci: as provas de DINHEIRO ficam num job BLOQUEANTE (sem continue-on-error); só o que não é dinheiro é informacional", () => {
  const inicio = workflow.indexOf("\n  contrato-dinheiro:\n");
  const fimDoBloqueante = workflow.indexOf("\n  provas-informacionais:\n");
  assert(inicio > 0 && fimDoBloqueante > inicio, "os dois jobs existem, nesta ordem");
  const bloqueante = workflow.slice(inicio, fimDoBloqueante);
  const informacional = workflow.slice(fimDoBloqueante);
  assert(!/^\s*continue-on-error:/m.test(bloqueante), "o job do dinheiro não pode ser informacional");
  for (const prova of [
    "tests/banco/pagamentos-rpc-viva.cjs",
    "tests/banco/devolucoes-viva.cjs",
    "tests/banco/cartao-online-viva.cjs",
    "tests/banco/financeiro-viva.cjs",
    "tests/banco/contestacao-viva.cjs",
    "tests/banco/invariantes-dinheiro.cjs",
  ]) {
    assertStringIncludes(bloqueante, prova);
    assert(!informacional.includes(prova), `${prova} não pode ficar no job informacional`);
  }
  assert(/^\s*continue-on-error: true$/m.test(informacional));
  for (const prova of ["crm-inicio-viva.cjs", "crm-todos-viva.cjs", "cpf-da-janela-viva.cjs"]) {
    assertStringIncludes(informacional, prova);
  }
});

Deno.test("20261196: a prova viva roda no CI (rpc-ci.yml, banco isolado)", () => {
  assertStringIncludes(workflow, "node tests/banco/rodar-isolado.cjs tests/banco/contestacao-viva.cjs");
});
