// @ts-nocheck
/**
 * As duas migrations do cartão (plano
 * docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T4),
 * conferidas offline contra o .sql — sem banco.
 *
 * O que erra caro aqui:
 *   - a RPC `confirmar_pagamento` mudar ALÉM do ramo 'recusado' (a função é
 *     a ÚNICA escrita de pagamento; um REPLACE que perdesse uma guarda do
 *     ramo 'pago' confirmaria dinheiro errado);
 *   - a policy nova abrir OUTRA linha de `app_settings` — a
 *     `pagamentos_mercado_pago` guarda o Access Token cifrado.
 */
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const MIG = `${DIR}../supabase/migrations/`;
const NOME_RPC = "20261160000000_a_recusa_do_cartao_nao_derruba_o_pedido.sql";
const NOME_POLICY = "20261160000100_o_cliente_le_a_configuracao_do_cartao.sql";

const rpc = Deno.readTextFileSync(`${MIG}${NOME_RPC}`);
const rpcRollback = Deno.readTextFileSync(`${MIG}rollback-manual-${NOME_RPC}`);
const policy = Deno.readTextFileSync(`${MIG}${NOME_POLICY}`);
const policyRollback = Deno.readTextFileSync(
  `${MIG}rollback-manual-${NOME_POLICY}`,
);
const anterior = Deno.readTextFileSync(
  `${MIG}20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql`,
);

/** O corpo de `confirmar_pagamento` (do CREATE até o `$confirmar$;`). */
function corpoDaFuncao(sql: string): string {
  const inicio = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.confirmar_pagamento(",
  );
  const fim = sql.indexOf("$confirmar$;", inicio);
  assert(inicio >= 0 && fim > inicio, "confirmar_pagamento não encontrada");
  return sql.slice(inicio, fim + "$confirmar$;".length);
}

/** Tira o ramo `IF p_status = 'recusado'` inteiro, para comparar o resto. */
function semRamoRecusado(corpo: string): string {
  const inicio = corpo.indexOf("    IF p_status = 'recusado' THEN");
  const fim = corpo.indexOf(
    "    -- 'aguardando' vindo do MP (pending/in_process) cai aqui",
  );
  assert(inicio >= 0 && fim > inicio, "ramo 'recusado' não encontrado");
  return corpo.slice(0, inicio) + corpo.slice(fim);
}

Deno.test("avaliarFase0 não recusa nenhum dos dois pares migration+rollback", () => {
  for (const [sqlMigration, sqlRollback] of [
    [rpc, rpcRollback],
    [policy, policyRollback],
  ]) {
    const r = avaliarFase0({ sqlMigration, sqlRollback, temRollback: true });
    assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  }
});

Deno.test("confirmar_pagamento: FORA do ramo 'recusado', a função é idêntica à de 20260901000000", () => {
  assertEquals(
    semRamoRecusado(corpoDaFuncao(rpc)),
    semRamoRecusado(corpoDaFuncao(anterior)),
  );
});

Deno.test("confirmar_pagamento: recusa em pedido vivo não devolve estoque nem cancela", () => {
  const corpo = corpoDaFuncao(rpc);
  const ramo = corpo.slice(
    corpo.indexOf("    IF p_status = 'recusado' THEN"),
    corpo.indexOf(
      "    -- 'aguardando' vindo do MP (pending/in_process) cai aqui",
    ),
  );
  // Sem comentários: o comentário do ramo CITA o comportamento antigo.
  const codigo = ramo.replace(/^\s*--.*$/gm, "");
  assertEquals(codigo.includes("devolver_estoque"), false);
  assertEquals(codigo.includes("'cancelled'"), false);
  // Bloco amarrado: o rótulo novo é o FIM do ramo, depois da guarda de
  // pedido que já saiu de 'pending'.
  assertStringIncludes(
    ramo,
    "            RETURN 'recusado';\n        END IF;\n\n",
  );
  assert(ramo.trimEnd().endsWith("RETURN 'tentativa_recusada';\n    END IF;"));
});

Deno.test("rollback da RPC devolve o corpo de 20260901000000 byte a byte", () => {
  assertEquals(corpoDaFuncao(rpcRollback), corpoDaFuncao(anterior));
});

Deno.test("policy: só a linha 'pagamentos_cartao', só SELECT, só authenticated", () => {
  assertStringIncludes(
    policy,
    "CREATE POLICY app_settings_config_cartao_select_policy\n" +
      "    ON public.app_settings\n" +
      "    FOR SELECT\n" +
      "    TO authenticated\n" +
      "    USING (key = 'pagamentos_cartao');",
  );
  // Nenhuma outra policy nesta migration, e nada para anon.
  assertEquals(policy.match(/CREATE POLICY/g)?.length, 1);
  assertEquals(/\banon\b/.test(policy.replace(/^--.*$/gm, "")), false);
});

Deno.test("nenhuma das migrations abre transação (AGENTS.md)", () => {
  for (const sql of [rpc, rpcRollback, policy, policyRollback]) {
    const semComentario = sql.replace(/^\s*--.*$/gm, "");
    assertEquals(/^\s*(BEGIN|COMMIT)\s*;/m.test(semComentario), false);
  }
});
