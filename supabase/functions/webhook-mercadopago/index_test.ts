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
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler, htmlDoAvisoDePagamentoAtrasado } from "./index.ts";
// mp-10: prova que a porta barata do handler e `avaliarAssinatura` usam a
// MESMA regra de parse (ver o teste "camposDaAssinatura vem do módulo
// compartilhado" mais abaixo) — não duas cópias que pudessem divergir.
import { camposDaAssinatura, montarSentinela } from "../_shared/mercadopago.ts";
// Tarefa mp-2: as MESMAS primitivas de cifra da produção montam o registro
// do lojista nos testes MP-W1..MP-W3 do fim deste arquivo. Desde a tarefa
// mp-6 o fixture vem PRONTO de `_shared/credenciais-mp_fixtures.ts` — era a
// mesma montagem copiada em cinco suítes, e cópia de fixture envelhece
// calada quando a forma do registro em app_settings muda. Desde a mp-10 o
// `contandoFrom` (dublê que conta os `from(tabela)`) também vem de lá — era
// copiado igualzinho no `reconciliar-pagamentos/index_test.ts`.
import {
  CHAVE_CIFRA_TESTE,
  contandoFrom,
  registroMpDeTeste,
  TOKEN_LOJISTA_FALSO,
  WEBHOOK_LOJISTA_FALSO as SEGREDO_WEBHOOK_LOJISTA,
} from "../_shared/credenciais-mp_fixtures.ts";

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
  // Achado S4/W7 (3ª revisão de risco, 26/09/2026): falha só a(s) primeira(s)
  // N chamada(s) de `.select("gateway_payment_id")` — as leituras do B1
  // (estorno) e do S1 (liberar pelo sentinela) pedem exatamente essa string
  // de colunas. `erroFrom` (acima) falharia TODA leitura, inclusive a que lê
  // o pedido no começo do handler — cedo demais para provar isto.
  falharLeituraGatewayPaymentId?: number;
  // Revisão de risco de 30/09/2026 (4ª rodada, MENOR 1): falha a leitura
  // `created_at, tentativas_de_pagamento` do fallback do sentinela — sem a
  // tentativa atual, o fallback não pode soltar a vaga.
  falharLeituraDaTentativa?: boolean;
  // Lote A (R10): falha a leitura `metodo_online, gateway_payment_id` — o
  // segundo sinal de "é cartão" na recusa de order sem payment_method.type.
  falharLeituraDoMetodo?: boolean;
  // Achado S5/W4 (3ª revisão de risco, 26/09/2026): simula uma corrida —
  // dispara logo DEPOIS da leitura ÚNICA (`select("total, total_amount,
  // gateway_payment_id")`, index.ts:1753-1757) que precede a decisão de
  // ADOTAR a vaga, e ANTES de a adoção tentar o próprio `.update()`. Mesmo
  // padrão do `aposLerLinhaDoPedido` do harness da 3ª revisão de risco.
  aposLeituraDoPedido?: (pedido: Record<string, unknown>) => void;
  // Fase 3.5 (cartão): `rpc("liberar_cobranca_do_pedido")` — o boolean que
  // a RPC devolve (default true) e a falha de banco simulada.
  liberarResultado?: boolean;
  liberarErro?: unknown;
  // Achado S1 (3ª revisão de risco, 26/09/2026, W5): fila de resultados
  // CONSUMIDA NA ORDEM das chamadas de `liberar_cobranca_do_pedido` desta
  // MESMA notificação — a 1ª tentativa (pelo id do MP) pode não bater com o
  // sentinela que está na vaga, e o FALLBACK novo tenta de novo pela chave
  // do sentinela. Esgotada a fila (ou ausente), cai em `liberarResultado`
  // (default `true`) — nenhum teste anterior a este achado usa isto.
  liberarResultados?: boolean[];
  registro?: {
    chamadasRpc: Array<{ args: Record<string, unknown> }>;
    chamadasLiberar?: Array<{ args: Record<string, unknown> }>;
    chamadasFrom?: Array<{ tabela: string; colunas: string; coluna: string; valor: unknown }>;
    chamadasConcluirEstorno?: Array<{ args: Record<string, unknown> }>;
    insertsOrderRefunds?: Array<Record<string, unknown>>;
    updatesOrderRefunds?: Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >;
    // Achado B2: a ADOÇÃO da vaga vazia/em verificação (`marketplace_orders`
    // direto, sem RPC).
    chamadasUpdateMarketplaceOrders?: Array<
      { valores: Record<string, unknown>; filtros: Array<{ coluna: string; valor: unknown }> }
    >;
    // C-P: cada `rpc("reservar_aviso_ao_lojista")`, e cada confirmar_/liberar_.
    chamadasReservar?: Array<{ args: Record<string, unknown> }>;
    chamadasAviso?: Array<{ nome: string; args: Record<string, unknown> }>;
  };
  // --- T5 (estorno pelo app): order_refunds — o ledger que o passo novo
  // (registrarDesfechoDoEstorno) lê/grava. Default: fila VAZIA — testes que
  // não passam nada aqui (as 50 pré-existentes) continuam se comportando
  // como antes MESMO que um status novo (refunded/charged_back) dispare o
  // gatilho: o passo roda e não encontra nada para fazer.
  orderRefundsRows?: Array<Record<string, unknown>>;
  erroOrderRefundsSelect?: unknown;
  erroOrderRefundsInsert?: unknown;
  erroOrderRefundsUpdate?: unknown;
  // Erro nomeado (ex.: 'estorno_acima_do_total') por chamada de
  // concluir_estorno — função para W8 poder recusar só a chamada que
  // interessa, sem afetar outras.
  erroConcluirEstorno?: (args: Record<string, unknown>) => unknown;
  concluirEstornoResultado?: unknown;
  // Tarefa mp-2: o registro CIFRADO do lojista, como ele dorme em
  // app_settings (_shared/credenciais-mp.ts). Default ausente — a loja que
  // ainda roda pelas chaves da plataforma, que é o que todos os testes
  // anteriores a esta tarefa exercitam.
  registroMp?: Record<string, unknown> | null;
  // C-P (02/10/2026): as três RPCs do aviso (migration 20261191000000)
  // espelham as reais, SEM o prazo de 2 minutos (o prazo é SQL e foi provado
  // em Postgres de verdade à parte): reservar = 'reservado' se a chave não
  // existe, 'enviado' se já foi entregue, 'em_envio' se outra entrega está
  // com ela; confirmar = enviado; liberar = apaga se NÃO enviado. As chaves
  // vivem em `avisos` — passe o MESMO Map entre chamadas de handler para
  // simular as reentregas do MP contra o mesmo banco. `reservaFalha`: "erro"
  // devolve `{ error }`, "lanca" rejeita, "nulo" devolve `{ data: null }`,
  // "desconhecido" devolve `true` (o contrato booleano da rodada 2).
  // `reservaRespostas`: roteiro consumido NA ORDEM das chamadas de reservar
  // (um `Error` no roteiro = a chamada lança); esgotado, volta ao Map.
  avisos?: Map<string, { enviado: boolean }>;
  reservaFalha?: "erro" | "lanca" | "nulo" | "desconhecido";
  reservaRespostas?: Array<string | Error>;
  // Lote A (04/10/2026): espelha os índices únicos PARCIAIS da migration
  // 20261192000000 — INSERT com (order_id, mp_refund_id) ou (order_id,
  // mp_chargeback_id) já presentes na fila devolve 23505, como o Postgres.
  // Opt-in: os testes anteriores ao Lote A continuam sem índice nenhum.
  indicesUnicosDoLedger?: boolean;
  // Lote A: as N PRIMEIRAS leituras de order_refunds por pedido só devolvem
  // depois que as N chegaram — duas entregas PARALELAS do MP leem o ledger
  // ANTES de qualquer uma gravar (a corrida do R2/R1-NULL), de forma
  // determinística.
  barreiraLeituraOrderRefunds?: number;
  // Lote A: chamado logo DEPOIS de cada leitura de order_refunds por pedido
  // (com a fila viva) — simula outra entrega gravando entre a leitura e o
  // INSERT desta.
  aposLerOrderRefunds?: (fila: Array<Record<string, unknown>>) => void;
  // Lote A (bloqueio da revisão): `concluir_estorno` também soma em
  // `pedido.valor_estornado` (como a RPC real, 2026110000100) — para o teste
  // ler o acumulado CANÔNICO no fim e numa reentrega. Opt-in.
  concluirSomaNoPedido?: boolean;
  // Lote A (bloqueios 1/3/5/6): as RPCs da 20261196000000 — o dinheiro da
  // contestação é decidido no BANCO, sob a trava do pedido (prova viva:
  // tests/banco/contestacao-viva.cjs). O dublê só registra a chamada e
  // devolve o retorno que o teste roteirizar (default: 'reservado').
  contestacaoNoLedger?: (args: Record<string, unknown>) => { data: unknown; error: unknown };
  estornoExternoNaContestacao?: (args: Record<string, unknown>) => { data: unknown; error: unknown };
}) {
  const avisos = opts.avisos ?? new Map<string, { enviado: boolean }>();
  let leiturasNaBarreira = 0;
  let soltarBarreira: () => void = () => {};
  const barreira = new Promise<void>((resolve) => {
    soltarBarreira = resolve;
  });
  // Fila VIVA de order_refunds — mutável: um INSERT desta MESMA chamada de
  // handler (ou de uma chamada seguinte, com o MESMO cliente falso — W3/W5
  // reenviam a notificação) passa a aparecer nas leituras seguintes, como o
  // banco de verdade faria.
  const filaOrderRefunds: Array<Record<string, unknown>> = (opts.orderRefundsRows ?? []).map(
    (r) => ({ ...r }),
  );
  let proximoIdInserido = 0;
  // W5: espelha a SOMA que a RPC real faz em marketplace_orders.valor_estornado
  // — só soma na PRIMEIRA conclusão de cada linha (P13: (status <> 'concluido'
  // OR concluido_em IS NULL)); replay da MESMA linha não soma de novo.
  let valorEstornadoAcumulado = 0;
  // Achado S4/W7: contador mutável, decrementado a cada leitura de
  // `gateway_payment_id` que esta chamada de handler faz.
  let falhasLeituraGatewayRestantes = opts.falharLeituraGatewayPaymentId ?? 0;
  // Lote A: a fila VIVA exposta ao teste — é ela que diz quantas linhas
  // EXISTEM no fim (os inserts registrados incluem as tentativas recusadas).
  if (opts.registro) (opts.registro as any).filaOrderRefunds = filaOrderRefunds;

  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      if (nome === "confirmar_pagamento") {
        opts.registro?.chamadasRpc.push({ args });
        if (opts.rpcError) return { data: null, error: opts.rpcError };
        return { data: opts.rpcResultado ?? null, error: null };
      }
      if (nome === "liberar_cobranca_do_pedido") {
        opts.registro?.chamadasLiberar?.push({ args });
        if (opts.liberarErro) return { data: null, error: opts.liberarErro };
        const daFila = opts.liberarResultados?.shift();
        return { data: daFila ?? opts.liberarResultado ?? true, error: null };
      }
      if (nome === "concluir_estorno") {
        opts.registro?.chamadasConcluirEstorno?.push({ args });
        const erro = opts.erroConcluirEstorno?.(args) ?? null;
        if (erro) return { data: null, error: erro };
        // Espelha o COALESCE + a guarda P13 da RPC real
        // (2026110000100_concluir_estorno.sql): só soma e só carimba
        // concluido_em na PRIMEIRA passagem — replay da MESMA linha (W5) não
        // soma de novo.
        const linha = filaOrderRefunds.find((r) => r.id === args.p_refund_id);
        const jaConcluida = Boolean(linha && linha.status === "concluido" && linha.concluido_em);
        if (linha && !jaConcluida) {
          valorEstornadoAcumulado += Number(linha.amount ?? 0);
          if (opts.concluirSomaNoPedido && opts.pedido) {
            const p = opts.pedido as Record<string, unknown>;
            p.valor_estornado = Number((Number(p.valor_estornado ?? 0) + Number(linha.amount ?? 0)).toFixed(2));
          }
          linha.status = "concluido";
          linha.concluido_em = "2026-09-08T00:00:00.000Z";
          if (args.p_mp_refund_id !== undefined && args.p_mp_refund_id !== null) {
            linha.mp_refund_id = args.p_mp_refund_id;
          }
        }
        if (opts.registro) (opts.registro as any).valorEstornadoAcumulado = valorEstornadoAcumulado;
        return {
          data: opts.concluirEstornoResultado ?? {
            concluido: true,
            ja_concluida: jaConcluida,
            valor_estornado: valorEstornadoAcumulado,
          },
          error: null,
        };
      }
      if (nome === "registrar_contestacao_no_ledger") {
        (opts.registro as any)?.chamadasContestacao?.push({ args });
        return opts.contestacaoNoLedger?.(args) ??
          { data: { resultado: "reservado", aviso: null, valor_estornado: 0, em_voo: 0, disponivel: 0 }, error: null };
      }
      if (nome === "registrar_estorno_externo_na_contestacao") {
        (opts.registro as any)?.chamadasExternoNaContestacao?.push({ args });
        return opts.estornoExternoNaContestacao?.(args) ??
          { data: { resultado: "inserido", aviso: null, valor_estornado: Number(args.p_valor), em_voo: 0, disponivel: 0 }, error: null };
      }
      if (nome === "reservar_aviso_ao_lojista") {
        opts.registro?.chamadasReservar?.push({ args });
        opts.registro?.chamadasAviso?.push({ nome, args });
        if (opts.reservaFalha === "lanca") throw new Error("rede caiu (dublê)");
        if (opts.reservaFalha === "erro") return { data: null, error: { message: "statement timeout (dublê)" } };
        if (opts.reservaFalha === "nulo") return { data: null, error: null };
        if (opts.reservaFalha === "desconhecido") return { data: true, error: null };
        const roteiro = opts.reservaRespostas?.shift();
        if (roteiro instanceof Error) throw roteiro;
        if (roteiro !== undefined) return { data: roteiro, error: null };
        const chave = String(args.p_chave);
        const linha = avisos.get(chave);
        if (linha) return { data: linha.enviado ? "enviado" : "em_envio", error: null };
        avisos.set(chave, { enviado: false });
        return { data: "reservado", error: null };
      }
      if (nome === "confirmar_aviso_ao_lojista" || nome === "liberar_aviso_ao_lojista") {
        opts.registro?.chamadasAviso?.push({ nome, args });
        const chave = String(args.p_chave);
        const linha = avisos.get(chave);
        if (nome === "confirmar_aviso_ao_lojista") {
          if (linha) linha.enviado = true;
          return { data: Boolean(linha), error: null };
        }
        const apaga = Boolean(linha && !linha.enviado);
        if (apaga) avisos.delete(chave);
        return { data: apaga, error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    from(tabela: string) {
      // Tarefa mp-2: a resolução das credenciais (_shared/credenciais-mp.ts)
      // lê app_settings pelo MESMO client. Ramo PRÓPRIO — se caísse na
      // cadeia de `marketplace_orders` lá embaixo, esta leitura entraria em
      // `registro.chamadasFrom`, e as asserções que provam QUAL linha o
      // handler lê (a mutação "M8") passariam a olhar para a leitura errada.
      if (tabela === "app_settings") {
        return {
          select(_colunas: string) {
            return {
              eq(_coluna: string, _valor: unknown) {
                return {
                  maybeSingle: async () => ({
                    data: opts.registroMp
                      ? { value: JSON.stringify(opts.registroMp) }
                      : null,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      if (tabela === "order_refunds") {
        return {
          select(colunas: string) {
            return {
              eq(_coluna: string, orderId: string) {
                if (opts.erroOrderRefundsSelect) {
                  return Promise.resolve({ data: null, error: opts.erroOrderRefundsSelect });
                }
                // Cópias RASAS por linha (como o PostgREST real devolve —
                // laudo rodada 2, BLOQUEIA-2): sem isso, o handler mutar uma
                // linha do array devolvido (ex.: marcar status='concluido'
                // localmente) mutava a MESMA referência que `filaOrderRefunds`
                // guarda, escondendo qualquer defeito de dupla contagem
                // dentro do MESMO lote — a fila continua VIVA entre chamadas
                // (W3/W5 seguem, porque o INSERT/RPC ainda escrevem na fila
                // de verdade; só a LEITURA deixa de compartilhar referência).
                //
                // PROJEÇÃO das colunas pedidas (laudo rodada 2, BLOQIEA
                // `mp_status`): mesma lógica de `colunasPedidas` usada 100
                // linhas abaixo para `marketplace_orders` — o PostgREST real
                // só devolve o que o `select()` pede, e a assimetria entre
                // os dois dublês (este devolvia a linha INTEIRA) era o que
                // escondia a coluna esquecida no `select` de produção.
                const colunasPedidas = new Set(
                  colunas
                    .split(",")
                    .map((c) => c.trim())
                    .filter((c) => c.length > 0),
                );
                const projetar = (r: Record<string, unknown>) =>
                  colunas.trim() === "*"
                    ? { ...r }
                    : Object.fromEntries(
                        Object.entries(r).filter(([chave]) => colunasPedidas.has(chave)),
                      );
                const ler = () => {
                  const lido = {
                    data: filaOrderRefunds.filter((r) => r.order_id === orderId).map(projetar),
                    error: null,
                  };
                  opts.aposLerOrderRefunds?.(filaOrderRefunds);
                  return lido;
                };
                const n = opts.barreiraLeituraOrderRefunds ?? 0;
                if (leiturasNaBarreira < n) {
                  leiturasNaBarreira++;
                  if (leiturasNaBarreira === n) soltarBarreira();
                  return barreira.then(ler);
                }
                return Promise.resolve(ler());
              },
            };
          },
          insert(valores: Record<string, unknown>) {
            // O INSERT do item A4/B (in_process) não encadeia `.select()` —
            // é `await`ado DIRETO, como o supabase-js real permite (o
            // resultado é thenable mesmo sem `.select()`). `executar()` é a
            // MESMA lógica para os dois casos, para não existir um segundo
            // produtor de linha na fila.
            const executar = () => {
              opts.registro?.insertsOrderRefunds?.push(valores);
              if (opts.erroOrderRefundsInsert) {
                return { data: null, error: opts.erroOrderRefundsInsert };
              }
              if (opts.indicesUnicosDoLedger) {
                // Comparação por NOME FIXO (nunca `valores[coluna]`), para não
                // acordar o security/detect-object-injection da catraca.
                const refundRepetido = valores.mp_refund_id != null &&
                  filaOrderRefunds.some((r) =>
                    r.order_id === valores.order_id && r.mp_refund_id === valores.mp_refund_id
                  );
                const contestacaoRepetida = valores.mp_chargeback_id != null &&
                  filaOrderRefunds.some((r) =>
                    r.order_id === valores.order_id && r.mp_chargeback_id === valores.mp_chargeback_id
                  );
                if (refundRepetido || contestacaoRepetida) {
                  return {
                    data: null,
                    error: {
                      code: "23505",
                      message: "duplicate key value violates unique constraint (dublê do Lote A)",
                    },
                  };
                }
              }
              proximoIdInserido++;
              const id = `sistema-${proximoIdInserido}`;
              filaOrderRefunds.push({ ...valores, id });
              return { data: { id }, error: null };
            };
            return {
              select(_colunas: string) {
                return {
                  maybeSingle: () => Promise.resolve(executar()),
                };
              },
              // `await`ável DIRETO (item A4/B in_process: `insert({...})`
              // sem `.select()`) — mesma regra do supabase-js real.
              then(resolveu: any, rejeitou: any) {
                return Promise.resolve(executar()).then(resolveu, rejeitou);
              },
            };
          },
          update(valores: Record<string, unknown>) {
            return {
              eq(_coluna: string, id: string) {
                return {
                  in(_coluna2: string, statusFiltro: string[]) {
                    const executar = () => {
                      opts.registro?.updatesOrderRefunds?.push({ id, valores, statusFiltro });
                      if (opts.erroOrderRefundsUpdate) {
                        return { data: null, error: opts.erroOrderRefundsUpdate };
                      }
                      const linha = filaOrderRefunds.find((r) => r.id === id);
                      if (linha && statusFiltro.includes(String(linha.status))) {
                        Object.assign(linha, valores);
                        return { data: [{ id }], error: null };
                      }
                      return { data: [], error: null };
                    };
                    return { then: (res: any, rej: any) => Promise.resolve(executar()).then(res, rej) };
                  },
                  // Lote A: a ADOÇÃO da linha antiga de contestação —
                  // `.eq("id", ...).is("mp_chargeback_id", null)`: só grava se
                  // a linha ainda não tem CBK (outra entrega pode ter adotado).
                  is(_coluna2: string, _valor: null) {
                    const executar = () => {
                      opts.registro?.updatesOrderRefunds?.push({ id, valores, statusFiltro: ["is:mp_chargeback_id:null"] });
                      if (opts.erroOrderRefundsUpdate) {
                        return { data: null, error: opts.erroOrderRefundsUpdate };
                      }
                      const linha = filaOrderRefunds.find((r) => r.id === id);
                      if (linha && (linha.mp_chargeback_id === null || linha.mp_chargeback_id === undefined)) {
                        Object.assign(linha, valores);
                        return { data: [{ id }], error: null };
                      }
                      return { data: [], error: null };
                    };
                    return { then: (res: any, rej: any) => Promise.resolve(executar()).then(res, rej) };
                  },
                };
              },
            };
          },
        };
      }

      // ── comportamento pré-existente (marketplace_orders) ──────────────
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
                maybeSingle: async () => {
                  if (opts.falharLeituraDaTentativa && colunasPedidas.has("tentativas_de_pagamento")) {
                    return { data: null, error: { message: "statement timeout" } };
                  }
                  if (opts.falharLeituraDoMetodo && colunasPedidas.has("metodo_online")) {
                    return { data: null, error: { message: "statement timeout" } };
                  }
                  if (colunas.trim() === "gateway_payment_id" && falhasLeituraGatewayRestantes > 0) {
                    falhasLeituraGatewayRestantes--;
                    return { data: null, error: { message: "statement timeout" } };
                  }
                  // Achado S5/W4: a corrida acontece DEPOIS que esta leitura
                  // devolveu o snapshot (`projetado`, já calculado acima) —
                  // mutar `pedido` aqui não pode mudar o que ESTA chamada já
                  // vai devolver, só o que a PRÓXIMA leitura/escrita vê.
                  if (
                    pedido &&
                    colunasPedidas.has("total_amount") &&
                    colunasPedidas.has("gateway_payment_id") &&
                    opts.aposLeituraDoPedido
                  ) {
                    opts.aposLeituraDoPedido(pedido as Record<string, unknown>);
                  }
                  return opts.erroFrom
                    ? { data: null, error: opts.erroFrom }
                    : { data: projetado, error: null };
                },
              };
            },
          };
        },
        // Achado B2 (2ª revisão de risco, 26/09/2026): a ADOÇÃO da vaga vazia
        // é o PRIMEIRO `.update()` que este webhook faz direto em
        // `marketplace_orders` (tudo antes passava pela RPC) — o dublê
        // precisa de um encadeador CONDICIONAL de verdade (mesmo padrão do
        // `bancoComEstado` em `criar-pagamento/index_test.ts`: compara por
        // NOME FIXO, nunca `pedido[coluna]`, para não acordar o
        // `security/detect-object-injection` da catraca).
        update(valores: Record<string, unknown>) {
          const pedido = opts.pedido as Record<string, unknown> | null;
          const filtros: Array<{ coluna: string; valor: unknown }> = [];
          const bateFiltro = (coluna: string, valor: unknown): boolean => {
            if (!pedido) return false;
            if (coluna === "id") return pedido.id === valor;
            if (coluna === "gateway_payment_id") return pedido.gateway_payment_id === valor;
            return false;
          };
          const encadeador = {
            eq(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor });
              return encadeador;
            },
            is(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor });
              return encadeador;
            },
            select(_cols: string) {
              return {
                maybeSingle: async () => {
                  if (pedido && filtros.every((f) => bateFiltro(f.coluna, f.valor))) {
                    Object.assign(pedido, valores);
                    opts.registro?.chamadasUpdateMarketplaceOrders?.push({ valores, filtros });
                    return { data: { id: pedido.id }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
          return encadeador;
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
  // Achado A3 (revisão de risco, 26/09/2026): a substituição do id GRAVADO
  // agora reconsulta ELE MESMO antes de confirmar — este teste passa a mockar
  // as DUAS chamadas: a consulta clássica (`/v1/payments/999`, o que a
  // notificação falou) e a consulta do id GRAVADO (`/v1/orders/{ORD...}`),
  // que aqui CONFIRMA o mesmo desfecho 'pago' (o caso feliz — a cobrança
  // gravada é mesmo a que foi paga).
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
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
  // Achado A3: segunda rota mockada para a reconsulta do id GRAVADO — ver o
  // teste "MP diz approved..." acima para o comentário completo.
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
  });
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
  // Achado A3: segunda rota mockada para a reconsulta do id GRAVADO.
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
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
  // Achado A3: segunda rota mockada para a reconsulta do id GRAVADO.
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
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

// Lote A (A5): 'ignorado' para um status 'pago' é pagamento aprovado que a
// RPC recusou aplicar (pedido já recusado/estornado com o mesmo id). Antes
// saía 200 em silêncio. Só observabilidade: o fluxo e a resposta não mudam.
const MARCA_DO_A5 = "confirmar_pagamento devolveu 'ignorado' para um pagamento APROVADO";

async function entregaComResultado(statusMp: string, resultadoRpc: string) {
  const registro = { chamadasRpc: [] };
  // Id clássico gravado: a recusa pela rota `payment` só chega à RPC assim
  // (PIX legado); as de Orders API são decididas pela rota `order`.
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria Cliente",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: "123456789012",
  };
  const supabase = clienteFalso({ rpcResultado: resultadoRpc, pedido, registro });
  const req = await requisicaoAssinada("123456789012");
  const fetchImpl = fetchConsulta(200, {
    id: 123456789012,
    status: statusMp,
    external_reference: UUID_PEDIDO,
    payer: { email: "maria@example.com" },
  });
  const erros: string[] = [];
  const erroReal = console.error;
  const avisoReal = console.warn;
  const logReal = console.log;
  console.error = (...args: unknown[]) => {
    erros.push(args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
  };
  console.warn = () => {};
  console.log = () => {};
  try {
    const resposta = await handler(req, { supabase, fetchImpl });
    return { resposta, corpo: await resposta.json(), registro, erros };
  } finally {
    console.error = erroReal;
    console.warn = avisoReal;
    console.log = logReal;
  }
}

Deno.test("Lote A A5 - 'ignorado' para status 'pago' -> UM console.error estruturado, sem dado pessoal; resposta e fluxo iguais", async () => {
  const { resposta, corpo, registro, erros } = await entregaComResultado("approved", "ignorado");

  assertEquals(resposta.status, 200);
  assertEquals(corpo, { ok: true, resultado: "ignorado" });
  assertEquals(registro.chamadasRpc.length, 1, "nenhuma outra RPC");
  const doA5 = erros.filter((e) => e.includes(MARCA_DO_A5));
  assertEquals(doA5.length, 1, `esperado 1 log do A5; console.error recebeu: ${JSON.stringify(erros)}`);
  const log = doA5[0];
  assertStringIncludes(log, `"pedido8":"${UUID_PEDIDO.slice(0, 8)}"`);
  assertStringIncludes(log, '"idGateway":"12345678');
  assertStringIncludes(log, '"statusRecebido":"pago"');
  assertStringIncludes(log, '"retorno":"ignorado"');
  // Sem dado pessoal e sem identificador inteiro.
  assert(!log.includes(UUID_PEDIDO), "o id do pedido vai truncado");
  assert(!log.includes("123456789012"), "o id do gateway vai só como prefixo");
  assert(!log.includes("Maria"), "sem nome do cliente");
  assert(!log.includes("@"), "sem e-mail");
});

Deno.test("Lote A A5 - controles: 'ignorado' de um status que NÃO é 'pago', e 'ja_pago' para 'pago', não disparam o log", async () => {
  for (const [statusMp, resultadoRpc] of [["rejected", "ignorado"], ["approved", "ja_pago"]]) {
    const { resposta, corpo, registro, erros } = await entregaComResultado(statusMp, resultadoRpc);
    assertEquals(resposta.status, 200, `${statusMp}/${resultadoRpc}`);
    // O controle só vale se a entrega CHEGOU à RPC com aquele retorno.
    assertEquals(registro.chamadasRpc.length, 1, `${statusMp}/${resultadoRpc} chegou à RPC`);
    assertEquals(corpo.resultado, resultadoRpc);
    assertEquals(
      erros.filter((e) => e.includes(MARCA_DO_A5)).length,
      0,
      `${statusMp}/${resultadoRpc} não deveria logar o A5`,
    );
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
  // Achado A3: segunda rota mockada para a reconsulta do id GRAVADO —
  // "refunded:refunded" também confirma 'estornado' (MAPA_STATUS_ORDER).
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "refunded", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "refunded", status_detail: "refunded" },
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_GRAVADO_NO_BANCO);
  assertEquals(registro.chamadasRpc[0].args.p_status, "estornado");
});

// --- Achado A3 (revisão de risco, 26/09/2026) ------------------------------
//
// O cenário que motivou a correção: o Achado A1 mostrou que uma cobrança de
// CARTÃO pode ficar ÓRFÃ (aprovada no MP, sem NENHUM registro no pedido —
// outra tentativa ganhou a vaga). Se essa order órfã for estornada pelo
// PAINEL do MP, o Mercado Pago manda uma notificação clássica ('payment')
// sobre ELA — com o MESMO `external_reference` do pedido (as duas orders
// vieram do mesmo `criar-pagamento`). Sem confirmar a cobrança GRAVADA antes
// de aplicar o status, a rota `payment` mandaria a RPC marcar a cobrança
// GRAVADA (a de verdade paga) como estornada — dinheiro que o cliente pagou
// e a loja já recebeu, virando "estornado" no banco por um estorno que
// aconteceu em OUTRA cobrança.

Deno.test("rota payment: 'estornado' é sobre uma cobrança DIFERENTE da gravada, e a GRAVADA continua 'pago' -> 200 ignorado, RPC NÃO chamada (cobrança órfã de outra tentativa)", async () => {
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
  const avisoReal = console.warn;
  console.warn = () => {};
  // A notificação clássica ("999") fala de um pagamento REFUNDED — mas a
  // reconsulta da cobrança GRAVADA (ID_GRAVADO_NO_BANCO) mostra que ELA
  // continua 'processed:accredited' (paga, nunca estornada): são cobranças
  // DIFERENTES para o mesmo pedido.
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "refunded", external_reference: UUID_PEDIDO } },
    order: {
      status: 200,
      corpo: { id: ID_GRAVADO_NO_BANCO, external_reference: UUID_PEDIDO, status: "processed", status_detail: "accredited" },
    },
  });

  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl });
  } finally {
    console.warn = avisoReal;
  }
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "id gravado não confirma o mesmo desfecho");
  // A prova que importa: a cobrança de VERDADE (gravada, ainda paga) NUNCA
  // é marcada como estornada por um estorno que não é dela.
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("rota payment: reconsulta do id GRAVADO falha (500) antes de aplicar 'pago'/'estornado' -> 500, evento mantido na fila do MP", async () => {
  const registro = { chamadasRpc: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_NO_BANCO,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999");
  const erroReal = console.error;
  console.error = () => {};
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
    order: { status: 500, corpo: { message: "erro interno" } },
  });

  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl });
  } finally {
    console.error = erroReal;
  }

  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("rota payment: id gravado é CLÁSSICO (PIX legado) -> NUNCA reconsulta a Orders API antes de confirmar (controle negativo do Achado A3)", async () => {
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
  // SEM rota `order` mockada: se o handler tentasse reconsultar a Orders API
  // aqui (não deveria — o id gravado é CLÁSSICO, o bloco de substituição
  // nem entra), `fetchInspecionavel` devolveria 404 e o teste acusaria.
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: { status: 200, corpo: { id: ID_PAGAMENTO_DO_MP, status: "approved", external_reference: UUID_PEDIDO } },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, String(ID_PAGAMENTO_DO_MP));
});

// --- Achado B1 (2ª revisão de risco, 26/09/2026) — W-órfã --------------------
//
// O cenário completo que o Achado A1 deixou aberto: uma cobrança de CARTÃO
// fica ÓRFÃ (aprovada no MP, sem NENHUM registro no pedido — outra tentativa
// ganhou a vaga). Se essa order órfã for ESTORNADA pelo PAINEL do MP, o
// `registrarDesfechoDoEstorno` (a única escrita do LEDGER de devolução) rodava
// ANTES do guard do Achado A3 — que só protege a chamada a `confirmar_
// pagamento` — e nas DUAS rotas. Sem o guard novo, o reembolso da ÓRFÃ virava
// um INSERT em `order_refunds` e `concluir_estorno` marcava o pedido REAL
// (pago, pela cobrança GRAVADA) como 'estornado': dinheiro que o cliente
// pagou e a loja já recebeu, cancelado por um estorno de OUTRA cobrança.

const S_ORFA = "ORDTST0000000000000000000001"; // a cobrança GRAVADA (paga)
const O_ORFA = "ORDTST0000000000000000000002"; // a ÓRFÃ (aprovada e reembolsada no painel)

Deno.test("W-orfa (rota order): reembolso da ÓRFÃ no painel do MP NÃO mexe no pedido REAL (pago por S) — ledger intacto, admin avisado", async () => {
  const registro = { chamadasRpc: [], insertsOrderRefunds: [] as any[] };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: S_ORFA,
    total: 100,
    total_amount: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-09-26T10:00:00Z",
    status: "processing",
  };
  const supabase = clienteFalso({ rpcResultado: "estornado", pedido, registro, orderRefundsRows: [] });
  const orfaReembolsada = {
    id: O_ORFA,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: "PAY2", status: "refunded", payment_method: { type: "credit_card", id: "master" } }],
      refunds: [{ id: "R-ORFA", amount: "100.00", status: "processed" }],
    },
  };
  const chamadasPush: unknown[] = [];
  const req = await requisicaoAssinada(O_ORFA, { corpoExtra: { type: "order" } });
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orfaReembolsada),
      enviarPush: async (a: unknown) => {
        chamadasPush.push(a);
      },
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
    });
  } finally {
    console.error = erroReal;
  }

  // A prova que importa: o pedido REAL continua 'pago' — o estorno da órfã
  // NUNCA vira um registro no ledger nem um `confirmar_pagamento('estornado')`
  // bem-sucedido para este pedido.
  assertEquals(pedido.payment_status, "pago");
  assertEquals(registro.insertsOrderRefunds.length, 0);
  assertEquals(chamadasPush.length, 1, "o admin precisa ser avisado — dinheiro estornado sem dono no ledger");
  assertEquals(resposta.status, 200);
});

Deno.test("W-orfa (rota payment, a que o A3 fecha do outro lado): reembolso da ÓRFÃ pela rota clássica -> ledger intacto, pedido REAL continua 'pago'", async () => {
  const registro = { chamadasRpc: [], insertsOrderRefunds: [] as any[] };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: S_ORFA,
    total: 100,
    total_amount: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-09-26T10:00:00Z",
    status: "processing",
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro, orderRefundsRows: [] });
  const gravadaAindaPaga = {
    id: S_ORFA,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "100.00",
    transactions: { payments: [{ id: "PAY1", status: "processed", payment_method: { type: "credit_card" } }] },
  };
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: {
      status: 200,
      corpo: {
        id: 12345,
        status: "refunded",
        status_detail: "refunded",
        external_reference: UUID_PEDIDO,
        transaction_amount: 100,
        refunds: [{ id: 777, amount: 100, status: "approved" }],
      },
    },
    order: { status: 200, corpo: gravadaAindaPaga },
  });
  const chamadasPush: unknown[] = [];
  const req = await requisicaoAssinada("12345", { corpoExtra: { type: "payment" } });
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl,
      enviarPush: async (a: unknown) => {
        chamadasPush.push(a);
      },
    });
  } finally {
    console.error = erroReal;
  }

  assertEquals(pedido.payment_status, "pago");
  assertEquals(registro.insertsOrderRefunds.length, 0);
  // O guard do Achado A3 (mais abaixo no handler) também recusa aplicar o
  // status: a GRAVADA reconsultada continua 'processed:accredited', nunca
  // 'refunded' — resultado final é 200 ignorado, sem RPC nenhuma.
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(resposta.status, 200);
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

Deno.test("resultado 'pago_apos_expirar' -> NÃO dispara o comprovante padrão, mas dispara o aviso honesto de pagamento atrasado", async () => {
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
  const chamadasAvisoAtrasado: unknown[] = [];
  const enviarAvisoAtrasado = async (args: unknown) => {
    chamadasAvisoAtrasado.push(args);
  };

  const resposta = await handler(req, {
    supabase,
    fetchImpl,
    enviarPush,
    enviarComprovante,
    enviarAvisoAtrasado,
  });

  assertEquals(resposta.status, 200);
  assertEquals(
    chamadasComprovante.length,
    0,
    "'pago_apos_expirar' não deveria disparar o comprovante padrão — o pedido segue cancelado e o texto mentiria",
  );
  assertEquals(
    chamadasAvisoAtrasado.length,
    1,
    "'pago_apos_expirar' deveria disparar o aviso honesto — PEÇA 5, o cliente não pode ficar mudo",
  );
  assertEquals((chamadasAvisoAtrasado[0] as { orderId: string }).orderId, UUID_PEDIDO);
});

Deno.test("comprovante e aviso atrasado disparam em exatamente 1 dos 9 retornos possíveis da RPC cada — nunca os dois para o mesmo resultado", async () => {
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
  const DISPARAM_COMPROVANTE = new Set(["pago"]);
  const DISPARAM_AVISO_ATRASADO = new Set(["pago_apos_expirar"]);

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
    const chamadasAvisoAtrasado: unknown[] = [];
    const enviarAvisoAtrasado = async (args: unknown) => {
      chamadasAvisoAtrasado.push(args);
    };

    await handler(req, { supabase, fetchImpl, enviarPush, enviarComprovante, enviarAvisoAtrasado });

    const esperadoComprovante = DISPARAM_COMPROVANTE.has(resultado) ? 1 : 0;
    const esperadoAviso = DISPARAM_AVISO_ATRASADO.has(resultado) ? 1 : 0;
    assertEquals(
      chamadasComprovante.length,
      esperadoComprovante,
      `resultado="${resultado}" deveria disparar ${esperadoComprovante} comprovante(s)`,
    );
    assertEquals(
      chamadasAvisoAtrasado.length,
      esperadoAviso,
      `resultado="${resultado}" deveria disparar ${esperadoAviso} aviso(s) atrasado(s)`,
    );
    assertEquals(
      chamadasComprovante.length > 0 && chamadasAvisoAtrasado.length > 0,
      false,
      `resultado="${resultado}" nunca deveria disparar os dois textos para o mesmo pedido`,
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

// =============================================================================
// W1–W9 — T5 da frente "estorno pelo app": o webhook registra o desfecho do
// estorno (inclusive o feito FORA do app) e o banco para de divergir do MP
// (brief 20260908-brief-t5-webhook-registra-o-desfecho-do-estorno.md).
//
// Pedido base reaproveita UUID_PEDIDO/ID_ORDER_TESTE já definidos acima.
// =============================================================================

Deno.test("W1 - payment 'refunded' com linha em_processamento de 100 -> concluir_estorno UMA vez (p_refund_id da linha, p_mp_refund_id 'r1'); nenhuma inserção", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
    updatesOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: "999",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
  };
  const orderRefundsRows = [
    {
      id: "linha-1",
      order_id: UUID_PEDIDO,
      amount: 100,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 1,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "refunded",
    status_detail: "refunded",
    external_reference: UUID_PEDIDO,
    transaction_amount_refunded: 100,
    refunds: [{ id: "r1", amount: 100, status: "approved" }],
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r1");
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

Deno.test("W2 - order 'processed'+'partially_refunded' com refund de 30 e linha 'solicitado' de 30 -> concluída com r2; responde 200 'estorno_parcial_registrado' SEM confirmar_pagamento com status inventado", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
  };
  const orderRefundsRows = [
    {
      id: "linha-2",
      order_id: UUID_PEDIDO,
      amount: 30,
      status: "solicitado",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 0,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r2", amount: "30.00", status: "processed" }],
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.resultado, "estorno_parcial_registrado");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-2");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r2");
  // statusMapeado é null (PEDIDO-05): confirmar_pagamento NUNCA é chamada
  // aqui (mutação m4: mover o passo para DEPOIS do retorno de status
  // desconhecido faria confirmar_pagamento nunca rodar OU rodar com status
  // inventado — este teste também cobre o caso "passo não roda de jeito
  // nenhum", que é o defeito real de mover o passo para depois do retorno).
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("W2b - achado MÉDIO da revisão do P1 de estorno: linha em_processamento COM o próprio mp_refund_id 'r2' e refund AGORA 'processed' -> conclui pela T5 (id próprio NÃO entra em idsJaReivindicados)", async () => {
  // Com a regra do P1 de estorno (29/09), o caso majoritário passou a ser
  // linha em_processamento COM o id do refund dela gravado (POST nasce
  // 'processing'). O conjunto 'reivindicados' do webhook incluía o id da
  // PRÓPRIA linha pendente — refundQueCobreALinha excluía o refund dela e a
  // linha ficava tentar_depois para SEMPRE (só o cron concluía). O id
  // próprio precisa sair do conjunto por linha (mesma regra do cron, que
  // exclui a própria linha com .neq('id', ...)).
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
  };
  const orderRefundsRows = [
    {
      id: "linha-2b",
      order_id: UUID_PEDIDO,
      amount: 30,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: "r2",
      tentativas: 1,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r2", amount: "30.00", status: "processed" }],
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.resultado, "estorno_parcial_registrado");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-2b");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r2");
});

Deno.test("W2c - hardening do achado MÉDIO da revisão final: DUAS pendentes com o MESMO mp_refund_id (ledger anômalo) -> SÓ a primeira conclui no lote; a segunda fica para o cron (1 RPC)", async () => {
  // Estado já viola o P0 de origem (nenhum fluxo próprio o produz), mas a
  // revisão final apontou que o filtro por valor (id !== próprio) derrotaria
  // o re-add de reivindicados para a SEGUNDA linha — as duas concluiriam com
  // o mesmo refund (crédito duplo dentro do cap). A trava: ids concluídos
  // NESTE lote voltam a bloquear mesmo sendo id 'próprio' da linha seguinte.
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
  };
  const orderRefundsRows = [
    {
      id: "linha-x",
      order_id: UUID_PEDIDO,
      amount: 30,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: "r9",
      tentativas: 1,
      concluido_em: null,
    },
    {
      id: "linha-y",
      order_id: UUID_PEDIDO,
      amount: 30,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: "r9",
      tentativas: 1,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const fetchImpl = fetchConsulta(200, {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r9", amount: "30.00", status: "processed" }],
    },
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  // SÓ a primeira linha do lote conclui; a segunda fica pendente para o cron.
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-x");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r9");
});

Deno.test("W3 - order 'refunded' SEM linha, refund processed 100 (r3) -> UMA linha 'sistema' concluída; a MESMA notificação de novo -> zero inserções, zero RPC nova", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r3", amount: "100.00", status: "processed" }],
    },
  };
  const fetchImpl = fetchConsulta(200, corpoOrder);

  const req1 = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta1 = await handler(req1, { supabase, fetchImpl });
  assertEquals(resposta1.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "r3");
  assertEquals(registro.insertsOrderRefunds[0].status, "concluido");
  assertEquals(registro.insertsOrderRefunds[0].solicitado_por, "sistema");
  assertEquals(registro.insertsOrderRefunds[0].motivo, "estorno feito fora do app (Mercado Pago)");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);

  // MESMA notificação de novo — o dublê (fila VIVA) agora devolve a linha
  // com mp_refund_id 'r3' já gravada -> zero inserções, zero RPC nova.
  const req2 = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta2 = await handler(req2, { supabase, fetchImpl });
  assertEquals(resposta2.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

// =============================================================================
// W9 — Missão pagamentos (28/09/2026). A guarda do Achado B1 reconsulta a
// ORDER GRAVADA quando a notificação CLÁSSICA (type 'payment') fala de
// reembolso/chargeback e o id gravado é um ORD — mas o corpo ORDER vinha
// acompanhado da rota 'payment' DA NOTIFICAÇÃO. `registrarDesfechoDoEstorno`
// deriva `ehPayments = rota === 'payment'` e lê `corpo.refunds[]` com
// terminal 'approved' + `transaction_amount_refunded` (formato Payments):
// uma ORDER não tem NENHUM desses campos — os refunds moram em
// `transactions[].refunds[]` com terminal 'processed'. Resultado: estorno
// REAL feito no painel ficava FORA do ledger para sempre (zero inserts,
// zero concluir_estorno) — o pedido só virava 'estornado' pela RPC de
// pagamento lá de baixo, sem `valor_estornado` nem razão (mesmo estado
// quebrado que o Achado S4 descreve, por outra porta).
// =============================================================================
Deno.test("W9 - rota payment (id clássico ≠ ORD gravado): refund da ORDER gravada 'refunded' (transactions[].refunds processed) -> UMA linha 'sistema' concluída com o mp_refund_id da ORDER", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
    updatesOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  // O pagamento CLÁSSICO consultado só carrega o GATILHO ('refunded') — sem
  // refunds[]/transaction_amount_refunded de propósito: quem decide é a ORDER
  // GRAVADA (guarda B1). Se o passo ler o pagamento clássico no formato
  // Payments em vez da ORDER reconsultada, o teste cai.
  const { fn: fetchImpl, chamadas } = fetchInspecionavel({
    pagamento: {
      status: 200,
      corpo: {
        id: ID_PAGAMENTO_DO_MP,
        status: "refunded",
        status_detail: "refunded",
        external_reference: UUID_PEDIDO,
      },
    },
    order: {
      status: 200,
      corpo: {
        id: ID_ORDER_TESTE,
        external_reference: UUID_PEDIDO,
        status: "refunded",
        status_detail: "refunded",
        transactions: {
          payments: [{ id: "PAY01XYZ", status: "processed" }],
          refunds: [{ id: "r9", amount: "100.00", status: "processed" }],
        },
      },
    },
  });

  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  // A guarda B1 reconsultou a ORDER gravada (além do pagamento clássico).
  assertStringIncludes(chamadas.join(" | "), `/v1/orders/${ID_ORDER_TESTE}`);
  // O refund 'r9' da ORDER — formato Order — é o que entra no ledger.
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "r9");
  assertEquals(registro.insertsOrderRefunds[0].status, "concluido");
  assertEquals(registro.insertsOrderRefunds[0].solicitado_por, "sistema");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

// Achado S4 (3ª revisão de risco, 26/09/2026, W7 do harness do 3º revisor):
// a leitura NOVA do id gravado (Achado B1 — decide se o objeto CONSULTADO é
// a cobrança GRAVADA ou uma ÓRFÃ) ignorava `error` — uma falha de banco
// (statement timeout, pool esgotado) fazia essa leitura virar `null` do
// MESMO jeito que "pedido sem essa cobrança", e um estorno LEGÍTIMO da
// cobrança GRAVADA caía no ramo `estorno_orfao`: nunca registrava no ledger,
// e o pedido só virava 'estornado' pela RPC `confirmar_pagamento`, sem
// `valor_estornado` nem razão.
Deno.test("cartão — Achado S4 (W7): a leitura do id gravado falha 1x num estorno LEGÍTIMO da cobrança GRAVADA -> 500 (MP reenvia), NADA registrado; no reenvio (leitura ok) registra certo", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    falharLeituraGatewayPaymentId: 1,
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r7", amount: "100.00", status: "processed" }],
    },
  };
  const fetchImpl = fetchConsulta(200, corpoOrder);
  const req1 = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const erroReal = console.error;
  console.error = () => {};
  let resposta1: Response;
  try {
    resposta1 = await handler(req1, { supabase, fetchImpl });
  } finally {
    console.error = erroReal;
  }

  // A prova que importa: antes desta correção, isto era 200 — o handler
  // tratava a cobrança GRAVADA como órfã e o MP nunca reenviava.
  assertEquals(resposta1.status, 500, "leitura falhou -> o MP tem que reenviar, nunca 200 silencioso");
  assertEquals(registro.insertsOrderRefunds.length, 0, "leitura falhou -> nada registrado no ledger");
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  assertEquals(registro.chamadasRpc.length, 0, "não chega nem a confirmar_pagamento");
  assertEquals(pedido.payment_status, "pago", "estorno legítimo AINDA não aplicado — nem pela RPC nem pelo ledger");

  // MP reenvia (a leitura já não falha mais) -> registra igual ao W3.
  const req2 = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta2 = await handler(req2, { supabase, fetchImpl });
  assertEquals(resposta2.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "r7");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

Deno.test("W4 - chargeback: 'in_process' -> RPC sob a trava com em_analise; 'settled' -> contra_a_loja; nenhuma escrita direta no ledger", async () => {
  // Lote A (bloqueios 1/3/5/6): a decisão sai do CASO (GET /v1/chargebacks/
  // {case_id}, `coverage_applied`) corroborado pelo PAGAMENTO contestado; o
  // dinheiro é da RPC `registrar_contestacao_no_ledger` (pedido travado).
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [] });
  const inProcess = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "in_process" }),
    caso: { id: "1234567890", coverage_applied: null, amount: 100, currency: "BRL" },
  });
  const resp1 = await semLogs(() => entregarContestacao(supabase, inProcess.fn));
  assertEquals(resp1.status, 200);
  const settled = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "settled" }),
    caso: { id: "1234567890", coverage_applied: false, amount: 100, currency: "BRL" },
  });
  const resp2 = await semLogs(() => entregarContestacao(supabase, settled.fn));
  assertEquals(resp2.status, 200);

  assertEquals(registro.chamadasContestacao.map((c: any) => c.args.p_decisao), ["em_analise", "contra_a_loja"]);
  assertEquals(registro.chamadasContestacao.map((c: any) => c.args.p_mp_chargeback_id), [ID_CONTESTACAO, ID_CONTESTACAO]);
  semEscritaDireta(registro);
});

Deno.test("W4b - chargeback: 'reimbursed' (caso a favor da loja) -> RPC com a_favor_da_loja; a edge nunca soma nem libera direto", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [] });
  const reimbursed = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "reimbursed" }),
    caso: { id: "1234567890", coverage_applied: true, amount: 100, currency: "BRL" },
  });
  const resp = await semLogs(() => entregarContestacao(supabase, reimbursed.fn));
  assertEquals(resp.status, 200);
  assertEquals(registro.chamadasContestacao.length, 1);
  assertEquals(registro.chamadasContestacao[0].args.p_decisao, "a_favor_da_loja");
  semEscritaDireta(registro);
});

// =============================================================================
// LOTE A (04/10/2026) — contestação (chargeback) e ledger de estorno.
//
// R1: o mapa compartilhado (`_shared/mercadopago.ts`) traduz TODO
// `charged_back` para 'estornado' — e continua assim de propósito (o checkout
// da `criar-pagamento` depende dele; crítica de desenho A1). O defeito era o
// handler chamar `confirmar_pagamento(..., 'estornado')` com esse rótulo:
// 'estornado' é IRREVERSÍVEL no SQL (20260901000000, não existe
// estornado->pago), e uma disputa em análise (`in_process`) ou ganha pela
// loja (`reimbursed`, valor creditado ao vendedor) marcava o pedido PAGO como
// estornado. O pedido só vira 'estornado' por `concluir_estorno`, com o total
// coberto (2026110000100). Doc: transaction-status do MP (URL no código).
// =============================================================================

const ID_CONTESTACAO = "CBK01J67CQQH5904WDBVZEM4JMEP3";
const ID_PAGAMENTO_DA_ORDER = "PAY01J67CQQH5904WDBVZEM4JMEP3";

/** Order CONTESTADA, na forma do GET /v1/orders/{id} (reference get-order):
 * `transactions.chargebacks[]` com id (CBK), transaction_id (PAY) e case_id.
 * `detalhePagamento` é o `status_detail` do PAGAMENTO contestado (A5);
 * `detalheOrder`, o agregado da raiz. */
function orderContestada(opts: {
  detalheOrder?: string;
  detalhePagamento?: string;
  chargebacks?: Array<Record<string, unknown>> | null;
  total?: string;
  refunds?: Array<Record<string, unknown>>;
} = {}): Record<string, unknown> {
  const detalheOrder = opts.detalheOrder ?? "in_process";
  const detalhePagamento = opts.detalhePagamento ?? detalheOrder;
  const transactions: Record<string, unknown> = {
    payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "charged_back", status_detail: detalhePagamento }],
  };
  if (opts.chargebacks !== null) {
    transactions.chargebacks = opts.chargebacks ?? [
      { id: ID_CONTESTACAO, transaction_id: ID_PAGAMENTO_DA_ORDER, case_id: "1234567890", status: detalhePagamento, references: [] },
    ];
  }
  if (opts.refunds) transactions.refunds = opts.refunds;
  return {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "charged_back",
    status_detail: detalheOrder,
    total_amount: opts.total ?? "100.00",
    transactions,
  };
}

function pedidoPago(total = 100): Record<string, unknown> {
  return {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
}

function registroDoLedger() {
  return {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
    updatesOrderRefunds: [] as any[],
    chamadasContestacao: [] as any[],
    chamadasExternoNaContestacao: [] as any[],
  };
}

/** Nenhuma escrita DIRETA no ledger pela edge (a contestação é da RPC). */
function semEscritaDireta(registro: ReturnType<typeof registroDoLedger>, rotulo = "") {
  assertEquals(registro.insertsOrderRefunds.length, 0, `${rotulo} insert direto`);
  assertEquals(registro.updatesOrderRefunds.length, 0, `${rotulo} update direto`);
  assertEquals(registro.chamadasConcluirEstorno.length, 0, `${rotulo} concluir_estorno pela edge`);
}

Deno.test("Lote A R1 - order 'charged_back' (in_process/settled/reimbursed) NUNCA chama confirmar_pagamento — 200 'contestacao_no_ledger'", async () => {
  for (const detalhe of ["in_process", "settled", "reimbursed"]) {
    const registro = registroDoLedger();
    const pedido = pedidoPago();
    const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
    const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
    const resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderContestada({ detalheOrder: detalhe })),
      enviarPushContado: async () => 1,
    });

    assertEquals(resposta.status, 200, detalhe);
    assertEquals((await resposta.json()).resultado, "contestacao_no_ledger", detalhe);
    assertEquals(registro.chamadasRpc.length, 0, `${detalhe}: confirmar_pagamento('estornado') é irreversível`);
  }
});

Deno.test("Lote A R1 - rota payment (PIX legado, id clássico gravado) com 'charged_back' -> confirmar_pagamento NÃO é chamada", async () => {
  const registro = registroDoLedger();
  const pedido = { ...pedidoPago(), gateway_payment_id: "999" };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, {
      id: 999,
      status: "charged_back",
      status_detail: "in_process",
      external_reference: UUID_PEDIDO,
      transaction_amount: 100,
    }),
    enviarPushContado: async () => 1,
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("Lote A R1 - rota payment 'refunded' cuja ORDER GRAVADA está 'charged_back' (bloco A3) -> confirmar_pagamento NÃO é chamada", async () => {
  // O bloco A3 reconsulta a order gravada e segue para a RPC quando o rótulo
  // MAPEADO dela bate ('estornado' == 'estornado') — mas o rótulo da order
  // contestada é o do mapa compartilhado, não o desfecho da disputa.
  const registro = registroDoLedger();
  const pedido = pedidoPago();
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const { fn: fetchImpl } = fetchInspecionavel({
    pagamento: {
      status: 200,
      corpo: { id: ID_PAGAMENTO_DO_MP, status: "refunded", status_detail: "refunded", external_reference: UUID_PEDIDO },
    },
    order: { status: 200, corpo: orderContestada({ detalheOrder: "settled" }) },
  });
  const req = await requisicaoAssinada(String(ID_PAGAMENTO_DO_MP), { corpoExtra: { type: "payment" } });
  const resposta = await handler(req, { supabase, fetchImpl, enviarPushContado: async () => 1 });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 0, "a order gravada está em disputa — 'estornado' só por concluir_estorno");
});

// ── R2: o MESMO refund externo (painel do MP) em duas entregas PARALELAS ─────
// As duas liam o ledger vazio e faziam INSERT com UUIDs distintos: refund de
// 20 num pedido de 100 somava 40. O índice único parcial (order_id,
// mp_refund_id) da 20261192000000 recusa a segunda com 23505, e o handler
// trata como "já registrado" (recupera a linha existente) — nunca 500.

function orderComRefundExterno(): Record<string, unknown> {
  return {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "processed" }],
      refunds: [{ id: "r-ext-20", amount: "20.00", status: "processed" }],
    },
  };
}

async function duasEntregasParalelas(supabase: unknown, corpo: Record<string, unknown>) {
  const reqA = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const reqB = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const deps = { supabase, fetchImpl: fetchConsulta(200, corpo), enviarPushContado: async () => 1 } as any;
  return await Promise.all([handler(reqA, deps), handler(reqB, deps)]);
}

Deno.test("Lote A R2 - controle: SEM o índice único, duas entregas paralelas do mesmo refund externo gravam DUAS linhas (a corrida é real no dublê)", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [], barreiraLeituraOrderRefunds: 2 });
  const [a, b] = await duasEntregasParalelas(supabase, orderComRefundExterno());
  assertEquals([a.status, b.status], [200, 200]);
  const linhas = (registro as any).filaOrderRefunds.filter((r: any) => r.mp_refund_id === "r-ext-20");
  assertEquals(linhas.length, 2, "o defeito do R2 — o índice da migration é quem fecha");
});

Deno.test("Lote A R2 - com o índice único: duas entregas paralelas do mesmo refund externo -> UMA linha, soma 20 (não 40), as duas 200", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(),
    registro,
    orderRefundsRows: [],
    barreiraLeituraOrderRefunds: 2,
    indicesUnicosDoLedger: true,
  });
  const [a, b] = await duasEntregasParalelas(supabase, orderComRefundExterno());

  assertEquals([a.status, b.status], [200, 200], "23505 é 'já registrado', nunca 500 (reenvio infinito do MP)");
  const linhas = (registro as any).filaOrderRefunds.filter((r: any) => r.mp_refund_id === "r-ext-20");
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].status, "concluido");
  assertEquals((registro as any).valorEstornadoAcumulado, 20);
});

Deno.test("Lote A R2 - 23505 com a linha existente AINDA sem concluido_em (a outra entrega caiu entre o INSERT e a RPC) -> esta conclui a linha existente", async () => {
  const registro = registroDoLedger();
  let jaInjetou = false;
  const supabase = clienteFalso({
    pedido: pedidoPago(),
    registro,
    orderRefundsRows: [],
    indicesUnicosDoLedger: true,
    // A linha da outra entrega nasce DEPOIS da leitura inicial desta (o
    // passo de recuperação do começo não a vê) e ANTES do INSERT desta.
    aposLerOrderRefunds: (fila) => {
      if (jaInjetou) return;
      jaInjetou = true;
      fila.push({
        id: "linha-da-outra-entrega",
        order_id: UUID_PEDIDO,
        amount: 20,
        status: "concluido",
        solicitado_por: "sistema",
        mp_refund_id: "r-ext-20",
        concluido_em: null,
      });
    },
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderComRefundExterno()),
    enviarPushContado: async () => 1,
  });

  assertEquals(resposta.status, 200);
  const fila = (registro as any).filaOrderRefunds as Array<Record<string, unknown>>;
  assertEquals(fila.filter((r) => r.mp_refund_id === "r-ext-20").length, 1);
  assertEquals(
    registro.chamadasConcluirEstorno.some((c: any) => c.args.p_refund_id === "linha-da-outra-entrega"),
    true,
    "a linha da janela de falha é concluída por quem esbarrou nela",
  );
  assertEquals((registro as any).valorEstornadoAcumulado, 20);
});

Deno.test("Lote A R2 - bloqueio da revisão: refund 20 já concluído por OUTRA entrega entre a leitura do ledger e a do pedido + refund 70 novo -> grava 70 (não 60), total 90; a reentrega continua 90", async () => {
  // Intercalação: pedido de 100. Esta entrega (B) lê o ledger VAZIO; a
  // entrega A conclui o refund de 20; B lê o pedido com valor_estornado 20;
  // B tenta inserir r20 -> 23505 (linha de A). O valor de r20 NÃO é dinheiro
  // novo de B: somá-lo de novo em memória (40) fazia o clamp de r70 gravar 60
  // e o banco terminar em 80, sem reentrega que corrigisse (r20 e r70 já
  // reivindicados).
  const registro = registroDoLedger();
  const pedido = pedidoPago();
  let entregaAJaConcluiu = false;
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    indicesUnicosDoLedger: true,
    concluirSomaNoPedido: true,
    aposLerOrderRefunds: (fila) => {
      if (entregaAJaConcluiu) return;
      entregaAJaConcluiu = true;
      fila.push({
        id: "linha-da-entrega-A",
        order_id: UUID_PEDIDO,
        amount: 20,
        status: "concluido",
        solicitado_por: "sistema",
        mp_refund_id: "r-20",
        concluido_em: "2026-10-04T00:00:00.000Z",
      });
      pedido.valor_estornado = 20;
    },
  });
  const corpo = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "processed" }],
      refunds: [
        { id: "r-20", amount: "20.00", status: "processed" },
        { id: "r-70", amount: "70.00", status: "processed" },
      ],
    },
  };
  const entregar = async () =>
    await handler(await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } }), {
      supabase,
      fetchImpl: fetchConsulta(200, corpo),
      enviarPushContado: async () => 1,
    });

  const resposta = await entregar();
  assertEquals(resposta.status, 200);
  const fila = (registro as any).filaOrderRefunds as Array<Record<string, unknown>>;
  const r70 = fila.filter((r) => r.mp_refund_id === "r-70");
  assertEquals(r70.length, 1);
  assertEquals(r70[0].amount, 70, "o clamp usa o acumulado CANÔNICO (20), não 20 + 20 em memória");
  assertEquals(pedido.valor_estornado, 90);

  // Reentrega do MP: nada novo, o total continua 90.
  const reentrega = await entregar();
  assertEquals(reentrega.status, 200);
  assertEquals(pedido.valor_estornado, 90);
  assertEquals(fila.filter((r) => r.status === "concluido").reduce((a, r) => a + Number(r.amount), 0), 90);
});

Deno.test("Lote A R2 - bloqueio da revisão (05:24): linha do APP pendente de 20 concluída por OUTRA entrega entre as leituras + refund 70 externo -> concluir_estorno devolve ja_concluida e NÃO soma em memória; grava 70, total 90; reentrega 90", async () => {
  // B lê a linha do app PENDENTE (20, r-20); A conclui a MESMA linha; B lê o
  // pedido com valor_estornado 20; B decide concluir r-20 -> a RPC devolve
  // ja_concluida (não somou de novo) -> somar 20 em memória (40) limitava o
  // r-70 a 60 e o banco terminava em 80.
  const registro = registroDoLedger();
  const pedido = pedidoPago();
  let entregaAJaConcluiu = false;
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [
      {
        id: "linha-do-app-20",
        order_id: UUID_PEDIDO,
        amount: 20,
        status: "em_processamento",
        solicitado_por: "lojista",
        mp_refund_id: "r-20",
        tentativas: 1,
        concluido_em: null,
        created_at: "2026-10-04T00:00:00.000Z",
      },
    ],
    indicesUnicosDoLedger: true,
    concluirSomaNoPedido: true,
    aposLerOrderRefunds: (fila) => {
      if (entregaAJaConcluiu) return;
      entregaAJaConcluiu = true;
      const linha = fila.find((r) => r.id === "linha-do-app-20")!;
      linha.status = "concluido";
      linha.concluido_em = "2026-10-04T00:00:01.000Z";
      pedido.valor_estornado = 20;
    },
  });
  const corpo = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "partially_refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "processed" }],
      refunds: [
        { id: "r-20", amount: "20.00", status: "processed" },
        { id: "r-70", amount: "70.00", status: "processed" },
      ],
    },
  };
  const entregar = async () =>
    await handler(await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } }), {
      supabase,
      fetchImpl: fetchConsulta(200, corpo),
      enviarPushContado: async () => 1,
    });

  assertEquals((await entregar()).status, 200);
  const fila = (registro as any).filaOrderRefunds as Array<Record<string, unknown>>;
  const r70 = fila.filter((r) => r.mp_refund_id === "r-70");
  assertEquals(r70.length, 1);
  assertEquals(r70[0].amount, 70, "ja_concluida não é dinheiro novo desta entrega");
  assertEquals(pedido.valor_estornado, 90);

  assertEquals((await entregar()).status, 200);
  assertEquals(pedido.valor_estornado, 90);
});

Deno.test("Lote A R2 - linha 'sistema' órfã da janela de falha (concluido sem concluido_em) concluída no começo do passo entra no acumulado: refund externo seguinte limitado pelo total certo", async () => {
  // Pedido de 100. Linha órfã de 30 (crash entre INSERT e RPC de um ciclo
  // anterior) é concluída AGORA pela recuperação W6 — soma 30 no banco. O
  // refund externo de 80 que chega junto só tem 70 disponíveis: sem contar a
  // órfã em memória, o clamp tentava 80 e a RPC recusava (acima do total) —
  // o estorno real ficava fora do ledger.
  const registro = registroDoLedger();
  const pedido = pedidoPago();
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [
      {
        id: "linha-orfa-30",
        order_id: UUID_PEDIDO,
        amount: 30,
        status: "concluido",
        solicitado_por: "sistema",
        mp_refund_id: "r-orfa-30",
        concluido_em: null,
        created_at: "2026-10-03T00:00:00.000Z",
      },
    ],
    indicesUnicosDoLedger: true,
    concluirSomaNoPedido: true,
    erroConcluirEstorno: (args) => {
      const linha = ((registro as any).filaOrderRefunds as Array<Record<string, unknown>>)
        .find((r) => r.id === args.p_refund_id);
      // Espelha a guarda da RPC real (2026110000100:125): só a PRIMEIRA
      // conclusão soma, e recusa se o acumulado passaria do total.
      const jaCarimbada = linha?.status === "concluido" && Boolean(linha?.concluido_em);
      if (!linha || jaCarimbada) return null;
      return Number(pedido.valor_estornado) + Number(linha.amount) > 100
        ? { message: "estorno_acima_do_total: dublê" }
        : null;
    },
  });
  const corpo = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "processed" }],
      refunds: [
        { id: "r-orfa-30", amount: "30.00", status: "processed" },
        { id: "r-80", amount: "80.00", status: "processed" },
      ],
    },
  };
  const erroReal = console.error;
  console.error = () => {};
  try {
    const resposta = await handler(await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } }), {
      supabase,
      fetchImpl: fetchConsulta(200, corpo),
      enviarPushContado: async () => 1,
      enviarPush: async () => {},
    });
    assertEquals(resposta.status, 200);
  } finally {
    console.error = erroReal;
  }
  const fila = (registro as any).filaOrderRefunds as Array<Record<string, unknown>>;
  const r80 = fila.filter((r) => r.mp_refund_id === "r-80");
  assertEquals(r80.length, 1);
  assertEquals(r80[0].amount, 70, "limitado ao que sobra depois da órfã (100 - 30)");
  assertEquals(pedido.valor_estornado, 100);
});

Deno.test("Lote A R2 - 23505 sem linha casando a chave (outra restrição) -> NÃO engole: 500, o MP reenvia", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(),
    registro,
    orderRefundsRows: [],
    erroOrderRefundsInsert: { code: "23505", message: "duplicate key value violates unique constraint \"order_refunds_pkey\"" },
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderComRefundExterno()),
      enviarPushContado: async () => 1,
    });
  } finally {
    console.error = erroReal;
  }
  assertEquals(resposta.status, 500);
});

// ── R1 (ledger da contestação) — decide pelo CASO, corroborado pelo PAGAMENTO
// contestado; identidade = chargebacks[].id (CBK), com índice único parcial
// (order_id, mp_chargeback_id) da 20261192000000. Fontes no cabeçalho de
// `_shared/contestacao.ts`.

/** Fetch que responde a ORDER em /v1/orders/ e o CASO em /v1/chargebacks/. */
function fetchDaContestacao(opts: {
  order: Record<string, unknown>;
  caso?: Record<string, unknown>;
  // Um caso POR case_id (multicaso): o fim da URL escolhe.
  casos?: Record<string, Record<string, unknown>>;
  statusCaso?: number;
}) {
  const chamadas: string[] = [];
  const fn = async (url: string, _init?: RequestInit) => {
    chamadas.push(url);
    if (url.includes("/v1/chargebacks/")) {
      const caseId = url.slice(url.lastIndexOf("/") + 1);
      const caso = opts.casos ? new Map(Object.entries(opts.casos)).get(caseId) : opts.caso;
      return new Response(JSON.stringify(caso ?? {}), { status: opts.statusCaso ?? 200 });
    }
    if (url.includes("/v1/orders/")) return new Response(JSON.stringify(opts.order), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return { fn, chamadas };
}

const CASO_EM_ANALISE = { id: "1234567890", amount: 37.5, currency: "BRL", coverage_applied: null };
const CASO_CONTRA_A_LOJA = { id: "1234567890", amount: 100, currency: "BRL", coverage_applied: false };
const CASO_A_FAVOR_DA_LOJA = { id: "1234567890", amount: 100, currency: "BRL", coverage_applied: true };

function linhaDaReserva(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "reserva-cbk",
    order_id: UUID_PEDIDO,
    amount: 100,
    status: "em_processamento",
    solicitado_por: "sistema",
    mp_refund_id: null,
    mp_chargeback_id: ID_CONTESTACAO,
    mp_status: "charged_back",
    mp_status_detail: "in_process",
    tentativas: 0,
    concluido_em: null,
    created_at: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

async function entregarContestacao(
  supabase: unknown,
  fetchImpl: unknown,
  pushes: unknown[] = [],
): Promise<Response> {
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  return await handler(req, {
    supabase,
    fetchImpl,
    enviarPushContado: async (args: any) => {
      pushes.push(args.aviso);
      return 1;
    },
  } as any);
}

function semLogs<T>(fn: () => Promise<T>): Promise<T> {
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  return fn().finally(() => {
    console.error = e;
    console.warn = w;
    console.log = l;
  });
}

/** O retorno da RPC no dublê (estado canônico incluso). */
function retornoDaRpc(resultado: string, extra: Record<string, unknown> = {}) {
  return { data: { resultado, aviso: null, valor_estornado: 0, em_voo: 0, disponivel: 0, ...extra }, error: null };
}

Deno.test("Lote A R1 - in_process (caso pendente) -> a RPC sob a trava recebe em_analise, CBK, case_id, o VALOR DO CASO (37,50) e a estimativa SEPARADA; nada direto", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [] });
  const { fn, chamadas } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "in_process" }), caso: CASO_EM_ANALISE });
  const resposta = await semLogs(() => entregarContestacao(supabase, fn));

  assertEquals(resposta.status, 200);
  assertStringIncludes(chamadas.join(" | "), "/v1/chargebacks/1234567890");
  assertEquals(registro.chamadasContestacao.length, 1);
  assertEquals(registro.chamadasContestacao[0].args, {
    p_order_id: UUID_PEDIDO,
    p_mp_chargeback_id: ID_CONTESTACAO,
    p_case_id: "1234567890",
    p_decisao: "em_analise",
    p_valor_caso: 37.5,
    p_valor_estimado: 100,
    p_casos_na_order: 1,
  });
  semEscritaDireta(registro);
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento nunca");
});

Deno.test("Lote A R1 (bloqueio 1) - caso SEM valor em reais confiável (outra moeda, ausente) -> p_valor_caso NULL; a estimativa vai SEPARADA e nunca no lugar do valor do caso", async () => {
  const casos: Array<[string, Record<string, unknown>, string]> = [
    ["in_process", { id: "1234567890", coverage_applied: null, amount: 37.5, currency: "ARS" }, "em_analise"],
    ["settled", { id: "1234567890", coverage_applied: false, amount: 100, currency: "ARS" }, "contra_a_loja"],
    ["settled", { id: "1234567890", coverage_applied: false, currency: "BRL" }, "contra_a_loja"],
  ];
  for (const [detalhe, caso, decisao] of casos) {
    const registro = registroDoLedger();
    const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
    const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: detalhe }), caso });
    await semLogs(() => entregarContestacao(supabase, fn));
    assertEquals(registro.chamadasContestacao.length, 1, JSON.stringify(caso));
    const args = registro.chamadasContestacao[0].args;
    assertEquals(args.p_decisao, decisao);
    assertEquals(args.p_valor_caso, null, `${JSON.stringify(caso)}: estimativa não vira valor do caso`);
    assertEquals(args.p_valor_estimado, 100);
    semEscritaDireta(registro, JSON.stringify(caso));
  }
});

Deno.test("Lote A R1 - settled (caso contra a loja + pagamento settled) -> RPC contra_a_loja com o valor do caso; a edge não conclui nada direto", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(),
    registro,
    orderRefundsRows: [linhaDaReserva()],
    contestacaoNoLedger: () => retornoDaRpc("concluido", { valor_estornado: 40 }),
  });
  const { fn } = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "settled" }),
    caso: { ...CASO_CONTRA_A_LOJA, amount: 40 },
  });
  const resposta = await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasContestacao.length, 1);
  assertEquals(registro.chamadasContestacao[0].args.p_decisao, "contra_a_loja");
  assertEquals(registro.chamadasContestacao[0].args.p_valor_caso, 40);
  semEscritaDireta(registro);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("Lote A R1 - reimbursed (caso a favor da loja + pagamento reimbursed) -> RPC a_favor_da_loja; nunca soma", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "reimbursed" }), caso: CASO_A_FAVOR_DA_LOJA });
  await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(registro.chamadasContestacao.map((c: any) => c.args.p_decisao), ["a_favor_da_loja"]);
  semEscritaDireta(registro);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("Lote A R1 - 'reimbursed' só no AGREGADO da order (pagamento in_process, caso pendente) -> a RPC recebe em_analise (nada a liberar)", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "reimbursed", detalhePagamento: "in_process" }),
    caso: CASO_EM_ANALISE,
  });
  await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(registro.chamadasContestacao.map((c: any) => c.args.p_decisao), ["em_analise"]);
  semEscritaDireta(registro);
});

Deno.test("Lote A R1 - CONFLITO (pagamento settled, caso ainda pendente) -> nenhuma RPC (a reserva fica), aviso ao admin UMA vez em duas entregas", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "settled" }), caso: CASO_EM_ANALISE });
  const pushes: unknown[] = [];
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
  assertEquals(pushes.length, 1, "aviso uma vez só");
});

Deno.test("Lote A R1 - CONFLITO só no PAGAMENTO (item sem status; pagamento settled, caso a favor da loja) -> nenhuma RPC", async () => {
  // Isola a corroboração pelo pagamento contestado: o item da contestação
  // não traz status, então só o pagamento contradiz o caso.
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({
    order: orderContestada({
      detalheOrder: "settled",
      chargebacks: [{ id: ID_CONTESTACAO, transaction_id: ID_PAGAMENTO_DA_ORDER, case_id: "1234567890" }],
    }),
    caso: CASO_A_FAVOR_DA_LOJA,
  });
  await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
});

Deno.test("Lote A R1 - SEM CBK legível (sem chargebacks[]) -> nenhuma RPC (nenhuma linha sem identidade), nenhum GET de caso, aviso ao admin uma vez", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [] });
  const { fn, chamadas } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "in_process", chargebacks: null }) });
  const pushes: unknown[] = [];
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
  assertEquals(pushes.length, 1);
  assertEquals(chamadas.some((u) => u.includes("/v1/chargebacks/")), false);
});

Deno.test("Lote A R1 - rota payment (PIX legado) 'charged_back' -> sem CBK: nenhuma RPC, aviso ao admin", async () => {
  const registro = registroDoLedger();
  const pedido = { ...pedidoPago(), gateway_payment_id: "999" };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const pushes: unknown[] = [];
  const resposta = await semLogs(() =>
    handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, {
        id: 999,
        status: "charged_back",
        status_detail: "in_process",
        external_reference: UUID_PEDIDO,
        transaction_amount: 100,
      }),
      enviarPushContado: async (args: any) => {
        pushes.push(args.aviso);
        return 1;
      },
    })
  );
  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
  assertEquals(pushes.length, 1);
});

Deno.test("Lote A R1 (bloqueio 3) - DOIS casos no mesmo pedido -> a RPC é chamada para CADA um, na ordem, com p_casos_na_order 2; a edge não pula o 2º por um saldo lido no começo", async () => {
  // Antes: a reserva do CBK1 (100) liberada por UPDATE não mudava o retrato
  // local, e o CBK2 era pulado ("além do que o pedido pode reservar").
  const registro = registroDoLedger();
  const roteiro = [
    retornoDaRpc("liberado", { disponivel: 100 }),
    retornoDaRpc("reservado", { disponivel: 0 }),
  ];
  const supabase = clienteFalso({
    pedido: pedidoPago(),
    registro,
    orderRefundsRows: [linhaDaReserva({ mp_chargeback_id: "CBK-1" })],
    contestacaoNoLedger: () => roteiro.shift()!,
  });
  const order = orderContestada({ detalheOrder: "in_process" });
  (order.transactions as any).payments = [
    { id: "PAY-1", status: "charged_back", status_detail: "reimbursed" },
    { id: "PAY-2", status: "charged_back", status_detail: "in_process" },
  ];
  (order.transactions as any).chargebacks = [
    { id: "CBK-1", transaction_id: "PAY-1", case_id: "111", status: "reimbursed" },
    { id: "CBK-2", transaction_id: "PAY-2", case_id: "222", status: "in_process" },
  ];
  const { fn } = fetchDaContestacao({
    order,
    casos: {
      "111": { id: "111", coverage_applied: true, amount: 100, currency: "BRL" },
      "222": { id: "222", coverage_applied: null, amount: 100, currency: "BRL" },
    },
  });
  const resposta = await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(resposta.status, 200);
  assertEquals(
    registro.chamadasContestacao.map((c: any) => [c.args.p_mp_chargeback_id, c.args.p_case_id, c.args.p_decisao, c.args.p_casos_na_order]),
    [
      ["CBK-1", "111", "a_favor_da_loja", 2],
      ["CBK-2", "222", "em_analise", 2],
    ],
  );
  semEscritaDireta(registro);
});

Deno.test("Lote A R1 - avisos da RPC: 'revertida' e 'saldo' viram UM push cada em duas entregas; 'conferir' vira o aviso de conferência", async () => {
  for (const [aviso, titulo] of [
    ["revertida", "Contestação mudou de resultado"],
    ["saldo", "Contestação maior que o saldo do pedido"],
    ["conferir", "Contestação de pagamento para conferir"],
  ]) {
    const registro = registroDoLedger();
    const supabase = clienteFalso({
      pedido: pedidoPago(),
      registro,
      orderRefundsRows: [],
      contestacaoNoLedger: () => retornoDaRpc(`desfecho_${aviso}`, { aviso }),
    });
    const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "settled" }), caso: CASO_CONTRA_A_LOJA });
    const pushes: any[] = [];
    await semLogs(() => entregarContestacao(supabase, fn, pushes));
    await semLogs(() => entregarContestacao(supabase, fn, pushes));
    assertEquals(pushes.length, 1, aviso);
    assertEquals(pushes[0].title, titulo, aviso);
  }
});

Deno.test("Lote A R1 - RPC com erro, ou retorno ilegível -> 500 (o MP reenvia); nada escrito pela edge", async () => {
  for (const roteiro of [
    { data: null, error: { message: "could not obtain lock (dublê)" } },
    { data: { sem: "resultado" }, error: null },
    { data: null, error: null },
  ]) {
    const registro = registroDoLedger();
    const supabase = clienteFalso({
      pedido: pedidoPago(),
      registro,
      orderRefundsRows: [],
      contestacaoNoLedger: () => roteiro,
    });
    const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "settled" }), caso: CASO_CONTRA_A_LOJA });
    const resposta = await semLogs(() => entregarContestacao(supabase, fn));
    assertEquals(resposta.status, 500, JSON.stringify(roteiro));
    semEscritaDireta(registro);
  }
});

Deno.test("Lote A R1 - duas entregas PARALELAS do mesmo caso -> as duas chegam à RPC com os mesmos argumentos (a serialização é a trava do pedido no banco: contestacao-viva (d)), as duas 200", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [], barreiraLeituraOrderRefunds: 2 });
  const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "settled" }), caso: CASO_CONTRA_A_LOJA });
  const [a, b] = await semLogs(() => Promise.all([entregarContestacao(supabase, fn), entregarContestacao(supabase, fn)]));
  assertEquals([a.status, b.status], [200, 200]);
  assertEquals(registro.chamadasContestacao.length, 2);
  assertEquals(registro.chamadasContestacao[0].args, registro.chamadasContestacao[1].args);
  semEscritaDireta(registro);
});

Deno.test("Lote A R1 (bloqueio 4) - o GET do caso devolve OUTRO caso -> nenhuma RPC (a reserva fica), aviso ao admin UMA vez", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({
    order: orderContestada({ detalheOrder: "settled" }),
    caso: { ...CASO_CONTRA_A_LOJA, id: "9999999999" },
  });
  const pushes: unknown[] = [];
  const r1 = await semLogs(() => entregarContestacao(supabase, fn, pushes));
  const r2 = await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals([r1.status, r2.status], [200, 200]);
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
  assertEquals(pushes.length, 1);
});

Deno.test("Lote A R1 - consulta do CASO falha (500) -> 500 (o MP reenvia = reconsulta), nenhuma RPC", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({ order: orderContestada({ detalheOrder: "settled" }), statusCaso: 500 });
  const resposta = await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasContestacao.length, 0);
  semEscritaDireta(registro);
});

// ── Bloqueio 2: REF (refund REGULAR, POST /v1/orders/{id}/refund) ≠ CBK ───
// Doc (refund-order/post): o refund devolve REF.../transaction_id PAY.../
// amount/status processed; nenhum contrato do MP liga um REF a um CBK. Antes,
// numa order contestada, todo refund processed era IGNORADO por suspeita de
// ser o débito da contestação — dedup inventado. Agora o REF entra como
// refund regular, pela RPC sob a trava do pedido: inteiro se cabe no saldo;
// senão não entra nem é recortado, e o admin é avisado.

function orderContestadaComRef(valor = "100.00", total = "200.00") {
  return orderContestada({
    detalheOrder: "settled",
    total,
    refunds: [{ id: "REF01PROVA", transaction_id: ID_PAGAMENTO_DA_ORDER, amount: valor, status: "processed" }],
  });
}

Deno.test("Lote A (bloqueio 2) - REF processed numa order contestada entra como refund REGULAR, inteiro, pela RPC sob a trava; a contestação segue para a dela", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({ pedido: pedidoPago(200), registro, orderRefundsRows: [linhaDaReserva()] });
  const { fn } = fetchDaContestacao({ order: orderContestadaComRef(), caso: CASO_CONTRA_A_LOJA });
  const resposta = await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasExternoNaContestacao.length, 1, "o REF não é descartado por suspeita");
  assertEquals(registro.chamadasExternoNaContestacao[0].args, {
    p_order_id: UUID_PEDIDO,
    p_mp_refund_id: "REF01PROVA",
    p_valor: 100,
    p_mp_status: "charged_back",
    p_mp_status_detail: "settled",
  });
  assertEquals(registro.chamadasContestacao.length, 1);
  semEscritaDireta(registro);
});

Deno.test("Lote A (bloqueio 2) - REF que NÃO cabe no saldo (sobreposição inconclusiva) -> nada recortado, aviso ao admin UMA vez em duas entregas", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(100),
    registro,
    orderRefundsRows: [linhaDaReserva()],
    estornoExternoNaContestacao: () => ({
      data: { resultado: "nao_cabe", aviso: "saldo", valor_estornado: 0, em_voo: 100, disponivel: 0 },
      error: null,
    }),
  });
  const { fn } = fetchDaContestacao({ order: orderContestadaComRef("100.00", "100.00"), caso: CASO_EM_ANALISE });
  const pushes: any[] = [];
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals(registro.chamadasExternoNaContestacao.length, 2);
  assertEquals(registro.chamadasExternoNaContestacao[0].args.p_valor, 100, "nunca recortado para caber");
  const doRef = pushes.filter((p) => String(p.title).includes("Devolução do Mercado Pago"));
  assertEquals(doRef.length, 1, "um aviso só");
  semEscritaDireta(registro);
});

Deno.test("Lote A (bloqueio 2) - erro da RPC do REF -> 500 (o MP reenvia); REF já reivindicado por uma linha -> nenhuma chamada", async () => {
  const registroErro = registroDoLedger();
  const supabaseErro = clienteFalso({
    pedido: pedidoPago(200),
    registro: registroErro,
    orderRefundsRows: [linhaDaReserva()],
    estornoExternoNaContestacao: () => ({ data: null, error: { message: "lock timeout (dublê)" } }),
  });
  const { fn } = fetchDaContestacao({ order: orderContestadaComRef(), caso: CASO_CONTRA_A_LOJA });
  const resposta = await semLogs(() => entregarContestacao(supabaseErro, fn));
  assertEquals(resposta.status, 500);
  semEscritaDireta(registroErro);

  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(200),
    registro,
    orderRefundsRows: [
      linhaDaReserva(),
      { id: "linha-do-app", order_id: UUID_PEDIDO, amount: 100, status: "concluido", solicitado_por: "lojista", mp_refund_id: "REF01PROVA", concluido_em: "2026-10-01T00:00:00.000Z" },
    ],
  });
  await semLogs(() => entregarContestacao(supabase, fn));
  assertEquals(registro.chamadasExternoNaContestacao.length, 0, "um refund credita UMA linha");
});

Deno.test("Lote A (ordem) - MESMO GET com REF processed 100 + caso FINAL a favor da loja, reserva antiga de 100 -> a contestação decide ANTES do REF: libera e o REF entra inteiro no mesmo evento", async () => {
  // Cenário exato da revisão: com o REF antes, a RPC dele via a reserva de
  // 100 (nao_cabe), a contestação liberava depois e a resposta era 200 sem
  // revisitar o REF — a devolução real confirmada ficava 0.
  const registro = registroDoLedger();
  const ordem: string[] = [];
  let reservaAtiva = true;
  let estornado = 0;
  const supabase = clienteFalso({
    pedido: pedidoPago(100),
    registro,
    orderRefundsRows: [linhaDaReserva()],
    contestacaoNoLedger: (args) => {
      ordem.push(`contestacao:${args.p_decisao}`);
      if (args.p_decisao === "a_favor_da_loja" && reservaAtiva) {
        reservaAtiva = false;
        return retornoDaRpc("liberado", { disponivel: 100 });
      }
      return retornoDaRpc("ja_liberado", { disponivel: 100 - estornado });
    },
    estornoExternoNaContestacao: (args) => {
      ordem.push(`ref:${args.p_mp_refund_id}`);
      if (reservaAtiva) {
        return { data: { resultado: "nao_cabe", aviso: "saldo", valor_estornado: estornado, em_voo: 100, disponivel: 0 }, error: null };
      }
      if (estornado > 0) {
        return { data: { resultado: "ja_registrado", aviso: null, valor_estornado: estornado, em_voo: 0, disponivel: 0 }, error: null };
      }
      estornado = Number(args.p_valor);
      return { data: { resultado: "inserido", aviso: null, valor_estornado: estornado, em_voo: 0, disponivel: 0 }, error: null };
    },
  });
  const { fn } = fetchDaContestacao({
    order: orderContestada({
      detalheOrder: "reimbursed",
      total: "100.00",
      refunds: [{ id: "REF01ORDEM", transaction_id: ID_PAGAMENTO_DA_ORDER, amount: "100.00", status: "processed" }],
    }),
    caso: CASO_A_FAVOR_DA_LOJA,
  });
  const pushes: any[] = [];
  const resposta = await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals(resposta.status, 200);
  assertEquals(ordem, ["contestacao:a_favor_da_loja", "ref:REF01ORDEM"]);
  assertEquals(estornado, 100, "a devolução real confirmada entra no mesmo evento");
  assertEquals(pushes.filter((p) => String(p.title).includes("Devolução do Mercado Pago")).length, 0);

  // Reentrega do MP: nada novo, sem contar duas vezes.
  await semLogs(() => entregarContestacao(supabase, fn, pushes));
  assertEquals(estornado, 100);
  semEscritaDireta(registro);
});

Deno.test("Lote A (bloqueio 0) - order que JÁ teve contestação no ledger, agora com status 'refunded': o REF também passa pela RPC sob a trava (sem clamp no retrato), nunca pelo INSERT direto", async () => {
  const registro = registroDoLedger();
  const supabase = clienteFalso({
    pedido: pedidoPago(100),
    registro,
    orderRefundsRows: [linhaDaReserva()],
    estornoExternoNaContestacao: () => ({
      data: { resultado: "nao_cabe", aviso: "saldo", valor_estornado: 0, em_voo: 100, disponivel: 0 },
      error: null,
    }),
  });
  const corpo = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: ID_PAGAMENTO_DA_ORDER, status: "refunded" }],
      refunds: [{ id: "REF01DEPOIS", transaction_id: ID_PAGAMENTO_DA_ORDER, amount: "100.00", status: "processed" }],
    },
  };
  const pushes: any[] = [];
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await semLogs(() =>
    handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, corpo),
      enviarPushContado: async (args: any) => {
        pushes.push(args.aviso);
        return 1;
      },
    } as any)
  );
  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasExternoNaContestacao.length, 1);
  assertEquals(registro.chamadasExternoNaContestacao[0].args.p_valor, 100);
  semEscritaDireta(registro);
  assertEquals(pushes.filter((p) => String(p.title).includes("Devolução do Mercado Pago")).length, 1);
});

Deno.test("W5 - W1 repetida (linha já concluída com mp_refund_id 'r1') -> nada inserido, RPC não chamada de novo, valor_estornado do dublê NÃO muda", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: "999",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
  };
  const orderRefundsRows = [
    {
      id: "linha-5",
      order_id: UUID_PEDIDO,
      amount: 100,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 1,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "refunded",
    status_detail: "refunded",
    external_reference: UUID_PEDIDO,
    transaction_amount_refunded: 100,
    refunds: [{ id: "r1", amount: 100, status: "approved" }],
  });

  // 1a passagem: conclui, igual ao W1.
  const req1 = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  await handler(req1, { supabase, fetchImpl });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  const valorApos1a = (registro as any).valorEstornadoAcumulado;
  assertEquals(valorApos1a, 100);

  // 2a passagem: MESMA notificação — a linha já está 'concluido' com
  // mp_refund_id 'r1' (fila viva do dublê), então ela sai de `pendentes` e a
  // RPC não é chamada de novo (P13: idempotente por contrato) — nada é
  // inserido, e o valor_estornado acumulado NÃO muda.
  const req2 = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  await handler(req2, { supabase, fetchImpl });
  assertEquals(registro.insertsOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals((registro as any).valorEstornadoAcumulado, valorApos1a);
});

Deno.test("W6 - linha 'sistema' concluida com concluido_em NULO (crash entre INSERT e RPC) -> o passo chama concluir_estorno para ela ANTES de tudo", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-crash",
      order_id: UUID_PEDIDO,
      amount: 40,
      status: "concluido",
      solicitado_por: "sistema",
      mp_refund_id: "r-recuperar",
      mp_status: "refunded",
      mp_status_detail: "refunded",
      tentativas: 0,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r-recuperar", amount: "40.00", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-crash");
  // A recuperação passa SÓ o id — os campos do MP já estão gravados na
  // linha (o COALESCE da RPC real os preserva).
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, undefined);
  // 'r-recuperar' já está em `reivindicados` (linha-crash já o tinha) — não
  // vira uma SEGUNDA inserção de "estorno fora do app".
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

Deno.test("W7 - order com refund 'in_process' (não 'processed') e linha em_processamento -> nada concluído, nada inserido, 200", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-7",
      order_id: UUID_PEDIDO,
      amount: 100,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 1,
      concluido_em: null,
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r7", amount: "100.00", status: "in_process" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

Deno.test("W8 - estorno externo maior que o disponível (pedido já totalmente estornado) -> a GUARDA impede o insert ANTES da RPC", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 100,
    payment_status: "estornado",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    // Seguro: SE a guarda faltasse (mutação m2) e o insert/RPC rodassem
    // mesmo assim, o dublê simula a recusa nomeada da RPC real.
    erroConcluirEstorno: () => ({
      message: "estorno_acima_do_total: a linha somaria 100 e o acumulado passaria do total 100.",
    }),
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r8", amount: "100.00", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  // A guarda (disponivel <= 0) barra ANTES do insert — mutação m2 (apagar o
  // clamp/guarda) faz insertsOrderRefunds subir para 1 e chama a RPC (que
  // recusaria pelo erro nomeado configurado acima).
  assertEquals(registro.insertsOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
});

Deno.test("W8b - RPC concluir_estorno recusa com 'estorno_acima_do_total' mesmo com a guarda passando -> console.error e SEGUE (200), nunca 500", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    erroConcluirEstorno: () => ({
      message: "estorno_acima_do_total: recusa de segurança do banco (item 6 do brief).",
    }),
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r8b", amount: "100.00", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  // A guarda deixou passar (disponivel = 100), o INSERT aconteceu, e a RPC
  // recusou pelo nome — o handler TOLERA (nunca lança 500): reenviar não
  // muda a conta.
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

Deno.test("W9 - dois refunds processed de 10 (ra, rb) e duas linhas pendentes de 10 -> cada linha recebe um id DIFERENTE (mutação m1: apagar o filtro de reivindicados derruba)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 20,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-9a",
      order_id: UUID_PEDIDO,
      amount: 10,
      status: "solicitado",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 0,
      concluido_em: null,
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "linha-9b",
      order_id: UUID_PEDIDO,
      amount: 10,
      status: "solicitado",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 0,
      concluido_em: null,
      created_at: "2026-09-02T00:00:00.000Z",
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [
        { id: "ra", amount: "10.00", status: "processed" },
        { id: "rb", amount: "10.00", status: "processed" },
      ],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConcluirEstorno.length, 2);
  const idsRecebidos = registro.chamadasConcluirEstorno.map((c: any) => c.args.p_mp_refund_id).sort();
  assertEquals(idsRecebidos, ["ra", "rb"]);
  const porLinha = new Map(
    registro.chamadasConcluirEstorno.map((c: any) => [c.args.p_refund_id, c.args.p_mp_refund_id]),
  );
  assertEquals(porLinha.get("linha-9a") !== porLinha.get("linha-9b"), true);
});

// =============================================================================
// PROBE-A/B — BLOQUEIA-1 do laudo Opus rodada 2 (PR #449, 08/09/2026):
// `somaEmCurso(linhasBanco)` percorre as linhas como lidas no INÍCIO do passo
// — a linha que ESTE MESMO LOTE acabou de concluir (RPC bem-sucedida) ainda
// aparece como 'solicitado'/'em_processamento' nesse array, e o valor dela é
// descontado DUAS vezes do `disponivel` do estorno externo: uma via
// `pedido.valor_estornado` (acumulado em memória, I-B), outra via
// `somaEmCurso`. Só ficam VERMELHOS depois do conserto do BLOQUEIA-2 (dublê
// devolve cópias rasas — sem isso a mutação de `concluir_estorno` no array
// da fila viva também mutava, por referência, o array `linhasBanco` do
// handler, escondendo o defeito).
// =============================================================================

Deno.test("PROBE-A (BLOQUEIA-1) - pedido 100, linha pendente 40 concluída por r1, externo rext 60 -> linha 'sistema' de 60 (não 20: somaEmCurso não pode recontar a linha que este lote acabou de concluir)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-proba",
      order_id: UUID_PEDIDO,
      amount: 40,
      status: "solicitado",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 0,
      concluido_em: null,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [
        { id: "r1", amount: "40.00", status: "processed" },
        { id: "rext", amount: "60.00", status: "processed" },
      ],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  // A linha pendente conclui com r1 (valor exato: 40).
  assertEquals(registro.chamadasConcluirEstorno.length, 2);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-proba");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r1");
  // rext (externo, não reivindicado) tem de registrar os R$60 INTEIROS — com
  // o bug, `disponivel` = 100 − 40(memória) − 40(linha-proba recontada por
  // somaEmCurso) = 20, e o insert sairia com amount 20.
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "rext");
  assertEquals(registro.insertsOrderRefunds[0].amount, 60);
});

Deno.test("PROBE-B (BLOQUEIA-1) - pedido 100, linha em_processamento 50 concluída por r1, externo rext 50 -> linha 'sistema' de 50 inserida, valor_estornado final 100", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-probb",
      order_id: UUID_PEDIDO,
      amount: 50,
      status: "em_processamento",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 1,
      concluido_em: null,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [
        { id: "r1", amount: "50.00", status: "processed" },
        { id: "rext", amount: "50.00", status: "processed" },
      ],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasConcluirEstorno.length, 2);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "linha-probb");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "r1");
  // Com o bug, disponivel = 100 − 50(memória) − 50(linha-probb recontada) = 0
  // -> a GUARDA barra e rext NUNCA é inserido: o cliente ficaria com só R$50
  // no ledger, apesar de o MP ter devolvido os R$100 inteiros.
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "rext");
  assertEquals(registro.insertsOrderRefunds[0].amount, 50);
  assertEquals((registro as any).valorEstornadoAcumulado, 100);
});

// =============================================================================
// MUT-X/MUT-Y — mutações do laudo Opus (rodada 2, PR #449) que sobreviviam
// 61/61: MUT-X apaga a linha `pedido.valor_estornado = ...` (I-B); MUT-Y
// apaga o filtro `l.solicitado_por !== "sistema"` do laço de pendentes.
// =============================================================================

Deno.test("MUT-X (I-B) - pedido 100, linha 40 concluída por r1, externo rext 80 -> disponivel usa o valor_estornado ACUMULADO EM MEMÓRIA (60), não o valor do banco antes do lote (apagar 'pedido.valor_estornado = ...' derruba: disponivel viraria 100 e o insert sairia com 80)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-mutx",
      order_id: UUID_PEDIDO,
      amount: 40,
      status: "solicitado",
      solicitado_por: "cliente",
      mp_refund_id: null,
      tentativas: 0,
      concluido_em: null,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [
        { id: "r1", amount: "40.00", status: "processed" },
        { id: "rext", amount: "80.00", status: "processed" },
      ],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 1);
  assertEquals(registro.insertsOrderRefunds[0].mp_refund_id, "rext");
  // disponivel correto = 100 − 40(memória) − 0(somaEmCurso, linha já
  // concluída pelo BLOQUEIA-1) = 60; rext (80) clampa em 60.
  assertEquals(registro.insertsOrderRefunds[0].amount, 60);
});

Deno.test("MUT-Y (dinheiro já saiu) - linha 'sistema' em_processamento de chargeback NÃO entra no laço de pendentes nem é concluída por um refund 'refunded' real do MESMO valor (apagar 'l.solicitado_por !== sistema' derruba)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "estornado",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const orderRefundsRows = [
    {
      id: "linha-chargeback",
      order_id: UUID_PEDIDO,
      amount: 100,
      status: "em_processamento",
      solicitado_por: "sistema",
      mp_refund_id: null,
      mp_status: "charged_back",
      mp_status_detail: "in_process",
      tentativas: 0,
      concluido_em: null,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ];
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows });
  // Um evento DIFERENTE (estorno real, não chargeback) traz um refund
  // 'processed' do MESMO valor da linha de chargeback (100) — ela não pode
  // emprestar o id: quem resolve uma disputa é settled/reimbursed, nunca um
  // refund comum.
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r-real", amount: "100.00", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  // A linha 'sistema' fica de fora do laço de pendentes -> nenhuma conclusão
  // pelo laço; r-real cai no passo do estorno externo, mas a linha de
  // chargeback ainda reserva o saldo inteiro (somaEmCurso não filtra por
  // solicitado_por) -> disponivel = 0 -> nenhum insert, nenhuma RPC.
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

// =============================================================================
// PROBE-E — ANTES-DE-CRESCER-1 do laudo Opus rodada 2 (PR #449): valor
// ilegível do MP (refund sem `amount`, `:606`) é "não sei" — console.error +
// PULAR (nenhum insert, nenhuma RPC), NUNCA `0` (que violaria
// `CHECK (amount > 0)` no banco -> 500 em laço -> o MP reenvia para sempre).
// =============================================================================

Deno.test("PROBE-E (ANTES-DE-CRESCER-1) - refund 'processed' sem 'amount' legível -> zero inserts, zero RPC de estorno, 200, e o resto do handler roda (confirmar_pagamento do 'refunded' acontece)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    rpcResultado: "estornado",
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      // sem `amount` — refund.amount é undefined -> Number(undefined) = NaN.
      refunds: [{ id: "r-sem-valor", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  // O resto do handler roda: confirmar_pagamento é chamada com o status do
  // 'refunded' (a falha ao registrar o desfecho do estorno NUNCA bloqueia o
  // resto do fluxo).
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "estornado");
});

// =============================================================================
// ANTES-DE-CRESCER-2 (laudo Opus rodada 2): chargeback pela rota `payment`
// nunca tinha teste — só a rota `order` (W4/W4b, acima) provava o valor.
// =============================================================================

Deno.test("ANTES-DE-CRESCER-2 (Lote A) - chargeback pela rota 'payment' (pagamento clássico, sem chargebacks[]) -> NENHUMA reserva: sem a identidade do caso (CBK) a linha seria duplicável", async () => {
  // Lote A (R1-NULL): até aqui esta notificação criava uma reserva SEM
  // identidade (mp_refund_id NULL) — duas entregas criavam duas, e a
  // liberação achava só a primeira. Sem CBK legível: não reserva, avisa o
  // admin (teste "rota payment (PIX legado) 'charged_back'", acima).
  const registro = registroDoLedger();
  const pedido = { ...pedidoPago(), gateway_payment_id: "999" };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "charged_back",
    status_detail: "in_process",
    external_reference: UUID_PEDIDO,
    transaction_amount: 100,
  });

  const resposta = await semLogs(() => handler(req, { supabase, fetchImpl, enviarPushContado: async () => 1 }));

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

// =============================================================================
// Rodada 3 (laudo Opus 08/09, rodada 2) — `Number(null)` e `Number("")` são
// 0, NÃO NaN: `!Number.isFinite(v)` sozinho passa um valor explicitamente
// nulo ou vazio como 0. Só `|| v <= 0` barra — sem ele, `amount: 0`/
// `transaction_amount: 0` violaria `CHECK (amount > 0)` no banco (500 em
// laço, o MP reenvia para sempre). PROBE-E (acima) já cobre `amount`
// AUSENTE (undefined -> NaN, já pego só por `Number.isFinite`); estas cobrem
// o valor PRESENTE mas nulo/vazio, que só o `<= 0` pega.
// =============================================================================

Deno.test("PROBE-E2 (rodada 3) - refund 'processed' com amount: null -> zero inserts, zero RPC de estorno, 200, e o resto do handler roda", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    rpcResultado: "estornado",
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      // amount: null -> Number(null) é 0 (finito!), não NaN.
      refunds: [{ id: "r-nulo", amount: null, status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  // O resto do handler roda mesmo com o refund pulado.
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "estornado");
});

Deno.test("PROBE-E3 (rodada 3) - refund 'processed' com amount: '' -> zero inserts (Number('') também é 0, não NaN)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    rpcResultado: "estornado",
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      refunds: [{ id: "r-vazio", amount: "", status: "processed" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

Deno.test("PROBE-F (rodada 3) - chargeback pela rota 'payment', 'in_process', transaction_amount: null -> zero inserts (guarda !valorPagoValido, :689)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: "999",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({ pedido, registro, orderRefundsRows: [] });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  const fetchImpl = fetchConsulta(200, {
    id: 999,
    status: "charged_back",
    status_detail: "in_process",
    external_reference: UUID_PEDIDO,
    transaction_amount: null,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

// =============================================================================
// MUT-N2 (laudo Opus rodada 2, PR #449) — o filtro de status do refactor
// "uma passagem" (o `continue` que descarta refund não-terminal, `:532`) não
// tinha teste que discriminasse: apagá-lo sobrevivia 67/67 porque, sem linha
// pendente para zerar `disponivel`, W7 (que também mata outros mutantes)
// fica verde por outro motivo. Este cenário isola o `continue`: SEM linha
// pendente nenhuma, um refund `in_process` (dinheiro que NÃO voltou) não
// pode virar insert nenhum.
// =============================================================================

Deno.test("MUT-N2 (rodada 3) - pedido SEM linha pendente, refund 'in_process' de 50 -> zero inserts (dinheiro que não voltou não pode ser gravado como devolvido)", async () => {
  const registro = {
    chamadasRpc: [] as any[],
    chamadasConcluirEstorno: [] as any[],
    insertsOrderRefunds: [] as any[],
  };
  const pedido = {
    id: UUID_PEDIDO,
    gateway_payment_id: ID_ORDER_TESTE,
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "delivered",
  };
  const supabase = clienteFalso({
    pedido,
    registro,
    orderRefundsRows: [],
    rpcResultado: "estornado",
  });
  const corpoOrder = {
    id: ID_ORDER_TESTE,
    external_reference: UUID_PEDIDO,
    status: "refunded",
    status_detail: "refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{ id: "PAY01XYZ", status: "processed" }],
      // 'in_process' NÃO é terminal (statusTerminal da rota order é
      // 'processed') — o `continue` de :532 tem que descartar este refund
      // ANTES de ele chegar em `refundsConcluidos`.
      refunds: [{ id: "r-in-process", amount: "50.00", status: "in_process" }],
    },
  };
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, corpoOrder) });

  assertEquals(resposta.status, 200);
  assertEquals(registro.insertsOrderRefunds.length, 0);
});

// --- PEÇA 5 (revisão de dinheiro-não-recebido, 12/09/2026): o cliente que
// paga PIX depois do prazo de reserva não pode ficar mudo. ---------------

function numeroDoPedidoEsperado(id: string): string {
  return `#${String(id).slice(-6).toUpperCase()}`;
}

Deno.test("htmlDoAvisoDePagamentoAtrasado: texto honesto — NUNCA promete 'aguardando confirmação' nem 'fila de separação'", () => {
  const html = htmlDoAvisoDePagamentoAtrasado({ orderId: UUID_PEDIDO, nomeDaLoja: "Loja Teste" });

  // As duas frases que o comprovante PADRÃO usa e que mentiriam aqui — ver
  // `htmlDoPedido` em `_shared/comprovante.ts`. A negação ("não entrou na
  // fila de separação") é o texto HONESTO — o que não pode aparecer é a
  // afirmação, no presente, de que o pedido ENTRA na fila.
  assertEquals(html.includes("aguardando"), false, "não pode dizer que o pagamento ainda está aguardando confirmação");
  assertEquals(html.includes("entra na fila de separação"), false, "o pedido está cancelado — nunca ENTRA na fila de separação");
  assertStringIncludes(html, "não entrou na fila de separação");

  // O que TEM de estar dito: pagamento confirmado, tarde, pedido cancelado.
  assertStringIncludes(html, "cancelado");
  assertStringIncludes(html, numeroDoPedidoEsperado(UUID_PEDIDO));
  assertStringIncludes(html, "Loja Teste");
});

Deno.test("aviso de pagamento atrasado: reserva NÃO concedida (reservou=false) -> não chega a ler store_config nem a enviar e-mail", async () => {
  // Mesma técnica de "por padrão... a reserva é alcançada com o orderId
  // certo" (mais acima): `reservou=false` simula o comprovante PADRÃO (ou
  // este mesmo aviso, num reenvio) já tendo reivindicado o pedido — é assim
  // que se prova, sem tocar SMTP, que os dois nunca mandam dois avisos.
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
    let leuStoreConfig = false;
    const pedido = {
      id: UUID_PEDIDO,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
    };
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadasRpc.push({ nome, args });
        if (nome === "confirmar_pagamento") return { data: "pago_apos_expirar", error: null };
        if (nome === "reivindicar_email_de_confirmacao") return { data: false, error: null };
        return { data: null, error: null };
      },
      from(tabela: string) {
        if (tabela === "store_config") leuStoreConfig = true;
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: tabela === "marketplace_orders" ? pedido : null, error: null }) };
              },
              limit(_n: number) {
                return { maybeSingle: async () => ({ data: null, error: null }) };
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
    assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO, "a reserva tem de ser alcançada com o orderId certo");
    assertEquals(leuStoreConfig, false, "reservou=false tem de parar ANTES de montar o e-mail (nada de SMTP)");
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

Deno.test("aviso de pagamento atrasado: RPC de reserva lança -> webhook ainda responde 200, e loga o erro (falha nunca sobe)", async () => {
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const pedido = {
      id: UUID_PEDIDO,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
    };
    const supabase = {
      rpc: async (nome: string) => {
        if (nome === "confirmar_pagamento") return { data: "pago_apos_expirar", error: null };
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
        args.some((v) => typeof v === "string" && v.includes("aviso de pagamento atrasado")),
      ),
      true,
      "deveria logar console.error mencionando o aviso de pagamento atrasado",
    );
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

Deno.test("aviso de pagamento atrasado: SMTP não configurado -> não chega a chamar a reserva, e loga o motivo", async () => {
  const valorUser = Deno.env.get("SMTP_USER");
  const valorPass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    const chamadasRpc: string[] = [];
    const pedido = { id: UUID_PEDIDO, user_id: null, customer_data: { email: "cliente@exemplo.com" } };
    const supabase = {
      rpc: async (nome: string) => {
        chamadasRpc.push(nome);
        if (nome === "confirmar_pagamento") return { data: "pago_apos_expirar", error: null };
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
    assertEquals(chamadasRpc.includes("reivindicar_email_de_confirmacao"), false);
    assertEquals(
      chamadasErro.some((args) =>
        args.some((v) => typeof v === "string" && v.includes("SMTP não configurado")),
      ),
      true,
    );
  } finally {
    if (valorUser !== undefined) Deno.env.set("SMTP_USER", valorUser);
    if (valorPass !== undefined) Deno.env.set("SMTP_PASSWORD", valorPass);
  }
});

// ── Tarefa mp-2 (15/09/2026): de QUEM são as chaves deste webhook ─────────
//
// Duas chaves vivem aqui, e as duas passaram a sair de
// `resolverCredenciaisMp` (_shared/credenciais-mp.ts): o SEGREDO que
// autentica a notificação (HMAC) e o TOKEN que reconsulta o MP. Com chave do
// lojista cadastrada, as duas são as DELE; sem cadastro nenhum, as da
// plataforma (comportamento de sempre, provado pelos 80 testes acima, que
// não passam registro nenhum).
//
// A assimetria testada em MP-W2 é de propósito e está escrita no módulo: o
// SEGREDO tem reserva no ambiente (o lojista pode ter cadastrado só a chave
// de cobrança, e sem reserva o webhook devolveria 401 para notificação
// legítima), o TOKEN não tem reserva nenhuma — cobrar/consultar na conta
// errada é o erro que esta frente existe para impedir.

// O `SEGREDO_WEBHOOK_LOJISTA` (o `WEBHOOK_LOJISTA_FALSO` do fixture) é
// DIFERENTE do `SEGREDO` da plataforma lá do topo, de propósito: é essa
// diferença que prova de quem é o segredo que valida a assinatura.

/** Como `fetchConsulta`, mas guardando os headers: é no `Authorization` que
 * mora a resposta de "com a chave de quem este webhook está perguntando". */
function fetchConsultaComHeaders(
  capturado: { autorizacoes: string[]; chamadas: number },
  status: number,
  corpo: Record<string, unknown>,
) {
  return async (_url: string, init?: RequestInit) => {
    capturado.chamadas++;
    capturado.autorizacoes.push(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
    );
    return new Response(JSON.stringify(corpo), { status });
  };
}

function pedidoDeTeste(): Record<string, unknown> {
  return {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ID_GRAVADO_CLASSICO_DIFERENTE,
  };
}

Deno.test("MP-W1 — lojista com chave cadastrada: a assinatura vale pelo SEGREDO DELE e o Bearer da consulta é o TOKEN DECIFRADO dele", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasRpc: [] };
    const supabase = clienteFalso({
      rpcResultado: "pago",
      pedido: pedidoDeTeste(),
      registro,
      registroMp: await registroMpDeTeste(),
    });
    // Assinada com o segredo DO LOJISTA — com o do ambiente ela seria 401.
    const req = await requisicaoAssinada("999", { segredo: SEGREDO_WEBHOOK_LOJISTA });
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "approved",
      external_reference: UUID_PEDIDO,
      transaction_amount: 149.9,
    });

    const resposta = await handler(req, { supabase, fetchImpl });

    assertEquals(resposta.status, 200);
    assertEquals(registro.chamadasRpc.length, 1);
    assertEquals(capturado.autorizacoes[0], `Bearer ${TOKEN_LOJISTA_FALSO}`);
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

Deno.test("MP-W2 — lojista com TOKEN mas SEM chave de assinatura própria: a reserva do MP_WEBHOOK_SECRET do ambiente NÃO vale mais (frente 8, decisão do dono 29/09) — 500 nomeado, nada processado", async () => {
  // O MP-W2 ANTIGO pinava o contrário: notificação assinada com o segredo DO
  // AMBIENTE era processada com 200 para lojista sem chave própria. Isso
  // deixava a CONFIRMAÇÃO de pagamento de uma loja depender do segredo
  // GLOBAL da plataforma — exatamente o que o dono rejeita no app
  // multi-loja ("a chave global do ambiente não é substituta da chave de
  // assinatura cadastrada por cada loja") e o oposto do que a política do
  // PIX aprovada já faz na CRIAÇÃO (lojista sem chave não gera PIX). Com a
  // camada de notificação alinhada à de criação: 500 com o motivo certo
  // (padrão do estado `indisponivel` — o MP reenvia e a loja se cura
  // cadastrando a chave em Ajustes; o reconciliador segue de backstop).
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasRpc: [] };
    const supabase = clienteFalso({
      rpcResultado: "pago",
      pedido: pedidoDeTeste(),
      registro,
      registroMp: await registroMpDeTeste({ webhookSecret: null }),
    });
    // Assinada com o segredo DO AMBIENTE — a reserva que este teste prova
    // que NÃO vale mais para lojista sem chave própria.
    const req = await requisicaoAssinada("999");
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "approved",
      external_reference: UUID_PEDIDO,
      transaction_amount: 149.9,
    });

    const resposta = await handler(req, { supabase, fetchImpl });

    assertEquals(resposta.status, 500);
    assertEquals(registro.chamadasRpc.length, 0);
    assertEquals(capturado.chamadas, 0);
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

Deno.test("MP-W2b — SEM cadastro nenhum (origem ambiente): a reserva do MP_WEBHOOK_SECRET do ambiente CONTINUA valendo — notificação legítima processa com o TOKEN da plataforma", async () => {
  // A reserva LEGÍTIMA: quando não existe cadastro de lojista (deploy da
  // plataforma/ambiente), o segredo do ambiente é a chave CERTA por definição.
  // Este teste prende a fronteira da frente 8: a reserva morre SÓ para
  // lojista sem chave própria — não para o ambiente.
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasRpc: [] };
    const supabase = clienteFalso({
      rpcResultado: "pago",
      pedido: pedidoDeTeste(),
      registro,
      registroMp: null,
    });
    const req = await requisicaoAssinada("999");
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "approved",
      external_reference: UUID_PEDIDO,
      transaction_amount: 149.9,
    });

    const resposta = await handler(req, { supabase, fetchImpl });

    assertEquals(resposta.status, 200);
    assertEquals(registro.chamadasRpc.length, 1);
    // "token-de-teste" é o MP_ACCESS_TOKEN do AMBIENTE nesta suíte (:104) —
    // o token da plataforma, que é o certo para origem ambiente.
    assertEquals(capturado.autorizacoes[0], "Bearer token-de-teste");
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

Deno.test("MP-W3 — chave do lojista cadastrada + cofre ausente: 500 (o MP reenvia) e NENHUMA consulta com o token da plataforma", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  const registroCifrado = await registroMpDeTeste();
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");

  const registro = { chamadasRpc: [] };
  const supabase = clienteFalso({
    rpcResultado: "pago",
    pedido: pedidoDeTeste(),
    registro,
    registroMp: registroCifrado,
  });
  // Assinada pelo ambiente: a notificação é legítima do ponto de vista do
  // HMAC (a reserva do segredo vale), e ainda assim o pagamento não é
  // processado — é a falha FECHADA do token.
  const req = await requisicaoAssinada("999");
  const capturado = { autorizacoes: [] as string[], chamadas: 0 };
  const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.9,
  });

  const resposta = await handler(req, { supabase, fetchImpl });

  // 500 e não 200: o evento FICA na fila do MP, que reenvia — quando alguém
  // devolver o cofre ao lugar, a notificação volta e o pedido confirma.
  assertEquals(resposta.status, 500);
  assertEquals(capturado.chamadas, 0);
  assertEquals(registro.chamadasRpc.length, 0);
});

// ── Tarefa mp-7 (16/09/2026): cofre ausente FECHA antes da assinatura, e
// lixo sem assinatura não paga banco ─────────────────────────────────────
//
// Dois achados da revisão de contexto limpo da mp-2, e as duas provas aqui:
//
// 1. Com registro do lojista presente e cofre ilegível (`origem:
//    "indisponivel"`), a reserva do ambiente NÃO vale para o HMAC. O lojista
//    cadastrou o segredo DELE, o MP assina com ELE, e comparar contra o
//    `MP_WEBHOOK_SECRET` da plataforma devolvia 401 "assinatura inválida" —
//    diagnóstico MENTIROSO durante os 30 min do PIX: quem está de plantão
//    caça o segredo errado em vez de devolver a chave do cofre ao lugar. O
//    500 com o motivo certo (`cofre_ausente`) já existia no código e era
//    INALCANÇÁVEL nesse estado. MP-W3 (acima) prova o mesmo estado quando a
//    notificação vem assinada pelo AMBIENTE; MP-W4 é o caso que de fato
//    acontece em produção — assinada pelo LOJISTA.
//
// 2. Toda requisição pagava um SELECT em app_settings ANTES de qualquer
//    autenticação. MP-W5/MP-W6 prendem a recusa barata: sem `x-signature`,
//    ou com `x-signature` sem `v1=`, a resposta é 401 sem tocar o banco.

// `contandoFrom` (conta cada `from(tabela)` do cliente falso — é assim que
// MP-W5/MP-W6 provam "ZERO acesso a app_settings", que nenhuma asserção de
// resposta conseguiria distinguir de "acessou e recusou depois") vem agora de
// `_shared/credenciais-mp_fixtures.ts` (mp-10) — era copiado igual no
// `reconciliar-pagamentos/index_test.ts`.

Deno.test("MP-W4 — registro do lojista + cofre ausente + notificação assinada pelo SEGREDO DELE: 500 com o motivo certo, nunca 401", async () => {
  // Cifra o registro com o cofre e DEPOIS tira a chave do ambiente: é o
  // estado real de "a variável sumiu do deploy", não um fixture inventado.
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  const registroCifrado = await registroMpDeTeste();
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");

  const registro = { chamadasRpc: [] };
  const tabelas: string[] = [];
  const supabase = contandoFrom(
    clienteFalso({
      rpcResultado: "pago",
      pedido: pedidoDeTeste(),
      registro,
      registroMp: registroCifrado,
    }),
    tabelas,
  );
  // Assinada com o segredo DO LOJISTA — que é o que o MP usa, porque foi ele
  // que o lojista cadastrou. Contra a reserva do ambiente isto NÃO bate.
  const req = await requisicaoAssinada("999", { segredo: SEGREDO_WEBHOOK_LOJISTA });
  const capturado = { autorizacoes: [] as string[], chamadas: 0 };
  const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
    id: ID_PAGAMENTO_DO_MP,
    status: "approved",
    external_reference: UUID_PEDIDO,
    transaction_amount: 149.9,
  });

  const chamadasErro: unknown[][] = [];
  const console_error = console.error;
  console.error = (...args: unknown[]) => {
    chamadasErro.push(args);
  };
  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl });
  } finally {
    console.error = console_error;
  }

  // 500, não 401: o MP reenvia, e quem está de plantão lê o motivo CERTO.
  assertEquals(resposta.status, 500);
  assertEquals(
    chamadasErro.some((args) =>
      args.some(
        (v) =>
          typeof v === "string" &&
          v.includes("origem: indisponivel") &&
          v.includes("motivo: cofre_ausente"),
      ),
    ),
    true,
    "o log tem de nomear o cofre ausente — é o diagnóstico que o 401 escondia",
  );
  assertEquals(capturado.chamadas, 0, "não deveria consultar o MP sem credencial");
  assertEquals(registro.chamadasRpc.length, 0);
  // Nada além da leitura das credenciais.
  assertEquals(tabelas, ["app_settings"]);
});

Deno.test("MP-W5 — requisição SEM x-signature: 401 sem pagar um SELECT em app_settings", async () => {
  const registro = { chamadasRpc: [] };
  const tabelas: string[] = [];
  const supabase = contandoFrom(clienteFalso({ rpcResultado: "pago", registro }), tabelas);
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  const req = requisicao({ data: { id: "999" } });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 401);
  // O ponto desta prova: lixo sem assinatura custa ZERO banco.
  assertEquals(tabelas, []);
  assertEquals(chamouFetch, false);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("mp-10 — camposDaAssinatura vem do módulo compartilhado (UMA regra de parse, não duas cópias)", () => {
  // Este parse existia DUAS vezes: aqui (para a porta barata acima) e dentro
  // de `avaliarAssinatura`, em `_shared/mercadopago.ts` — duas grafias
  // podiam divergir em silêncio e fazer a porta barata recusar (ou aceitar)
  // notificação que a validação de verdade decidiria diferente. Sem o
  // `export` desta função em `_shared/mercadopago.ts`, este `import` (topo
  // do arquivo) já quebra o arquivo inteiro.
  assertEquals(camposDaAssinatura(null), { ts: null, v1: null });
  assertEquals(
    camposDaAssinatura("ts=1730000000,v1=abcdef"),
    { ts: "1730000000", v1: "abcdef" },
  );
  // Só `ts=`: `v1` fica null — é exatamente a condição que MP-W6 (abaixo)
  // prova que recusa sem tocar o banco.
  assertEquals(
    camposDaAssinatura("ts=1730000000"),
    { ts: "1730000000", v1: null },
  );
});

Deno.test("MP-W6 — x-signature malformada (sem v1=): 401 sem pagar um SELECT em app_settings", async () => {
  const registro = { chamadasRpc: [] };
  const tabelas: string[] = [];
  const supabase = contandoFrom(clienteFalso({ rpcResultado: "pago", registro }), tabelas);
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response("{}", { status: 200 });
  };
  // Só `ts=`: é a mesma coisa que `avaliarAssinatura` já recusa sem sequer
  // importar a chave do HMAC — agora recusa antes de tocar o banco.
  const req = requisicao({ data: { id: "999" } }, { "x-signature": "ts=1730000000" });

  const resposta = await handler(req, { supabase, fetchImpl });

  assertEquals(resposta.status, 401);
  assertEquals(tabelas, []);
  assertEquals(chamouFetch, false);
  assertEquals(registro.chamadasRpc.length, 0);
});

// --- Tarefa mp-6: UMA resolução de credenciais por invocação ---------------
//
// Ressalva da revisão de mp-1. Nesta function a credencial é usada DUAS
// vezes na mesma requisição: o `segredoWebhook` valida o HMAC e o `token`
// consulta o pagamento no MP. Resolver duas vezes custaria um SELECT extra
// em app_settings e um AES-GCM extra por notificação — e o MP reenvia a
// mesma notificação várias vezes —, mas o caro não é o custo: entre as duas
// resoluções o registro pode MUDAR (o lojista salvando a chave nova na tela
// de Ajustes). O webhook validaria a assinatura com o segredo velho e
// consultaria o MP com o token novo, ou o contrário; o diagnóstico disso em
// produção é impossível. MP-W7 prende a resolução única — e falharia na
// hora em que alguém movesse `resolverCredenciaisMp` para dentro do trecho
// que consulta o MP, que é a refatoração "óbvia" que quebra isto.

Deno.test("MP-W7 — notificação processada do começo ao fim resolve as credenciais UMA vez (um só SELECT em app_settings)", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasRpc: [] };
    const tabelas: string[] = [];
    const supabase = contandoFrom(
      clienteFalso({
        rpcResultado: "pago",
        pedido: pedidoDeTeste(),
        registro,
        registroMp: await registroMpDeTeste(),
      }),
      tabelas,
    );
    // Assinada com o segredo DO LOJISTA: o HMAC e a consulta ao MP têm de
    // sair da MESMA resolução, senão o caminho nem chega ao fim.
    const req = await requisicaoAssinada("999", { segredo: SEGREDO_WEBHOOK_LOJISTA });
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "approved",
      external_reference: UUID_PEDIDO,
      transaction_amount: 149.9,
    });

    const resposta = await handler(req, { supabase, fetchImpl });

    // O caminho completo: HMAC validado, MP consultado, RPC chamada.
    assertEquals(resposta.status, 200);
    assertEquals(registro.chamadasRpc.length, 1);
    assertEquals(capturado.chamadas, 1);
    assertEquals(capturado.autorizacoes[0], `Bearer ${TOKEN_LOJISTA_FALSO}`);
    // E UMA leitura de app_settings, não duas.
    assertEquals(
      tabelas.filter((tabela) => tabela === "app_settings").length,
      1,
      "as credenciais têm de ser resolvidas uma vez só e reaproveitadas pelo HMAC e pela consulta ao MP",
    );
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

// ═══ Fase 3.5 (26/09/2026): recusa de CARTÃO libera a vaga, nunca cancela ════
//
// O ramo 'recusado' de `confirmar_pagamento` CANCELA o pedido e devolve o
// estoque — certo para PIX, errado para cartão (o cliente tenta outro cartão
// ou PIX na mesma reserva). O que se prova: recusa/expiração de order de
// cartão chama `liberar_cobranca_do_pedido` com o `order.id` da resposta
// AUTENTICADA, e NUNCA `confirmar_pagamento`; o PIX segue como era; a rota
// `payment` descarta a recusa de cobrança da Orders API.

const ID_ORDER_CARTAO_MP = "ORDCARTAO1KZZ4D94WC79335A68CZ5N";

function orderDoMp(status: string, statusDetail: string, tipo: string): Record<string, unknown> {
  return {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status,
    status_detail: statusDetail,
    total_amount: "149.90",
    transactions: {
      payments: [
        {
          id: "PAY01CARTAO",
          status,
          status_detail: statusDetail,
          payment_method: { id: tipo === "bank_transfer" ? "pix" : "master", type: tipo },
        },
      ],
    },
  };
}

function ambienteDoWebhook() {
  Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO);
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
}

for (
  const caso of [
    { nome: "crédito recusado (failed:rejected_by_issuer)", status: "failed", detalhe: "rejected_by_issuer", tipo: "credit_card" },
    { nome: "crédito recusado (failed:failed)", status: "failed", detalhe: "failed", tipo: "credit_card" },
    { nome: "débito cancelado", status: "canceled", detalhe: "canceled", tipo: "debit_card" },
    { nome: "crédito expirado (3DS abandonado)", status: "expired", detalhe: "expired", tipo: "credit_card" },
  ]
) {
  Deno.test(`cartão — order ${caso.nome} -> liberar_cobranca_do_pedido(order do MP), NUNCA confirmar_pagamento; 200 'cobranca_liberada'`, async () => {
    ambienteDoWebhook();
    const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasFrom: [] };
    const supabase = clienteFalso({ rpcResultado: "recusado", pedido: { id: UUID_PEDIDO, total: 149.9 }, registro });
    const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
    const chamadasPush: unknown[] = [];

    const resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp(caso.status, caso.detalhe, caso.tipo)),
      enviarPush: async (a: unknown) => {
        chamadasPush.push(a);
      },
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo, { ok: true, resultado: "cobranca_liberada" });
    assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento cancelaria o pedido");
    assertEquals(registro.chamadasLiberar.length, 1);
    // p_order_id da RESPOSTA do MP (external_reference) e p_gateway_payment_id
    // = order.id do MP — nunca o data.id do corpo (ID_ORDER_TESTE).
    assertEquals(registro.chamadasLiberar[0].args, {
      p_order_id: UUID_PEDIDO,
      p_gateway_payment_id: ID_ORDER_CARTAO_MP,
    });
    assertEquals(chamadasPush.length, 0);
    // Nem a leitura do pedido para conferência acontece: nada a conferir.
    assertEquals(registro.chamadasFrom.length, 0);
  });
}

// ── Frente 9 (29/09/2026): recusa ilegível sob SENTINELA ───────────────────
// O hardening do metodo_online cobre credito/debito, mas o sentinela DEIXA
// metodo_online NULL por desenho (fechamento S3) — recusa de cartão com tipo
// ilegível no corpo caía no caminho de PIX: confirmar_pagamento('recusado')
// CANCELA o pedido e devolve o estoque com o cliente na tela de retry (venda
// perdida). Sentinela é mecanismo EXCLUSIVO do cartão: vaga sentinela +
// método desconhecido ⇒ cartão, liberar em vez de cancelar.

Deno.test("cartão — recusa com tipo ILEGÍVEL no corpo + vaga SENTINELA + metodo_online NULL -> liberar_cobranca_do_pedido (nunca cancelar o pedido: venda perdida)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const pedidoSobSentinela = {
    id: UUID_PEDIDO,
    total: 149.9,
    // Sentinela do cartão (Achado B2): metodo_online fica NULL por desenho.
    gateway_payment_id: `verificando:${UUID_PEDIDO}:c0:1790000000000`,
    metodo_online: null,
  };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: pedidoSobSentinela,
    registro,
    // Fidelidade (revisão da frente 9, 29/09): a RPC REAL devolve false aqui
    // — a vaga guarda o SENTINELA, e p_gateway_payment_id é o id da order
    // RECUSADA (WHERE da migration 20261176000000 não bate). A resposta de
    // produção é 'nada_a_liberar' (o pedido NÃO morre; o sentinela é solto
    // pelo resolverVagaEmVerificacao no retry do cliente).
    liberarResultado: false,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  // Corpo SEM transactions: orderEhDeCartao não decide — é o cenário do
  // hardening (resposta incompleta, nunca medida contra a API real).
  const orderIlegivel = {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status: "failed",
    status_detail: "rejected_by_issuer",
    total_amount: "149.90",
  };

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderIlegivel),
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento('recusado') cancelaria o pedido e devolveria o estoque — venda perdida");
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
});

Deno.test("fronteira — recusa ilegível + metodo_online NULL + vaga VAZIA (sem sentinela): caminho de PIX permanece (PIX recusado é final; cartão nunca deixa vaga vazia)", async () => {
  // Prende a DELIMITAÇÃO do fix: só a vaga SENTINELA (mecanismo exclusivo do
  // cartão) decide cartão quando nada mais é legível. Vaga NULL + método
  // NULL é o PIX de resposta perdida — confirmar_pagamento('recusado')
  // segue sendo o desfecho certo (spec: recusado é final só para PIX).
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const pedidoSemVaga = {
    id: UUID_PEDIDO,
    total: 149.9,
    gateway_payment_id: null,
    metodo_online: null,
  };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: pedidoSemVaga,
    registro,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const orderIlegivel = {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status: "failed",
    status_detail: "rejected_by_issuer",
    total_amount: "149.90",
  };

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderIlegivel),
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasLiberar.length, 0);
});

Deno.test("cartão — reenvio da MESMA recusa (vaga já solta, RPC devolve false) -> 200 'nada_a_liberar', ainda sem confirmar_pagamento", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ liberarResultado: false, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("failed", "high_risk", "credit_card")),
  });

  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(registro.chamadasLiberar.length, 1);
});

// Achado S1 (3ª revisão de risco, 26/09/2026, W5 do harness do 3º revisor):
// a recusa desta order (ambígua — nasceu de um retry cuja PRIMEIRA order
// ficou com a resposta perdida) não bate com o que está NA VAGA: a vaga
// guarda o SENTINELA (`verificando:...`) que `criar-pagamento` gravou no 409
// `idempotency_key_already_used`, não o id desta order. Sem o fallback, a
// 1ª tentativa de liberar (pelo id do MP) sempre falha, e NADA solta a vaga
// — o pedido fica preso até a reserva morrer, mesmo com a recusa JÁ
// CONHECIDA e NENHUMA cobrança aprovada existindo.
//
// Ponto 2 (4ª revisão de risco, 26/09/2026) amarrou este fallback a uma
// BUSCA (`buscarOrdersDoPedido`/`resolverSentinela`) — o `fetchImpl` deste
// teste agora discrimina a URL da busca (`/v1/orders?...`) da reconsulta por
// id (`/v1/orders/{id}`) e devolve a MESMA order recusada nas duas: a busca
// confirma que é a ÚNICA order de cartão do pedido e que está morta, então
// o fallback ainda libera — a prova que este teste sempre fez continua de
// pé, só que agora por FATO, não por confiar cegamente em QUALQUER
// sentinela achado na vaga.
Deno.test("cartão — Achado S1 (W5): recusa de order AMBÍGUA sobre um pedido com o SENTINELA na vaga -> a 1ª tentativa de liberar (pelo id do MP) não bate, a BUSCA confirma que está morta, o FALLBACK libera pela chave do sentinela", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  // B1 (5ª revisão de risco, 26/09/2026): o sentinela leva o LIMITE INFERIOR
  // embutido — aqui, "5 min atrás", para a order recusada (criada "agora")
  // cair dentro da janela.
  const sentinela = montarSentinela(`${UUID_PEDIDO}:c0`, Date.now() - 5 * 60_000);
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinela };
  // 1ª chamada (pelo id do MP, ID_ORDER_CARTAO_MP): não bate com o
  // sentinela -> false. 2ª chamada (o fallback, pela chave do sentinela) ->
  // true.
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false, true] });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const ordemRecusada = {
    ...orderDoMp("failed", "cc_rejected_other_reason", "credit_card"),
    date_created: new Date().toISOString(),
  };
  const fetchImpl = async (url: string) =>
    url.includes("/v1/orders?")
      ? new Response(JSON.stringify({ results: [ordemRecusada] }), { status: 200 })
      : new Response(JSON.stringify(ordemRecusada), { status: 200 });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // A prova que importa: antes desta correção, a resposta era sempre
  // 'nada_a_liberar' — a vaga nunca soltava.
  assertEquals(corpo, { ok: true, resultado: "cobranca_liberada" });
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento cancelaria o pedido");
  assertEquals(registro.chamadasLiberar.length, 2);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
  assertEquals(registro.chamadasLiberar[1].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: sentinela,
  });
});

// Revisão de risco de 30/09/2026 (3ª rodada, MENOR 1): o MESMO cenário do
// S1, mas o sentinela é de uma tentativa ANTERIOR (`c0` com a tentativa já
// em 2). A busca só enxerga a order MORTA de uma tentativa posterior; a
// `c0` ambígua pode ainda não estar indexada — soltar a vaga abriria um
// cartão novo (chave `c2`) ao lado dela. O fallback NÃO solta.
Deno.test("cartão — recusa com o sentinela de uma tentativa ANTERIOR na vaga -> a busca manda liberar, mas o fallback NÃO solta (chave diverge da tentativa atual)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const sentinela = montarSentinela(`${UUID_PEDIDO}:c0`, Date.now() - 5 * 60_000);
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinela, tentativas_de_pagamento: 2 };
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false, true] });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const ordemRecusada = {
    ...orderDoMp("failed", "cc_rejected_other_reason", "credit_card"),
    date_created: new Date().toISOString(),
  };
  const fetchImpl = async (url: string) =>
    url.includes("/v1/orders?")
      ? new Response(JSON.stringify({ results: [ordemRecusada] }), { status: 200 })
      : new Response(JSON.stringify(ordemRecusada), { status: 200 });

  const console_warn = console.warn;
  console.warn = () => {};
  let corpo: unknown;
  try {
    const resposta = await handler(req, { supabase, fetchImpl });
    assertEquals(resposta.status, 200);
    corpo = await resposta.json();
  } finally {
    console.warn = console_warn;
  }

  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasRpc.length, 0);
  // Só a 1ª tentativa (pelo id do MP) — o fallback pelo sentinela não roda.
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
});

Deno.test("cartão — leitura da tentativa atual FALHA no fallback do sentinela -> NÃO solta a vaga (sem a tentativa, não dá para saber se o sentinela é da tentativa atual)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const sentinela = montarSentinela(`${UUID_PEDIDO}:c0`, Date.now() - 5 * 60_000);
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinela, tentativas_de_pagamento: 0 };
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false, true], falharLeituraDaTentativa: true });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const ordemRecusada = {
    ...orderDoMp("failed", "cc_rejected_other_reason", "credit_card"),
    date_created: new Date().toISOString(),
  };
  const fetchImpl = async (url: string) =>
    url.includes("/v1/orders?")
      ? new Response(JSON.stringify({ results: [ordemRecusada] }), { status: 200 })
      : new Response(JSON.stringify(ordemRecusada), { status: 200 });

  const console_warn = console.warn;
  const console_error = console.error;
  console.warn = () => {};
  console.error = () => {};
  let corpo: unknown;
  try {
    const resposta = await handler(req, { supabase, fetchImpl });
    assertEquals(resposta.status, 200);
    corpo = await resposta.json();
  } finally {
    console.warn = console_warn;
    console.error = console_error;
  }

  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasLiberar.length, 1);
});

// Q2 (4ª revisão de risco, 26/09/2026, harness ponta a ponta do 4º revisor):
// a recusa ATRASADA (ou reenviada) da tentativa c0 NÃO pode soltar o
// sentinela da tentativa c1 — que a busca confirma AINDA ESTAR EM ANÁLISE no
// MP. Sem a busca (o fallback antigo do Ponto 2), esta MESMA notificação
// soltaria a vaga só porque havia ALGUM sentinela nela — o cliente pedia PIX
// e, quando c1 aprovasse depois, o pedido tinha DUAS cobranças capturadas.
Deno.test("cartão — Q2: recusa ATRASADA da tentativa ANTERIOR (c0) NÃO solta o sentinela da tentativa c1 (a busca confirma que c1 segue VIVA)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const idOrderC1 = "ORDCARTAO2KZZ4D94WC79335A68CZ5N";
  const sentinelaC1 = `verificando:${UUID_PEDIDO}:c1`;
  // `tentativas_de_pagamento: 1` — o sentinela `c1` é o da tentativa ATUAL;
  // sem isto a chave atual seria `c0` e a regra da chave anterior barraria o
  // fallback antes de a busca importar (4ª revisão de risco, 30/09/2026).
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinelaC1, tentativas_de_pagamento: 1 };
  // Só UMA liberação chega a acontecer (a 1ª, pelo id do MP — que nunca bate
  // com o sentinela) — o fallback não deve tentar uma 2ª vez.
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false] });
  const req = await requisicaoAssinada(ID_ORDER_CARTAO_MP, { corpoExtra: { type: "order" } });
  const ordemC0Recusada = orderDoMp("failed", "cc_rejected_other_reason", "credit_card");
  const ordemC1Viva = { ...orderDoMp("processing", "in_process", "credit_card"), id: idOrderC1 };
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/orders?")) {
      return new Response(JSON.stringify({ results: [ordemC0Recusada, ordemC1Viva] }), { status: 200 });
    }
    return new Response(JSON.stringify(ordemC0Recusada), { status: 200 });
  };

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  // A prova que importa: com o fallback antigo, isto seria 'cobranca_liberada'
  // só por existir ALGUM sentinela na vaga — Q2 reproduzido. Com a busca,
  // c1 aparece VIVA e o sentinela fica intacto.
  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento cancelaria o pedido");
  assertEquals(
    registro.chamadasLiberar.length,
    1,
    "só a 1ª tentativa (pelo id do MP) — o fallback NÃO chama a RPC de novo sem a busca confirmar que TODAS as orders de cartão estão mortas",
  );
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
});

// Q2b (4ª revisão de risco, 26/09/2026, harness ponta a ponta do 4º revisor):
// o cancelamento ATRASADO de um PIX ANTIGO (troca PIX→cartão, ramo (c) de
// `criar-pagamento`) também soltava o sentinela de uma tentativa de CARTÃO
// seguinte no fallback antigo — `recusaLiberaAVaga` cobre CANCELAMENTO de
// qualquer tipo, não só cartão. O mínimo do Ponto 2 ignora, neste fallback,
// toda notificação que não seja de cartão — sem precisar de rede nenhuma
// (a busca nem chega a ser chamada).
Deno.test("cartão — Q2b: cancelamento ATRASADO de um PIX ANTIGO (troca PIX→cartão) NÃO solta o sentinela de uma tentativa de cartão seguinte — nem tenta a busca (notificação não é de cartão)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const sentinelaC1 = `verificando:${UUID_PEDIDO}:c1`;
  // `tentativas_de_pagamento: 1` — o sentinela `c1` é o da tentativa ATUAL;
  // sem isto a chave atual seria `c0` e a regra da chave anterior barraria o
  // fallback antes de a busca importar (4ª revisão de risco, 30/09/2026).
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinelaC1, tentativas_de_pagamento: 1 };
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false] });
  const idPixAntigo = "ORDPIXANTIGO1KZZ4D94WC79335A6";
  const req = await requisicaoAssinada(idPixAntigo, { corpoExtra: { type: "order" } });
  const pixCancelado = {
    id: idPixAntigo,
    external_reference: UUID_PEDIDO,
    status: "canceled",
    status_detail: "canceled",
    total_amount: "149.90",
    transactions: {
      payments: [{
        id: "PAYPIXANTIGO",
        status: "canceled",
        status_detail: "canceled",
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
    },
  };
  let chamouBusca = false;
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/orders?")) {
      chamouBusca = true;
      throw new Error("a busca nunca deveria ser chamada para uma notificação que não é de cartão");
    }
    return new Response(JSON.stringify(pixCancelado), { status: 200 });
  };

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(chamouBusca, false, "mínimo do Ponto 2: notificação que não é de cartão nem tenta a busca");
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: idPixAntigo,
  });
});

// Q3-webhook (B1, 5ª revisão de risco, 26/09/2026; relógio REALISTA — BLOQUEIO
// da 7ª rodada, 26/09/2026): a MESMA lista PARCIAL do cenário Q3
// (`criar-pagamento/index_test.ts`) — só a order MORTA de uma tentativa
// ANTERIOR (c0) está indexada; a da tentativa ATUAL (c1, ainda em análise no
// MP) não apareceu ainda — mas chegando pelo FALLBACK do webhook (a recusa
// atrasada da PRÓPRIA c0). Antes de B1, "todas as orders ENCONTRADAS estão
// mortas" bastava para o fallback soltar a vaga — `cobranca_liberada` —
// mesmo a lista sendo incompleta. c0 é criada só ~1s ANTES do limite —o caso
// REAL: é a MORTE de c0 que causa a liberação que fixa o limite. Uma margem
// de 10 minutos (como a 6ª rodada testava) nunca reproduz o bug — só uma
// margem de segundos, o BLOQUEIO que a 7ª rodada mediu (R6-Q3-webhook).
Deno.test("cartão — Q3-webhook (B1): recusa ATRASADA de c0 (criada ~1s ANTES do limite) chega pelo fallback, mas a busca só mostra c0 -> 'nada_a_liberar', sentinela de c1 intacto", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const limiteInferiorC1Ms = Date.now();
  const sentinelaC1 = montarSentinela(`${UUID_PEDIDO}:c1`, limiteInferiorC1Ms);
  // `tentativas_de_pagamento: 1` — o sentinela `c1` é o da tentativa ATUAL;
  // sem isto a chave atual seria `c0` e a regra da chave anterior barraria o
  // fallback antes de a busca importar (4ª revisão de risco, 30/09/2026).
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinelaC1, tentativas_de_pagamento: 1 };
  // Só a 1ª tentativa de liberar (pelo id do MP, que é o de c0 — nunca bate
  // com o sentinela de c1) — o fallback não deve conseguir soltar.
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false] });
  const req = await requisicaoAssinada(ID_ORDER_CARTAO_MP, { corpoExtra: { type: "order" } });
  const ordemC0RecusadaAtrasada = {
    ...orderDoMp("failed", "cc_rejected_other_reason", "credit_card"),
    // ~1s ANTES do limite inferior da tentativa c1 — o caso comum, não um
    // valor de minutos que nunca acontece de verdade.
    date_created: new Date(limiteInferiorC1Ms - 1_000).toISOString(),
  };
  const fetchImpl = async (url: string) =>
    url.includes("/v1/orders?")
      ? new Response(JSON.stringify({ results: [ordemC0RecusadaAtrasada] }), { status: 200 })
      : new Response(JSON.stringify(ordemC0RecusadaAtrasada), { status: 200 });

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(
    corpo,
    { ok: true, resultado: "nada_a_liberar" },
    "B1 fecha Q3-webhook: a lista parcial (só c0, de fora da janela) NUNCA solta o sentinela de c1",
  );
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento cancelaria o pedido");
  assertEquals(registro.chamadasLiberar.length, 1, "só a 1ª tentativa (pelo id do MP) — o fallback não solta");
});

// Ponto 2 (4ª revisão de risco, 26/09/2026): a busca pode FALHAR (rede fora
// do ar, corpo ilegível, 5xx) — nunca libera às cegas. Mesma regra de
// segurança do Ponto 1 (`criar-pagamento/index.ts`).
Deno.test("cartão — Ponto 2: busca FALHA (500) ao tentar confirmar o sentinela -> NUNCA libera às cegas", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const sentinela = `verificando:${UUID_PEDIDO}:c0`;
  const pedido = { id: UUID_PEDIDO, total: 149.9, gateway_payment_id: sentinela };
  const supabase = clienteFalso({ pedido, registro, liberarResultados: [false] });
  const req = await requisicaoAssinada(ID_ORDER_CARTAO_MP, { corpoExtra: { type: "order" } });
  const ordemRecusada = orderDoMp("failed", "cc_rejected_other_reason", "credit_card");
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/orders?")) return new Response("erro interno", { status: 500 });
    return new Response(JSON.stringify(ordemRecusada), { status: 200 });
  };

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(corpo, { ok: true, resultado: "nada_a_liberar" });
  assertEquals(registro.chamadasLiberar.length, 1, "a busca falhou — nunca tenta a 2ª liberação");
});

// Achado N3 (3ª revisão de risco, 26/09/2026, W6 do harness do 3º revisor):
// a notificação CLÁSSICA ('payment') de 'pago'/'estornado' sobre um pedido
// cuja vaga guarda o SENTINELA reconsultava a Orders API com o próprio
// sentinela como id ("verificando:...") — que NUNCA existe como order de
// verdade — e o 500 correspondente fazia o MP reenviar a MESMA notificação
// em loop, para sempre (o sentinela não é resolvido por essa rota).
Deno.test("cartão — Achado N3 (W6): notificação clássica 'pago' sobre um pedido com o SENTINELA na vaga -> ignorado (200), NUNCA reconsulta nem 500 em loop", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const sentinela = `verificando:${UUID_PEDIDO}:c0`;
  const pedido = { id: UUID_PEDIDO, total: 149.9, total_amount: null, gateway_payment_id: sentinela };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });
  // Fetch DISCRIMINADO por URL — sem isso um stub fixo (`fetchConsulta`)
  // devolveria a MESMA resposta de sucesso para a reconsulta do sentinela,
  // escondendo o defeito real: o MP de verdade responde 400
  // `invalid_path_param` para um id que não começa com "ORD" (BLOQUEIO 3 da
  // revisão, `criar-pagamento/index.ts`) — NUNCA um 200 — e é esse 400 que
  // vira o 500 em loop que este achado fecha.
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/payments/")) {
      return new Response(
        JSON.stringify({
          id: ID_PAGAMENTO_DO_MP,
          status: "approved",
          status_detail: "accredited",
          external_reference: UUID_PEDIDO,
          transaction_amount: 149.9,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/orders/")) {
      return new Response(
        JSON.stringify({ errors: [{ code: "invalid_path_param", message: "must begin with the prefix 'ORD'" }] }),
        { status: 400 },
      );
    }
    throw new Error(`fetch inesperado no teste N3/W6: ${url}`);
  };
  const avisoReal = console.warn;
  console.warn = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl });
  } finally {
    console.warn = avisoReal;
  }
  const corpo = await resposta.json();

  // A prova que importa: antes desta correção, isto era 500 (reconsultar o
  // sentinela pela Orders API sempre bate no 400 acima) — o MP reenviaria a
  // MESMA notificação para sempre, num loop que nunca se resolve sozinho.
  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorado, "vaga em verificação");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(pedido.gateway_payment_id, sentinela, "a vaga continua intacta — quem resolve o sentinela é outra rota");
});

// --- Hardening (item não-verificável do laudo do revisor-risco, 26/09/2026)
//
// Se o GET da order de cartão vier SEM `payment_method.type` legível (a
// notificação chegou antes de a Orders API preencher o método, ou um formato
// que este repositório não previu — nunca medido contra a API real),
// `orderEhDeCartao` não reconhece cartão pela FORMA da resposta. Segundo
// sinal: `metodo_online`, que `criar-pagamento` já carimba no PRÓPRIO pedido.

function orderDoMpSemTipoLegivel(status: string, statusDetail: string): Record<string, unknown> {
  return {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status,
    status_detail: statusDetail,
    total_amount: "149.90",
    // SEM `payment_method` — a Orders API não deu para saber se é cartão ou
    // não só olhando esta resposta.
    transactions: { payments: [{ id: "PAY01SEMTIPO", status, status_detail: statusDetail }] },
  };
}

Deno.test("hardening — order recusada SEM payment_method.type legível, mas metodo_online='credito' no pedido -> ainda libera a vaga (nunca confirmar_pagamento)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: { id: UUID_PEDIDO, total: 149.9, metodo_online: "credito" },
    registro,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMpSemTipoLegivel("failed", "failed")),
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo, { ok: true, resultado: "cobranca_liberada" });
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento('recusado') cancelaria o pedido de cartão");
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
});

Deno.test("hardening — order recusada SEM payment_method.type legível, mas metodo_online='pix' no pedido -> segue confirmar_pagamento('recusado') como antes (controle negativo)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: { id: UUID_PEDIDO, total: 149.9, metodo_online: "pix" },
    registro,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMpSemTipoLegivel("failed", "failed")),
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasLiberar.length, 0);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "recusado");
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

Deno.test("Lote A R10 - recusa de order SEM payment_method.type legível e a leitura do metodo_online FALHA -> 500 (o MP reenvia), sem confirmar_pagamento nem liberar", async () => {
  // A leitura com erro era ignorada: `metodoRow` vinha null, o pedido de
  // CARTÃO parecia PIX, e confirmar_pagamento('recusado') CANCELAVA o pedido
  // e devolvia o estoque com o cliente ainda na tela do cartão.
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: { id: UUID_PEDIDO, total: 149.9, metodo_online: "credito" },
    registro,
    falharLeituraDoMetodo: true,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMpSemTipoLegivel("failed", "failed")),
    });
  } finally {
    console.error = erroReal;
  }

  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento('recusado') cancelaria um pedido de cartão");
  assertEquals(registro.chamadasLiberar.length, 0);
});

Deno.test("cartão — liberar_cobranca_do_pedido com erro de banco -> 500 (o MP reenvia), sem confirmar_pagamento", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ liberarErro: { message: "deadlock" }, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp("failed", "failed", "credit_card")),
    });
  } finally {
    console.error = erroReal;
  }

  assertEquals(resposta.status, 500);
  assertEquals(registro.chamadasRpc.length, 0);
});

Deno.test("cartão — recusa com external_reference sem forma de UUID -> 200 ignorado, NENHUMA rpc (nem liberar)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const order = { ...orderDoMp("failed", "failed", "credit_card"), external_reference: "nao-e-uuid" };
  const avisoReal = console.warn;
  console.warn = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, order) });
  } finally {
    console.warn = avisoReal;
  }

  assertEquals(resposta.status, 200);
  assertEquals((await resposta.json()).ignorado, "external_reference inválido");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(registro.chamadasLiberar.length, 0);
});

Deno.test("cartão — aprovado (processed:accredited) continua indo para confirmar_pagamento('pago') — a regra nova é só da recusa", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({
    rpcResultado: "pago",
    pedido: { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null },
    registro,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
    enviarPush: async () => {},
    enviarComprovante: async () => {},
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasLiberar.length, 0);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

// --- Achado B2 (2ª revisão de risco, 26/09/2026) — ADOÇÃO da vaga vazia -----
//
// `criar-pagamento` pode ter deixado a vaga VAZIA (nada foi gravado — a
// resposta do MP se perdeu antes do UPDATE) ou com um SENTINELA
// "verificando:..." (409 `idempotency_key_already_used` num retry com token
// novo). Quando ESTA notificação diz que a cobrança foi aprovada, o webhook
// tem que ADOTAR a vaga antes de confirmar — senão `confirmar_pagamento`
// nunca encontra o `gateway_payment_id` que precisa para bater a guarda (d).

Deno.test("cartão — order aprovada com a vaga VAZIA (NULL) -> ADOTA (grava o id) e SÓ ENTÃO confirma 'pago' (Achado B2)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [] };
  const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null, gateway_payment_id: null };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
    enviarPush: async () => {},
    enviarComprovante: async () => {},
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasUpdateMarketplaceOrders.length, 1);
  assertEquals(registro.chamadasUpdateMarketplaceOrders[0].valores.gateway_payment_id, ID_ORDER_CARTAO_MP);
  assertEquals(pedido.gateway_payment_id, ID_ORDER_CARTAO_MP, "a vaga foi ADOTADA antes de confirmar");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

Deno.test("cartão — order aprovada com a vaga em SENTINELA ('verificando:...') -> ADOTA e confirma 'pago' (Achado B2)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: `verificando:${UUID_PEDIDO}:c0`,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
    enviarPush: async () => {},
    enviarComprovante: async () => {},
  });

  assertEquals(resposta.status, 200);
  assertEquals(pedido.gateway_payment_id, ID_ORDER_CARTAO_MP);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "pago");
});

Deno.test("cartão — order aprovada, mas a vaga JÁ TEM outra cobrança de verdade -> NÃO adota, avisa o admin ('cartao_divergente'), RPC decide 'divergente'", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: "ORDTST01OUTRACOBRANCAJAGRAVADA",
  };
  // `confirmar_pagamento` real recusaria com 'divergente' (id não bate) — o
  // dublê espelha isso explicitamente.
  const supabase = clienteFalso({ rpcResultado: "divergente", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const chamadasPush: unknown[] = [];
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
      // C-P: o aviso de cobrança duplicada sai pelo push CONTADO.
      enviarPushContado: (a: unknown) => {
        chamadasPush.push(a);
        return Promise.resolve(1);
      },
      enviarComprovante: async () => {},
    });
  } finally {
    console.error = erroReal;
  }

  assertEquals(resposta.status, 200);
  // A prova que importa: a vaga da cobrança REAL nunca é sobrescrita.
  assertEquals(pedido.gateway_payment_id, "ORDTST01OUTRACOBRANCAJAGRAVADA");
  assertEquals(registro.chamadasUpdateMarketplaceOrders.length, 0);
  assertEquals(chamadasPush.length, 1, "o admin precisa ser avisado de uma possível cobrança duplicada");
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

// Achado S3 (3ª revisão de risco, 26/09/2026, W3 do harness do 3º revisor):
// a ADOÇÃO só gravava `gateway_payment_id` — `metodo_online`/`parcelas`
// ficavam NULL mesmo para uma cobrança de CARTÃO de verdade, e o
// comprovante ao cliente ("PIX pelo site") e o Financeiro (fin__forma_do_
// pedido) contavam a venda como PIX.
Deno.test("cartão — Achado S3 (W3): ADOÇÃO da vaga vazia também grava metodo_online/parcelas, lidos da order RECONSULTADA — nunca do corpo do webhook", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [] };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: null,
    metodo_online: null,
    parcelas: null,
  };
  const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const ordemAprovada = {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    transactions: {
      payments: [{
        id: "PAY01CARTAO",
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "master", type: "credit_card", installments: 6 },
      }],
    },
  };

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, ordemAprovada),
    enviarPush: async () => {},
    enviarComprovante: async () => {},
  });

  assertEquals(resposta.status, 200);
  assertEquals(pedido.gateway_payment_id, ID_ORDER_CARTAO_MP);
  // A prova que importa: antes desta correção os dois ficavam `null` — o
  // comprovante saía como "PIX pelo site" para um cartão de crédito 6x.
  assertEquals(pedido.metodo_online, "credito");
  assertEquals(pedido.parcelas, 6);
  assertEquals(registro.chamadasUpdateMarketplaceOrders[0].valores.metodo_online, "credito");
  assertEquals(registro.chamadasUpdateMarketplaceOrders[0].valores.parcelas, 6);
});

// Achado S5 (3ª revisão de risco, 26/09/2026, W4 do harness do 3º revisor):
// a ADOÇÃO pode perder a corrida para OUTRA escrita (não a `confirmar_
// pagamento` desta MESMA order — essa a RPC decide sozinha) — por exemplo,
// `criar-pagamento` gravando um PIX na MESMA janela em que o webhook leu a
// vaga NULL. Sem reler depois de perder a corrida, o pedido seguia com
// dinheiro de DUAS cobranças aprovadas (o cartão desta notificação e o PIX,
// se o cliente pagar os dois) e ZERO aviso ao admin.
Deno.test("cartão — Achado S5 (W4): a ADOÇÃO perde a corrida para um PIX gravado ENTRE a leitura e o UPDATE -> avisa o admin (antes: zero push)", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [] };
  const idPixConcorrente = "ORDTST01PIXCONCORRENTE000000";
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: null,
  };
  const supabase = clienteFalso({
    rpcResultado: "divergente",
    pedido,
    registro,
    // A corrida: a MESMA leitura que decide "vaga adotável" (vazia) dispara
    // a mutação — por quando a adoção tentar o `.update(...).is(
    // "gateway_payment_id", null)`, a vaga já não é mais NULL.
    aposLeituraDoPedido: (p) => {
      p.gateway_payment_id = idPixConcorrente;
    },
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const chamadasPush: unknown[] = [];
  const erroReal = console.error;
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
      // C-P: o aviso de cobrança duplicada sai pelo push CONTADO.
      enviarPushContado: (a: unknown) => {
        chamadasPush.push(a);
        return Promise.resolve(1);
      },
      enviarComprovante: async () => {},
    });
  } finally {
    console.error = erroReal;
  }

  assertEquals(resposta.status, 200);
  // A adoção perdeu a corrida — a vaga do PIX concorrente nunca é
  // sobrescrita pela adoção.
  assertEquals(pedido.gateway_payment_id, idPixConcorrente);
  assertEquals(registro.chamadasUpdateMarketplaceOrders.length, 0);
  // A prova que importa: antes desta correção, `chamadasPush.length` era 0
  // aqui — o admin nunca soube de duas cobranças aprovadas disputando o
  // mesmo pedido.
  assertEquals(chamadasPush.length, 1, "o admin precisa ser avisado — a vaga tem OUTRA cobrança real, não um sentinela");
});

// C-P (02/10/2026, W7 do harness PGlite): o push "Cobrança de cartão
// duplicada?" saía a cada ENTREGA do MP (uma notificação por atualização da
// order + reenvios; o handler relê o estado ATUAL). Agora reserva
// `cartao_divergente:<pedido>:<order>` com PRAZO antes de avisar, confirma só
// se o push CHEGOU a alguém e libera se não chegou — e avisa mesmo assim se a
// reserva FALHAR (falha aberta). O prazo de 2 minutos é SQL (provado à parte).
const VAGA_OUTRA_COBRANCA = "ORDTST01OUTRACOBRANCAJAGRAVADA";
const CHAVE_DIVERGENTE = `cartao_divergente:${UUID_PEDIDO}:${ID_ORDER_CARTAO_MP}`;

async function entregarOrderDivergente(opts: {
  avisos: Map<string, { enviado: boolean }>;
  reservaFalha?: "erro" | "lanca" | "nulo" | "desconhecido";
  reservaRespostas?: Array<string | Error>;
  order?: Record<string, unknown>;
  corrida?: boolean;
  // o que o push CONTADO devolve: número de inscrições, ou "lanca"
  entrega?: number | "lanca";
}) {
  ambienteDoWebhook();
  const registro = {
    chamadasRpc: [],
    chamadasLiberar: [],
    chamadasUpdateMarketplaceOrders: [],
    chamadasReservar: [] as Array<{ args: Record<string, unknown> }>,
    chamadasAviso: [] as Array<{ nome: string; args: Record<string, unknown> }>,
  };
  const pedido = {
    id: UUID_PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: opts.corrida ? null : VAGA_OUTRA_COBRANCA,
  };
  const supabase = clienteFalso({
    rpcResultado: "divergente",
    pedido,
    registro,
    avisos: opts.avisos,
    reservaFalha: opts.reservaFalha,
    reservaRespostas: opts.reservaRespostas,
    aposLeituraDoPedido: opts.corrida
      ? (p) => {
        p.gateway_payment_id = VAGA_OUTRA_COBRANCA;
      }
      : undefined,
  });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const pushes: Array<{ title: string }> = [];
  const erros: string[] = [];
  const dormidas: number[] = [];
  const [erroReal, avisoReal] = [console.error, console.warn];
  console.error = (...a: unknown[]) => erros.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.warn = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, opts.order ?? orderDoMp("processed", "accredited", "credit_card")),
      enviarPushContado: ({ aviso }: { aviso: { title: string } }) => {
        pushes.push(aviso);
        if (opts.entrega === "lanca") return Promise.reject(new Error("web push fora do ar (dublê)"));
        return Promise.resolve(opts.entrega ?? 1);
      },
      // Rodada 3: a espera da reconsulta é injetada (nada de 8 s reais).
      dormir: (ms: number) => {
        dormidas.push(ms);
        return Promise.resolve();
      },
      enviarComprovante: async () => {},
    });
  } finally {
    console.error = erroReal;
    console.warn = avisoReal;
  }
  const avisoRpcs = registro.chamadasAviso.map((c) => c.nome.replace("_aviso_ao_lojista", ""));
  return { status: resposta.status, pushes, registro, erros, pedido, avisoRpcs, dormidas };
}

Deno.test("C-P (a) — 3 entregas com push ENTREGUE -> 1 push, confirmado; o log de cartao_divergente sai nas 3; a RPC decide 'divergente' nas 3", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const rodadas = [];
  for (let i = 0; i < 3; i++) rodadas.push(await entregarOrderDivergente({ avisos }));
  assertEquals(rodadas.map((r) => r.status), [200, 200, 200]);
  assertEquals(rodadas.map((r) => r.pushes.length), [1, 0, 0]);
  assertEquals(rodadas[0].pushes[0].title, "Cobrança de cartão duplicada?");
  assertEquals(rodadas.map((r) => r.avisoRpcs), [["reservar", "confirmar"], ["reservar"], ["reservar"]]);
  assertEquals(rodadas[0].registro.chamadasAviso.map((c) => c.args), [{ p_chave: CHAVE_DIVERGENTE }, { p_chave: CHAVE_DIVERGENTE }]);
  assertEquals([...avisos.entries()], [[CHAVE_DIVERGENTE, { enviado: true }]]);
  for (const r of rodadas) {
    assert(r.erros.some((e) => e.includes("cartao_divergente")), "o console.error do cartao_divergente continua em toda entrega");
    assertEquals(r.registro.chamadasRpc.map((c) => c.args.p_payment_id), [ID_ORDER_CARTAO_MP]);
    assertEquals(r.pedido.gateway_payment_id, VAGA_OUTRA_COBRANCA);
  }
});

for (const entrega of [0, "lanca"] as const) {
  Deno.test(`C-P (b) — push que NÃO CHEGA (${entrega === 0 ? "0 inscrições entregues" : "lança"}): libera a reserva; a PRÓXIMA entrega avisa de novo e confirma`, async () => {
    const avisos = new Map<string, { enviado: boolean }>();
    const r1 = await entregarOrderDivergente({ avisos, entrega });
    assertEquals([r1.status, r1.pushes.length], [200, 1]);
    assertEquals(r1.avisoRpcs, ["reservar", "liberar"]);
    assertEquals(avisos.size, 0, "reserva liberada");
    const r2 = await entregarOrderDivergente({ avisos });
    assertEquals([r2.pushes.length, r2.avisoRpcs], [1, ["reservar", "confirmar"]]);
    const r3 = await entregarOrderDivergente({ avisos });
    assertEquals(r3.pushes.length, 0);
  });
}

for (const falha of ["erro", "lanca", "nulo", "desconhecido"] as const) {
  const rotulo = new Map([
    ["erro", "com ERRO"],
    ["lanca", "que LANÇA"],
    ["nulo", "com retorno NULO"],
    ["desconhecido", "com valor DESCONHECIDO (true)"],
  ]).get(falha);
  Deno.test(`C-P (d) — reserva ${rotulo}: avisa em TODA entrega (falha aberta), 200, sem confirmar/liberar vaga que não é dela`, async () => {
    const avisos = new Map<string, { enviado: boolean }>();
    const rodadas = [];
    for (let i = 0; i < 2; i++) rodadas.push(await entregarOrderDivergente({ avisos, reservaFalha: falha }));
    assertEquals(rodadas.map((r) => [r.status, r.pushes.length]), [[200, 1], [200, 1]]);
    assertEquals(rodadas.map((r) => r.avisoRpcs), [["reservar"], ["reservar"]]);
    assert(rodadas[0].erros.some((e) => e.includes("reservar_aviso_ao_lojista falhou")), rodadas[0].erros.join("\n"));
  });
}

// Rodada 3 (02/10/2026): a corrida A/B — quem encontra 'em_envio' espera o
// RESULTADO da dona reconsultando (pausas 1 s, 2,5 s, 4,5 s; 8 s é a soma das
// pausas, não um prazo — as RPCs e o push somam por fora) e
// assume se ela liberou; se ela continuar enviando, 503 para o MP reentregar.
Deno.test("C-P (singleflight) — 'em_envio' e depois 'reservado' (a dona liberou): assume, faz o push, confirma, 200", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const r = await entregarOrderDivergente({ avisos, reservaRespostas: ["em_envio", "reservado"] });
  assertEquals([r.status, r.pushes.length, r.dormidas], [200, 1, [1000]]);
  assertEquals(r.avisoRpcs, ["reservar", "reservar", "confirmar"]);
  assertEquals(r.registro.chamadasRpc.length, 1, "segue para confirmar_pagamento");
});

Deno.test("C-P (singleflight) — 'em_envio', 'em_envio' e depois 'enviado' (a dona entregou): nenhum push, 200", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const r = await entregarOrderDivergente({ avisos, reservaRespostas: ["em_envio", "em_envio", "enviado"] });
  assertEquals([r.status, r.pushes.length, r.dormidas], [200, 0, [1000, 2500]]);
  assertEquals(r.avisoRpcs, ["reservar", "reservar", "reservar"]);
});

for (const ramo of ["divergente", "S5"] as const) {
  Deno.test(`C-P (singleflight, ${ramo}) — 'em_envio' até o fim da espera: 503 (o MP reentrega), 4 reservas no máximo, 8 s de pausas somadas, nenhum push, nada de confirmar_pagamento`, async () => {
    const avisos = new Map<string, { enviado: boolean }>();
    const r = await entregarOrderDivergente({
      avisos,
      corrida: ramo === "S5",
      reservaRespostas: ["em_envio", "em_envio", "em_envio", "em_envio", "em_envio", "em_envio"],
    });
    assertEquals([r.status, r.pushes.length], [503, 0]);
    assertEquals(r.avisoRpcs, ["reservar", "reservar", "reservar", "reservar"]);
    assertEquals(r.dormidas, [1000, 2500, 4500]);
    assertEquals(r.dormidas.reduce((a, b) => a + b, 0), 8000);
    assertEquals(r.registro.chamadasRpc.length, 0, "503 antes de confirmar_pagamento");
  });
}

Deno.test("C-P (singleflight) — a RECONSULTA lança: falha aberta (avisa sem confirmar/liberar), 200", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const r = await entregarOrderDivergente({ avisos, reservaRespostas: ["em_envio", new Error("rede caiu (dublê)")] });
  assertEquals([r.status, r.pushes.length, r.dormidas], [200, 1, [1000]]);
  assertEquals(r.avisoRpcs, ["reservar", "reservar"]);
});

Deno.test("C-P (singleflight) — loja SEM inscrito, A e B: A entrega 0 e libera; B ('em_envio' -> 'reservado') entrega 0 e libera; os dois 200, nenhum não-2xx", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const a = await entregarOrderDivergente({ avisos, entrega: 0 });
  const b = await entregarOrderDivergente({ avisos, entrega: 0, reservaRespostas: ["em_envio"] });
  assertEquals([a.status, b.status], [200, 200]);
  assertEquals([a.avisoRpcs, b.avisoRpcs], [["reservar", "liberar"], ["reservar", "reservar", "liberar"]]);
  assertEquals(avisos.size, 0);
});

Deno.test("C-P (e) — OUTRA order aprovada (id diferente) no mesmo pedido avisa de novo, com chave própria", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  await entregarOrderDivergente({ avisos });
  const outraOrder = { ...orderDoMp("processed", "accredited", "credit_card"), id: "ORDCARTAO2SEGUNDAAPROVADA00000" };
  const r = await entregarOrderDivergente({ avisos, order: outraOrder });
  assertEquals(r.pushes.length, 1);
  assertEquals(r.registro.chamadasReservar[0].args.p_chave, `cartao_divergente:${UUID_PEDIDO}:ORDCARTAO2SEGUNDAAPROVADA00000`);
  assertEquals([...avisos.keys()].sort(), [CHAVE_DIVERGENTE, `cartao_divergente:${UUID_PEDIDO}:ORDCARTAO2SEGUNDAAPROVADA00000`].sort());
});

Deno.test("C-P — ramo S5 (adoção perdeu a corrida) reserva a MESMA chave do ramo divergente: S5 e a reentrega seguinte dão 1 push", async () => {
  const avisos = new Map<string, { enviado: boolean }>();
  const s5 = await entregarOrderDivergente({ avisos, corrida: true });
  assert(s5.erros.some((e) => e.includes("perdeu a corrida da adoção")), "a 1a entrega tem de passar pelo S5");
  assertEquals(s5.registro.chamadasReservar.map((c) => c.args.p_chave), [CHAVE_DIVERGENTE]);
  assertEquals(s5.avisoRpcs, ["reservar", "confirmar"]);
  const reentrega = await entregarOrderDivergente({ avisos });
  assert(reentrega.erros.some((e) => e.includes("a vaga já tem OUTRA cobrança gravada")), "a 2a entrega tem de passar pelo ramo divergente");
  assertEquals([s5.pushes.length, reentrega.pushes.length], [1, 0]);
});

Deno.test("C-P — aprovação NORMAL (vaga vazia adotada, ou já com a própria order) nunca chama a reserva", async () => {
  for (const vaga of [null, ID_ORDER_CARTAO_MP]) {
    ambienteDoWebhook();
    const registro = {
      chamadasRpc: [],
      chamadasLiberar: [],
      chamadasUpdateMarketplaceOrders: [],
      chamadasReservar: [],
      chamadasAviso: [],
    };
    const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null, gateway_payment_id: vaga };
    const supabase = clienteFalso({ rpcResultado: "pago", pedido, registro });
    const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
    const resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")),
      enviarPush: async () => {},
      enviarComprovante: async () => {},
    });
    assertEquals(resposta.status, 200, String(vaga));
    assertEquals(registro.chamadasAviso.length, 0, String(vaga));
  }
});

Deno.test("C-P (b) — push REAL contado sem destino (nenhum admin; admin sem inscrição): 0 entregues -> libera; a próxima entrega tenta de novo", async () => {
  for (const caso of ["sem admin", "admin sem inscrição"] as const) {
    ambienteDoWebhook();
    const avisos = new Map<string, { enviado: boolean }>();
    const rodadas = [];
    for (let i = 0; i < 2; i++) {
      const registro = { chamadasRpc: [], chamadasLiberar: [], chamadasUpdateMarketplaceOrders: [], chamadasAviso: [] };
      const pedido = { id: UUID_PEDIDO, customer_name: "Maria", total: 149.9, total_amount: null, gateway_payment_id: VAGA_OUTRA_COBRANCA };
      const base = clienteFalso({ rpcResultado: "divergente", pedido, registro, avisos });
      // `disparoPushContadoReal` de verdade: lê profiles e push_subscriptions.
      const supabase = {
        ...base,
        from(tabela: string) {
          if (tabela === "profiles") {
            return { select: () => ({ eq: () => Promise.resolve({ data: caso === "sem admin" ? [] : [{ id: "adm-1" }], error: null }) }) };
          }
          if (tabela === "push_subscriptions") {
            return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
          }
          return base.from(tabela);
        },
      };
      const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
      const [erroReal, avisoReal, logReal] = [console.error, console.warn, console.log];
      console.error = () => {};
      console.warn = () => {};
      console.log = () => {};
      try {
        const resposta = await handler(req, { supabase, fetchImpl: fetchConsulta(200, orderDoMp("processed", "accredited", "credit_card")) });
        assertEquals(resposta.status, 200, caso);
      } finally {
        [console.error, console.warn, console.log] = [erroReal, avisoReal, logReal];
      }
      rodadas.push(registro.chamadasAviso.map((c) => c.nome));
    }
    assertEquals(rodadas, [
      ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"],
      ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"],
    ], caso);
    assertEquals(avisos.size, 0, caso);
  }
});

Deno.test("PIX — order recusada (failed, bank_transfer) continua em confirmar_pagamento('recusado') — comportamento de antes", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ rpcResultado: "recusado", pedido: { id: UUID_PEDIDO, total: 149.9 }, registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("failed", "failed", "bank_transfer")),
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasLiberar.length, 0);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "recusado");
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

Deno.test("PIX — order expirada (bank_transfer) continua 'order expirada' sem RPC nenhuma — comportamento de antes", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });
  const avisoReal = console.warn;
  console.warn = () => {};
  let resposta: Response;
  try {
    resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, orderDoMp("expired", "expired", "bank_transfer")),
    });
  } finally {
    console.warn = avisoReal;
  }

  assertEquals(resposta.status, 200);
  assertEquals((await resposta.json()).ignorado, "order expirada");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(registro.chamadasLiberar.length, 0);
});

Deno.test("PIX — order CANCELADA (a troca PIX -> cartão da criar-pagamento) só libera a vaga: a notificação que chega antes da própria criar-pagamento liberar não pode matar o pedido", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({ rpcResultado: "recusado", registro });
  const req = await requisicaoAssinada(ID_ORDER_TESTE, { corpoExtra: { type: "order" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, orderDoMp("canceled", "canceled", "bank_transfer")),
  });

  assertEquals(resposta.status, 200);
  assertEquals((await resposta.json()).resultado, "cobranca_liberada");
  assertEquals(registro.chamadasRpc.length, 0);
  assertEquals(registro.chamadasLiberar[0].args, {
    p_order_id: UUID_PEDIDO,
    p_gateway_payment_id: ID_ORDER_CARTAO_MP,
  });
});

for (
  const caso of [
    { nome: "id da Orders API (ORD…)", gravado: ID_GRAVADO_NO_BANCO },
    { nome: "vaga vazia (null)", gravado: null },
    { nome: "vaga vazia (string vazia)", gravado: "" },
  ]
) {
  Deno.test(`rota payment — pagamento RECUSADO com gateway_payment_id gravado = ${caso.nome} -> 200 ignorado, NENHUMA rpc (a rota order decide)`, async () => {
    ambienteDoWebhook();
    const registro = { chamadasRpc: [], chamadasLiberar: [] };
    const supabase = clienteFalso({
      rpcResultado: "recusado",
      pedido: { id: UUID_PEDIDO, total: 149.9, total_amount: null, gateway_payment_id: caso.gravado },
      registro,
    });
    const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });

    const resposta = await handler(req, {
      supabase,
      fetchImpl: fetchConsulta(200, {
        id: ID_PAGAMENTO_DO_MP,
        status: "rejected",
        status_detail: "cc_rejected_other_reason",
        external_reference: UUID_PEDIDO,
        transaction_amount: 149.9,
      }),
    });

    assertEquals(resposta.status, 200);
    assertEquals((await resposta.json()).ignorado, "recusa decidida pela rota order");
    assertEquals(registro.chamadasRpc.length, 0, "confirmar_pagamento('recusado') cancelaria o pedido");
    assertEquals(registro.chamadasLiberar.length, 0);
  });
}

Deno.test("rota payment — pagamento RECUSADO com id CLÁSSICO gravado (PIX legado) continua em confirmar_pagamento('recusado') — controle negativo", async () => {
  ambienteDoWebhook();
  const registro = { chamadasRpc: [], chamadasLiberar: [] };
  const supabase = clienteFalso({
    rpcResultado: "recusado",
    pedido: { id: UUID_PEDIDO, total: 149.9, total_amount: null, gateway_payment_id: String(ID_PAGAMENTO_DO_MP) },
    registro,
  });
  const req = await requisicaoAssinada("999", { corpoExtra: { type: "payment" } });

  const resposta = await handler(req, {
    supabase,
    fetchImpl: fetchConsulta(200, {
      id: ID_PAGAMENTO_DO_MP,
      status: "rejected",
      external_reference: UUID_PEDIDO,
      transaction_amount: 149.9,
    }),
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasRpc.length, 1);
  assertEquals(registro.chamadasRpc[0].args.p_status, "recusado");
  assertEquals(registro.chamadasRpc[0].args.p_payment_id, String(ID_PAGAMENTO_DO_MP));
});
