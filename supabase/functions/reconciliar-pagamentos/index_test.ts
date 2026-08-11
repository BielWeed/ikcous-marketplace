// @ts-nocheck
/**
 * Testes da reconciliar-pagamentos (Fase 3, Task 6).
 *
 * Nada aqui toca rede nem banco: `deps.supabase` e `deps.fetchImpl`
 * substituem tudo isso, na mesma costura que `webhook-mercadopago` já provou
 * (index_test.ts). A RPC `pagamentos_a_reconciliar` (Task 5) ainda não foi
 * aplicada em produção — por isso o cliente falso abaixo é a ÚNICA forma de
 * exercitar este handler antes do deploy.
 *
 * O que se prova é o que erra caro aqui: um `RECONCILIACAO_SECRET` errado (ou
 * ausente) disparando a varredura de pedidos de qualquer um que descubra a
 * URL, e um candidato com falha na consulta ao MP abortando o lote inteiro —
 * a reconciliação existe justamente para pegar o que o webhook perdeu, então
 * ela não pode perder o resto do lote por causa de um candidato só.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-reconciliacao-teste";
const UUID_PEDIDO_1 = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const UUID_PEDIDO_2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

function requisicaoComSegredo(segredo: string | null): Request {
  const headers: Record<string, string> = {};
  if (segredo !== null) headers["x-reconciliacao-secret"] = segredo;
  return new Request("http://localhost/reconciliar-pagamentos", { method: "POST", headers });
}

function fetchConsulta(status: number, corpo: Record<string, unknown>) {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corpo), { status });
}

/**
 * Cliente Supabase falso: distingue as duas RPCs pelo nome. `rpc("pagamentos_a_reconciliar")`
 * devolve os `candidatos` configurados; `rpc("confirmar_pagamento", args)` registra os
 * argumentos em `registro.chamadasConfirmar` — o que os testes 3 e 4 conferem — e devolve
 * `rpcConfirmarResultado`.
 */
function clienteFalso(opts: {
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  erroCandidatos?: unknown;
  rpcConfirmarResultado?: string;
  rpcConfirmarError?: unknown;
  registro: { chamadasConfirmar: Array<{ args: Record<string, unknown> }>; chamouCandidatos: boolean };
}) {
  return {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") {
        opts.registro.chamouCandidatos = true;
        if (opts.erroCandidatos) return { data: null, error: opts.erroCandidatos };
        return { data: opts.candidatos ?? [], error: null };
      }
      if (nome === "confirmar_pagamento") {
        opts.registro.chamadasConfirmar.push({ args: args ?? {} });
        if (opts.rpcConfirmarError) return { data: null, error: opts.rpcConfirmarError };
        return { data: opts.rpcConfirmarResultado ?? "pago", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
  };
}

// --- 1. segredo incorreto ----------------------------------------------------

Deno.test("segredo incorreto -> 401, pagamentos_a_reconciliar NÃO é chamada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  const req = requisicaoComSegredo("segredo-errado");

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 401);
  assertEquals(registro.chamouCandidatos, false);
});

// --- segredo ausente no ambiente -> 503 (decisão do brief) -------------------

Deno.test("RECONCILIACAO_SECRET ausente no ambiente -> 503, mesmo com header correto", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  Deno.env.delete("RECONCILIACAO_SECRET");
  try {
    const req = requisicaoComSegredo(SEGREDO);
    const resposta = await handler(req, { supabase });

    assertEquals(resposta.status, 503);
    assertEquals(registro.chamouCandidatos, false);
  } finally {
    Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
  }
});

// --- 2. nenhum candidato -------------------------------------------------------

Deno.test("nenhum candidato -> 200 com { ok: true, verificados: 0 }", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ok, true);
  assertEquals(corpo.verificados, 0);
  assertEquals(registro.chamouCandidatos, true);
});

// --- 3. MP diz approved --------------------------------------------------------

Deno.test("MP diz approved -> chama confirmar_pagamento com 'pago' e conta 1 confirmado", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, { id: 999, status: "approved" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_order_id, UUID_PEDIDO_1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, "999");
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
});

// --- 4. MP diz cancelled --------------------------------------------------------

Deno.test("MP diz cancelled -> chama confirmar_pagamento com 'recusado'", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "recusado", registro });
  const fetchImpl = fetchConsulta(200, { id: 999, status: "cancelled" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "recusado");
});

// --- 5. um candidato falha, os outros continuam ---------------------------------

Deno.test("um candidato falha na consulta ao MP e os outros continuam", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "111" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "222" },
  ];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  let chamadasFetch = 0;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamadasFetch++;
    // O primeiro candidato (111) falha na consulta; o segundo (222) tem que
    // ser processado mesmo assim — é a prova de que um `try` por candidato
    // impede a falha de um de abortar o lote.
    if (chamadasFetch === 1) return new Response("erro interno", { status: 500 });
    return new Response(JSON.stringify({ id: 222, status: "approved" }), { status: 200 });
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, "222");
});

// --- 6. MP diz pending, RPC devolve 'ignorado' -> não é confirmado (item 1) -----

Deno.test("MP diz pending -> confirmar_pagamento devolve 'ignorado' -> confirmados: 0, ignorados: 1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  // PIX expirado que ninguém pagou: MP ainda diz 'pending', mapearStatus vira
  // 'aguardando', e confirmar_pagamento cai no RETURN 'ignorado' por default
  // (20260808000000_confirmar_pagamento.sql:179). Sem erro nenhum — é
  // exatamente o caso que a contagem antiga confundia com sucesso.
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "ignorado", registro });
  const fetchImpl = fetchConsulta(200, { id: 999, status: "pending" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
});

// --- 7. confirmar_pagamento rejeita para um candidato, o outro continua (item 3) -

Deno.test("confirmar_pagamento rejeita para um candidato e o outro é processado assim mesmo", async () => {
  const chamadasConfirmar: Array<{ args: Record<string, unknown> }> = [];
  let chamadasRpcConfirmar = 0;
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "111" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "222" },
  ];
  const supabase = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
      if (nome === "confirmar_pagamento") {
        chamadasRpcConfirmar++;
        chamadasConfirmar.push({ args: args ?? {} });
        // O primeiro candidato (111) rejeita (não devolve {error}, LANÇA); o
        // segundo (222) tem que ser processado mesmo assim — é a prova de
        // que o `try/catch` por candidato cobre a chamada de confirmar_pagamento,
        // não só a consulta ao MP.
        if (chamadasRpcConfirmar === 1) throw new Error("conexão com o banco perdida");
        return { data: "pago", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
  };
  const fetchImpl = fetchConsulta(200, { id: 999, status: "approved" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(chamadasConfirmar.length, 2);
});

// --- 7b. status do MP fora do switch de mapearStatus (item 1 da re-revisão) -----

Deno.test("MP diz in_mediation (status desconhecido) -> não some da contagem: ignorados: 1, confirmar_pagamento NÃO chamada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, registro });
  // "in_mediation" é status real do MP mas está fora do switch de
  // mapearStatus (_shared/mercadopago.ts) -> mapearStatus devolve null. Antes
  // do conserto esse candidato não caía em confirmados, ignorados nem falhas:
  // um `verificados: 1` sem contrapartida em nenhum balde.
  const fetchImpl = fetchConsulta(200, { id: 999, status: "in_mediation" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 1);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 8/9. busca de candidatos fora de qualquer try (item 4) ---------------------

Deno.test("pagamentos_a_reconciliar devolve {error} -> 500", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ erroCandidatos: { message: "erro de banco" }, registro });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 500);
});

Deno.test("pagamentos_a_reconciliar rejeita (erro de rede) -> 500, não escapa do handler", async () => {
  const supabase = {
    rpc: async (nome: string) => {
      if (nome === "pagamentos_a_reconciliar") throw new Error("timeout de rede");
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 500);
});
