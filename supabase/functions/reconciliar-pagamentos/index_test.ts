// @ts-nocheck
/**
 * Testes da reconciliar-pagamentos (Fase 3, Task 6; migrada para a Orders API
 * na Tarefa 4, CHECKOUT-070).
 *
 * Nada aqui toca rede nem banco: `deps.supabase` e `deps.fetchImpl`
 * substituem tudo isso, na mesma costura que `webhook-mercadopago` já provou
 * (index_test.ts). A RPC `pagamentos_a_reconciliar` (Task 5) ainda não foi
 * aplicada em produção — por isso o cliente falso abaixo é a ÚNICA forma de
 * exercitar este handler antes do deploy.
 *
 * O que se prova é o que erra caro aqui: um `RECONCILIACAO_SECRET` errado (ou
 * ausente) disparando a varredura de pedidos de qualquer um que descubra a
 * URL, um candidato com falha na consulta ao MP abortando o lote inteiro — a
 * reconciliação existe justamente para pegar o que o webhook perdeu, então
 * ela não pode perder o resto do lote por causa de um candidato só — e,
 * desde a Tarefa 4, que `gateway_payment_id` agora é id de ORDER: consultar
 * pelo endpoint clássico (`GET /v1/payments/{id}`) devolveria 404 para todo
 * candidato criado depois da migração, apagando a rede de segurança
 * exatamente para os pedidos que ela existe para proteger.
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

// Fetch de UMA rota só: usado quando o candidato bate na Orders API e para
// por aí (sem cair no fallback clássico) — a mesma URL responde sempre o
// mesmo corpo, então o teste nem precisa olhar para ela.
function fetchConsulta(status: number, corpo: Record<string, unknown>) {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corpo), { status });
}

/**
 * Cliente Supabase falso: distingue as duas RPCs pelo nome. `rpc("pagamentos_a_reconciliar")`
 * devolve os `candidatos` configurados; `rpc("confirmar_pagamento", args)` registra os
 * argumentos em `registro.chamadasConfirmar` — o que os testes conferem — e devolve
 * `rpcConfirmarResultado`.
 */
function clienteFalso(opts: {
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  erroCandidatos?: unknown;
  rpcConfirmarResultado?: string;
  rpcConfirmarError?: unknown;
  // Conferência de valor (laudo 31/08, A3): total do pedido devolvido pela
  // leitura de `marketplace_orders` (default 149.9 — os mocks antigos não
  // tinham `from()` nenhum e os MPs mockados não trazem valor, então a
  // conferência deles nem roda). `erroFrom` injeta falha de leitura.
  pedidoTotal?: number | null;
  erroFrom?: unknown;
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
    from(_tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, _valor: unknown) {
              return {
                maybeSingle: async () =>
                  opts.erroFrom
                    ? { data: null, error: opts.erroFrom }
                    : {
                        data: { total: opts.pedidoTotal ?? 149.9, total_amount: null },
                        error: null,
                      },
              };
            },
          };
        },
      };
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

// --- 3. order aprovada (Orders API) ---------------------------------------------

Deno.test("order aprovada (processed:accredited) -> confirmados:1, p_payment_id é o id da ORDER", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  // Id de teste da Orders API — em produção começa com "ORD", em teste com
  // "ORDTST" (fato medido no brief, 14/08/2026). O ULID inteiro aqui prova
  // que nada no código depende de um prefixo curto tipo "ORD" + dígito.
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", status_detail: "accredited" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_order_id, UUID_PEDIDO_1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, idOrder);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
});

// --- 3.5 CONFERÊNCIA DE VALOR (laudo 31/08, A3; ressalva 1 da revisão do
// PR #366): a reconciliação atinge PEDIDO VIVO — sem esta porta, o que o
// webhook recusou por valor entrava aqui depois, por status. ----------------

Deno.test("order aprovada com total_amount '10.00' de um pedido de R$ 149,90 -> NÃO confirma, ignorados:1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST04VALORDIVERGENTE";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "10.00",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0, "pagamento divergente NÃO pode virar pedido pago pelo cron");
  assertEquals(corpo.ignorados, 1, "o divergente fica na fila, não é falha");
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("order aprovada com total_amount STRING '149.90' batendo o total -> confirma (a conversão de string não mente)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST05VALORBATE";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
});

Deno.test("candidato legado (clássico) aprovado com transaction_amount 100 de um pedido de R$ 149,90 -> NÃO confirma", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "88888" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: 88888,
    status: "approved",
    transaction_amount: 100,
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("leitura do total falha -> falhas:1, NÃO confirma (sem a linha, nenhuma conferência tem o que comparar)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST06ERROLEITURA";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({
    candidatos,
    rpcConfirmarResultado: "pago",
    erroFrom: { message: "conexão recusada" },
    registro,
  });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 4. order ainda aguardando o PIX ser pago -----------------------------------

Deno.test("order ainda aguardando (action_required:waiting_transfer) -> RPC chamada com 'aguardando', ignorados:1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST02WAITINGTRANSFER";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  // RPC devolve 'ignorado': mesmo comportamento de um PIX ainda pendente no
  // caminho clássico — status desconhecido/ainda-não-pago não é falha.
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "ignorado", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "action_required",
    status_detail: "waiting_transfer",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "aguardando");
});

// --- 5. order expirada: armadilha 2 do brief --------------------------------------

Deno.test("order expirada (expired:expired) -> NÃO chama confirmar_pagamento, ignorados:1 (armadilha 2)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST03EXPIRED";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "expired", status_detail: "expired" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  // A prova real da armadilha: confirmar_pagamento NÃO pode ser chamada com
  // 'expirado' — a RPC não conhece esse valor e cairia no RETURN 'ignorado'
  // do fim, indistinguível no log de um 'ignorado' que passou pela RPC de
  // verdade.
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 6. candidato legado (id clássico) -> vai DIRETO para o endpoint clássico ----
//
// O MP não devolve 404 para um id sem forma de order — devolve 400
// `invalid_path_param` ("must begin with the prefix 'ORD'..."). Um id
// clássico (numérico) nunca tem forma de order, então bateria 400, nunca
// 404: o fallback por CÓDIGO DE ERRO nunca disparava de verdade. Estes
// testes prescindem inteiramente do código de erro e provam a discriminação
// pela FORMA do id: legado nunca toca `/v1/orders/`, order nunca toca
// `/v1/payments/`, e um roteamento errado quebraria alguma das asserções de
// URL abaixo mesmo que os contadores batessem por acidente.

Deno.test("candidato legado (id numérico) nunca chama /v1/orders/ — vai direto para consultarPagamento e confirma", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes("/v1/payments/999")) {
      return new Response(JSON.stringify({ id: 999, status: "approved" }), { status: 200 });
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, "999");
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  // A prova real da armadilha: nenhuma chamada bateu em /v1/orders/ — o
  // candidato legado nunca gasta uma consulta na Orders API antes.
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas.every((u) => !u.includes("/v1/orders/")), true);
});

Deno.test("candidato novo (ULID de order) nunca chama /v1/payments/ — vai direto para consultarOrder", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes(`/v1/orders/${idOrder}`)) {
      return new Response(
        JSON.stringify({ id: idOrder, status: "processed", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas.every((u) => !u.includes("/v1/payments/")), true);
});

Deno.test("candidato legado pago (approved) é confirmado como pago_apos_expirar, sem tocar a Orders API", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "555" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago_apos_expirar", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    return new Response(JSON.stringify({ id: 555, status: "approved" }), { status: 200 });
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  // Status que a RPC RECEBE é o mapeado ('pago'), não o resultado que ela
  // devolve ('pago_apos_expirar') — a RPC decide a transição sob FOR UPDATE.
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas[0].includes("/v1/payments/555"), true);
});

// --- 7. candidato legado recusado pelo clássico -> falha, sem tentar Orders -----

Deno.test("candidato legado recusado pelo endpoint clássico (400 ou 404) conta falha, sem NUNCA tentar a Orders API", async () => {
  for (const statusRecusa of [400, 404]) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "888" }];
    const supabase = clienteFalso({ candidatos, registro });
    const urlsChamadas: string[] = [];
    const fetchImpl = async (url: string) => {
      urlsChamadas.push(url);
      return new Response(JSON.stringify({ message: "recusado" }), { status: statusRecusa });
    };
    const req = requisicaoComSegredo(SEGREDO);

    const resposta = await handler(req, { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(corpo.falhas, 1, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(corpo.confirmados, 0, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(registro.chamadasConfirmar.length, 0, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(urlsChamadas.length, 1, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(
      urlsChamadas.every((u) => !u.includes("/v1/orders/")),
      true,
      `status HTTP da recusa: ${statusRecusa}`,
    );
  }
});

// --- 8. erro de rede num candidato não impede o seguinte --------------------------

Deno.test("erro de rede na consulta de um candidato não impede o seguinte", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "ORDTST04NETFAIL" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "ORDTST05NETOK" },
  ];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    // consultarOrder tem try/catch próprio em volta do fetch e devolve
    // { ok: false, status: 0 } — não é um throw que escapa até o handler.
    if (url.includes("ORDTST04NETFAIL")) throw new Error("timeout de rede");
    if (url.includes("ORDTST05NETOK")) {
      return new Response(
        JSON.stringify({ id: "ORDTST05NETOK", status: "processed", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
});

// --- 9. confirmar_pagamento rejeita para um candidato, o outro continua ----------

Deno.test("confirmar_pagamento rejeita para um candidato e o outro é processado assim mesmo", async () => {
  const chamadasConfirmar: Array<{ args: Record<string, unknown> }> = [];
  let chamadasRpcConfirmar = 0;
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "ORDTST06A" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "ORDTST06B" },
  ];
  const supabase = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
      if (nome === "confirmar_pagamento") {
        chamadasRpcConfirmar++;
        chamadasConfirmar.push({ args: args ?? {} });
        // O primeiro candidato (ORDTST06A) rejeita (LANÇA, não devolve
        // {error}); o segundo (ORDTST06B) tem que ser processado mesmo assim
        // — prova de que o try/catch por candidato cobre a chamada de
        // confirmar_pagamento, não só a consulta ao MP.
        if (chamadasRpcConfirmar === 1) throw new Error("conexão com o banco perdida");
        return { data: "pago", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    // Conferência de valor (laudo 31/08): o handler lê o total do pedido
    // antes de confirmar. Total que BATE — o intent deste teste é a
    // continuidade após rejeição da RPC, não a conferência.
    from(_tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, _valor: unknown) {
              return {
                maybeSingle: async () => ({ data: { total: 149.9, total_amount: null }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  const fetchImpl = async (url: string) =>
    new Response(
      JSON.stringify({
        id: url.includes("ORDTST06A") ? "ORDTST06A" : "ORDTST06B",
        status: "processed",
        status_detail: "accredited",
      }),
      { status: 200 },
    );
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(chamadasConfirmar.length, 2);
});

// --- 10. par status:status_detail fora do MAPA_STATUS_ORDER ----------------------

Deno.test("par status:status_detail fora do mapa -> não some da contagem: ignorados:1, confirmar_pagamento NÃO chamada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST07DESCONHECIDO";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, registro });
  // Par real na sintaxe da Orders API, mas fora de MAPA_STATUS_ORDER —
  // mapearStatusOrder tem que devolver null, nunca um palpite.
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processing", status_detail: "algo_novo_do_mp" });
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

// --- 11. busca de candidatos fora de qualquer try ---------------------------------

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

// --- 12. invariante da soma, com candidatos mistos --------------------------------

Deno.test("invariante confirmados + ignorados + falhas === verificados, com candidatos mistos", async () => {
  const registro = { chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>, chamouCandidatos: false };
  const candidatos = [
    { order_id: "10000000-0000-4000-8000-000000000001", gateway_payment_id: "ORDTST08APROVADO" }, // confirmado
    { order_id: "10000000-0000-4000-8000-000000000002", gateway_payment_id: "ORDTST09WAITING" }, // ignorado (RPC 'ignorado')
    { order_id: "10000000-0000-4000-8000-000000000003", gateway_payment_id: "ORDTST10EXPIRED" }, // ignorado (armadilha 2, sem RPC)
    { order_id: "10000000-0000-4000-8000-000000000004", gateway_payment_id: "777" }, // legado -> confirmado via clássico, direto
    { order_id: "10000000-0000-4000-8000-000000000005", gateway_payment_id: "666" }, // legado recusado pelo clássico -> falha
    { order_id: "10000000-0000-4000-8000-000000000006", gateway_payment_id: "ORDTST11NET" }, // erro de rede -> falha
  ];

  const supabase = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
      if (nome === "confirmar_pagamento") {
        registro.chamadasConfirmar.push({ args: args ?? {} });
        if (args?.p_payment_id === "ORDTST08APROVADO" || args?.p_payment_id === "777") {
          return { data: "pago", error: null };
        }
        return { data: "ignorado", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    // Conferência de valor (laudo 31/08): total que BATE para os candidatos
    // aprovados — o intent deste teste é a INVARIANTE da soma, não a
    // conferência (os MPs mockados não trazem valor, então ela nem roda,
    // exceto 777 aprovado, que bate com 149.9 e confirma).
    from(_tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, _valor: unknown) {
              return {
                maybeSingle: async () => ({ data: { total: 149.9, total_amount: null }, error: null }),
              };
            },
          };
        },
      };
    },
  };

  // Os candidatos legados (777, 666) só têm resposta cadastrada para
  // /v1/payments/ — se o roteamento por forma regredisse para o código de
  // erro antigo (e tentasse /v1/orders/ primeiro), o fetch lançaria "fetch
  // inesperado" e o teste cairia por causa raiz clara, não por um contador
  // batendo por acidente.
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes("/v1/orders/ORDTST08APROVADO")) {
      return new Response(
        JSON.stringify({ id: "ORDTST08APROVADO", status: "processed", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/orders/ORDTST09WAITING")) {
      return new Response(
        JSON.stringify({ id: "ORDTST09WAITING", status: "action_required", status_detail: "waiting_transfer" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/orders/ORDTST10EXPIRED")) {
      return new Response(
        JSON.stringify({ id: "ORDTST10EXPIRED", status: "expired", status_detail: "expired" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/payments/777")) {
      return new Response(JSON.stringify({ id: 777, status: "approved" }), { status: 200 });
    }
    if (url.includes("/v1/payments/666")) {
      return new Response(JSON.stringify({ message: "payment not found" }), { status: 404 });
    }
    if (url.includes("ORDTST11NET")) {
      throw new Error("timeout de rede");
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };

  const req = requisicaoComSegredo(SEGREDO);
  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 6);
  assertEquals(corpo.confirmados, 2);
  assertEquals(corpo.ignorados, 2);
  assertEquals(corpo.falhas, 2);
  assertEquals(corpo.confirmados + corpo.ignorados + corpo.falhas, corpo.verificados);

  // A prova real da armadilha 2 num lote misto: confirmar_pagamento tem que
  // ser chamada para os 3 candidatos que chegam até ela — o aprovado, o
  // aguardando (a RPC decide 'ignorado', mas É chamada) e o legado 777 —, e
  // NUNCA para ORDTST10EXPIRED (filtrado antes da RPC), nem para os dois que
  // falham na consulta ao MP (666 e ORDTST11NET, que nem chegam ao status
  // mapeado). Sem esta asserção, remover o filtro de 'expirado' faria a RPC
  // ser chamada com p_status: 'expirado' e cair no RETURN 'ignorado' do fim
  // — os contadores do corpo ficariam idênticos, e só aqui isso apareceria.
  assertEquals(registro.chamadasConfirmar.length, 3);
  assertEquals(
    registro.chamadasConfirmar.map((c) => c.args.p_payment_id).sort(),
    ["777", "ORDTST08APROVADO", "ORDTST09WAITING"],
  );

  // Roteamento por FORMA, não por código de erro: os dois candidatos legados
  // (777, 666) nunca tocam /v1/orders/ — só o roteiro correto explica as
  // seis URLs abaixo (uma por candidato, nunca duas).
  assertEquals(urlsChamadas.length, 6);
  assertEquals(
    urlsChamadas.some((u) => u.includes("/v1/orders/777") || u.includes("/v1/orders/666")),
    false,
  );
});
