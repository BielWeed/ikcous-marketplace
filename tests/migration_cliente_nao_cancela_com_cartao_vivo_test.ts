// @ts-nocheck
// O CLIENTE NÃO CANCELA COM CARTÃO VIVO — prova offline do par
// 20261180000000 + rollback (achado independente de revisão de risco,
// dinheiro, 26/09/2026). A prova VIVA (RPC de verdade no Postgres efêmero,
// cenários de cliente/admin/PIX/cartão) mora em tests/banco/; aqui fica o
// que se prova só lendo o texto.
//
// Cada asserção está amarrada a um risco: guarda ausente deixa o cliente
// cancelar um pedido com cobrança de cartão viva (dinheiro fora do fluxo);
// guarda vazando para o admin trava a reconciliação; guarda pegando PIX
// tira do cliente um cancelamento que hoje funciona; ERRCODE customizado
// esconde a mensagem nova atrás da frase genérica do front
// (mensagemAmigavelErroAtualizacaoStatus, src/hooks/useOrders.ts); rollback
// que não bate byte a byte com o corpo da 20261175000000 deixa a guarda
// presa mesmo depois de "revertida".
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
const NOME = "20261180000000_cliente_nao_cancela_com_cartao_vivo.sql";
const NOME_175 = "20261175000000_a_devolucao_nasce_no_pedido.sql";

const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const migration175 = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/${NOME_175}`,
);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

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

Deno.test("assinatura, SECURITY DEFINER e search_path continuam os mesmos", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.update_order_status_atomic( " +
    "p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL, " +
    "p_silent boolean DEFAULT FALSE ) RETURNS jsonb LANGUAGE plpgsql " +
    "SECURITY DEFINER SET search_path = public";
  assertStringIncludes(m, cabecalho);
  assertStringIncludes(r, cabecalho);
});

Deno.test("a migration não repete GRANT/REVOKE — ACL herdada do CREATE OR REPLACE", () => {
  // Mesma convenção das redefinições anteriores desta função
  // (20260901000000, 20261060000000, 20261175000000): CREATE OR REPLACE
  // preserva a ACL vigente, então nenhuma delas repete GRANT/REVOKE. Se este
  // arquivo um dia precisar tocar ACL, é sinal de que a suposição registrada
  // no cabeçalho (nenhuma edge function chama esta RPC) mudou.
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_order_status_atomic/i.test(
      m,
    ),
  );
  assert(
    !/REVOKE\s+\w+\s+ON\s+FUNCTION\s+public\.update_order_status_atomic/i.test(
      m,
    ),
  );
});

Deno.test("a guarda nova existe, dentro do ramo do cliente, e usa o SQLSTATE padrão (sem USING ERRCODE)", () => {
  const inicioFuncao = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(",
  );
  assert(
    inicioFuncao >= 0,
    "update_order_status_atomic não encontrada na migration",
  );
  const corpo = m.slice(inicioFuncao);

  const inicioRamoCliente = corpo.indexOf("IF NOT v_is_admin THEN");
  const inicioGuardaVelha = corpo.indexOf(
    "Este pedido não pode mais ser cancelado por você.",
  );
  const inicioGuardaNova = corpo.indexOf("v_payment_status = 'aguardando'");
  const inicioLedgerDoEstorno = corpo.indexOf("LEDGER DO ESTORNO");

  assert(inicioRamoCliente >= 0, "ramo IF NOT v_is_admin não encontrado");
  assert(inicioGuardaVelha > inicioRamoCliente);
  assert(
    inicioGuardaNova > inicioGuardaVelha,
    "guarda nova precisa vir depois da checagem de status existente",
  );
  assert(
    inicioLedgerDoEstorno > inicioGuardaNova,
    "guarda nova precisa estar ANTES do ledger do estorno (fora do IF NOT v_is_admin)",
  );

  // A condição inteira, normalizada — se o parêntese do OR ou a lista do IN
  // mudar de forma (ex.: incluir 'pix'), este teste quebra.
  assertStringIncludes(
    m,
    "IF v_payment_status = 'aguardando' AND ( v_metodo_online IN ('credito', 'debito') OR v_gateway_payment_id LIKE 'verificando:%' ) THEN",
  );
  // "; END IF;" logo depois da mensagem — sem `USING ERRCODE` no meio: a
  // exceção sai com o SQLSTATE padrão do plpgsql (P0001), o único que
  // `mensagemAmigavelErroAtualizacaoStatus` repassa ao cliente tal como veio
  // do banco (o cabeçalho da migration explica o porquê; a frase "USING
  // ERRCODE" aparece só em comentário, nunca como cláusula real deste
  // RAISE — por isso a checagem é pela adjacência exata, não por regex
  // solta sobre o arquivo inteiro).
  assertStringIncludes(
    m,
    "RAISE EXCEPTION 'Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.'; END IF;",
  );
});

Deno.test("'credito'/'debito' entram na guarda, 'pix' fica de fora — cliente continua cancelando PIX aguardando", () => {
  assertStringIncludes(m, "v_metodo_online IN ('credito', 'debito')");
  assert(!m.includes("v_metodo_online IN ('credito', 'debito', 'pix')"));
  assert(!/v_metodo_online\s*=\s*'pix'/i.test(m));
});

Deno.test("o SELECT que trava a linha passa a ler metodo_online e gateway_payment_id", () => {
  assertStringIncludes(
    m,
    "SELECT status, user_id, cancelled_after_shipping, payment_status, paid_at, total, metodo_online, gateway_payment_id INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total, v_metodo_online, v_gateway_payment_id FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;",
  );
});

Deno.test("o ledger do estorno automático (pedido pago) continua intocado, byte a byte", () => {
  const trechoLedger =
    "IF p_new_status = 'cancelled' AND v_old_status IN ('pending', 'processing') " +
    "AND v_payment_status IN ('pago', 'pago_apos_expirar') AND v_paid_at IS NOT NULL " +
    "AND NOT v_cancelled_after_shipping AND NOT EXISTS (";
  assertStringIncludes(m, trechoLedger);
});

Deno.test("o rollback restaura o corpo da 20261175000000 (Seção 11) byte a byte, sem a guarda nova", () => {
  const marcador =
    "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(";

  const inicio175 = migration175.indexOf(marcador);
  assert(
    inicio175 >= 0,
    "corpo de update_order_status_atomic não encontrado em 175",
  );
  const corpo175 = migration175.slice(inicio175).trimEnd();

  const inicioRollback = rollback.indexOf(marcador);
  assert(
    inicioRollback >= 0,
    "corpo de update_order_status_atomic não encontrado no rollback",
  );
  const corpoRollback = rollback.slice(inicioRollback).trimEnd();

  assertEquals(
    corpoRollback,
    corpo175,
    "o rollback precisa restaurar o MESMO corpo que a 20261175000000 deixou, sem a guarda nova",
  );

  // Confirma que a guarda nova de fato NÃO sobrevive no corpo restaurado.
  assert(!corpoRollback.includes("v_metodo_online"));
  assert(!corpoRollback.includes("PREFIXO_VAGA_EM_VERIFICACAO"));
  assert(!corpoRollback.includes("verificando:"));
});

Deno.test("a migration declara a ordem de aplicação (depois de 75-78, independente da 79)", () => {
  assertStringIncludes(migration, "depois de 75–78");
  assertStringIncludes(migration, "independente da 79");
});
