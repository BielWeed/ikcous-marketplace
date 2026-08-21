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
// O id que o MP DEVOLVE é DIFERENTE do que veio no corpo do webhook, de
// propósito. O corpo é forjável (esta função roda com `verify_jwt=false`, então
// quem descobre a URL escolhe o que mandar); a resposta do MP é autenticada pelo
// token do gateway. Enquanto os dois lados carregavam o MESMO valor, a asserção
// de `p_payment_id` era satisfeita por coincidência do arranjo e não distinguia
// de ONDE o campo veio — medido em 20/08/2026: a mutação que faz a produção ler
// o id do corpo sobrevivia a TODOS os 30 testes deste arquivo, nos dois caminhos.
//
// É a mesma técnica que o teste da order já usava para `status`/`status_detail`
// ("DIVERGEM de propósito", abaixo) e que o `corpo hostil não decide o pedido`
// usa para `external_reference`. Aqui ela chega ao id.
//
// ⚠️ SÓ O LADO DO MP MUDA; o corpo do webhook fica como estava. O handler
// escolhe a ROTA pela FORMA do id do corpo (numérico -> /v1/payments/, ULID ->
// /v1/orders/, em `index.ts:370-377`), então mexer no corpo trocaria o caminho
// testado em silêncio, deixando o teste verde provando outra coisa.
//
// ⚠️ `ID_ORDER_DO_MP` é diferente do corpo E de `transactions.payments[0].id`
// ("PAY01KZZ…", no teste `type 'order' aprovada`). Os dois importam: aquele teste
// já distinguia `order.id` de `payments[0].id` — guarda antiga, que continua de
// pé; a distinção contra o corpo é a que entra agora. Um valor que colidisse com
// qualquer um dos dois fecharia uma cegueira e abriria a outra.
//
// E essa guarda antiga não é preciosismo. `_shared/mercadopago.ts:536-556`
// registra que, no caminho da Orders API, o `gateway_payment_id` deve ser o
// `order.id` e não o `payments[0].id` — a Orders API não expõe reconsulta por id
// de pagamento. Com o id errado gravado, a `confirmar_pagamento` cai no
// `IS DISTINCT FROM` (`20260808000000_confirmar_pagamento.sql:53-57`) e devolve
// 'divergente' 32 linhas ANTES do primeiro UPDATE da função (`:88`): ela recusa
// sem gravar nada.
//
// 🔴 A recusa é PROJETADA — não é o defeito. O comentário do ramo (`:40-42`) diz:
// "alguém está confirmando o pagamento de OUTRO pedido: não escrever e deixar
// para uma pessoa olhar". Se você chegou aqui investigando um pedido preso, NÃO
// afrouxe essa guarda: ela é o que impede confirmar o pagamento do pedido errado.
// O que falta é a segunda metade da frase do autor — **ninguém avisa a pessoa**.
// O pedido para, o MP reenvia, a guarda recusa de novo, e não há alerta em lugar
// nenhum. Destrava corrigindo o `gateway_payment_id`, se alguém notar que existe.
//
// (O próprio módulo, em `:554-555`, marca a escolha do `orderId` como pendente de
// confirmação contra o corpo real do MP. Enquanto ela não vem, este teste é o
// único registro executável da decisão.)
const ID_PAGAMENTO_DO_MP = 12345;
const ID_ORDER_DO_MP = "ORDMP99KZZ4D94WC79335A68CZ5NZ7X";

// O valor que `criar-pagamento` REALMENTE grava em `gateway_payment_id` desde
// a migração para a Orders API (index.ts:590: sempre o id da ORDER, "ORD...",
// nunca o de um pagamento clássico) — usado nos testes da rota `payment` que
// provam a correção de 21/08/2026. DIFERENTE de propósito tanto do id que o
// corpo do webhook carrega ("999", forjável) quanto do que a rota `payment`
// do MP devolve (ID_PAGAMENTO_DO_MP, numérico): são três fontes, e só a
// prova distingue se o teste as mantém diferentes entre si.
const ID_GRAVADO_NO_BANCO = "ORDBANCO1KZZ4D94WC79335A68CZ5NZ7X";

// Um id CLÁSSICO (só dígitos) DIFERENTE de `ID_PAGAMENTO_DO_MP` — usado pelo
// controle negativo abaixo. Achado de revisão (mutação "M2b", 21/08/2026):
// gravar o MESMO valor que o MP devolve nos dois lados faz a asserção do
// `p_payment_id` ser satisfeita OU pelo comportamento certo (substitui só
// quando não-clássico) OU por uma mutação que substitui SEMPRE com aviso
// condicional — os dois passam pelos 32 testes quando os dois lados
// coincidem. Só um valor clássico e DIFERENTE do que o MP devolve prova que
// o código de fato NÃO substituiu.
const ID_GRAVADO_CLASSICO_DIFERENTE = "777777";

Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

/**
 * Assina um payload pela REGRA do manifesto do Mercado Pago, escrita aqui de
 * forma INDEPENDENTE da implementação (não importa nada de `mercadopago.ts`
 * além do que os testes precisam validar por fora): HMAC-SHA256 do manifesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, com o segmento
 * `request-id` OMITIDO quando o header não veio.
 *
 * `grafia` escolhe se o `data.id` entra no manifesto exatamente como foi
 * passado (`"original"`, o padrão) ou em minúsculas (`"minuscula"`) — as
 * DUAS únicas regras que `construirCandidatosManifesto` aceita desde
 * 16/08/2026 (achado BLOQUEANTE de revisão removeu a query string como
 * terceira fonte). Existir essa escolha aqui, e não só um espelho fixo do
 * casing original, é o que permite um teste assinar por uma grafia e montar
 * um corpo com OUTRA — sem isso a suíte só provava "id igual valida", nunca
 * "id diferente (ainda que só na fonte) é recusado".
 */
async function assinar(
  dataId: string,
  ts: number,
  xRequestId: string | null,
  segredo: string,
  grafia: "original" | "minuscula" = "original",
): Promise<string> {
  const idNoManifesto = grafia === "minuscula" ? dataId.toLowerCase() : dataId;
  const manifesto = xRequestId
    ? `id:${idNoManifesto};request-id:${xRequestId};ts:${ts};`
    : `id:${idNoManifesto};ts:${ts};`;
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
 *
 * `registro.chamadasFrom`, quando presente, grava tabela/colunas/coluna/valor
 * de CADA `.eq()` — sem isso, nada prova que a leitura aponta para a linha
 * CERTA (`orderId`, vindo da resposta autenticada do MP) e não para o id cru
 * do corpo do webhook (`dataIdStr`, forjável). Achado de revisão (mutação
 * "M8"): trocar `.eq("id", orderId)` por `.eq("id", dataIdStr)` sobrevivia a
 * todos os testes, porque o cliente falso devolvia o mesmo `pedido` fixo
 * para qualquer `.eq()`, ignorando o argumento.
 */
function clienteFalso(opts: {
  rpcResultado?: string;
  rpcError?: unknown;
  pedido?: Record<string, unknown> | null;
  registro?: {
    chamadasRpc: Array<{ args: Record<string, unknown> }>;
    chamadasFrom?: Array<{ tabela: string; colunas: string; coluna: string; valor: unknown }>;
  };
}) {
  return {
    rpc: async (_nome: string, args: Record<string, unknown>) => {
      opts.registro?.chamadasRpc.push({ args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcResultado ?? null, error: null };
    },
    from(tabela: string) {
      return {
        select(colunas: string) {
          return {
            eq(coluna: string, valor: unknown) {
              opts.registro?.chamadasFrom?.push({ tabela, colunas, coluna, valor });
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
//
// Correção de 21/08/2026 (o defeito dos três elos, achado de auditoria): em
// produção `criar-pagamento` (index.ts:590) SEMPRE grava o id da ORDER em
// `gateway_payment_id` — nunca o id clássico que esta rota recebe do MP. O
// mock deste teste refletia um cenário que nunca acontece de verdade (os
// dois lados "clássicos" e coincidindo por acaso); ele agora grava
// ID_GRAVADO_NO_BANCO (ORD…) para exercitar o caso real, e a RPC precisa
// receber ESSE valor — não o que a rota `payment` do MP devolveu — senão
// `confirmar_pagamento` cai em 'divergente' e nada é gravado.

Deno.test("MP diz approved, gateway_payment_id gravado é ORD (Orders API) -> RPC recebe o valor do BANCO, com aviso logado", async () => {
  const registro = { chamadasRpc: [], chamadasFrom: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };
  const chamadasAviso: unknown[][] = [];
  const console_warn = console.warn;
  console.warn = (...args: unknown[]) => {
    chamadasAviso.push(args);
  };

  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl, enviarPush });
  } finally {
    console.warn = console_warn;
  }

  assertEquals(resposta.status, 200);
  assertEquals(chamadasPush.length, 1);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasAviso.length, 1, "deveria logar um aviso ao substituir o id pelo valor do banco");
  // Achado de revisão (mutação "M12"): a versão anterior desta asserção
  // juntava TODOS os argumentos numa string só e perguntava se ela CONTINHA
  // os valores — trocar os dois campos do objeto logado entre si
  // (`idDevolvidoPeloMp: idGravadoNoBanco, idGravadoNoBanco: idParaRpc`)
  // continuava satisfazendo essa busca, porque os dois valores apareciam em
  // algum lugar da string, na ordem que fosse. E
  // `assertStringIncludes(texto, "gateway_payment_id")` era satisfeita pela
  // MENSAGEM ESTÁTICA (que já contém esse literal), não pelo objeto — não
  // provava nada. Asserção POR CAMPO no objeto logado prova que cada valor
  // foi para o rótulo certo.
  const [, campos] = chamadasAviso[0] as [string, Record<string, unknown>];
  assertEquals(campos.orderId, UUID_PEDIDO);
  assertEquals(campos.idDevolvidoPeloMp, String(ID_PAGAMENTO_DO_MP));
  assertEquals(campos.idGravadoNoBanco, ID_GRAVADO_NO_BANCO);
  // Achado de revisão (mutação "M8"): prova que as DUAS leituras de
  // `marketplace_orders` (a do gateway_payment_id e a do push) apontam para
  // `orderId` (vindo da resposta autenticada do MP) — não para `dataIdStr`
  // ("999", o id cru e forjável do corpo do webhook).
  assertEquals(registro.chamadasFrom.length, 2, "deveria ter lido o pedido duas vezes: gateway_payment_id e push");
  // Achado de revisão (mutação "M10"): as duas leituras pedem COLUNAS
  // diferentes (a nova, "gateway_payment_id"; a do push, que já existia,
  // "id, customer_name, total, total_amount") — por isso a asserção é POR
  // LEITURA, não um laço uniforme. Trocar `.select("gateway_payment_id")`
  // por `.select("id")` sobrevivia a todos os testes: o laço antigo conferia
  // tabela/coluna/valor mas nunca `colunas`, e o PostgREST devolveria só
  // `{ id }` — `?.gateway_payment_id` viraria `undefined`, a correção nunca
  // dispararia, em silêncio, com os testes desta correção continuando
  // verdes.
  const [leituraGatewayId, leituraPush] = registro.chamadasFrom;
  assertEquals(leituraGatewayId.tabela, "marketplace_orders");
  assertEquals(leituraGatewayId.colunas, "gateway_payment_id");
  assertEquals(leituraGatewayId.coluna, "id");
  assertEquals(leituraGatewayId.valor, UUID_PEDIDO);
  assertEquals(leituraPush.tabela, "marketplace_orders");
  assertEquals(leituraPush.colunas, "id, customer_name, total, total_amount");
  assertEquals(leituraPush.coluna, "id");
  assertEquals(leituraPush.valor, UUID_PEDIDO);
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
    id: ID_ORDER_DO_MP,
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
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_DO_MP);
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

Deno.test("type 'payment' explícito continua no caminho clássico, e ainda assim aplica a correção (não-regressão)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const fetchImpl = fetchConsulta(200, { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
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
      corpo: { id: ID_ORDER_DO_MP, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/orders/")), true, "deveria ter consultado /v1/orders/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_DO_MP);
});

Deno.test("type ausente + id numérico -> caminho CLÁSSICO (consulta /v1/payments/), e aplica a correção do gateway_payment_id", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999"); // sem `type`
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/payments/")), true, "deveria ter consultado /v1/payments/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
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
      corpo: { id: ID_ORDER_DO_MP, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
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
    assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_DO_MP);
    assertEquals(chamadasErro.length, 1, "type desconhecido deveria logar console.error, não console.warn");
  } finally {
    console.error = console_error;
  }
});

Deno.test("type DESCONHECIDO + id numérico -> caminho CLÁSSICO (consulta /v1/payments/), e aplica a correção do gateway_payment_id", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "order.updated" } });
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(chamadas.some((u) => u.includes("/v1/payments/")), true, "deveria ter consultado /v1/payments/");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
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

// --- a QUERY STRING NÃO é fonte de manifesto (achado BLOQUEANTE de revisão,
// 16/08/2026) ---------------------------------------------------------------
//
// A versão anterior deste commit aceitava também o `data.id` da QUERY como
// candidato de assinatura. O defeito: a assinatura passava a poder ser
// satisfeita pelo id da QUERY, enquanto TODO o processamento downstream
// (rota, consulta ao MP, RPC `confirmar_pagamento`) usa o id do CORPO — e o
// atacante controla os dois. O teste abaixo é o que faltava para pegar
// exatamente isso: teria FALHADO (200, RPC chamada com o id errado) antes
// desta correção, e passa (401, RPC nunca chamada) depois.

Deno.test("assinatura sobre o id da QUERY com corpo divergente -> 401, RPC NUNCA chamada (a query não é fonte de manifesto)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });

  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-123";
  const ID_ASSINADO = ID_ORDER_TESTE; // o que o x-signature amarra (via query)
  const ID_CORPO_ADULTERADO = "ORDTST01OUTRAORDEMQUALQUER000001"; // o que o handler processaria
  // Assina sobre ID_ASSINADO — é o valor que iria na query, exatamente como
  // o probe da revisão fez.
  const v1 = await assinar(ID_ASSINADO, ts, requestId, SEGREDO);
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  const req = new Request(
    `http://localhost/webhook-mercadopago?data.id=${ID_ASSINADO}&type=order`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({ type: "order", data: { id: ID_CORPO_ADULTERADO } }),
    },
  );

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 401);
  assertEquals(chamouFetch, false, "não deveria ter consultado o MP com o id adulterado");
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("data.id da query com valor DIFERENTE do corpo não atrapalha o caminho normal — a query é inerte", async () => {
  // A query pode chegar com qualquer coisa (inclusive um `data.id` que não
  // bate com nada) sem afetar a validação: quem decide é só o corpo.
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-123";
  const v1 = await assinar("999", ts, requestId, SEGREDO);
  const req = new Request("http://localhost/webhook-mercadopago?data.id=lixo-qualquer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: "999" } }),
  });
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

Deno.test("grafia minuscula do helper assinar valida via candidato corpo-minusculo (id ORD… caixa mista)", async () => {
  // Não-regressão do helper novo: `grafia: "minuscula"` precisa produzir um
  // v1 que a implementação aceita pelo candidato "corpo-minusculo" — sem
  // isto, a opção nova do helper nunca seria exercitada por nenhum teste.
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const ID_MISTO = "OrD01TsTAbC";
  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-123";
  const v1 = await assinar(ID_MISTO, ts, requestId, SEGREDO, "minuscula");
  const req = new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ type: "order", data: { id: ID_MISTO } }),
  });
  const fetchImpl = fetchConsulta(200, {
    id: ID_MISTO,
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

// --- correção de 21/08/2026: gateway_payment_id gravado vs. id que a rota
// `payment` do MP devolve (achado de auditoria, os três elos) ---------------
//
// `criar-pagamento` sempre grava o id da ORDER em `gateway_payment_id`
// (index.ts:590), mesmo quando o painel do MP está inscrito no tópico
// clássico e esta rota recebe um id NUMÉRICO do MP. Sem ler o valor gravado
// e substituir por ele, `confirmar_pagamento` cai em 'divergente' e o
// dinheiro que já entrou no MP nunca é registrado — o teste principal desse
// caminho está no teste 3 (linha ~231, acima). Os dois testes abaixo cobrem
// o CONTROLE (nada muda quando os dois lados já falam a mesma língua) e o
// caminho de FALHA da leitura.

Deno.test("rota payment: gateway_payment_id gravado é clássico (e DIFERENTE do id do MP) -> nada muda, e NÃO loga aviso (controle negativo)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    // Clássico, mas DIFERENTE de ID_PAGAMENTO_DO_MP (o que o MP devolve
    // abaixo) — cobrança criada ANTES da migração para a Orders API, ou
    // clone que ainda usa o endpoint clássico. Achado de revisão (mutação
    // "M2b"): com os dois lados no MESMO valor, "substitui sempre com aviso
    // condicional" e "substitui só quando não-clássico" produzem a mesma
    // asserção de `p_payment_id` — só um valor DIFERENTE prova que o código
    // não substituiu.
    gateway_payment_id: ID_GRAVADO_CLASSICO_DIFERENTE,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };
  const chamadasAviso: unknown[][] = [];
  const console_warn = console.warn;
  console.warn = (...args: unknown[]) => {
    chamadasAviso.push(args);
  };

  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl, enviarPush });
  } finally {
    console.warn = console_warn;
  }

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, String(ID_PAGAMENTO_DO_MP));
  assertEquals(
    chamadasAviso.length,
    0,
    "não deveria logar aviso quando os dois lados já falam a mesma língua",
  );
});

Deno.test("rota payment: falha ao ler gateway_payment_id do pedido -> 500, RPC NÃO chamada, evento mantido na fila do MP", async () => {
  const chamadasRpc: Array<{ args: Record<string, unknown> }> = [];
  const erroLeitura = { message: "connection reset" };
  // Cliente falso PRÓPRIO deste teste (não `clienteFalso`): precisa devolver
  // um `error` na leitura de `marketplace_orders`, o que `clienteFalso` não
  // parametriza (ele só injeta erro no `.rpc()`).
  const supabase = {
    rpc: async (_nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ args });
      return { data: "pago", error: null };
    },
    from(_tabela: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return { maybeSingle: async () => ({ data: null, error: erroLeitura }) };
            },
          };
        },
      };
    },
  };
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 500);
  assertEquals(chamadasRpc.length, 0, "não deveria chamar confirmar_pagamento com o id que não pôde ser confirmado");
});

// Achado de revisão (mutação "M7", 21/08/2026): remover o `if (rota ===
// "payment")` que envolve o bloco de substituição não quebra NENHUM teste
// acima, porque nenhum deles exercita a rota `order` com um
// `gateway_payment_id` gravado que NÃO seja clássico. Na rota `order` a
// guarda (d) de `confirmar_pagamento` ainda compara duas fontes
// independentes (o `order.id` que o MP devolveu contra o `ORD…` gravado no
// banco) — é o que já pegou o defeito real de gravar `payments[0].id` no
// lugar de `order.id` (linhas 43-49, acima). Se o bloco de substituição
// rodasse também aqui, o valor gravado (não-clássico, forma de order)
// substituiria o `order.id` verdadeiro sem que nada acusasse.
Deno.test("rota order: gateway_payment_id gravado (ORD do banco) NÃO substitui o order.id do MP — a guarda (d) continua comparando duas fontes independentes", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    // Valor gravado no banco, DIFERENTE do que o MP devolve abaixo
    // (ID_ORDER_DO_MP) — se o bloco de substituição (restrito hoje a
    // `rota === "payment"`) rodasse aqui, a RPC receberia este valor em vez
    // do order.id verdadeiro.
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_DO_MP,
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
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_DO_MP);
});

Deno.test("rota payment: gateway_payment_id gravado é string vazia -> não substitui, guarda (c) fica sem trava e RPC recebe o id do MP", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    // Pedido criado sem cobrança gravada (ou coluna zerada por engano) — o
    // `length > 0` da condição de substituição barra este valor, e a RPC
    // segue com o id que o MP devolveu, que `confirmar_pagamento` recusa na
    // guarda (c) (gateway_payment_id IS NOT NULL). Sem este teste, o `length
    // > 0` não tinha nenhum caso exercitando a string vazia.
    gateway_payment_id: "",
  };
  const supabase = clienteFalso({ rpcResultado: "divergente", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, String(ID_PAGAMENTO_DO_MP));
});

// Achado de revisão (mutação "M15", 21/08/2026): nenhum teste acima exercita
// a rota `payment` com `gateway_payment_id` gravado em forma de ORD **e**
// status DIFERENTE de 'pago' — todos os testes que gravam ID_GRAVADO_NO_BANCO
// usam status "approved" ("pago"). Restringir a substituição a
// `statusMapeado === "pago"` (em vez de a TODOS os status) sobrevivia a toda
// a suíte. Na vida real isso apaga um estorno: uma cobrança da Orders API
// notificada pelo tópico clássico (`refunded` -> "estornado") voltaria a
// 'divergente' e o estorno nunca seria registrado — o dinheiro já voltou no
// MP e o app segue mostrando o pedido como se nada tivesse acontecido.
Deno.test("rota payment: status 'refunded' (estornado) com gateway_payment_id gravado ORD -> RPC recebe o id do BANCO, não só quando 'pago' (M15)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "estornado", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "refunded",
    external_reference: UUID_PEDIDO,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
  assertEquals(registro.chamadasRpc[0].args.p_status, "estornado");
});
