// @ts-nocheck
// O CRM E O INÍCIO LEEM A LOJA — prova offline do par 20261178000000 +
// rollback (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
// tarefa 4). A prova VIVA mora em tests/banco/crm-inicio-viva.cjs.
//
// Riscos amarrados: RPC de leitura de clientes sem o gate de admin (lista de
// WhatsApp e e-mail de todos os clientes para qualquer conta); migration de
// leitura que escreve; receita contando pedido cancelado ou dinheiro não
// reconhecido.
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
const NOME = "20261178000000_o_crm_e_o_inicio_leem_a_loja.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const limpo = norm(removerRuido(migration));

Deno.test("avaliarFase0 não recusa o par e nenhum dos dois controla transação", () => {
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

Deno.test("só leitura: nenhuma tabela, gatilho ou escrita", () => {
  for (const proibido of [
    "CREATE TABLE",
    "CREATE TRIGGER",
    "INSERT INTO",
    "UPDATE public.",
    "DELETE FROM",
  ]) {
    assertEquals(limpo.includes(proibido), false, proibido);
  }
});

Deno.test("as três RPCs fazem o gate de admin e saem de anon; ajudantes sem EXECUTE", () => {
  for (const f of ["crm_visao", "crm_clientes", "painel_inicio"]) {
    const ini = m.indexOf(`CREATE OR REPLACE FUNCTION public.${f}(`);
    const corpo = m.slice(ini, m.indexOf("$$;", m.indexOf("AS $$", ini)));
    assertStringIncludes(corpo, "SECURITY DEFINER SET search_path = public");
    assertStringIncludes(corpo, "IF NOT public.is_admin() THEN");
  }
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.crm__vendas(timestamptz) FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.crm__clientes_rfm(timestamptz) FROM PUBLIC, anon, authenticated;",
  );
});

Deno.test("venda que conta: dinheiro reconhecido e pedido não cancelado", () => {
  assertStringIncludes(
    m,
    "WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND o.status NOT IN ('cancelled', 'returned')",
  );
});
