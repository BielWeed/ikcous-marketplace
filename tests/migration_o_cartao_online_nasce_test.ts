// @ts-nocheck
// O CARTÃO ONLINE NASCE — prova offline do par 20261176000000 + rollback
// (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
// tarefa 2). A prova VIVA mora em tests/banco/cartao-online-viva.cjs.
//
// Riscos amarrados: cartão nascendo LIGADO em loja que nunca testou o Brick
// sob o COEP do app; liberar_cobranca_do_pedido executável por cliente (ele
// soltaria a cobrança de um pedido e pagaria duas vezes); liberar sem as
// guardas (soltar cobrança já paga, ou a cobrança NOVA por resposta atrasada
// da antiga); rollback que derruba o histórico de como o pedido foi pago.
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
const NOME = "20261176000000_o_cartao_online_nasce.sql";
const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

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

Deno.test("cartão nasce DESLIGADO e a configuração só é escrita pela RPC de admin", () => {
  assertStringIncludes(m, "credito boolean NOT NULL DEFAULT false,");
  assertStringIncludes(m, "debito boolean NOT NULL DEFAULT false,");
  assertStringIncludes(
    m,
    "ALTER TABLE public.config_pagamento_cartao ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON public.config_pagamento_cartao FROM PUBLIC, anon, authenticated;",
  );
  // Achado L (revisão de 26/09/2026): grant por COLUNA, sem updated_by — o
  // checkout e a edge criar-pagamento só leem credito/debito/parcelas_max.
  assertStringIncludes(
    m,
    "GRANT SELECT (id, credito, debito, parcelas_max, updated_at) ON public.config_pagamento_cartao TO anon, authenticated;",
  );
  assert(!m.includes("GRANT SELECT ON public.config_pagamento_cartao"));
  assertStringIncludes(m, "IF NOT public.is_admin() THEN");
});

Deno.test("registrar_estorno_manual ganha uma data real do estorno (achado F)", () => {
  assertStringIncludes(
    m,
    "ADD COLUMN IF NOT EXISTS estorno_manual_registrado_em timestamptz;",
  );
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(",
  );
  assert(ini >= 0, "registrar_estorno_manual não encontrada");
  const corpo = m.slice(ini, m.indexOf("$$;", ini));
  assertStringIncludes(
    corpo,
    "estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())",
  );
});

Deno.test("achado 7 (rodada 2): o carimbo do estorno cobre TODO caminho para 'estornado', não só o manual", () => {
  assertStringIncludes(
    m,
    "BEFORE UPDATE OF payment_status ON public.marketplace_orders",
  );
  assertStringIncludes(
    m,
    "WHEN (NEW.payment_status = 'estornado' AND OLD.payment_status IS DISTINCT FROM 'estornado')",
  );
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.marca_estorno_direto_do_pedido(",
  );
  assert(ini >= 0, "marca_estorno_direto_do_pedido não encontrada");
  const corpo = m.slice(ini, m.indexOf("$$;", ini));
  assertStringIncludes(
    corpo,
    "NEW.estorno_manual_registrado_em := COALESCE(NEW.estorno_manual_registrado_em, now());",
  );
  // Gatilho estreito, de propósito: não é SECURITY DEFINER (só escreve em
  // NEW, não precisa de privilégio nenhum a mais que quem já faz o UPDATE).
  assert(
    !corpo.includes("SECURITY DEFINER"),
    "o gatilho não deveria elevar privilégio — só escreve na própria linha",
  );
  // Baixa prioridade da rodada 3: REVOKE por hábito (mesma disciplina de
  // devolucao_avisa_o_cliente em 20261175000000).
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.marca_estorno_direto_do_pedido() FROM PUBLIC, anon, authenticated;",
  );
});

Deno.test("liberar_cobranca_do_pedido: só service role, com as três guardas", () => {
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) TO service_role;",
  );
  assertStringIncludes(
    m,
    "AND gateway_payment_id = p_gateway_payment_id AND payment_status = 'aguardando' AND paid_at IS NULL",
  );
  assertStringIncludes(m, "SECURITY DEFINER SET search_path = public");
});

Deno.test("o rollback derruba RPCs e tabela mas mantém as colunas do pedido", () => {
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.liberar_cobranca_do_pedido(uuid, text);",
  );
  assertStringIncludes(
    r,
    "DROP TABLE IF EXISTS public.config_pagamento_cartao;",
  );
  assertEquals(/DROP COLUMN/i.test(rollback), false);
  // Achado R: a ordem de reversão (78 -> 77 -> 76) é recusada, não só documentada.
  assertStringIncludes(r, "to_regprocedure('public.painel_inicio()')");
  assertStringIncludes(r, "to_regprocedure('public.fin_dre(date, date)')");
  // Achado F: registrar_estorno_manual volta ao corpo de 20261072000000
  // (sem o carimbo), verbatim.
  const ini = r.indexOf(
    "CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(",
  );
  assert(ini >= 0, "registrar_estorno_manual não restaurada no rollback");
  const corpo = r.slice(ini, r.indexOf("$$;", ini));
  assert(
    !corpo.includes("estorno_manual_registrado_em"),
    "rollback deveria restaurar o corpo ORIGINAL, sem o carimbo do achado F",
  );
  // Achado 7: o gatilho é infraestrutura pura — o rollback dropa os dois.
  assertStringIncludes(
    r,
    "DROP TRIGGER IF EXISTS tr_marca_estorno_direto_do_pedido ON public.marketplace_orders;",
  );
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.marca_estorno_direto_do_pedido();",
  );
});
