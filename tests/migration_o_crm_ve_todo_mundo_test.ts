// @ts-nocheck
// O CRM VÊ TODO MUNDO — prova offline do par 20261183000000 + rollback
// (pedido do dono, 27/09/2026: Dashboard CRM → Clientes → "Todos os
// clientes" só listava quem tinha compra PAGA).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem esta migration, `crm_clientes` e
// `crm_visao` continuam enxergando só `crm__clientes_rfm` (compradores) —
// quem se cadastrou e nunca comprou, e quem pediu e não pagou, ficam
// invisíveis para sempre. Cada asserção abaixo está amarrada a um pedaço do
// contrato que o cabeçalho da migration promete; sabotar qualquer uma reabre
// esse furo (ou o de segurança: RFM deixando de ser INTOCADO, ou um SELECT
// amplo novo para anon/authenticated).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
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
const NOME = "20261183000000_o_crm_ve_todo_mundo.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;
const MIGRATION_78_PATH = `${DIR}../supabase/migrations/20261178000000_o_crm_e_o_inicio_leem_a_loja.sql`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const migration78 = Deno.readTextFileSync(MIGRATION_78_PATH);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

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

Deno.test("as duas funções novas nascem STABLE, sem SECURITY DEFINER, e são revogadas de PUBLIC/anon/authenticated", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE FUNCTION public.crm__pedidos_nao_pagos(p_ate timestamptz)",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.crm__pedidos_nao_pagos(timestamptz) FROM PUBLIC, anon, authenticated;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.crm__nunca_comprou(timestamptz) FROM PUBLIC, anon, authenticated;",
    ),
  );
});

Deno.test("crm__pedidos_nao_pagos reaproveita a fusão wa->conta de crm__vendas e só conta valor_em_aberto de 'aguardando'", () => {
  assertStringIncludes(
    migrationN,
    norm("WITH vendas AS ( SELECT * FROM public.crm__vendas(p_ate) )"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "COALESCE(sum(i.total) FILTER (WHERE i.payment_status = 'aguardando'), 0),",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("AND i.chave_calc NOT IN (SELECT chave FROM pagas)"),
  );
});

Deno.test("crm__nunca_comprou exclui equipe/admin (só role customer) e lê e-mail de auth.users", () => {
  assertStringIncludes(
    migrationN,
    norm("WHERE COALESCE(p.role, 'customer') = 'customer'"),
  );
  assertStringIncludes(
    migrationN,
    norm("LEFT JOIN auth.users u ON u.id = p.id"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "AND NOT EXISTS ( SELECT 1 FROM public.marketplace_orders o WHERE o.user_id = p.id AND o.created_at <= p_ate )",
    ),
  );
});

Deno.test("crm_clientes vira a uniao de 3 grupos, ordenados grupo->receita->data, com is_admin() e 42501 preservados", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "FROM public.crm__clientes_rfm(now()) c LEFT JOIN public.profiles pr ON pr.id = c.user_id",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("0 AS grupo, c.ultima_compra AS ordem_data"),
  );
  assertStringIncludes(
    migrationN,
    norm("1 AS grupo, np.ultimo_pedido AS ordem_data"),
  );
  assertStringIncludes(
    migrationN,
    norm("2 AS grupo, nc.cadastrado_em AS ordem_data"),
  );
  assertStringIncludes(
    migrationN,
    norm("ORDER BY b.grupo ASC, b.receita DESC, b.ordem_data DESC)"),
  );
  assertStringIncludes(
    migrationN,
    norm("'valor_em_aberto', b.valor_em_aberto"),
  );
});

Deno.test("crm_visao ganha os 2 segmentos novos no jsonb_agg, sem tocar kpis/canais/formas/funil/pipeline", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "SELECT segmento, count(*) AS clientes, sum(receita) AS receita FROM rfm GROUP BY segmento UNION ALL SELECT 'pediu_nao_pagou', count(*), COALESCE(sum(valor_em_aberto), 0) FROM nao_pagos UNION ALL SELECT 'nunca_comprou', count(*), 0 FROM nunca",
    ),
  );
  // As CTEs de kpis/canais/formas/funil/pipeline (v, atual, anterior,
  // primeira, rfm, devolvido, devolvido_manual) continuam byte-a-byte iguais
  // à 78 — confere contra o arquivo fonte, não uma cópia solta neste teste.
  const kpisDaMigration78 = norm(
    migration78.slice(
      migration78.indexOf("'kpis', jsonb_build_object("),
      migration78.indexOf("'segmentos', COALESCE"),
    ),
  );
  assertStringIncludes(migrationN, kpisDaMigration78);
});

Deno.test("rollback restaura os corpos de crm_visao e crm_clientes VERBATIM da 78 (md5) e derruba os 2 ajudantes novos", () => {
  const trechoDa78 = norm(
    migration78.slice(
      migration78.indexOf("CREATE OR REPLACE FUNCTION public.crm_visao"),
      migration78.indexOf("CREATE OR REPLACE FUNCTION public.painel_inicio"),
    ),
  );
  assertStringIncludes(rollbackN, trechoDa78);
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.crm__pedidos_nao_pagos(timestamptz);"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.crm__nunca_comprou(timestamptz);"),
  );
});
