// @ts-nocheck
// "JÁ ESTORNEI" FECHA A CORRIDA COM O CRON — prova offline do par
// 20261189000000 + rollback (dinheiro, 02/10/2026). O COMPORTAMENTO da função
// (a corrida com o cron REAL, recusado/recusa, travas, aplicar->desfazer->
// aplicar, ACL) foi provado executando o SQL destes arquivos em Postgres real
// (PGlite) à parte — o repositório não tem PGlite; aqui fica o que se prova
// só lendo o texto, no `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: hash do preflight que não é o md5
// real recusa a migration num banco CORRETO (ou aceita corpo errado);
// rollback que não bate byte a byte com a 20261176 deixa a regra nova presa
// depois de "revertida"; migration posterior à 20261176 que redefina a função
// sem este par saber faz o preflight recusar (ou o rollback apagar a dela);
// GRANT/REVOKE repetido muda a ACL; e — o contrato com OUTRO módulo — se a
// marca do cron ou da edge deixar de ser UPDATE condicional por status, levar
// a linha a `recusado` deixa de impedir o POST e a corrida volta.
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
const NOME = "20261189000000_ja_estornei_fecha_a_corrida_com_o_cron.sql";
const NOME_76 = "20261176000000_o_cartao_online_nasce.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration76 = ler(NOME_76);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);

const MARCADOR =
  "\nCREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)";
// Da assinatura até o fechamento `$$;` — o texto da função.
const funcao = (sql) => {
  const i = sql.indexOf(MARCADOR);
  assert(i >= 0, "registrar_estorno_manual não encontrada");
  assertEquals(
    sql.indexOf(MARCADOR, i + 1),
    -1,
    "registrar_estorno_manual aparece 2x",
  );
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
// O corpo (o que o Postgres grava em prosrc): entre `AS $$` e `$$;`.
const corpo = (sql) => {
  const f = funcao(sql);
  return f.slice(f.indexOf("AS $$") + "AS $$".length, f.length - "$$;".length);
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigoNovo = norm(semComentarios(funcao(migration)));

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
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
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("o ponto de partida é a 20261176: nenhuma OUTRA migration redefine registrar_estorno_manual depois dela", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter(
      (n) =>
        n !== NOME &&
        ler(n).includes("FUNCTION public.registrar_estorno_manual("),
    )
    .sort();
  assertEquals(nomes.at(-1), NOME_76);
});

Deno.test("assinatura, RETURNS, SECURITY DEFINER e search_path iguais aos da 20261176", () => {
  const cabecalho = (sql) =>
    norm(funcao(sql).slice(0, funcao(sql).indexOf("AS $$") + "AS $$".length));
  const esperado =
    "CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid) " +
    "RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$";
  assertEquals(cabecalho(migration76), esperado);
  assertEquals(cabecalho(migration), esperado);
  assertEquals(cabecalho(rollback), esperado);
});

Deno.test("a migration e o rollback não repetem GRANT/REVOKE nem COMMENT — ACL e metadado herdados do CREATE OR REPLACE", () => {
  for (const sql of [migration, rollback]) {
    const limpo = semComentarios(sql);
    assert(!/\bGRANT\b/i.test(limpo), "GRANT repetido");
    assert(!/\bREVOKE\b/i.test(limpo), "REVOKE repetido");
    assert(!/\bCOMMENT\s+ON\b/i.test(limpo), "COMMENT ON novo");
  }
});

Deno.test("o rollback restaura o TEXTO da função da 20261176 byte a byte", () => {
  assertEquals(funcao(rollback), funcao(migration76));
  assertEquals(md5(corpo(rollback)), md5(corpo(migration76)));
  assert(
    !corpo(rollback).includes("order_refunds"),
    "o corpo antigo não olha o ledger",
  );
});

Deno.test("os hashes dos preflights são o md5 REAL dos corpos (20261176 e desta migration)", () => {
  const hashAntigo = md5(corpo(migration76));
  const hashNovo = md5(corpo(migration));
  assertEquals(hashAntigo, "ed824820fbe1ea1503c9afe58a9edcbb");
  assert(hashAntigo !== hashNovo, "a migration precisa mudar o corpo");
  const preflight = migration.slice(0, migration.indexOf(MARCADOR));
  assertStringIncludes(preflight, `'${hashAntigo}'`);
  assertStringIncludes(preflight, `'${hashNovo}'`);
  assertStringIncludes(preflight, "md5(replace(prosrc, E'\\r', ''))");
  const preflightRollback = rollback.slice(0, rollback.indexOf(MARCADOR));
  assertStringIncludes(preflightRollback, `IS DISTINCT FROM '${hashNovo}'`);
  assert(
    !preflightRollback.includes(`'${hashAntigo}'`),
    "o rollback só desfaz o corpo NOVO",
  );
  assertStringIncludes(preflightRollback, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("os preflights vêm ANTES do CREATE, apontam para a função certa e recusam com B1_BASELINE_DIVERGENT", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261189$\nDECLARE"],
    [rollback, "DO $preflight_rollback_20261189$\nDECLARE"],
  ]) {
    const ini = sql.indexOf(bloco);
    const create = sql.indexOf(MARCADOR);
    assert(ini >= 0 && create > ini, `${bloco} precisa vir antes do CREATE`);
    const trecho = sql.slice(ini, create);
    assertStringIncludes(
      trecho,
      "to_regprocedure('public.registrar_estorno_manual(uuid)')",
    );
    // A recusa do HASH (não só a de coluna): RAISE EXCEPTION, nunca NOTICE.
    assertStringIncludes(
      trecho,
      "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %)",
    );
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(trecho),
      "preflight que só avisa não recusa",
    );
    assertEquals(detectarTransacaoExplicita(removerRuido(trecho)).achados, []);
  }
  assertStringIncludes(
    m,
    "AND table_name = 'order_refunds' AND column_name IN ('order_id', 'status', 'ultimo_erro', 'updated_at') ) <> 4",
  );
});

Deno.test("a regra: trava linha -> pedido -> releitura, recusa em_processamento ANTES de gravar, e só a linha 'solicitado' vira 'recusado'", () => {
  const c = codigoNovo;
  const i1 = c.indexOf(
    "AND viva.status IN ('solicitado', 'em_processamento') ORDER BY viva.id FOR UPDATE OF viva;",
  );
  const i2 = c.indexOf(
    "FROM public.marketplace_orders o WHERE o.id = p_order_id FOR UPDATE OF o;",
  );
  const i3 = c.indexOf(
    "AND releitura.status IN ('solicitado', 'em_processamento') ORDER BY releitura.id FOR UPDATE OF releitura;",
  );
  const i4 = c.indexOf(
    "INTO v_em_processamento, v_disputa_em_curso FROM public.order_refunds r WHERE r.order_id = p_order_id AND r.status = 'em_processamento'; IF v_em_processamento THEN RAISE EXCEPTION 'O Mercado Pago já está devolvendo",
  );
  const i5 = c.indexOf(
    "IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN",
  );
  const i6 = c.indexOf(
    "UPDATE public.order_refunds r SET status = 'recusado', ultimo_erro = 'A loja registrou a devolução feita fora do app', updated_at = now() WHERE r.order_id = p_order_id AND r.status = 'solicitado';",
  );
  const i7 = c.indexOf(
    "UPDATE public.marketplace_orders SET payment_status = 'estornado'",
  );
  assert(
    i1 >= 0 && i2 > i1 && i3 > i2 && i4 > i3 && i5 > i4 && i6 > i5 && i7 > i6,
    `ordem: ${[i1, i2, i3, i4, i5, i6, i7]}`,
  );
  assertStringIncludes(
    c,
    "faça-a pelo painel do Mercado Pago, nunca por outro caminho.",
  );
  // Linha do SISTEMA (disputa no MP): recusa com texto PRÓPRIO — o app não pediu devolução nenhuma.
  assertStringIncludes(
    c,
    "COALESCE(bool_or(r.solicitado_por IS DISTINCT FROM 'sistema'), false), COALESCE(bool_or(r.solicitado_por = 'sistema'), false)",
  );
  assertStringIncludes(
    c,
    "IF v_disputa_em_curso THEN RAISE EXCEPTION 'Há uma disputa ou devolução do Mercado Pago em andamento para este pedido. Acompanhe pelo painel do Mercado Pago; não devolva por outro meio.' USING ERRCODE = '22023';",
  );
  // NULL em payment_status não pode virar "já estornado" (NOT NULL = NULL pularia tudo).
  assertStringIncludes(c, "COALESCE(o.payment_status = 'estornado', false)");
  // Só uma escrita no ledger, e só em 'solicitado'.
  assertEquals(c.split("UPDATE public.order_refunds").length - 1, 1);
});

Deno.test("contrato com o cron e a edge: as marcas antes do MP são UPDATE CONDICIONAL por status (a linha 'recusado' devolve 0 linhas)", () => {
  const cron = norm(
    lerArquivo("supabase/functions/reconciliar-pagamentos/index.ts"),
  );
  assertStringIncludes(
    cron,
    '.update({ status: "em_processamento", tentativas: Number(refund.tentativas ?? 0) + 1, updated_at: new Date().toISOString(), }) .eq("id", refund.id) .in("status", ["solicitado"]) .select(); if (erroMarca) throw erroMarca; if (!Array.isArray(marcada) || marcada.length === 0) { refundsAdiados++; continue; }',
  );
  const edge = norm(
    lerArquivo("supabase/functions/estornar-pagamento/index.ts"),
  );
  assertStringIncludes(
    edge,
    ".eq('id', refundId) .in('status', ['solicitado', 'em_processamento']) .neq('solicitado_por', 'sistema') .select()",
  );
  assertStringIncludes(
    edge,
    "if (!Array.isArray(marcada) || marcada.length === 0) {",
  );
});
