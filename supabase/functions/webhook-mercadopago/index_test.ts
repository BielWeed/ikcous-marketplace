// @ts-nocheck
/**
 * Testes da webhook-mercadopago (Fase 3, Task 4).
 *
 * Nada aqui toca rede nem banco: `deps.supabase`, `deps.fetchImpl` e
 * `deps.enviarPush` substituem tudo isso, na mesma costura que a
 * `criar-pagamento` já provou (index_test.ts:55-124).
 *
 * O que se prova é o que erra caro aqui: aceitar requisição sem assinatura
 * válida (produto de graça para quem descobrir a URL), disparar push em cada
 * reenvio do MP (idempotência quebrada vira spam pro lojista), ou confirmar
 * pagamento de um pedido que o corpo do webhook não pode determinar sozinho
 * (por isso o `p_order_id` sai da RESPOSTA do MP, nunca do corpo).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-webhook-teste";
const UUID_PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

/**
 * Assina um payload com o MESMO algoritmo de `validarAssinatura`
 * (mercadopago.ts:260-332): HMAC-SHA256 do manifesto
 * `id:<dataId>;request-id:<xRequestId>;ts:<ts>;`, com o segmento
 * `request-id` omitido quando não veio. Gerar a assinatura de verdade aqui —
 * em vez de um hex fixo — evita reescrever este arquivo toda vez que um teste
 * precisar de um `dataId` diferente.
 */
async function assinar(
  dataId: string,
  ts: number,
  xRequestId: string | null,
  segredo: string,
): Promise<string> {
  const manifesto = xRequestId
    ? `id:${dataId};request-id:${xRequestId};ts:${ts};`
    : `id:${dataId};ts:${ts};`;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  return Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function requisicao(corpo: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(corpo),
  });
}

/** Requisição com assinatura VÁLIDA para o `dataId` dado. */
async function requisicaoAssinada(
  dataId: string,
  opts: { segredo?: string; ts?: number; requestId?: string | null } = {},
): Promise<Request> {
  const segredo = opts.segredo ?? SEGREDO;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const requestId = opts.requestId === undefined ? "req-123" : opts.requestId;
  const v1 = await assinar(dataId, ts, requestId, segredo);
  const headers: Record<string, string> = { "x-signature": `ts=${ts},v1=${v1}` };
  if (requestId !== null) headers["x-request-id"] = requestId;
  return requisicao({ data: { id: dataId } }, headers);
}

function fetchConsulta(status: number, corpo: Record<string, unknown>) {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corpo), { status });
}

/**
 * Cliente Supabase falso: `.rpc()` registra cada chamada (nome fixo é sempre
 * `confirmar_pagamento`, o que importa provar são os ARGUMENTOS) e
 * `.from().select().eq().maybeSingle()` devolve o pedido para montar o aviso
 * de push — mesmo padrão de `criar-pagamento/index_test.ts:55-114`.
 */
function clienteFalso(opts: {
  rpcResultado?: string;
  rpcError?: unknown;
  pedido?: Record<string, unknown> | null;
  registro?: { chamadasRpc: Array<{ args: Record<string, unknown> }> };
}) {
  return {
    rpc: async (_nome: string, args: Record<string, unknown>) => {
      opts.registro?.chamadasRpc.push({ args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcResultado ?? null, error: null };
    },
    from(_tabela: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return { maybeSingle: async () => ({ data: opts.pedido ?? null, error: null }) };
            },
          };
        },
      };
    },
  };
}

// --- 1. assinatura inválida ------------------------------------------------

Deno.test("assinatura inválida -> 401, e confirmar_pagamento NÃO é chamada", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = requisicao({ data: { id: "999" } }, { "x-signature": "ts=1,v1=deadbeef" });

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 401);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- 2. MP responde 500 -----------------------------------------------------

Deno.test("MP responde 500 ao consultar o pagamento -> a função responde 500", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(500, { message: "erro interno" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- 3. approved + 'pago' ----------------------------------------------------

Deno.test("MP diz approved, RPC devolve 'pago' -> 200 e o push dispara uma vez", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(chamadasPush.length, 1);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, "999");
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
});

// --- 4. 'ja_pago' -> idempotência --------------------------------------------

Deno.test("RPC devolve 'ja_pago' -> 200 e NENHUM push — é a prova da idempotência", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "ja_pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(chamadasPush.length, 0);
});

// --- 5. 'pago_apos_expirar' -----------------------------------------------

Deno.test("RPC devolve 'pago_apos_expirar' -> 200 e push com texto diferente", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago_apos_expirar", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const chamadasPush: any[] = [];
  const enviarPush = async (args: any) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(chamadasPush.length, 1);
  assertEquals(chamadasPush[0].aviso.title, "Pagamento fora do prazo");
});

// --- 6. status desconhecido --------------------------------------------------

Deno.test("MP devolve status desconhecido -> 200, sem chamar a RPC com status inventado", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "in_mediation",
    external_reference: UUID_PEDIDO,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- 7. corpo sem data.id ----------------------------------------------------

Deno.test("corpo sem data.id -> 400, sem tocar MP nem banco", async () => {
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = requisicao({});

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 400);
  assertEquals(chamouFetch, false);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- external_reference: a armadilha do 22P02 -------------------------------

Deno.test("external_reference ausente -> 200, RPC não chamada", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, { id: 999, status: "approved" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("external_reference sem forma de UUID -> 200, RPC não chamada", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "approved",
    external_reference: "nao-e-uuid",
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- consultarPagamento 404: "esse pagamento não existe" não reenvia -------

Deno.test("MP devolve 404 ao consultar o pagamento -> 200, não 500 — reenviar não ajuda", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(404, { message: "Payment not found" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- erro de banco na RPC ----------------------------------------------------

Deno.test("RPC devolve erro de banco -> 500, para o MP reenviar", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcError: { message: "connection reset" }, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 500);
});
