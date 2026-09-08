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
 * Cliente Supabase falso: distingue as duas RPCs de pagamento pelo nome.
 * `rpc("pagamentos_a_reconciliar")` devolve os `candidatos` configurados;
 * `rpc("confirmar_pagamento", args)` registra os argumentos em
 * `registro.chamadasConfirmar` — o que os testes conferem — e devolve
 * `rpcConfirmarResultado`.
 *
 * Task 4 (fila de `order_refunds`) acrescenta, sem tocar o comportamento
 * acima: `rpc("concluir_estorno")`, e as tabelas `order_refunds` (fila +
 * marca + desfecho) e `marketplace_orders` roteada por NOME (a leitura do
 * "pedido fresco" só troca de forma quando `resolverPedidoFresco` é
 * passado — sem ele, `marketplace_orders` continua devolvendo exatamente o
 * que a conferência de valor da reconciliação de pagamentos sempre esperou).
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
  registro: {
    chamadasConfirmar: Array<{ args: Record<string, unknown> }>;
    chamouCandidatos: boolean;
    chamadasConcluirEstorno?: Array<{ args: Record<string, unknown> }>;
    atualizacoesOrderRefunds?: Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >;
  };

  // --- Task 4: fila de order_refunds pendentes ---------------------------
  // Fila devolvida por `.from('order_refunds').select(...).in(...).lt(...)
  // .order(...).limit(20)`. O filtro `lt('updated_at', limite)` é SIMULADO
  // de verdade (não ignorado): item com `updated_at` >= limite some da
  // lista — é assim que R6 prova a janela de 2 minutos sem reimplementar a
  // query, só reagindo ao valor que o handler calculou.
  refundsPendentes?: Array<Record<string, unknown>>;
  erroRefundsPendentes?: unknown;
  // Pedido "fresco" por order_id — FUNÇÃO, não mapa estático: R7 precisa que
  // o valor mude ENTRE as duas iterações do laço (a RPC do dublê sobe
  // `valor_estornado` depois da 1ª linha concluir), e uma função é o único
  // jeito de expressar isso sem reimplementar o handler.
  resolverPedidoFresco?: (orderId: string) => Record<string, unknown> | null;
  erroPedidoFrescoPorOrderId?: ReadonlyMap<string, unknown>;
  atualizarOrderRefunds?: (
    id: string,
    valores: Record<string, unknown>,
    statusFiltro: string[],
  ) => { data: unknown; error: unknown };
  aoConcluirEstorno?: (args: Record<string, unknown>) => void;
  erroConcluirEstorno?: unknown;
  // --- item 1 do brief P0 (08/09/2026): ids já reivindicados por OUTRAS
  // linhas do mesmo pedido -------------------------------------------------
  // `.select("mp_refund_id").eq("order_id", x).neq("id", y).not("mp_refund_id",
  // "is", null)`. FUNÇÃO (não mapa estático), pelo MESMO motivo de
  // `resolverPedidoFresco`: R13 precisa que o valor mude ENTRE as duas
  // iterações do lote (a 1ª linha grava o id que a 2ª tem de ver). Default
  // `[]`: os testes que não passam esta opção preservam o comportamento de
  // antes (nenhum id excluído).
  idsJaReivindicadosPorPedido?: (orderId: string, idAtual: string) => string[];
  erroIdsJaReivindicados?: unknown;
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
      if (nome === "concluir_estorno") {
        opts.registro.chamadasConcluirEstorno?.push({ args: args ?? {} });
        opts.aoConcluirEstorno?.(args ?? {});
        if (opts.erroConcluirEstorno) return { data: null, error: opts.erroConcluirEstorno };
        return { data: { payment_status: "pago" }, error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select(_colunas: string) {
            return {
              // item 1 do brief P0: `.select("mp_refund_id").eq("order_id",
              // x).neq("id", y).not("mp_refund_id", "is", null)` — chain
              // IRMÃ de `.in()` abaixo (a fila pendente), diferenciada pelo
              // método que vem em seguida.
              eq(_coluna: string, orderId: string) {
                return {
                  neq(coluna2: string, idAtual: string) {
                    return {
                      not(_coluna3: string, _op: string, _valor: unknown) {
                        if (opts.erroIdsJaReivindicados) {
                          return Promise.resolve({
                            data: null,
                            error: opts.erroIdsJaReivindicados,
                          });
                        }
                        // AC3-a (laudo Opus #447 rodada 2, 08/09/2026): o
                        // dublê tem de CONFERIR a coluna real que a produção
                        // passou a `.neq()`, não descartá-la e reimplementar
                        // a exclusão pelo `id` na mão — sem isso, trocar a
                        // coluna em produção (ex.: "id" -> "mp_refund_id",
                        // R15) passa batido porque o mock nunca olhava para
                        // ela. `assertEquals` é a prova: mutar
                        // reconciliar-pagamentos/index.ts:598 para
                        // `.neq("mp_refund_id", refund.id)` faz este assert
                        // (e R15) falharem.
                        assertEquals(coluna2, "id");
                        const ids = opts.idsJaReivindicadosPorPedido?.(
                          orderId,
                          idAtual,
                        ) ?? [];
                        return Promise.resolve({
                          data: ids.map((mp_refund_id) => ({ mp_refund_id })),
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
              in(_coluna: string, _valores: string[]) {
                // R14 (T5, webhook): linha `solicitado_por = 'sistema'` é
                // dinheiro que já se moveu FORA do app — o cron nunca a
                // toca. `.neq()` é CAUSAL aqui (filtra pelos argumentos reais
                // que a produção passa, acumulados em `exclusoes`), e não é
                // estrutural: `.lt()` fica disponível tanto encadeado depois
                // de `.neq()` quanto direto em cima de `.in()` — assim, se a
                // produção deixar de chamar `.neq("solicitado_por","sistema")`,
                // o mock não quebra com TypeError (o que o `catch` externo do
                // handler engoliria e faria o teste passar por acidente); a
                // linha 'sistema' simplesmente deixa de ser excluída, e a
                // mutação aparece como uma diferença real no resultado.
                const comExclusoes = (
                  exclusoes: Array<{ coluna: string; valor: unknown }>,
                ) => ({
                  neq(coluna: string, valor: unknown) {
                    return comExclusoes([...exclusoes, { coluna, valor }]);
                  },
                  lt(_colunaData: string, valorLimite: string) {
                    // D4 (ANTES-DE-CRESCER 6): a producao encadeia DOIS
                    // `.order()` (tentativas ASC, created_at ASC) antes do
                    // `.limit()` — o mock acumula os criterios recursivamente
                    // (cada `.order()` devolve um objeto com `.order()` E
                    // `.limit()`) e SIMULA a ordenacao de verdade, para que
                    // R10 prove a fila sem reimplementar o handler.
                    const comCriterios = (
                      criterios: Array<{ coluna: string; ascendente: boolean }>,
                    ) => ({
                      order(coluna: string, o?: { ascending?: boolean }) {
                        return comCriterios([
                          ...criterios,
                          { coluna, ascendente: o?.ascending ?? true },
                        ]);
                      },
                      limit: async (n: number) => {
                        if (opts.erroRefundsPendentes) {
                          return { data: null, error: opts.erroRefundsPendentes };
                        }
                        const todos = opts.refundsPendentes ?? [];
                        const filtrados = todos.filter((r) => {
                          const registro2 = r as Record<string, unknown>;
                          const upd = registro2.updated_at;
                          const passaJanela = typeof upd !== "string" || upd < valorLimite;
                          // Causal: só exclui pelo que `.neq()` de fato
                          // recebeu — sem chamada, sem exclusão nenhuma.
                          const passaExclusoes = exclusoes.every(
                            ({ coluna, valor }) => registro2[coluna] !== valor,
                          );
                          return passaJanela && passaExclusoes;
                        });
                        const ordenados = [...filtrados].sort((a, b) => {
                          for (const { coluna, ascendente } of criterios) {
                            const va = (a as Record<string, unknown>)[coluna];
                            const vb = (b as Record<string, unknown>)[coluna];
                            if (va === vb) continue;
                            if (va === undefined || va === null) {
                              return ascendente ? -1 : 1;
                            }
                            if (vb === undefined || vb === null) {
                              return ascendente ? 1 : -1;
                            }
                            if (va < vb) return ascendente ? -1 : 1;
                            if (va > vb) return ascendente ? 1 : -1;
                          }
                          return 0;
                        });
                        return { data: ordenados.slice(0, n), error: null };
                      },
                    });
                    return comCriterios([]);
                  },
                });
                return comExclusoes([]);
              },
            };
          },
          update(valores: Record<string, unknown>) {
            return {
              eq(_coluna: string, id: string) {
                return {
                  in(_coluna2: string, statusFiltro: string[]) {
                    const executar = async () => {
                      opts.registro.atualizacoesOrderRefunds?.push({ id, valores, statusFiltro });
                      if (opts.atualizarOrderRefunds) {
                        return opts.atualizarOrderRefunds(id, valores, statusFiltro);
                      }
                      return { data: [{ id }], error: null };
                    };
                    return {
                      select: () => executar(),
                      then: (
                        res: (v: { data: unknown; error: unknown }) => void,
                        rej?: (e: unknown) => void,
                      ) => executar().then(res, rej),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (tabela === "marketplace_orders") {
        return {
          select(_colunas: string) {
            return {
              eq(_coluna: string, id: string) {
                return {
                  maybeSingle: async () => {
                    if (opts.resolverPedidoFresco) {
                      if (opts.erroPedidoFrescoPorOrderId?.has(id)) {
                        return { data: null, error: opts.erroPedidoFrescoPorOrderId.get(id) };
                      }
                      const pedido = opts.resolverPedidoFresco(id);
                      return pedido ? { data: pedido, error: null } : { data: null, error: null };
                    }
                    return opts.erroFrom
                      ? { data: null, error: opts.erroFrom }
                      : {
                        data: { total: opts.pedidoTotal ?? 149.9, total_amount: null },
                        error: null,
                      };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`from inesperado nos testes: ${tabela}`);
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

// =============================================================================
// R1–R7 — Task 4 da frente "estorno pelo app": a reconciliação processa a
// fila de `order_refunds` pendentes (plano 20260907-plano-estorno-pelo-app.md;
// laudo 20260907-laudo-opus-pr438-t2-executor-do-estorno-rodada2.md — I-A/I-B).
//
// Todos os candidatos de PAGAMENTO ficam vazios nestes testes: o que se prova
// aqui é só o passo NOVO, isolado do laço que já existia.
// =============================================================================

const AGORA_MS = Date.now();
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const PAID_AT_FRESCO = new Date(AGORA_MS - UM_DIA_MS).toISOString();

/**
 * Dublê de fetch por ROTA (método + trecho da URL) — mesmo padrão de
 * `estorno_test.ts`. Cada chamada fica registrada (URL, método, corpo, chave
 * de idempotência) para as asserções de R3/R4 (a chave é a mesma; nenhum POST
 * quando não deveria haver).
 */
function fetchDubleReconciliacao(
  rotas: Array<{ metodo: string; trecho: string; status: number; corpo: unknown }>,
) {
  const chamadas: Array<
    { url: string; metodo: string; chave?: string; corpoEnviado?: unknown }
  > = [];
  const f = (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string"
      ? entrada
      : entrada instanceof URL
      ? entrada.href
      : entrada.url;
    const metodo = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url,
      metodo,
      chave: headers["X-Idempotency-Key"],
      corpoEnviado: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const rota = rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(
      new Response(JSON.stringify(rota?.corpo ?? {}), { status: rota?.status ?? 500 }),
    );
  };
  return { f, chamadas };
}

function pedidoFrescoPara(extras: Partial<Record<string, unknown>> = {}) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: PAID_AT_FRESCO,
    status: "cancelled",
    ...extras,
  };
}

Deno.test("R1 - linha solicitado antiga -> marca em_processamento, chama o executor e conclui pela RPC concluir_estorno", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 50 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r1", order_id: pedido.id, amount: 50, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 999, status: "approved", amount: 50 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "r1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "999");
  // A marca: UPDATE condicional em 'solicitado' antes de chamar o MP.
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) => a.id === "r1" && a.statusFiltro.includes("solicitado") && a.valores.status === "em_processamento",
    ),
    true,
  );
  assertEquals(mp.chamadas[0].chave, "r1");
});

Deno.test("R2 - linha em_processamento com consulta mostrando refund >= soma -> conclui SEM novo POST", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 30, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r2", order_id: pedido.id, amount: 30, status: "em_processamento", tentativas: 1, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  // SÓ a rota de GET existe: se o código tentasse repetir o POST, o dublê
  // devolveria 500 (rota inexistente) e o teste cairia por causa clara.
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 30 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].metodo, "GET");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

Deno.test("R3 - consulta sem refund e tentativas=2 -> repete o POST com a MESMA chave (X-Idempotency-Key = id)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 20, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r3", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // GET da confirmação direta: sem transaction_amount_refunded -> "não sei".
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
    // POST do retry: em_process (PIX em contingência) — não conclui, mas
    // prova que o retry aconteceu com a MESMA chave.
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "in_process" } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(mp.chamadas.length, 2);
  assertEquals(mp.chamadas[0].metodo, "GET");
  assertEquals(mp.chamadas[1].metodo, "POST");
  assertEquals(mp.chamadas[1].chave, "r3");
  assertEquals(corpo.estornos.concluidos, 0);
  assertEquals(corpo.estornos.adiados, 1);
  // tentativas foi incrementada ANTES do retry (marca da nova tentativa).
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "r3" && a.valores.tentativas === 3),
    true,
  );
});

Deno.test("R4 - tentativas=5 -> continua em_processamento (saldo reservado), SEM novo POST, ultimo_erro com o texto do teto (D2/BLOQUEIA-2)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 10, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r4", order_id: pedido.id, amount: 10, status: "em_processamento", tentativas: 5, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // D2/BLOQUEIA-2: `falhou` LIBERA o saldo reservado (solicitar_estorno só
  // reserva solicitado/em_processamento) — um teto sem veredito do MP nunca
  // pode terminar em `falhou` (2º POST com chave nova = pagamento em dobro).
  // Conta como adiado, nunca como falho.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  // Só a consulta (GET) — nenhum POST depois do teto de 5 tentativas (m3).
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].metodo, "GET");
  const gravado = registro.atualizacoesOrderRefunds.find((a) => a.id === "r4");
  assertEquals(
    gravado?.valores.ultimo_erro,
    "não consegui confirmar a devolução no Mercado Pago depois de 5 tentativas; confira no painel do MP",
  );
  // A prova real do BLOQUEIA-2: o update NÃO grava `status` nenhum (m2) — a
  // linha continua em_processamento, o filtro condicional prova isso.
  assertEquals(gravado?.valores.status, undefined);
  assertEquals(gravado?.statusFiltro, ["em_processamento"]);
});

Deno.test("R5 - item que lança (pedido não encontrado) não impede o seguinte (falhos:1, o outro concluído)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedidoBom = pedidoFrescoPara({ id: "20000000-0000-4000-8000-000000000002", total: 15 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // 1ª linha: order_id sem pedido nenhum -> lança dentro do try do item.
      { id: "rSabotada", order_id: "20000000-0000-4000-8000-00000000dead", amount: 5, status: "solicitado", tentativas: 0, mp_refund_id: null },
      { id: "rBoa", order_id: pedidoBom.id, amount: 15, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    erroPedidoFrescoPorOrderId: new Map([["20000000-0000-4000-8000-00000000dead", { message: "erro de leitura" }]]),
    resolverPedidoFresco: (orderId) => (orderId === pedidoBom.id ? pedidoBom : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 321, status: "approved", amount: 15 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 0, falhos: 1 });
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "rBoa");
});

Deno.test("R6 - linha atualizada há 30s NÃO é tocada (janela de 2 minutos evita disputar com a edge do clique)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara();
  const trintaSegundosAtras = new Date(AGORA_MS - 30 * 1000).toISOString();
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "r6",
        order_id: pedido.id,
        amount: 10,
        status: "solicitado",
        tentativas: 0,
        mp_refund_id: null,
        updated_at: trintaSegundosAtras,
      },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 0);
  assertEquals(registro.atualizacoesOrderRefunds.length, 0);
});

Deno.test("R7 - duas linhas do MESMO pedido no lote: a 1ª conclui e sobe valor_estornado; a 2ª só conclui se a consulta mostrar a SOMA das duas (I-B)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-000000000099";
  // Estado do ledger SIMULADO: sobe quando a RPC concluir_estorno "grava" —
  // é o que torna a releitura FRESCA (dentro do laço, por item) observável:
  // sem ela, as duas iterações veriam sempre valor_estornado = 0.
  let valorEstornadoSimulado = 0;
  const AMOUNT_POR_LINHA: ReadonlyMap<string, number> = new Map([["rA", 30], ["rB", 20]]);

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "rA", order_id: orderId, amount: 30, status: "solicitado", tentativas: 0, mp_refund_id: null },
      { id: "rB", order_id: orderId, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (id) =>
      id === orderId
        ? pedidoFrescoPara({ id: orderId, total: 100, valor_estornado: valorEstornadoSimulado })
        : null,
    aoConcluirEstorno: (args) => {
      const refundId = String(args.p_refund_id);
      valorEstornadoSimulado += AMOUNT_POR_LINHA.get(refundId) ?? 0;
    },
  });

  let chamada = 0;
  const mp = { f: (_entrada: string | URL | Request, _init?: RequestInit) => {
    chamada++;
    // 1: POST de A -> aprovado direto (sem consulta).
    if (chamada === 1) {
      return Promise.resolve(new Response(JSON.stringify({ id: 111, status: "approved", amount: 30 }), { status: 201 }));
    }
    // 2: POST de B -> o MP diz "já estornado" (4296): manda confirmar.
    if (chamada === 2) {
      return Promise.resolve(new Response(JSON.stringify({ message: "erro", cause: [{ code: 4296 }] }), { status: 404 }));
    }
    // 3: GET de confirmação de B -> só os R$30 de A aparecem no MP; os R$20
    // de B nunca saíram (o cenário exato do achado I-B).
    return Promise.resolve(new Response(JSON.stringify({ id: 123456789, status: "approved", transaction_amount_refunded: 30 }), { status: 200 }));
  } };

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // A conclui; B NÃO conclui (o MP só confirma os R$30 de A — com a
  // releitura fresca, B exige 30+20=50 e falha; com snapshot velho B exigiria
  // só 0+20=20 e concluiria ERRADO, dobrando o ledger sem o dinheiro sair).
  assertEquals(corpo.estornos.concluidos, 1);
  assertEquals(corpo.estornos.falhos, 1);
  const desfechoB = registro.atualizacoesOrderRefunds.find((a) => a.id === "rB" && a.valores.status === "falhou");
  assertEquals(desfechoB !== undefined, true);
});

// =============================================================================
// R8 — complemento da T4 (merge com o conserto do PR #439): PIX = ORDER, e o
// cron precisa da MESMA injeção de `consultarTransacaoDaOrder` que a edge do
// clique já tem — sem ela `executarEstorno` devolve `tentar_depois` para
// sempre para toda linha de order (achado do laudo do PR #439).
// =============================================================================

Deno.test("R8 - linha solicitado de pedido PIX (gateway_payment_id de ORDER) -> consulta a transação, refunda pela order e conclui", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 20,
    valor_estornado: 0,
  });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r8", order_id: pedido.id, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        transactions: { payments: [{ id: "PAY_X", status: "processed" }] },
      },
    },
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: { id: "REFUND01", status: "refunded" },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 2);
  assertEquals(mp.chamadas[0].metodo, "GET");
  assertEquals(mp.chamadas[1].metodo, "POST");
  const post = mp.chamadas[1].corpoEnviado as { transactions: Array<{ id: string }> };
  assertEquals(post.transactions[0].id, "PAY_X");
  assertEquals(mp.chamadas[1].chave, "r8");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "r8");
});

// =============================================================================
// R9–R11 — D2/D3/D4 do laudo rodada 2 do PR #440 (BLOQUEIA-2 e
// ANTES-DE-CRESCER 3/5/6).
// =============================================================================

Deno.test("R9 - retry em_processamento de pedido PIX (gateway_payment_id de ORDER) chama consultarTransacaoDaOrder e refunda pela Orders API (D3, mutante: remover a injeção SÓ do retry)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 20,
    valor_estornado: 0,
  });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r9", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // Serve TANTO o GET de confirmarPorConsulta (refunds[] vazio -> ainda
    // não confirmou) QUANTO o GET de consultarTransacaoDaOrder dentro do
    // retry (transactions.payments[] traz o id que o POST exige). R2/R3/R4
    // só cobrem este caminho com id CLÁSSICO (123456789) — todo o caminho
    // de recuperação para PIX (único método vivo) ficava sem teste.
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "refunded",
        transactions: {
          payments: [{ id: "PAY_RETRY", status: "processed" }],
          refunds: [],
        },
      },
    },
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: { id: "REFUND_RETRY", status: "refunded" },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  const postChamada = mp.chamadas.find((c) => c.metodo === "POST");
  assertEquals(postChamada !== undefined, true);
  // O corpo do POST usa a transação que consultarTransacaoDaOrder devolveu —
  // sem a injeção, executarEstorno nunca chegaria a montar este POST (viraria
  // tentar_depois para sempre, e o teste cairia em concluidos:0/adiados:1).
  const corpoEnviado = postChamada?.corpoEnviado as { transactions: Array<{ id: string }> };
  assertEquals(corpoEnviado.transactions[0].id, "PAY_RETRY");
  assertEquals(postChamada?.chave, "r9");
});

Deno.test("R10 - fila ordena por tentativas ASC antes de created_at ASC: linha travada (tentativas 5, regime D2) não mata de fome linha nova (tentativas 0) no LIMIT 20 (D4)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const antigo = new Date(AGORA_MS - 3 * 60 * 1000).toISOString(); // fora da janela de 2 min

  // 20 linhas TRAVADAS (tentativas=5, o regime "só consulta" do D2) com
  // created_at MAIS ANTIGO que a linha nova — se a fila ordenasse só por
  // created_at (like antes do D4), elas ocupariam as 20 vagas do LIMIT e a
  // nova morreria de fome para sempre. O pedido delas nunca é resolvido
  // (resolverPedidoFresco só conhece a nova) — o que basta para provar QUAIS
  // entraram no lote, sem precisar de dublê de MP para elas.
  const travadas = Array.from({ length: 20 }, (_, i) => ({
    id: `travada-${i}`,
    order_id: `pedido-travada-${i}`,
    amount: 10,
    status: "em_processamento",
    tentativas: 5,
    mp_refund_id: null,
    updated_at: antigo,
    created_at: new Date(AGORA_MS - (100 - i) * UM_DIA_MS).toISOString(),
  }));
  const pedidoNovo = pedidoFrescoPara({ id: "20000000-0000-4000-8000-0000000000ff", total: 10 });
  const novo = {
    id: "novo",
    order_id: pedidoNovo.id,
    amount: 10,
    status: "solicitado",
    tentativas: 0,
    mp_refund_id: null,
    updated_at: antigo,
    // O MAIS RECENTE de todos — em ordenação só por created_at ficaria por
    // ÚLTIMO e sairia do LIMIT 20 (21 linhas no total).
    created_at: new Date(AGORA_MS).toISOString(),
  };

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [...travadas, novo],
    resolverPedidoFresco: (orderId) => (orderId === pedidoNovo.id ? pedidoNovo : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 1, status: "approved", amount: 10 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos.vistos, 20, "o LIMIT 20 continua valendo");
  // A prova real: a linha NOVA foi tocada (marcada em_processamento) — ela
  // entrou no lote. Sem o ORDER BY tentativas ASC (mutante m5: ordenar só
  // por created_at), ela ficaria de fora e este array estaria vazio.
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "novo"),
    true,
  );
  assertEquals(corpo.estornos.concluidos, 1, "a nova concluiu o estorno normalmente");
});

Deno.test("R11 - concluido cuja RPC concluir_estorno levanta: incrementa tentativas e grava o motivo leigo, linha continua em_processamento (D4, ANTES-DE-CRESCER 5)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 30, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r11", order_id: pedido.id, amount: 30, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    erroConcluirEstorno: { message: "conexão com o banco perdida" },
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 30 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // O MP CONFIRMOU (GET diz 30/30) — o dinheiro já saiu; só a NOSSA escrita
  // (RPC concluir_estorno) falhou. Nunca "falhou": o dinheiro não pode
  // desaparecer do registro só porque a escrita local deu erro.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  const gravado = registro.atualizacoesOrderRefunds.find((a) => a.id === "r11");
  assertEquals(gravado?.valores.tentativas, 3, "incrementa a partir das 2 tentativas já persistidas");
  assertEquals(typeof gravado?.valores.ultimo_erro, "string");
  assertEquals(gravado?.valores.status, undefined, "nunca falhou: o MP já confirmou o dinheiro");
  assertEquals(gravado?.statusFiltro, ["em_processamento"]);
});

// =============================================================================
// R12–R13 — brief P0 de 08/09/2026 (pré-requisito da T5/T6), achado 1 do laudo
// `20260908-laudo-opus-pr440-t4-reconciliacao-rodada2.md`: `confirmarPorConsulta`
// credita à linha avaliada QUALQUER refund processed do pedido — com duas
// linhas pendentes, uma é dada por devolvida com o dinheiro da outra.
// R15 — AC-3 da rodada 2 do laudo Opus do PR #447 (08/09/2026): a linha que
// JÁ carrega o próprio `mp_refund_id` (PIX em contingência) não pode ler a
// si mesma como "já reivindicada por outra linha" — o `.neq("id", refund.id)`
// é quem garante isso.
// =============================================================================

Deno.test("R12 - experimento do laudo ponta a ponta: com a ordenação tentativas ASC (b primeiro), b NÃO conclui com o refund de a; a conclui pela consulta", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000aa";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 30,
    valor_estornado: 0,
  });

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // a: R$20, tentativas 5 (a que TEM o refund no MP). b: R$10,
      // tentativas 1 — vem PRIMEIRO na fila (tentativas ASC, D4).
      { id: "a", order_id: orderId, amount: 20, status: "em_processamento", tentativas: 5, mp_refund_id: null },
      { id: "b", order_id: orderId, amount: 10, status: "em_processamento", tentativas: 1, mp_refund_id: null },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
  });

  // A order do MP mostra UM refund processed de 20 (o de `a`) — nunca muda
  // entre as consultas (mesmo objeto, sempre a mesma resposta).
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "ref-a", amount: "20.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
    // Retry de b (POST com a chave dela): o MP diz "já em curso" — b fica
    // em_processamento (adiada), NUNCA concluída sem o refund dela aparecer.
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: { error: "invalid_request", error_messages: [{ code: "order_refund_already_in_process" }] },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // b (avaliada primeiro) NÃO conclui: nem com o dinheiro de a (achado 1),
  // nem sem POST — o POST com a chave DELA saiu (`mp.chamadas` abaixo) e o
  // resultado é "em_processamento" (adiada). a conclui SEM POST, pela
  // consulta, com o refund que é exatamente do valor dela.
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "a");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "ref-a");
  // O POST de b saiu com a chave DELA (idempotência por linha) — nunca a de a.
  const postDeB = mp.chamadas.find((c) => c.metodo === "POST");
  assertEquals(postDeB?.chave, "b");
});

Deno.test("R13 - idsJaReivindicados: duas linhas do MESMO valor no mesmo lote — a 1ª conclui com o refund, a 2ª (vendo o id já gravado) NÃO conclui", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000bb";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 10,
    valor_estornado: 0,
  });

  // Estado SIMULADO do que cada linha já reivindicou — a 2ª iteração tem de
  // ver o que a 1ª gravou NO MESMO lote (a leitura é DENTRO do laço, por
  // item; um SELECT único antes do laço veria as duas ainda sem id).
  const reivindicadosPorOrder = new Map<string, string[]>();

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // Mesmas tentativas — desempata por created_at (c1 antes de c2).
      {
        id: "c1",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: null,
        created_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "c2",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: null,
        created_at: "2026-09-02T00:00:00.000Z",
      },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
    idsJaReivindicadosPorPedido: (id) => reivindicadosPorOrder.get(id) ?? [],
    aoConcluirEstorno: (args) => {
      const lista = reivindicadosPorOrder.get(orderId) ?? [];
      lista.push(String(args.p_mp_refund_id));
      reivindicadosPorOrder.set(orderId, lista);
    },
  });

  // A order do MP mostra UM único refund processed de 10 (`ref-x`) — o
  // MESMO valor das duas linhas.
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "ref-x", amount: "10.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
    // Retry de c2 (o único caminho que sobra depois de excluído ref-x): o MP
    // diz "já em curso" — c2 fica em_processamento (adiada).
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: { error: "invalid_request", error_messages: [{ code: "order_refund_already_in_process" }] },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // c1 conclui com ref-x; c2 (mesmo valor, MESMO refund já reivindicado por
  // c1) NÃO conclui — é exatamente o achado 1 do laudo, agora com DUAS
  // linhas do MESMO valor em vez de valores diferentes (E36 cobre a unidade;
  // este teste cobre o CONTRATO do cron ponta a ponta).
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "c1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "ref-x");
});

Deno.test("R15 - linha em_processamento que JÁ carrega o PRÓPRIO mp_refund_id (PIX em contingência): o .neq exclui a si mesma e ela CONCLUI (AC-3, laudo #447 rodada 2)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000cc";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 10,
    valor_estornado: 0,
  });

  // A ÚNICA linha do lote: em_processamento, já com o PRÓPRIO mp_refund_id
  // gravado numa passada anterior (`gravarDesfechoDoEstorno` grava o id na
  // linha `em_processamento` quando o POST devolve o assíncrono do PIX em
  // contingência — `resultado.tipo === "em_processamento"`, index.ts:~154).
  const linhasDoPedido = [
    { id: "rf-self-linha", order_id: orderId, mp_refund_id: "rf-self" },
  ];

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "rf-self-linha",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: "rf-self",
      },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
    // Simula a query real (`.eq("order_id", x).neq("id", idAtual)
    // .not("mp_refund_id", "is", null)`): SÓ exclui a linha cujo id bate com
    // `idAtual`. Sem essa exclusão (mutação m3: `.neq("id", refund.id)` ->
    // `.neq("id", "0000...")`), a linha leria o PRÓPRIO mp_refund_id como já
    // reivindicado por OUTRA linha e nunca concluiria — morre de fome até o
    // teto com o dinheiro já devolvido (o cenário do AC-3).
    idsJaReivindicadosPorPedido: (oid, idAtual) =>
      linhasDoPedido
        .filter((l) => l.order_id === oid && l.id !== idAtual)
        .map((l) => l.mp_refund_id)
        .filter((id): id is string => typeof id === "string"),
  });

  // A order do MP mostra o refund `rf-self` (o mesmo id JÁ gravado na
  // linha) processed, do valor exato dela.
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "rf-self", amount: "10.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // Conclui SEM POST nenhum (nenhuma rota POST no dublê acima) — o `.neq`
  // exclui a si mesma, e "rf-self" nunca entra em idsJaReivindicados.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "rf-self-linha");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "rf-self");
});

// =============================================================================
// R14 — item "reconciliar-pagamentos" do brief da T5 (webhook): linha
// `solicitado_por = 'sistema'` (estorno feito fora do app, ou chargeback em
// análise) é dinheiro que JÁ se moveu — o cron jamais chama `executarEstorno`
// para ela (seria um POST de refund NOVO com a chave dela = pagar duas
// vezes). Só o webhook grava e conclui linha `sistema`.
// =============================================================================

Deno.test("R14 - linha 'sistema' em em_processamento NÃO é consultada nem POSTada; 'vistos' não a conta (mutação: tirar o .neq derruba)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara();
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "r14-sistema",
        order_id: pedido.id,
        amount: 10,
        status: "em_processamento",
        solicitado_por: "sistema",
        tentativas: 1,
        mp_refund_id: null,
      },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // A linha 'sistema' nunca entra na fila que o handler enxerga: 'vistos'
  // fica em 0, nenhuma chamada ao MP, nenhuma atualização da linha.
  assertEquals(corpo.estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 0);
  assertEquals(registro.atualizacoesOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
});
