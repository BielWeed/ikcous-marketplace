// @ts-nocheck
// A VARREDURA DE CANCELADOS ENXERGA O CANCELAMENTO — prova offline do par
// 20261164000000 + rollback (frente pedidos-4, tarefa
// useOrders-cancelados-janela-e-colunas; achado central de useOrders-1417
// ainda aberto após a rodada b8800f8).
//
// O DEFEITO QUE ESTA MIGRATION FECHA: a varredura do painel de cancelados
// (fetchPedidosCancelados, src/hooks/useOrders.ts) chama get_admin_orders_
// paged com p_page_size 200 e recebe, para CADA pedido, o jsonb_agg de itens
// (com subconsulta de produto para imagem) e o endereço — arrasto que o
// painel NÃO lê (os dois baldes só usam id, nome, total, canal e quatro
// campos de decisão). E não há janela nenhuma: a varredura enxerga TODO o
// histórico de cancelados da loja, para sempre. A primeira tentativa de
// janela (WIP de 17/09) recortou por p_start_date — data de CRIAÇÃO — e a
// revisão reprovou com BLOQUEIA: pedido criado há 100 dias e cancelado
// ONTEM sumiria da lista de pendências. A janela certa é sobre a data do
// CANCELAMENTO, que hoje só existe no marketplace_order_history (linha com
// new_status = 'cancelled'); para pedido legado sem linha de histórico, o
// fallback é o updated_at da própria ordem.
//
// Cada asserção abaixo está amarrada a uma dessas ameaças, ou às armadilhas
// que já custaram caro neste repositório: reintroduzir BEGIN/COMMIT (gravou
// em produção uma vez), nascer com EXECUTE para PUBLIC (default do Postgres
// depois de qualquer CREATE FUNCTION) e recortar a janela pela data errada.
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
const NOME =
  "20261164000000_a_varredura_de_cancelados_enxerga_o_cancelamento.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();

// Mesma decisão do arquivo-molde (migration_o_codigo_de_barras_...): só
// apagar comentário, sem `removerRuido` — metade do que esta migration
// promete está em string literal (`'cancelled'`, `'fora_da_janela'`).
const corpo = (s) => norm(s.replace(/^[ \t]*--.*$/gm, ""));
const migrationSql = corpo(migration);
const rollbackSql = corpo(rollback);

const ASSINATURA =
  "CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90::integer, p_page integer DEFAULT 0::integer, p_page_size integer DEFAULT 200)";

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("a RPC nova nasce com os tres argumentos e defaults que o front trava", () => {
  assertStringIncludes(migrationSql, ASSINATURA);
});

Deno.test("SECURITY DEFINER com search_path fixo e o gate de admin no corpo", () => {
  const blocoFuncao = blocoEntre(migrationSql, ASSINATURA, "$function$;");
  assertStringIncludes(blocoFuncao, "SECURITY DEFINER");
  assertStringIncludes(
    blocoFuncao,
    "SET search_path TO 'public', 'extensions'",
  );
  assertStringIncludes(blocoFuncao, "IF NOT public.is_admin() THEN");
  assertStringIncludes(blocoFuncao, "RAISE EXCEPTION");
});

Deno.test("BLOQUEIA da revisao: a janela recorta pela data do CANCELAMENTO, nunca pela de criacao", () => {
  const blocoFuncao = blocoEntre(migrationSql, ASSINATURA, "$function$;");
  // A data do cancelamento: ultima entrada 'cancelled' no histórico —
  // exatamente esta conjunção, sem reescrever de outro jeito.
  assertStringIncludes(blocoFuncao, "hi.new_status = 'cancelled'");
  assertStringIncludes(
    blocoFuncao,
    norm(
      "COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias)",
    ),
  );
  // O recorte por CRIAÇÃO era o defeito do WIP reprovado: se um dia
  // reaparecer aqui, o pedido antigo cancelado ontem some do painel de
  // pendências em silêncio.
  assert(
    !blocoFuncao.includes("o.created_at >="),
    "a janela NÃO pode recortar por o.created_at — é o BLOQUEIA da revisão de 17/09 (pedido criado há 100 dias e cancelado ontem sumiria da lista)",
  );
});

Deno.test("pedido legado sem linha de historico cai no updated_at (COALESCE presente na janela E na ordenacao)", () => {
  // A varredura tem de enxergar cancelado anterior à criação do histórico
  // (20261140000000 não o alimentou retroativamente): sem o COALESCE, todo
  // cancelado legado sairía da janela — a pendência de dinheiro mais velha
  // é justamente a que o painel não pode perder.
  const ocorrencias =
    migrationSql.split("COALESCE(h.cancelado_em, o.updated_at)").length - 1;
  assert(
    ocorrencias >= 3,
    `esperado COALESCE(h.cancelado_em, o.updated_at) na contagem, no recorte e na ordenação; achado ${ocorrencias}x`,
  );
});

Deno.test("colunas minimas: a funcao NAO toca itens nem endereco (o arrasto que a tarefa corta)", () => {
  // O painel de cancelados não lê itens nem endereço (medido em
  // AlertasCancelados.tsx e nos dois baldes de AdminOrdersView.tsx): o
  // jsonb_agg de itens — com subconsulta de imagem por item — e o JOIN de
  // user_addresses são o custo que esta RPC deixa de pagar. Se um deles
  // voltar, a varredura voltou a baixar o pedido inteiro por linha.
  const limpo = norm(removerRuido(migration)).toUpperCase();
  assert(
    !limpo.includes("MARKETPLACE_ORDER_ITEMS"),
    "a RPC de cancelados não pode consultar marketplace_order_items — é o arrasto que a tarefa corta",
  );
  assert(
    !limpo.includes("USER_ADDRESSES"),
    "a RPC de cancelados não pode consultar user_addresses — o endereço vem do snapshot do customer_data no mapper",
  );
});

Deno.test("a projecao devolve as colunas que o painel e o mapper leem", () => {
  const blocoFuncao = blocoEntre(migrationSql, ASSINATURA, "$function$;");
  for (const chave of [
    "'id'",
    "'user_id'",
    "'customer_name'",
    "'customer_data'",
    "'total'",
    "'payment_method'",
    "'payment_status'",
    "'status'",
    "'cancelled_after_shipping'",
    "'returned_to_seller_at'",
    "'pagamento_recebido_em'",
    "'canal'",
    "'vendedor_id'",
    "'created_at'",
    "'updated_at'",
    "'cancelado_em'",
  ]) {
    assertStringIncludes(blocoFuncao, chave);
  }
});

Deno.test("o retorno declara data, total_count e fora_da_janela (a honestidade sobre quem ficou fora)", () => {
  const blocoReturn = blocoEntre(
    migrationSql,
    "RETURN jsonb_build_object(",
    "END;",
  );
  assertStringIncludes(blocoReturn, "'data'");
  assertStringIncludes(blocoReturn, "'total_count'");
  assertStringIncludes(blocoReturn, "'fora_da_janela'");
});

Deno.test("fora_da_janela e 0 quando p_dias e nulo (sem janela = varredura completa, nunca mentiu)", () => {
  const blocoFuncao = blocoEntre(migrationSql, ASSINATURA, "$function$;");
  // A contagem de fora só existe sob janela; com p_dias NULL ela tem de
  // valer 0 — um "há mais antigos" inventado acenderia o aviso na tela para
  // sempre.
  assertStringIncludes(
    blocoFuncao,
    norm(
      "COUNT(*) FILTER ( WHERE p_dias IS NOT NULL AND cancelado_em < now() - make_interval(days => p_dias) )",
    ),
  );
});

Deno.test("grants: anon perde, authenticated e service_role ganham EXECUTE (mold 20261163000000)", () => {
  const assinaturaCompleta =
    "public.get_admin_orders_cancelados_recentes(integer, integer, integer)";
  assertStringIncludes(
    migrationSql,
    norm(`REVOKE ALL ON FUNCTION ${assinaturaCompleta} FROM PUBLIC, anon;`),
  );
  assertStringIncludes(
    migrationSql,
    norm(`GRANT EXECUTE ON FUNCTION ${assinaturaCompleta} TO authenticated;`),
  );
  assertStringIncludes(
    migrationSql,
    norm(`GRANT EXECUTE ON FUNCTION ${assinaturaCompleta} TO service_role;`),
  );
  // O REVOKE tem de vir DEPOIS do CREATE — função nova nasce com EXECUTE
  // para PUBLIC, mas revogar antes de existir é erro de SQL.
  assert(
    migrationSql.indexOf(ASSINATURA) <
      migrationSql.indexOf(`REVOKE ALL ON FUNCTION ${assinaturaCompleta}`),
    "o REVOKE tem de vir depois do CREATE FUNCTION",
  );
});

Deno.test("nenhuma linha de seed: a migration nao escreve DADO em pedido nenhum", () => {
  const limpo = norm(removerRuido(migration)).toUpperCase();
  for (const tabela of ["MARKETPLACE_ORDERS", "MARKETPLACE_ORDER_HISTORY"]) {
    assert(
      !limpo.includes(`INSERT INTO PUBLIC.${tabela}`),
      `migration contém INSERT em ${tabela} — esta migration é só de catálogo de funções`,
    );
    assert(
      !limpo.includes(`UPDATE PUBLIC.${tabela}`),
      `migration contém UPDATE em ${tabela} — esta migration é só de catálogo de funções`,
    );
    assert(
      !limpo.includes(`DELETE FROM PUBLIC.${tabela}`),
      `migration contém DELETE em ${tabela} — esta migration é só de catálogo de funções`,
    );
  }
});

Deno.test("rollback derruba exatamente a assinatura que a migration criou", () => {
  assertStringIncludes(
    rollbackSql,
    norm(
      "DROP FUNCTION IF EXISTS public.get_admin_orders_cancelados_recentes(integer, integer, integer);",
    ),
  );
  // O rollback desta migration é só o DROP: a função não existia antes, não
  // há definição a restaurar — e o DROP leva o ACL junto.
  assert(
    !rollbackSql.includes("CREATE FUNCTION") &&
      !rollbackSql.includes("CREATE OR REPLACE FUNCTION"),
    "o rollback não recria função nenhuma — a RPC não existia antes desta migration",
  );
});

/** Recorta o bloco entre `inicio` e o primeiro `fim` depois dele (molde do arquivo-molde). */
function blocoEntre(sqlSemComentario, inicio, fim) {
  const i = sqlSemComentario.indexOf(inicio);
  assert(i !== -1, `trecho não encontrado: ${inicio}`);
  const j = sqlSemComentario.indexOf(fim, i);
  assert(j !== -1, `fim do trecho não encontrado: ${fim}`);
  return sqlSemComentario.slice(i, j + fim.length);
}
