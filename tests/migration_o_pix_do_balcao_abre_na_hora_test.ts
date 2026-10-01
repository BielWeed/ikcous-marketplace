// @ts-nocheck
// O PIX DO BALCÃO ABRE NA HORA — prova offline da 20261184000000 e do
// rollback conjunto 84/85 (frente A, docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md).
//
// O DEFEITO QUE ESTE TESTE FIXA: "PIX na hora" gravava a venda JÁ PAGA no
// clique (20261162000000:386), sem cobrança nenhuma. A RPC nova faz o pedido
// nascer À ESPERA do PIX, como um pedido do site, e um gatilho marca a
// entrega quando o pagamento é confirmado. Cada asserção abaixo amarra uma
// das travas; sabotar qualquer uma reabre o buraco correspondente.
//
// Prova ESTÁTICA (texto do par). O comportamento — reserva e devolução de
// estoque, idempotência, gatilho, Financeiro — é provado contra um Postgres
// de verdade em tests/banco/pix-do-balcao-viva.cjs (job rpc-ci).
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
const NOME = "20261184000000_o_pix_do_balcao_abre_na_hora.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../scripts/sql/pix-84-85-revert.sql`,
);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

const ASSINATURA =
  "public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)";

// Corpo da RPC (o primeiro par de $function$) e corpo do gatilho (o segundo).
function corpos() {
  const marcas = [];
  let i = migration.indexOf("$function$");
  while (i !== -1) {
    marcas.push(i);
    i = migration.indexOf("$function$", i + 1);
  }
  assertEquals(marcas.length, 6, "três funções, três pares de $function$");
  return [
    migration.slice(marcas[0] + 10, marcas[1]),
    migration.slice(marcas[2] + 10, marcas[3]),
  ];
}
const [corpoRpc, corpoGatilho] = corpos();
const corpoRpcN = norm(corpoRpc);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("assinatura: chave de idempotencia OBRIGATORIA em 2o lugar, SECURITY DEFINER, search_path fechado", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE OR REPLACE FUNCTION public.iniciar_venda_presencial_pix(p_itens jsonb, p_idempotency_key uuid, p_cliente_user_id uuid DEFAULT NULL, p_cliente_nome text DEFAULT NULL, p_cliente_whatsapp text DEFAULT NULL, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL)
       RETURNS jsonb
       LANGUAGE plpgsql
       SECURITY DEFINER
       SET search_path = pg_catalog, pg_temp`,
    ),
  );
  assertStringIncludes(
    corpoRpcN,
    norm(
      `IF p_idempotency_key IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023'`,
    ),
  );
});

Deno.test("o gate de admin e' a PRIMEIRA instrucao do corpo", () => {
  const posBegin = corpoRpc.indexOf("\nBEGIN");
  const posGate = corpoRpc.indexOf("public.is_admin()");
  assert(posBegin !== -1 && posGate > posBegin);
  assertEquals(
    norm(removerRuido(corpoRpc.slice(posBegin + "\nBEGIN".length, posGate))),
    "IF",
  );
  assertStringIncludes(corpoRpcN, norm("v_vendedor := auth.uid();"));
});

Deno.test("o pedido nasce A ESPERA do PIX: pending/aguardando/online/pix/presencial, 30 min, sem recebimento", () => {
  const inicio = corpoRpc.indexOf("INSERT INTO public.marketplace_orders");
  const fim = corpoRpc.indexOf("RETURNING id INTO v_order_id", inicio);
  assert(inicio !== -1 && fim !== -1, "INSERT do pedido não encontrado");
  const bloco = norm(corpoRpc.slice(inicio, fim));
  assertStringIncludes(
    bloco,
    norm(
      "payment_method, metodo_online, status, payment_status, expires_at, vendedor_id, canal",
    ),
  );
  assertStringIncludes(
    bloco,
    norm(
      "'online', 'pix', 'pending', 'aguardando', now() + interval '30 minutes', v_vendedor, 'presencial'",
    ),
  );
  for (const proibido of [
    "pagamento_recebido_em",
    "pagamento_recebido_por",
    "'recebido_na_entrega'",
    "'delivered'",
  ]) {
    assert(
      !bloco.includes(proibido),
      `o PIX nasce sem dinheiro recebido — ${proibido} não pode estar no INSERT`,
    );
  }
});

Deno.test("idempotencia casa por canal + vendedor + forma 'online', ANTES da checagem de PIX ligado", () => {
  const guarda = norm(
    `IF v_canal_existente IS DISTINCT FROM 'presencial'
       OR v_vendedor_existente IS DISTINCT FROM v_vendedor
       OR v_metodo_existente IS DISTINCT FROM 'online' THEN
         RAISE EXCEPTION USING ERRCODE='23505'`,
  );
  // Duas vezes: a checagem inicial e o ramo da corrida (unique_violation).
  assertEquals(corpoRpcN.split(guarda).length - 1, 1);
  assertStringIncludes(
    corpoRpcN,
    norm(
      `OR v_vendedor_existente IS DISTINCT FROM v_vendedor
       OR v_metodo_existente IS DISTINCT FROM 'online' THEN
         RAISE EXCEPTION USING ERRCODE='23505'`,
    ),
  );
  assertEquals(
    (corpoRpcN.match(/v_metodo_existente IS DISTINCT FROM 'online'/g) || [])
      .length,
    2,
    "a guarda de forma vale na leitura inicial E na corrida",
  );
  const posIdem = corpoRpc.indexOf(
    "WHERE o.idempotency_key = p_idempotency_key",
  );
  const posLigado = corpoRpc.indexOf(
    "public.forma_de_pagamento_aceita('online')",
  );
  assert(posIdem !== -1 && posLigado !== -1);
  assert(
    posIdem < posLigado,
    "retry de venda que já nasceu não pode ser barrado pelo interruptor",
  );
});

Deno.test("total zero nao vira PIX e desconto maior que a venda e' recusado", () => {
  assertStringIncludes(
    corpoRpcN,
    norm(
      `IF v_total <= 0 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Um PIX precisa de valor maior que zero.';`,
    ),
  );
  assertStringIncludes(corpoRpcN, norm("IF v_desconto > v_subtotal THEN"));
  assertStringIncludes(
    corpoRpcN,
    norm(
      "IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN",
    ),
  );
});

Deno.test("preco do banco com trava e reserva de estoque XOR guardada por ROW_COUNT", () => {
  assertEquals((corpoRpcN.match(/FOR NO KEY UPDATE/g) || []).length, 2);
  assertEquals(
    (corpoRpcN.match(/UPDATE public\.(product_variants|produtos) SET/g) || [])
      .length,
    2,
  );
  assertStringIncludes(corpoRpcN, norm("AND stock_increment >= v_quantity"));
  assertStringIncludes(corpoRpcN, norm("AND estoque >= v_quantity"));
  const limpo = removerRuido(migration);
  for (const proibido of ["p_vendedor", "p_total", "p_preco", "p_subtotal"]) {
    assert(
      /* eslint-disable-next-line security/detect-non-literal-regexp --
       * nome de parâmetro desta mesma lista, nunca entrada externa. */
      !new RegExp(`\\b${proibido}\\b`, "i").test(limpo),
      `a RPC não pode ter parâmetro ${proibido}`,
    );
  }
});

Deno.test("so' o historico do PEDIDO nasce — payment_history e' do recebimento manual", () => {
  assertStringIncludes(
    corpoRpcN,
    norm(
      `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
       VALUES (v_order_id, NULL, 'pending', 'Venda no balcão — aguardando o PIX', v_vendedor);`,
    ),
  );
  assert(!corpoRpc.includes("marketplace_order_payment_history"));
});

Deno.test("grants: EXECUTE so' para authenticated; funcao do gatilho sem EXECUTE para ninguem", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon, authenticated, service_role;`,
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated;`),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.venda_do_balcao_paga_e_entregue() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert(
    !/GRANT[^;]*venda_do_balcao_paga_e_entregue/i.test(migrationN),
    "ninguém executa a função do gatilho diretamente",
  );
});

Deno.test("o gatilho e' estreito: so' balcao, so' aguardando->pago, so' pedido ainda pending", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE TRIGGER tr_venda_do_balcao_paga_e_entregue
        BEFORE UPDATE OF payment_status ON public.marketplace_orders
        FOR EACH ROW
        WHEN (
          OLD.canal = 'presencial'
          AND OLD.payment_status = 'aguardando'
          AND NEW.payment_status = 'pago'
          AND OLD.status = 'pending'
          AND NEW.status = 'pending'
        )
        EXECUTE FUNCTION public.venda_do_balcao_paga_e_entregue();`,
    ),
  );
  const g = norm(corpoGatilho);
  assertStringIncludes(g, "NEW.status := 'delivered';");
  // Não mexe em dinheiro nem em estoque.
  for (const proibido of [
    "payment_status :=",
    "NEW.total",
    "devolver_estoque",
    "UPDATE public.",
    "paid_at",
  ]) {
    assert(!g.includes(proibido), `o gatilho não pode tocar ${proibido}`);
  }
});

Deno.test("a migration NAO recria as vizinhas do dinheiro", () => {
  for (const vizinha of [
    "registrar_venda_presencial",
    "confirmar_pagamento",
    "expirar_pedidos_vencidos",
    "update_order_status_atomic",
    "devolver_estoque",
    "fin__conta_da_forma",
    "fin__forma_do_pedido",
    "fin__movimentos",
  ]) {
    assert(
      /* eslint-disable-next-line security/detect-non-literal-regexp --
       * nome de função desta mesma lista, nunca entrada externa. */
      !new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${vizinha}\\b`,
        "i",
      ).test(migration),
      `a migration recria public.${vizinha}`,
    );
  }
  assert(!/ALTER\s+TABLE/i.test(removerRuido(migration)), "nenhum ALTER TABLE");
});

Deno.test("rollback: derruba gatilho e as duas funcoes pela assinatura completa, sem recriar nada", () => {
  assertStringIncludes(
    rollbackN,
    "DROP TRIGGER tr_venda_do_balcao_paga_e_entregue ON public.marketplace_orders;",
  );
  assertStringIncludes(
    rollbackN,
    "DROP FUNCTION public.venda_do_balcao_paga_e_entregue();",
  );
  assertStringIncludes(rollbackN, `DROP FUNCTION ${ASSINATURA};`);
  const limpo = removerRuido(rollback);
  assert(!/CREATE\s+(?:FUNCTION|TRIGGER|OR\s+REPLACE)/i.test(limpo));
});

Deno.test("preflight das dependências (74, 76, 60) antes de criar qualquer função", () => {
  const pos = migration.indexOf("DO $preflight$");
  assert(pos !== -1 && pos < migration.indexOf("CREATE OR REPLACE FUNCTION"));
  for (const falta of [
    "column_name = 'metodo_online'",
    "to_regprocedure('public.forma_de_pagamento_aceita(text)')",
    "to_regprocedure('public.devolver_estoque(uuid)')",
  ]) {
    assertStringIncludes(migration, falta);
  }
});

Deno.test("guarda do status: só a loja com sessão; PIX aguardando não avança; só balcão", () => {
  assertStringIncludes(
    migrationN,
    norm(`CREATE TRIGGER tr_venda_do_balcao_guarda_o_status
      BEFORE UPDATE OF status ON public.marketplace_orders
      FOR EACH ROW
      WHEN (OLD.canal = 'presencial' AND NEW.status IS DISTINCT FROM OLD.status)
      EXECUTE FUNCTION public.venda_do_balcao_guarda_o_status();`),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "IF auth.uid() IS NOT NULL AND public.is_admin() IS DISTINCT FROM true THEN",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      `IF OLD.payment_status = 'aguardando' AND NEW.payment_status = 'aguardando' AND NEW.status IN ('processing', 'shipping', 'delivered') THEN`,
    ),
  );
  assertStringIncludes(
    rollbackN,
    "DROP TRIGGER tr_venda_do_balcao_guarda_o_status ON public.marketplace_orders;",
  );
  assertStringIncludes(
    rollbackN,
    "DROP FUNCTION public.venda_do_balcao_guarda_o_status();",
  );
});
