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
 *
 * O `.select()` PROJETA as colunas pedidas a partir de `pedido`, em vez de
 * devolver o objeto inteiro (achado de revisão, 21/08/2026): sem isso,
 * `.select("gateway_payment_id")` → `.select("id")` na produção passava
 * batido por 34 dos 35 testes — só a asserção de metadado em
 * `leituraGatewayId.colunas` acusava, e a produção quebrada (id trocado, em
 * silêncio) não derrubava NENHUM teste pelo comportamento. Com a projeção,
 * a mesma mutação some o campo `gateway_payment_id` do objeto devolvido, e
 * quem depende dele (a substituição do `idParaRpc`) falha pelo
 * COMPORTAMENTO, não só pelo nome da coluna pedida. `colunas.trim() === "*"`
 * devolve o `pedido` inteiro — não há nenhum `select("*")` neste arquivo
 * hoje, mas um projetor que quebrasse nesse caso venceria por ausência de
 * cobertura, não por estar certo.
 */
function clienteFalso(opts: {
  rpcResultado?: string;
  rpcError?: unknown;
  pedido?: Record<string, unknown> | null;
  // Falha de LEITURA injetada (laudo 31/08, conferência de valor): quando
  // presente, todo `.from().select().eq().maybeSingle()` devolve
  // `{ data: null, error }` — o handler tem que devolver 500 (evento fica
  // na fila do MP) em vez de confirmar sem conferir.
  erroFrom?: unknown;
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
              const pedido = opts.pedido ?? null;
              const colunasPedidas = new Set(
                colunas
                  .split(",")
                  .map((c) => c.trim())
                  .filter((c) => c.length > 0),
              );
              const projetado =
                pedido === null
                  ? null
                  : colunas.trim() === "*"
                    ? pedido
                    : Object.fromEntries(
                        Object.entries(pedido as Record<string, unknown>).filter(([chave]) =>
                          colunasPedidas.has(chave),
                        ),
                      );
              return {
                maybeSingle: async () =>
                  opts.erroFrom
                    ? { data: null, error: opts.erroFrom }
                    : { data: projetado, error: null },
              };
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
  // Achado de revisão, 22/08/2026: esta é a ÚNICA asserção sobre o CONTEÚDO
  // do push em todo o arquivo, e ela existe para provar a outra metade do
  // projetor de colunas do `clienteFalso` — a leitura multi-coluna do push.
  // Sem ela, quebrar o projetor (basta tirar o `.trim()` de `colunas.split`)
  // deixa a suíte 35/0 enquanto `total` some do objeto lido, `formatarBRL`
  // recebe `undefined` e devolve "R$ 0,00" (index.ts:128, `Number(valor ?? 0)`
  // — não estoura, só mente): o lojista receberia "Pedido pago · #1234 ·
  // R$ 0,00". Medida nas duas pontas antes de entrar: 35/0 com o projetor
  // são, 34/1 com ele quebrado.
  assertStringIncludes(
    String((chamadasPush[0] as { aviso: { body: string } }).aviso.body),
    "149,90",
  );
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasAviso.length, 2, "deveria logar DOIS avisos: conferência de valor sem número (a resposta do mock não traz transaction_amount) e a substituição do id pelo valor do banco");
  // Achado de revisão (mutação "M12"): a versão anterior desta asserção
  // juntava TODOS os argumentos numa string só e perguntava se ela CONTINHA
  // os valores — trocar os dois campos do objeto logado entre si
  // (`idDevolvidoPeloMp: idGravadoNoBanco, idGravadoNoBanco: idParaRpc`)
  // continuava satisfazendo essa busca, porque os dois valores apareciam em
  // algum lugar da string, na ordem que fosse. E
  // `assertStringIncludes(texto, "gateway_payment_id")` era satisfeita pela
  // MENSAGEM ESTÁTICA (que já contém esse literal), não pelo objeto — não
  // provava nada. Asserção POR CAMPO no objeto logado prova que cada valor
  // foi para o rótulo certo. (O aviso [0] é da conferência de valor sem
  // número — laudo 31/08; o swap é o [1].)
  const [, campos] = chamadasAviso[1] as [string, Record<string, unknown>];
  assertEquals(campos.orderId, UUID_PEDIDO);
  assertEquals(campos.idDevolvidoPeloMp, String(ID_PAGAMENTO_DO_MP));
  assertEquals(campos.idGravadoNoBanco, ID_GRAVADO_NO_BANCO);
  // Achado de revisão (mutação "M8"): prova que as DUAS leituras de
  // `marketplace_orders` (a da conferência — valor + gateway_payment_id na
  // mesma leitura única, laudo 31/08 — e a do push) apontam para `orderId`
  // (vindo da resposta autenticada do MP) — não para `dataIdStr` ("999", o
  // id cru e forjável do corpo do webhook).
  assertEquals(registro.chamadasFrom.length, 2, "deveria ter lido o pedido duas vezes: a conferência única e o push");
  // Achado de revisão (mutação "M10"): as duas leituras pedem COLUNAS
  // diferentes (a nova, "total, total_amount, gateway_payment_id"; a do
  // push, que já existia, "id, customer_name, total, total_amount") — por
  // isso a asserção é POR LEITURA, não um laço uniforme. Trocar o select da
  // conferência por `.select("id")` sobrevivia a todos os testes: o laço
  // antigo conferia tabela/coluna/valor mas nunca `colunas`, e o PostgREST
  // devolveria só `{ id }` — `?.gateway_payment_id` viraria `undefined`, a
  // correção nunca dispararia, em silêncio, com os testes desta correção
  // continuando verdes.
  const [leituraConferencia, leituraPush] = registro.chamadasFrom;
  assertEquals(leituraConferencia.tabela, "marketplace_orders");
  assertEquals(leituraConferencia.colunas, "total, total_amount, gateway_payment_id");
  assertEquals(leituraConferencia.coluna, "id");
  assertEquals(leituraConferencia.valor, UUID_PEDIDO);
  assertEquals(leituraPush.tabela, "marketplace_orders");
  assertEquals(leituraPush.colunas, "id, customer_name, total, total_amount");
  assertEquals(leituraPush.coluna, "id");
  assertEquals(leituraPush.valor, UUID_PEDIDO);
});

// --- 3.5 CONFERÊNCIA DE VALOR (laudo caça-bugs 31/08, achado A3) -----------
//
// O que se prova aqui: o valor que o MP APROVOU (na resposta autenticada)
// tem que bater com o total do pedido — PIX parcial deixa de virar "pedido
// pago". Os mocks desta seção trazem `transaction_amount`/`total_amount`,
// que os mocks ANTIGOS não traziam: ausência de valor = "não deu para
// conferir" (comportamento anterior, com warn), e é justamente o que os
// testes antigos acima exercitam sem saber.

Deno.test("rota payment: MP aprovou R$ 100 de um pedido de R$ 149,90 -> NÃO confirma, sem push, 200 'valor divergente'", async () => {
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
    transaction_amount: 100,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "valor divergente");
  assertEquals(registro.chamadasRpc.length, 0, "a RPC NÃO pode ser chamada com valor divergente");
  assertEquals(chamadasPush.length, 0, "pagamento divergente não pode virar push de 'pedido pago'");
  // A recusa acontece DEPOIS da leitura única e ANTES da RPC: a leitura
  // existe (a conferência precisa do total), a RPC não.
  assertEquals(registro.chamadasFrom.length, 1);
});

Deno.test("rota payment: valor aprovado bate o total -> confirma (controle positivo da conferência)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_CLASSICO_DIFERENTE,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.9,
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_order_id, UUID_PEDIDO);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasPush.length, 1);
});

Deno.test("rota payment: diferença de 4 centavos é arredondamento, não divergência (tolerância da criação do pedido)", async () => {
  // Por que 150/149.96 e não um par colado em exatamente 0.05: subtração de
  // ponto flutuante perto de 0.05 não é exata (149.9 - 149.85 =
  // 0.05000000000004), e um teste de BORDA exata testaria o float64, não a
  // regra. 4 centavos dentro, 6 centavos fora (teste seguinte) provam a
  // tolerância por MISERICÓRDIA e por RECUSA, sem depender do último bit.
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 150,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_CLASSICO_DIFERENTE,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.96,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1, "0.04 < 0.05 — confirmar");
});

Deno.test("rota payment: diferença de 6 centavos é divergência de dinheiro (fora da tolerância)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 150,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_CLASSICO_DIFERENTE,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.94,
  });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "valor divergente");
  assertEquals(registro.chamadasRpc.length, 0, "0.06 > 0.05 — NÃO confirmar");
});

Deno.test("rota order: total_amount STRING '10.00' (grafia medida da Orders API) diverge do total -> NÃO confirma", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_DO_MP,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "10.00",
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "valor divergente");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(chamadasPush.length, 0);
});

Deno.test("rota order: total_amount STRING '149.90' bate o total -> confirma (a conversão de string não mente)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_DO_MP,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(chamadasPush.length, 1);
});

Deno.test("rota order: sem total_amount na raiz, o fallback transactions.payments[0].amount ('10.00') diverge -> NÃO confirma", async () => {
  // Nota 3 da revisão do PR #366: o caminho do fallback do
  // `extrairValorDaOrder` não tinha teste próprio — uma mutação que
  // quebrasse SÓ o fallback passaria batido. Aqui a raiz está ausente de
  // propósito; o valor só existe dentro de transactions.payments[0].
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
      payments: [{ id: "PAY01KZZXXXXXXXXXXXXXXXXXXXXX", amount: "10.00" }],
    },
  });
  const chamadasPush: unknown[] = [];
  const enviarPush = async (args: unknown) => {
    chamadasPush.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "valor divergente");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(chamadasPush.length, 0);
});

Deno.test("leitura do pedido falha -> 500 (evento fica na fila do MP), RPC não chamada", async () => {
  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({
    rpcResultado: "pago",
    erroFrom: { message: "conexão recusada" },
    registro,
  });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.9,
  });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 500);
  assertEquals(corpo.error, "Erro ao consultar o pedido.");
  assertEquals(registro.chamadasRpc.length, 0, "sem a linha do pedido, nenhuma conferência tem o que comparar — não confirmar");
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
  // `enviarComprovante` no-op: este teste é sobre ROTEAMENTO (type
  // desconhecido -> forma do id), não sobre o comprovante. O resultado é
  // 'pago', então o gate real do handler chamaria o comprovante de verdade
  // — que, sem SMTP configurado no ambiente de teste, logaria um SEGUNDO
  // console.error ("sem_remetente") e quebraria a contagem exata abaixo.
  // Mesmo papel que o antigo stub padrão de `.functions.invoke` cumpria
  // silenciosamente antes do redesenho (25/08/2026): isolar testes que não
  // são sobre o comprovante do ruído dele.
  const enviarComprovante = async (_args: unknown) => {};
  try {
    const resposta = await handler(req, { supabase, fetchImpl, enviarComprovante });

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
    chamadasAviso.filter((a) => String(a[0]).includes("gateway_payment_id gravado")).length,
    0,
    "não deveria logar o aviso do SWAP quando os dois lados já falam a mesma língua. (Desde o laudo 31/08 existe OUTRO warn nesta rota — a conferência de valor avisando que o mock não trouxe transaction_amount; filtrar pelo aviso do swap, não por silêncio total.)",
  );
});

Deno.test("rota payment: falha ao ler gateway_payment_id do pedido -> 500, RPC NÃO chamada, evento mantido na fila do MP", async () => {
  const chamadasRpc: Array<{ args: Record<string, unknown> }> = [];
  const erroLeitura = { message: "connection reset" };
  // Cliente falso PRÓPRIO deste teste: precisa devolver um `error` na
  // leitura de `marketplace_orders` (o `clienteFalso` ganhou `erroFrom` para
  // isso na conferência de valor de 31/08; este teste é anterior, continua
  // valendo como está, e cobre o MESMO 500 pelo caminho da leitura única).
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

// --- defeito medido em 25/08/2026: quem paga PIX pelo site nunca é avisado
// de que o pagamento entrou. `useOrders.ts:1330-1332` promete "quem envia
// nesse caminho é o webhook, quando o pagamento confirma" — mas o webhook
// nunca chamava `send-order-confirmation`. Estes testes prendem essa
// promessa: o comprovante ao CLIENTE dispara SÓ em 'pago' (1 dos 9
// retornos), nunca nos outros oito, e uma falha de envio não pode derrubar
// o webhook (o MP reenviaria em laço).
//
// REDESENHO DE 25/08/2026: `enviarComprovante` (deps do handler) continua
// existindo como o ponto de injeção para testes — só o que ele faz POR
// PADRÃO mudou. Antes chamava `supabase.functions.invoke("send-order-
// confirmation", ...)` por HTTP, com um header `Authorization` forçado.
// Agora chama `enviarComprovantePedido` (`_shared/comprovante.ts`) DIRETO,
// por import — sem HTTP, sem header, sem depender de qual chave
// (`SUPABASE_SECRET_KEYS` vs `SUPABASE_SERVICE_ROLE_KEY`) o painel do
// Supabase tem hoje. Os testes que provavam o mecanismo HTTP antigo (header
// `Authorization` com a chave legada, `SUPABASE_SERVICE_ROLE_KEY` ausente)
// saíram: não há mais header nenhum para forçar. No lugar entrou um teste
// que mata o mutante de REGREDIR para o mecanismo antigo (mais abaixo,
// "não depende de SUPABASE_SECRET_KEYS nem de invoke HTTP").
//
// ⚠️ 'pago_apos_expirar' fica de FORA de propósito (achado de revisão de
// contexto limpo, 25/08/2026, mantido no redesenho) — diferente do push ao
// lojista, que sai nos DOIS. `enviarComprovantePedido` só sabe ler o
// literal 'pago'; com 'pago_apos_expirar' ela mentiria duas vezes: diria
// que o pagamento está "aguardando confirmação" (já foi confirmado) e que
// o pedido "entra na fila de separação" (segue cancelado, estoque já
// devolvido). E não há segunda chance: a reserva de envio é única e
// definitiva.

Deno.test("resultado 'pago' -> dispara TAMBÉM o comprovante ao cliente, com o orderId certo", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const enviarPush = async (_args: unknown) => {};
  const chamadasComprovante: unknown[] = [];
  const enviarComprovante = async (args: unknown) => {
    chamadasComprovante.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush, enviarComprovante });

  assertEquals(resposta.status, 200);
  assertEquals(chamadasComprovante.length, 1);
  assertEquals((chamadasComprovante[0] as { orderId: string }).orderId, UUID_PEDIDO);
});

Deno.test("resultado 'pago_apos_expirar' -> NÃO dispara o comprovante ao cliente (enviarComprovantePedido só conhece 'pago' e mentiria duas vezes)", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
  const supabase = clienteFalso({ rpcResultado: "pago_apos_expirar", pedido, registro });
  const req = await requisicaoAssinada("999");
  const fetchImpl = fetchConsulta(200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
  });
  const enviarPush = async (_args: unknown) => {};
  const chamadasComprovante: unknown[] = [];
  const enviarComprovante = async (args: unknown) => {
    chamadasComprovante.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarPush, enviarComprovante });

  assertEquals(resposta.status, 200);
  assertEquals(
    chamadasComprovante.length,
    0,
    "'pago_apos_expirar' não deveria disparar o comprovante — o pedido segue cancelado e o texto mentiria",
  );
});

Deno.test("comprovante dispara em exatamente 1 dos 9 retornos possíveis da RPC — só 'pago' (o push sai também em 'pago_apos_expirar', o comprovante não)", async () => {
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
  const DISPARAM = new Set(["pago"]);

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
    const enviarPush = async (_args: unknown) => {};
    const chamadasComprovante: unknown[] = [];
    const enviarComprovante = async (args: unknown) => {
      chamadasComprovante.push(args);
    };

    await handler(req, { supabase, fetchImpl, enviarPush, enviarComprovante });

    const esperado = DISPARAM.has(resultado) ? 1 : 0;
    assertEquals(
      chamadasComprovante.length,
      esperado,
      `resultado="${resultado}" deveria disparar ${esperado} comprovante(s)`,
    );
  }
});

// --- o caminho REAL (deps.enviarComprovante não injetado): agora chama
// enviarComprovantePedido DIRETO, sem HTTP -----------------------------------

Deno.test("enviarComprovantePedido lança -> webhook ainda responde 200, e loga o erro (falha nunca sobe)", async () => {
  // Usa a implementação REAL (não injeta deps.enviarComprovante), para provar
  // que o catch de `dispararComprovanteReal` — não o teste — é o que impede
  // a falha de subir. Sem isso, uma exceção inesperada dentro do miolo faria
  // o handler devolver 500 e o MP reenviaria em laço um pagamento que já foi
  // registrado com sucesso.
  //
  // `supabase.rpc` lança direto (em vez de devolver `{error}`) para simular
  // uma falha que `enviarComprovantePedido` não trata internamente — o
  // ponto de prova aqui é o `catch` de `dispararComprovanteReal`, não o
  // tratamento de erro do miolo (que já tem sua própria suíte em
  // `_shared/comprovante_test.ts`).
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const registro = { chamadasRpc: [] };
    const pedido = {
      id: UUID_PEDIDO,
      customer_name: "Maria",
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        registro.chamadasRpc.push({ args });
        if (nome === "confirmar_pagamento") return { data: "pago", error: null };
        if (nome === "reivindicar_email_de_confirmacao") {
          throw new Error("conexão com o banco caiu no meio da reserva");
        }
        return { data: null, error: null };
      },
      from(tabela: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: tabela === "marketplace_orders" ? pedido : null, error: null }) };
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
    const enviarPush = async (_args: unknown) => {};
    const chamadasErro: unknown[][] = [];
    const console_error = console.error;
    console.error = (...args: unknown[]) => {
      chamadasErro.push(args);
    };

    let resposta: Response;
    try {
      resposta = await handler(req, { supabase, fetchImpl, enviarPush });
    } finally {
      console.error = console_error;
    }

    assertEquals(resposta.status, 200);
    assertEquals(
      chamadasErro.some((args) =>
        args.some((v) => typeof v === "string" && v.includes("comprovante")),
      ),
      true,
      "deveria logar console.error mencionando o comprovante",
    );
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

Deno.test("enviarComprovantePedido devolve { ok: false } SEM lançar (ex.: SMTP não configurado) -> webhook responde 200, e loga o motivo", async () => {
  // `enviarComprovantePedido` (`_shared/comprovante.ts`) NUNCA lança para os
  // desfechos esperados — devolve `{ ok: false, motivo }` (ver
  // `_shared/comprovante_test.ts`). Este teste prende que
  // `dispararComprovanteReal` INSPECIONA esse retorno e loga o motivo, em
  // vez de tratar `{ ok: false }` como sucesso silencioso — sem ele, um
  // mutante que apagasse o `if (!desfecho.ok)` sobreviveria: o webhook
  // continuaria respondendo 200 (o catch nem entraria em jogo), mas nenhum
  // log diria por que o cliente não recebeu o comprovante.
  //
  // SMTP_USER/SMTP_PASSWORD ficam DELETADOS de propósito (não setados): é
  // o que faz `remetenteConfigurado()` real devolver `false` e
  // `enviarComprovantePedido` devolver `{ ok: false, motivo: 'sem_remetente' }`
  // SEM tocar rede nenhuma — nem o `supabase` fake precisa implementar nada
  // além do necessário para `confirmar_pagamento`.
  const valorUser = Deno.env.get("SMTP_USER");
  const valorPass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    const registro = { chamadasRpc: [] };
    const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null };
    const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
    const req = await requisicaoAssinada("999");
    const fetchImpl = fetchConsulta(200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "approved",
      external_reference: UUID_PEDIDO,
    });
    const enviarPush = async (_args: unknown) => {};
    const chamadasErro: unknown[][] = [];
    const console_error = console.error;
    console.error = (...args: unknown[]) => {
      chamadasErro.push(args);
    };

    let resposta: Response;
    try {
      resposta = await handler(req, { supabase, fetchImpl, enviarPush });
    } finally {
      console.error = console_error;
    }

    assertEquals(resposta.status, 200);
    const logComMotivo = chamadasErro.find((args) =>
      args.some((v) => typeof v === "string" && v.includes("comprovante ao cliente não enviado")),
    );
    assertEquals(logComMotivo !== undefined, true, "deveria logar que o comprovante não foi enviado");
    const [, campos] = (logComMotivo ?? []) as [string, Record<string, unknown>];
    assertEquals(campos?.motivo, "sem_remetente");
  } finally {
    if (valorUser !== undefined) Deno.env.set("SMTP_USER", valorUser);
    if (valorPass !== undefined) Deno.env.set("SMTP_PASSWORD", valorPass);
  }
});

Deno.test("por padrão (sem deps.enviarComprovante), chama enviarComprovantePedido DIRETO — a reserva do banco (reivindicar_email_de_confirmacao) é alcançada com o orderId certo", async () => {
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const pedido = {
      id: UUID_PEDIDO,
      customer_name: "Maria",
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadasRpc.push({ nome, args });
        if (nome === "confirmar_pagamento") return { data: "pago", error: null };
        // "já enviado": para o teste, o que importa é provar que a RPC de
        // reserva foi ALCANÇADA com o orderId certo — não completar o envio
        // (que tocaria SMTP de verdade).
        if (nome === "reivindicar_email_de_confirmacao") return { data: false, error: null };
        return { data: null, error: null };
      },
      from(tabela: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: tabela === "marketplace_orders" ? pedido : null, error: null }) };
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
    const enviarPush = async (_args: unknown) => {};

    const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

    assertEquals(resposta.status, 200);
    const chamadaReserva = chamadasRpc.find((c) => c.nome === "reivindicar_email_de_confirmacao");
    assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO);
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

// --- defeito medido em 25/08/2026 (redesenho): mata o mutante de REGREDIR
// para o mecanismo antigo (supabase.functions.invoke + header Authorization
// forçado com uma chave lida do ambiente). O teste NÃO prova por VALOR (a
// leitura de uma variável específica) — prova por MECANISMO: o fake de
// supabase abaixo não define `.functions` nenhum, então se o código
// regredisse para `supabase.functions.invoke(...)`, a chamada lançaria
// "is not a function", o catch de `dispararComprovanteReal` engoliria o
// erro, e a reserva (`reivindicar_email_de_confirmacao`) JAMAIS seria
// alcançada. `SUPABASE_SECRET_KEYS` é setada com um valor DISTINTO e nunca
// deveria ser lida por este caminho — se o mutante reintroduzisse a leitura
// da chave, o valor lido seria justamente este, mas quem denuncia a
// regressão é a ausência da chamada à reserva, não o valor em si.

Deno.test("comprovante chama DIRETO a reserva no supabase do webhook — não depende de SUPABASE_SECRET_KEYS nem de invoke HTTP", async () => {
  const valorAnterior = Deno.env.get("SUPABASE_SECRET_KEYS");
  Deno.env.set(
    "SUPABASE_SECRET_KEYS",
    JSON.stringify({ default: "chave-nova-que-este-caminho-nao-deveria-ler" }),
  );
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const pedido = {
      id: UUID_PEDIDO,
      customer_name: "Maria",
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = {
      // Sem `.functions` de propósito — ver o comentário acima.
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadasRpc.push({ nome, args });
        if (nome === "confirmar_pagamento") return { data: "pago", error: null };
        if (nome === "reivindicar_email_de_confirmacao") return { data: false, error: null };
        return { data: null, error: null };
      },
      from(tabela: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: tabela === "marketplace_orders" ? pedido : null, error: null }) };
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
    const enviarPush = async (_args: unknown) => {};

    const resposta = await handler(req, { supabase, fetchImpl, enviarPush });

    assertEquals(resposta.status, 200);
    assertEquals(
      chamadasRpc.some((c) => c.nome === "reivindicar_email_de_confirmacao"),
      true,
      "a reserva do banco precisa ser alcançada sem passar por HTTP nem por header de autenticação",
    );
  } finally {
    if (valorAnterior === undefined) Deno.env.delete("SUPABASE_SECRET_KEYS");
    else Deno.env.set("SUPABASE_SECRET_KEYS", valorAnterior);
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});
