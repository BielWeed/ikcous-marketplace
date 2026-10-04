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
  // R1 (revisão Opus de 14d77a5b): as colunas da linha incerta, se já
  // existirem, têm de ter a forma desta migration.
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.post_autorizado_em já existe como");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao já existe como");
  assertStringIncludes(bloco, "B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao já existe com default");
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
  // R1: as duas colunas da linha incerta, NULL nas linhas que já existem; o
  // DEFAULT true de criada_sob_autorizacao vem DEPOIS, num ALTER COLUMN
  // separado (só INSERT futuro) — no ADD COLUMN ele preencheria o legado.
  assertStringIncludes(topo, "ADD COLUMN IF NOT EXISTS post_autorizado_em timestamptz;");
  const addCriada = topo.indexOf("ADD COLUMN IF NOT EXISTS criada_sob_autorizacao boolean;");
  const setDefault = topo.indexOf("ALTER COLUMN criada_sob_autorizacao SET DEFAULT true;");
  assert(addCriada > 0 && setDefault > addCriada, "ADD COLUMN sem default, e SET DEFAULT depois");
  const alteracoesDeOrderRefunds = [...topo.matchAll(/ALTER TABLE public\.order_refunds[^;]*;/g)].map((m) =>
    m[0].replace(/\s+/g, " ")
  );
  assertEquals(
    alteracoesDeOrderRefunds.filter((a) => /\bDEFAULT\b/i.test(a)),
    ["ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao SET DEFAULT true;"],
    "em order_refunds, o único DEFAULT é o SET DEFAULT true",
  );
  // O rollback tira o DEFAULT (edge antiga de volta não carimba) e guarda
  // as colunas (o carimbo é evidência de dinheiro).
  assertStringIncludes(
    semComentarios(rollback),
    "ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao DROP DEFAULT;",
  );
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
    "DROP FUNCTION IF EXISTS public.autorizar_post_do_estorno",
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
    "public.autorizar_post_do_estorno(uuid, numeric)",
  ]) {
    assertStringIncludes(migration, `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated;`);
    assertStringIncludes(migration, `GRANT EXECUTE ON FUNCTION ${fn}\n  TO service_role;`);
  }
  assertEquals((semComentarios(migration).match(/SECURITY DEFINER\s+SET search_path = public/g) || []).length, 3);
});

Deno.test("20261196: autorizar_post_do_estorno trava a LINHA e depois o PEDIDO, e só escreve updated_at e o carimbo do POST quando autoriza", () => {
  const autorizar = corpos(migration)[2];
  const linha = autorizar.search(/FROM public\.order_refunds\s+WHERE id = p_refund_id\s+FOR UPDATE;/);
  const pedido = autorizar.search(/FROM public\.marketplace_orders\s+WHERE id = v_linha\.order_id\s+FOR UPDATE;/);
  assert(linha > 0 && pedido > linha, "linha -> pedido");
  const escritas = [...autorizar.matchAll(/UPDATE public\.order_refunds\s+SET ([^;]*);/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  // R1: o MESMO UPDATE que renova updated_at carimba post_autorizado_em.
  assertEquals(escritas, ["updated_at = now(), post_autorizado_em = now() WHERE id = v_linha.id"]);
  assert(autorizar.indexOf("'nao_cabe'") < autorizar.search(/UPDATE public\.order_refunds/), "nao_cabe volta antes de qualquer escrita");
  assertStringIncludes(semComentarios(rollback), "DROP FUNCTION public.autorizar_post_do_estorno(uuid, numeric);");
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
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/admin-atual-portas-viva.cjs",
    "tests/banco/admin-atual-devolucao-viva.cjs",
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

Deno.test("rpc-ci: no job do dinheiro TODAS as provas rodam mesmo depois de uma vermelha (!cancelled()), só com as migrations aplicadas, e o job continua reprovando", () => {
  // R2 da revisão Opus de 14d77a5b: a prova que falha primeiro escondia as
  // seguintes. Cada passo de prova tem de levar o `if` abaixo; o passo das
  // migrations tem o id que ele cita; e nenhum continue-on-error (o job
  // reprova se QUALQUER passo reprovar).
  const inicio = workflow.indexOf("\n  contrato-dinheiro:\n");
  const fim = workflow.indexOf("\n  provas-informacionais:\n");
  const bloqueante = workflow.slice(inicio, fim);
  assert(!/continue-on-error/.test(bloqueante.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")));
  assert(/- name: Aplica as migrations do zero\n\s+id: aplica\n\s+run: node tests\/banco\/aplicar-migrations\.cjs/.test(bloqueante));
  const passos = bloqueante.split(/\n {6}- /).slice(1);
  const provas = passos.filter((p) => /tests\/banco\/(rodar-isolado\.cjs|invariantes-dinheiro\.cjs)/.test(p));
  assertEquals(provas.length, 9, "as 9 provas de dinheiro");
  // Inclusive a da 20261199000000 (portas do painel), que entrou depois.
  assertEquals(
    provas.filter((p) => p.includes("tests/banco/admin-atual-portas-viva.cjs")).length,
    1,
    "a prova das portas do painel (99) está no job do dinheiro",
  );
  // E a da 20261200000000 (decisão da devolução), com o mesmo `if` do laço abaixo.
  assertEquals(
    provas.filter((p) => p.includes("tests/banco/admin-atual-devolucao-viva.cjs")).length,
    1,
    "a prova da decisão da devolução (200) está no job do dinheiro",
  );
  for (const passo of provas) {
    assertStringIncludes(
      passo,
      "\n        if: ${{ !cancelled() && steps.aplica.outcome == 'success' }}\n",
      `sem o if: ${passo.split("\n")[0]}`,
    );
  }
  // Os passos de preparo NÃO levam o if (o padrão: parar no 1o erro).
  for (const passo of passos.filter((p) => !provas.includes(p))) {
    assert(!/^\s+if:/m.test(passo), `passo de preparo com if: ${passo.split("\n")[0]}`);
  }
});

Deno.test("20261196: a prova viva roda no CI (rpc-ci.yml, banco isolado)", () => {
  assertStringIncludes(workflow, "node tests/banco/rodar-isolado.cjs tests/banco/contestacao-viva.cjs");
});
