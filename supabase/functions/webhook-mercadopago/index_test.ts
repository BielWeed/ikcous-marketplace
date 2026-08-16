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
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
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

/**
 * Requisição com assinatura VÁLIDA para o `dataId` dado.
 *
 * `corpoExtra`/`dataExtra` existem para o teste 8 (rodada de conserto 1):
 * montar um corpo com campos hostis (`external_reference`, `order_id`,
 * `p_order_id`, `data.external_reference`) SEM mexer na assinatura, que só
 * amarra `data.id`.
 */
async function requisicaoAssinada(
  dataId: string,
  opts: {
    segredo?: string;
    ts?: number;
    requestId?: string | null;
    corpoExtra?: Record<string, unknown>;
    dataExtra?: Record<string, unknown>;
  } = {},
): Promise<Request> {
  const segredo = opts.segredo ?? SEGREDO;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const requestId = opts.requestId === undefined ? "req-123" : opts.requestId;
  const v1 = await assinar(dataId, ts, requestId, segredo);
  const headers: Record<string, string> = { "x-signature": `ts=${ts},v1=${v1}` };
  if (requestId !== null) headers["x-request-id"] = requestId;
  const corpo = {
    ...opts.corpoExtra,
    data: { id: dataId, ...opts.dataExtra },
  };
  return requisicao(corpo, headers);
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
  // Stub de fetch que ACUSA se for chamado: sem ele, a suíte só fica offline
  // porque a assinatura curto-circuita antes — sob mutação (achado da
  // revisão), chegou a disparar uma chamada real para api.mercadopago.com
  // (846ms). Com o stub, qualquer reordenação que chame o MP antes da
  // assinatura falha aqui, não em produção.
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  const req = requisicao({ data: { id: "999" } }, { "x-signature": "ts=1,v1=deadbeef" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 401);
  assertEquals(chamouFetch, false);
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
  assertEquals(chamadasPush[0].aviso.title, "Pagamento fora do fluxo");
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

// --- 8. o corpo NÃO decide qual pedido é confirmado (rodada de conserto 1) --

Deno.test("corpo hostil não decide o pedido — p_order_id vem SEMPRE da resposta do MP", async () => {
  // Invariante nº 1: sem ela, quem descobre a URL (verify_jwt=false) manda um
  // corpo com assinatura válida para QUALQUER data.id de um pagamento real, e
  // aponta external_reference/order_id/p_order_id para o pedido que quiser —
  // a mutação medida pela revisão (`body?.data?.external_reference ??
  // consulta.externalReference`) confirmaria o pedido ERRADO.
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const UUID_HOSTIL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const req = await requisicaoAssinada("999", {
    corpoExtra: {
      external_reference: UUID_HOSTIL,
      order_id: UUID_HOSTIL,
      p_order_id: UUID_HOSTIL,
    },
    dataExtra: { external_reference: UUID_HOSTIL },
  });
  // O MP diz que este pagamento é de OUTRO pedido — o real.
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
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
});

// --- 9. push exatamente em 2 dos 9 retornos possíveis da RPC ----------------

Deno.test("push dispara em exatamente 2 dos 9 retornos possíveis da RPC", async () => {
  // Os nove retornos de confirmar_pagamento (migration
  // 20260808000000_confirmar_pagamento.sql). A mutação medida pela revisão
  // (`if (resultado !== "ja_pago")`) faria 'divergente' virar push a cada
  // ~15 min, no ritmo do reenvio do MP — um laço sobre os nove é o que pega
  // isso, um teste por valor não pegaria a contagem agregada.
  const NOVE_RETORNOS = [
    "pago",
    "pago_apos_expirar",
    "ja_pago",
    "recusado",
    "estornado",
    "ja_estornado",
    "divergente",
    "inexistente",
    "ignorado",
  ];
  const DISPARAM_PUSH = new Set(["pago", "pago_apos_expirar"]);

  for (const resultado of NOVE_RETORNOS) {
    const registro = { chamadasRpc: [] };
    const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
    const supabase = clienteFalso({ rpcResultado: resultado, pedido, registro });
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

    await handler(req, { supabase, fetchImpl, enviarPush });

    const esperado = DISPARAM_PUSH.has(resultado) ? 1 : 0;
    assertEquals(chamadasPush.length, esperado, `resultado="${resultado}" deveria disparar ${esperado} push(es)`);
  }
});

// --- 10. ts antigo é ACEITO (rodada de conserto 1: janela desligada) -------

Deno.test("ts de 1h atrás é ACEITO — o webhook nunca confia no que chega, só no que consulta no MP", async () => {
  // O MP não para de reenviar depois da 3ª tentativa — estende o intervalo
  // e continua, sem limite documentado. Nenhuma janela finita é segura, e
  // aceitar um ts velho não custa nada: quem autentica é o HMAC, e a decisão
  // vem de uma consulta NOVA ao MP (o status ATUAL), não do que veio no
  // header. Todos os outros testes assinam com ts=agora; sem este, a decisão
  // de desligar a janela não está presa por nenhum teste.
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const agora = Math.floor(Date.now() / 1000);
  const req = await requisicaoAssinada("999", { ts: agora - 3600 });
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
  assertEquals(registro.chamadasRpc.length, 1);
});

// --- type/topic que não é payment: barato de filtrar, evita poluir o log ---

Deno.test("type diferente de 'payment' não consulta o MP nem chama a RPC", async () => {
  // Notificação de merchant_order (ou qualquer tópico que não seja payment)
  // hoje seria consultada como pagamento, o MP devolveria 404, e a função
  // responderia 200 mesmo assim — inofensivo, mas cada uma dessas gera log de
  // erro (`mercadopago: recusou 404`) sem nunca ter sido um pagamento. Filtrar
  // antes de tocar o MP evita o ruído.
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "merchant_order" } });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamouFetch, false);
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

// --- 'divergente'/'inexistente': dinheiro sem registro (achado BLOQUEANTE
// da revisão do PR #179) -------------------------------------------------
//
// A `criar-pagamento` já prova o cenário onde o MP responde 200 na criação
// da cobrança e o UPDATE seguinte falha (loga
// "criar-pagamento: cobrança criada mas não gravada"). Quando o webhook
// chega depois, autenticado pelo x-signature, `confirmar_pagamento` recusa
// com 'divergente' porque `gateway_payment_id IS NULL` no pedido — e sem
// log aqui o pedido expira em 30 min, o estoque volta, e fica "dinheiro no
// Mercado Pago, nada no app, 200 no log de acesso e zero aviso". A
// reconciliação (reconciliar-pagamentos/index.ts:191-197) já loga esses
// dois retornos com console.warn; este teste prende o mesmo tratamento
// aqui, com console.error — é dinheiro que entrou sem registro, não um
// reenvio inofensivo do MP encontrando um estado já tratado.
// --- Tarefa 3 (CHECKOUT-070): notificação da Orders API (`type: "order"`) --
//
// Depois da migração para a Orders API (Tarefas 1-2), a confirmação de PIX
// chega como `type: "order"`, não mais `type: "payment"`. Sem estes testes,
// o filtro de :240-243 descarta com 200 OK todo pedido pago — "aguardando"
// para sempre.

/**
 * Fetch que INSPECIONA a URL chamada, para provar qual endpoint o handler
 * escolheu (`/v1/orders/{id}` vs `/v1/payments/{id}`) — sem isso, os testes
 * de "type ausente" só provariam o retorno da RPC, não a ROTA escolhida.
 */
function fetchInspecionavel(mapa: {
  pagamento?: { status: number; corpo: Record<string, unknown> };
  order?: { status: number; corpo: Record<string, unknown> };
}) {
  const chamadas: string[] = [];
  const fn = async (url: string, _init?: RequestInit) => {
    chamadas.push(url);
    if (url.includes("/v1/orders/")) {
      const r = mapa.order ?? { status: 404, corpo: {} };
      return new Response(JSON.stringify(r.corpo), { status: r.status });
    }
    const r = mapa.pagamento ?? { status: 404, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  };
  return { fn, chamadas };
}

const ID_ORDER_TESTE = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";

Deno.test("type 'order' aprovada -> RPC recebe p_order_id do external_reference (raiz) e p_payment_id do order.id, NUNCA de payments[0]", async () => {
  // status/status_detail existem em DOIS lugares no corpo real: a raiz (a
  // verdade do pedido) e dentro de transactions.payments[0] (índice de
  // array, vira escolha carregada no dia em que houver mais de um
  // pagamento). Aqui os dois DIVERGEM de propósito: se a implementação ler
  // de payments[0] por engano, o status mapeado muda e o teste pega.
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    transactions: {
      payments: [{ id: "PAY01KZZXXXXXXXXXXXXXXXXXXXXX", status: "action_required", status_detail: "waiting_transfer" }],
    },
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_TESTE);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasPush.length, 1);
});

Deno.test("type 'order' com status 'expired:expired' -> 200 com rótulo próprio, RPC NÃO chamada", async () => {
  // confirmar_pagamento (20260810000000_confirmar_pagamento_guarda_status.sql)
  // não conhece 'expirado' — cairia no RETURN 'ignorado' final, indistinguível
  // no log de todos os outros "ignorado". Por isso o filtro é ANTES da RPC,
  // com rótulo e warn próprios.
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "expired",
    status_detail: "expired",
  });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(corpo.ignorado, "order expirada");
});

Deno.test("type 'payment' explícito continua no caminho clássico (não-regressão)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const fetchImpl = fetchConsulta(200, { id: 999, status: "approved", external_reference: UUID_PEDIDO });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, "999");
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasPush.length, 1);
});

Deno.test("type ausente + id em forma de ULID -> caminho de ORDER (consulta /v1/orders/)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE); // sem `type`
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    order: {
      status: 200,
      corpo: { id: ID_ORDER_TESTE, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/orders/")), true, "deveria ter consultado /v1/orders/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_TESTE);
});

Deno.test("type ausente + id numérico -> caminho CLÁSSICO (consulta /v1/payments/, não-regressão)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999"); // sem `type`
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: 999, status: "approved", external_reference: UUID_PEDIDO } },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/payments/")), true, "deveria ter consultado /v1/payments/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, "999");
});

Deno.test("type 'order' com external_reference sem forma de UUID -> 200, RPC não chamada", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: "nao-e-uuid",
    status: "processed",
    status_detail: "accredited",
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("type 'order': MP devolve 404 ao consultar a order -> 200, não 500 — reenviar não ajuda", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(404, { message: "Order not found" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("type 'order': MP devolve 500 ao consultar a order -> 500, para o MP reenviar", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(500, { message: "erro interno" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- Tarefa 3, ressalva de revisão: `type` DESCONHECIDO não pode ser
// descartado às cegas — ninguém neste projeto jamais observou uma
// notificação real da Orders API, e um tópico fora da lista de irrelevantes
// conhecidos precisa cair no desempate por forma do id (igual ao caso
// `type` ausente), não no descarte. -------------------------------------

Deno.test("type DESCONHECIDO + id em forma de order -> consulta a Orders API (não descarta) e loga console.error", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "orders.v2" } });
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    order: {
      status: 200,
      corpo: { id: ID_ORDER_TESTE, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
  });
  const chamadasErro: unknown[][] = [];
  const console_error = console.error;
  console.error = (...args: unknown[]) => {
    chamadasErro.push(args);
  };
  try {
    const resposta = await handler(req, { supabase, fetchImpl });

    assertEquals(resposta.status, 200);
    assertEquals(chamadas.some((u) => u.includes("/v1/orders/")), true, "deveria ter consultado /v1/orders/");
    assertEquals(registro.chamadasRpc.length, 1);
    assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_TESTE);
    assertEquals(chamadasErro.length, 1, "type desconhecido deveria logar console.error, não console.warn");
  } finally {
    console.error = console_error;
  }
});

Deno.test("type DESCONHECIDO + id numérico -> caminho CLÁSSICO (consulta /v1/payments/)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "order.updated" } });
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: 999, status: "approved", external_reference: UUID_PEDIDO } },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/payments/")), true, "deveria ter consultado /v1/payments/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, "999");
});

Deno.test("type irrelevante da lista oficial (point_integration_wh) -> 200, descartado sem NENHUMA chamada ao MP", async () => {
  // Diferente do teste de merchant_order (acima): aqui a prova é sobre as
  // URLs efetivamente chamadas pelo fetchImpl (`chamadas`), não só o corpo
  // da resposta — provando que a lista de irrelevantes cobre outro tópico
  // oficial além do já testado.
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({ rpcResultado: "pago", registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "point_integration_wh" } });
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({});

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.length, 0, "não deveria ter chamado o MP");
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- data.id da QUERY STRING entra como candidato de assinatura -----------
//
// Até aqui (`requisicaoAssinada`/`requisicao`) TODA requisição de teste é
// montada sem `?`, então o caminho da query nunca foi exercitado. A doc do
// MP monta o manifesto sobre `req.query['data.id']`, não sobre o corpo —
// este teste prova que o candidato da query é REALMENTE usado, não só
// aceito por coincidir com o do corpo: o corpo chega com o id em
// MINÚSCULAS (não bate com o que foi assinado nem no casing original nem
// no minúsculo — os dois colapsam na mesma string), e só o `data.id` da
// QUERY, em maiúsculas, é o que o MP realmente assinou.

Deno.test("data.id da query string valida quando o corpo sozinho (nas duas grafias) NÃO bateria", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });

  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-123";
  // O MP assina com o data.id da QUERY (maiúsculo, o ULID canônico).
  const v1 = await assinar(ID_ORDER_TESTE, ts, requestId, SEGREDO);
  // O corpo chega com o MESMO id em minúsculas — corpo-original e
  // corpo-minusculo colapsam na mesma string (já é minúsculo) e NENHUM dos
  // dois bate com o hash assinado sobre o id maiúsculo.
  const dataIdCorpo = ID_ORDER_TESTE.toLowerCase();
  const req = new Request(
    `http://localhost/webhook-mercadopago?data.id=${ID_ORDER_TESTE}&type=order`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({ type: "order", data: { id: dataIdCorpo } }),
    },
  );
  const fetchImpl = fetchConsulta(200, {
    id: dataIdCorpo,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, dataIdCorpo);
  assertEquals(chamadasPush.length, 1);
});

Deno.test("sem data.id na query, só o do corpo — não-regressão do caminho já coberto", async () => {
  // Garante que a adição da query não É OBRIGATÓRIA: uma notificação sem
  // `?data.id=` (ou com a URL que os outros testes já usam) continua
  // validando pelo corpo sozinho, como sempre validou.
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
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(chamadasPush.length, 1);
});

Deno.test("RPC devolve 'divergente' ou 'inexistente' -> 200 e console.error acusa, com orderId/paymentId/resultado", async () => {
  for (const resultado of ["divergente", "inexistente"]) {
    const registro = { chamadasRpc: [] };
    const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
    const supabase = clienteFalso({ rpcResultado: resultado, pedido, registro });
    const req = await requisicaoAssinada("999");
    const fetchImpl = fetchConsulta(200, {
      id: 999,
      status: "approved",
      external_reference: UUID_PEDIDO,
    });
    const chamadasErro: unknown[][] = [];
    const console_error = console.error;
    console.error = (...args: unknown[]) => {
      chamadasErro.push(args);
    };
    try {
      const resposta = await handler(req, { supabase, fetchImpl });

      assertEquals(resposta.status, 200);
      assertEquals(
        chamadasErro.length,
        1,
        `resultado="${resultado}" deveria logar console.error exatamente uma vez`,
      );
      const textoCompleto = chamadasErro[0]
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ");
      assertStringIncludes(textoCompleto, UUID_PEDIDO);
      assertStringIncludes(textoCompleto, "999");
      assertStringIncludes(textoCompleto, resultado);
    } finally {
      console.error = console_error;
    }
  }
});
