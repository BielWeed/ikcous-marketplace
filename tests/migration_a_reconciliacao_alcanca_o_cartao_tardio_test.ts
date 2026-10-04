// @ts-nocheck
// A RECONCILIAÇÃO ALCANÇA O CARTÃO TARDIO — prova offline do par
// 20261190000000 + rollback (dinheiro, 02/10/2026). O COMPORTAMENTO (D2 com o
// cron REAL, rodízio D3, cobrança terminal, push, aplicar->desfazer->aplicar,
// ACL) foi provado executando o SQL destes arquivos em Postgres real (PGlite)
// à parte — o repositório não tem PGlite; aqui fica o que se prova só lendo o
// texto, no `npm run test:unit`.
//
// Riscos amarrados: hash de preflight que não é o md5 real recusa a migration
// num banco CORRETO; rollback que não bate byte a byte deixa a fila nova presa;
// janela de 14 dias vazando para o PIX (consulta inútil por duas semanas) ou
// encolhendo para o cartão (D2 de volta); `NOT`/`COALESCE` mal posto tirando o
// pedido sem `metodo_online` da janela de 24 h; a marca terminal escondendo
// cobrança NOVA da vaga; o nome dos argumentos do carimbo divergindo entre a
// edge e o SQL (a RPC falharia em todo ciclo, calada — não fatal por desenho).
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
const NOME = "20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql";
const NOME_10 = "20261010000000_reconciliacao_alcanca_o_pedido_vivo.sql";
const NOME_76 = "20261176000000_o_cartao_online_nasce.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const m10 = ler(NOME_10);
const m76 = ler(NOME_76);
const cron = lerArquivo("supabase/functions/reconciliar-pagamentos/index.ts");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Do CREATE até o fechamento da dollar-quote `tag`. */
function funcao(sql, cabeca, tag) {
  const i = sql.indexOf(cabeca);
  assert(i >= 0, `${cabeca} não encontrada`);
  assertEquals(sql.indexOf(cabeca, i + 1), -1, `${cabeca} aparece 2x`);
  const r = sql.slice(i);
  const a = r.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  const b = r.indexOf(`${tag};`, a);
  return { texto: r.slice(0, b + tag.length + 1), corpo: r.slice(a, b) };
}
const FILA = "CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()";
const MARCAR =
  "CREATE OR REPLACE FUNCTION public.marcar_visitas_da_reconciliacao(";
const fila10 = funcao(m10, FILA, "$candidatos$");
const filaNova = funcao(migration, FILA, "$candidatos$");
const marcar = funcao(migration, MARCAR, "$marcar$");
const codigoFila = norm(semComentarios(filaNova.texto));

function comentarioLiberar(sql) {
  const marca =
    "COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS";
  const i = sql.lastIndexOf(marca);
  assert(i >= 0, "COMMENT de liberar não encontrado");
  const sqlComentario = sql.slice(i, sql.indexOf(";\n", i) + 1);
  const texto = [...sqlComentario.matchAll(/'((?:[^']|'')*)'/g)]
    .map((x) => x[1].replace(/''/g, "'"))
    .join("");
  return { sql: sqlComentario, texto };
}

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

Deno.test("ponto de partida: a 20261010 é a última OUTRA definição da fila; a tabela e o carimbo nascem aqui", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name) && e.name !== NOME)
    .map((e) => e.name)
    .sort();
  const fila = nomes.filter((n) =>
    ler(n).includes("FUNCTION public.pagamentos_a_reconciliar("),
  );
  assertEquals(fila.at(-1), NOME_10);
  assertEquals(
    nomes.filter((n) =>
      /reconciliacao_visitas|marcar_visitas_da_reconciliacao/.test(ler(n)),
    ),
    [],
  );
});

Deno.test("o preflight é o PRIMEIRO comando, recusa com RAISE EXCEPTION (nunca só aviso) e confere fila, tabela, carimbo, coluna e COMMENT", () => {
  const codigo = semComentarios(migration);
  const primeiro = codigo.search(
    /\b(DO|CREATE|ALTER|REVOKE|GRANT|COMMENT|DROP|INSERT|UPDATE)\b/,
  );
  assertEquals(
    codigo.slice(primeiro, primeiro + "DO $preflight_20261190$".length),
    "DO $preflight_20261190$",
  );
  const ini = migration.indexOf("DO $preflight_20261190$\nDECLARE");
  const fim = migration.indexOf("END $preflight_20261190$;", ini);
  const bloco = migration.slice(ini, fim);
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  for (const t of [
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marketplace_orders.metodo_online",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de pagamentos_a_reconciliar (hash %)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reconciliacao_visitas já existe com outra forma",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_visitas_da_reconciliacao já existe com outra forma",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o COMMENT de liberar_cobranca_do_pedido",
    "'order_id uuid NOT NULL, visitado_em timestamp with time zone NOT NULL, cobranca_terminal text'",
    "c.confrelid = 'public.marketplace_orders'::regclass",
    "c.confdeltype = 'c'",
  ])
    assertStringIncludes(bloco, t);
  assertEquals(
    detectarTransacaoExplicita(
      removerRuido(`${bloco}END $preflight_20261190$;`),
    ).achados,
    [],
  );
});

Deno.test("os hashes dos preflights são o md5 REAL dos corpos (fila da 20261010, fila nova, carimbo)", () => {
  const h10 = md5(fila10.corpo);
  const hNova = md5(filaNova.corpo);
  const hMarcar = md5(marcar.corpo);
  assertEquals(h10, "6b3fd779573e2badc52e02ab84fa931c");
  assert(h10 !== hNova);
  const pre = migration.slice(
    0,
    migration.indexOf("END $preflight_20261190$;"),
  );
  for (const h of [h10, hNova, hMarcar]) assertStringIncludes(pre, `'${h}'`);
  const preR = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261190$;"),
  );
  assertStringIncludes(preR, `IS DISTINCT FROM '${hNova}'`);
  assertStringIncludes(preR, `IS DISTINCT FROM '${hMarcar}'`);
  assert(!preR.includes(`'${h10}'`), "o rollback só desfaz o corpo NOVO");
  for (const s of [pre, preR])
    assertStringIncludes(s, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("a fila: mesma assinatura/retorno/LANGUAGE/SECURITY/search_path da 20261010, mesmos ramos de status e LIMIT", () => {
  const cab = (t) => norm(t.slice(0, t.indexOf("AS $candidatos$")));
  assertEquals(cab(filaNova.texto), cab(fila10.texto));
  for (const t of [
    "WHERE o.gateway_payment_id IS NOT NULL AND o.paid_at IS NULL",
    "o.payment_status = 'expirado' OR (o.payment_status = 'aguardando' AND o.status = 'cancelled') OR (o.payment_status = 'aguardando' AND o.status = 'pending')",
    "LIMIT 100;",
  ])
    assertStringIncludes(codigoFila, t);
});

Deno.test("a janela: 24 h para todos OU 14 dias só para cartão possivelmente vivo (sentinela ou crédito/débito), com COALESCE; 'pix' fora", () => {
  assertStringIncludes(
    codigoFila,
    "AND ( o.expires_at > now() - interval '24 hours' OR ( o.expires_at > now() - interval '14 days' AND COALESCE( o.gateway_payment_id LIKE 'verificando:%' OR o.metodo_online IN ('credito', 'debito'), false ) ) )",
  );
  assert(!/'pix'/i.test(codigoFila));
  assertEquals(
    codigoFila.split("interval '").length - 1,
    2,
    "só as duas janelas",
  );
});

Deno.test("rodízio e cobrança terminal: vivo primeiro, nunca visitado / mais antigo depois; a marca é do ID da cobrança", () => {
  assertStringIncludes(
    codigoFila,
    "LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id",
  );
  assertStringIncludes(
    codigoFila,
    "AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)",
  );
  assertStringIncludes(
    codigoFila,
    "ORDER BY (o.status = 'pending') DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC LIMIT 100;",
  );
});

Deno.test("objetos novos e ACL: tabela com RLS e sem anon/authenticated; carimbo SECURITY DEFINER só para service_role; fila e liberar sem GRANT/REVOKE", () => {
  const c = norm(semComentarios(migration));
  for (const t of [
    "CREATE TABLE IF NOT EXISTS public.reconciliacao_visitas ( order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders(id) ON DELETE CASCADE, visitado_em timestamptz NOT NULL, cobranca_terminal text );",
    "ALTER TABLE public.reconciliacao_visitas ENABLE ROW LEVEL SECURITY;",
    "REVOKE ALL ON TABLE public.reconciliacao_visitas FROM PUBLIC, anon, authenticated;",
    "REVOKE ALL ON FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]) FROM PUBLIC, anon, authenticated;",
    "GRANT EXECUTE ON FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]) TO service_role;",
    "RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $marcar$",
  ])
    assertStringIncludes(c, t);
  assert(!/(GRANT|REVOKE)[^;]*pagamentos_a_reconciliar/i.test(c));
  assert(!/(GRANT|REVOKE)[^;]*liberar_cobranca_do_pedido/i.test(c));
  // upsert ordenado (dois ciclos sobrepostos travam na mesma ordem)
  assertEquals(
    norm(semComentarios(marcar.corpo)).split("ORDER BY").length - 1,
    2,
  );
});

Deno.test("COMMENT de liberar_cobranca_do_pedido: o texto da 20261176 inteiro + a invariante; o rollback devolve o da 76 byte a byte", () => {
  const velho = comentarioLiberar(m76);
  const novo = comentarioLiberar(migration);
  assert(novo.texto.startsWith(velho.texto));
  assertStringIncludes(
    novo.texto.slice(velho.texto.length),
    "INVARIANTE: só esta RPC (liberar_cobranca_do_pedido) esvazia a vaga, e só por prova ou cancelamento confirmado",
  );
  assertEquals(comentarioLiberar(rollback).sql, velho.sql);
});

Deno.test("o rollback restaura o TEXTO da fila da 20261010 byte a byte, ANTES de apagar carimbo e tabela", () => {
  const f = funcao(rollback, FILA, "$candidatos$");
  assertEquals(f.texto, fila10.texto);
  const iFila = rollback.indexOf(FILA);
  const iDropF = rollback.indexOf(
    "DROP FUNCTION public.marcar_visitas_da_reconciliacao(uuid[], uuid[], text[]);",
  );
  const iDropT = rollback.indexOf("DROP TABLE public.reconciliacao_visitas;");
  assert(iFila > 0 && iDropF > iFila && iDropT > iDropF);
  assert(!/(GRANT|REVOKE)/i.test(semComentarios(rollback)));
});

Deno.test("contrato com a edge: o cron chama o carimbo com OS MESMOS nomes de argumento do SQL e só dá push no literal 'pago_apos_expirar'", () => {
  const c = norm(cron);
  assertStringIncludes(
    c,
    'supabase.rpc("marcar_visitas_da_reconciliacao", { p_visitados: visitados, p_terminais: terminais, p_cobrancas_terminais: cobrancasTerminais, });',
  );
  assertStringIncludes(
    norm(marcar.texto),
    "p_visitados uuid[], p_terminais uuid[] DEFAULT '{}', p_cobrancas_terminais text[] DEFAULT '{}'",
  );
  // FASE 2 (04/10/2026): os efeitos (push ao lojista, comprovante, aviso de
  // atraso) saem do módulo ÚNICO `_shared/efeitos-do-pagamento.ts`, o MESMO do
  // webhook, e só quando `confirmar_pagamento` diz que ESTA chamada confirmou
  // ('pago' ou 'pago_apos_expirar'). O cron não tem mais porta de push própria.
  assertStringIncludes(c, "if (desfechoComEfeito(resultado)) {");
  assertStringIncludes(c, "await aplicarEfeitosDoPagamentoConfirmado({");
  assertEquals(cron.split("dispararPushAoAdminReal").length - 1, 0, "nenhuma porta de push própria no cron");
  const efeitos = norm(lerArquivo("supabase/functions/_shared/efeitos-do-pagamento.ts"));
  assertStringIncludes(efeitos, 'if (resultado === "pago_apos_expirar") {');
});
