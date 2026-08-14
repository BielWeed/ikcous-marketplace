// @ts-nocheck
/**
 * webhook-mercadopago — fecha o laço da cobrança (Fase 3, Task 4): recebe a
 * confirmação do Mercado Pago e é o ÚNICO caminho que faz um pedido virar
 * 'pago' de verdade — `criar-pagamento` (Fase 2) nunca escreve isso.
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *
 * Roda com `verify_jwt = false` (config.toml) porque o MP não manda JWT.
 * Quem autentica é o `x-signature`, validado por `validarAssinatura` — sem
 * ele, qualquer um que descubra a URL forja um "aprovado" e leva produto de
 * graça. É por isso que a checagem de assinatura vem ANTES de qualquer
 * leitura de corpo além do `data.id` (que a própria assinatura depende
 * dele) e antes de qualquer chamada ao MP ou ao banco.
 *
 * POR QUE O `p_order_id` VEM DA RESPOSTA DO MP, NÃO DO CORPO DO WEBHOOK
 *
 * O corpo só é autenticado pelo `x-signature`, que amarra o `data.id` — não
 * amarra nenhum outro campo. Um corpo forjado com a MESMA assinatura de um
 * pagamento real não existe (a assinatura barra isso), mas o corpo em si
 * nunca carrega o pedido: quem sabe a qual pedido um pagamento pertence é o
 * `external_reference` que `criarPagamento`/`consultarPagamento` leem de
 * volta da API do MP, autenticada pelo `MP_ACCESS_TOKEN`. Por isso o pedido
 * sai de `consulta.externalReference`, nunca de `body`.
 *
 * `pareceUuid` nesse valor é a segunda trava: sem forma de UUID (ausente,
 * vazio, ou pagamento criado por fora deste sistema), o Postgres recusaria o
 * cast com 22P02, a chamada rejeitaria, e o handler devolveria 500 — fazendo
 * o MP reenviar PARA SEMPRE um evento que nunca vai dar certo. Aqui isso vira
 * 200 com log, e a RPC nem é chamada.
 *
 * A RPC `confirmar_pagamento` (Task 2) É A ÚNICA ESCRITA
 *
 * Ela decide sob `FOR UPDATE` — inclusive idempotência do reenvio do MP
 * (`ja_pago`, `ja_estornado`) — e devolve só um texto. Este handler nunca
 * escreve `payment_status` diretamente: o UPDATE mora todo dentro da RPC.
 *
 * PUSH: SÓ 'pago' E 'pago_apos_expirar'
 *
 * É o retorno da RPC que decide, não o `status` que o MP mandou. `ja_pago`
 * e `ignorado` são o reenvio do MP encontrando um estado que já foi
 * tratado, e disparar push de novo a cada reenvio (o MP tenta a cada ~15
 * min até receber 200) transformaria o canal do lojista em spam.
 * `divergente` e `inexistente` NÃO entram nesse grupo: a confirmação já
 * veio aprovada pelo MP, mas não bate com nenhum pedido — dinheiro que pode
 * ter entrado sem registro. Por isso não disparam push (não haveria pedido
 * certo para avisar), mas são logados como erro, não silenciados.
 *
 * MIGRAÇÃO PARA A ORDERS API (CHECKOUT-070, Tarefa 3 de 4)
 *
 * `criar-pagamento` (Tarefa 2) já cria a cobrança PIX via `POST /v1/orders`
 * em vez do endpoint clássico (`POST /v1/payments`, que devolve 500 para
 * `payment_method_id: "pix"` desde agosto/2026). O MP notifica essa cobrança
 * com `type: "order"`, não `type: "payment"` — este handler agora reconhece
 * as duas notificações (ver `rota`, mais abaixo) para não descartar com 200
 * OK um pedido que acabou de ser pago. `reconciliar-pagamentos` (Tarefa 4)
 * segue por outro agente, em paralelo.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import {
  consultarOrder,
  consultarPagamento,
  idEhClassico,
  mapearStatus,
  mapearStatusOrder,
  validarAssinatura,
} from "../_shared/mercadopago.ts";
import {
  carregarChavesVapid,
  corsHeaders,
  enviarParaInscritos,
  readKey,
  resumir,
} from "../_shared/webpush.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tópicos (`type`) do MP conhecidos e IRRELEVANTES para pagamento — levantados
// na doc oficial (não da memória) em 14/08/2026:
// https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks
// (tabela de tópicos do painel) + https://www.mercadopago.com.mx/developers/en/docs/checkout-api-orders/notifications
// (confirma `type: "order"` como o nome real no corpo, não "orders").
// "merchant_order" (sem prefixo/sufixo) é o nome clássico/IPN do mesmo
// tópico que a doc atual lista como "topic_merchant_order_wh" — mantido
// porque é o que este handler já recebia em produção antes desta correção.
//
// Lista de propósito CURTA (ressalva de revisão, CHECKOUT-070 Tarefa 3): o
// modo de falha de um tópico irrelevante que ficou de fora é seguro e barato
// — cai no desempate por forma do id, o id é numérico, vai para
// `GET /v1/payments/{id}`, o MP devolve 404, e o handler já responde 200
// "pagamento não encontrado" (:305-307). Custa uma linha de log. Colocar
// aqui um tópico que ÀS VEZES é pagamento custaria o dinheiro da loja — por
// isso a lista só entra com o que a doc afirma, com certeza, ser outra coisa.
const TOPICOS_IRRELEVANTES = new Set([
  "merchant_order",
  "topic_merchant_order_wh",
  "subscription_authorized_payment",
  "subscription_preapproval",
  "subscription_preapproval_plan",
  "mp-connect",
  "wallet_connect",
  "stop_delivery_op_wh",
  "topic_claims_integration_wh",
  "topic_card_id_wh",
  "topic_chargebacks_wh",
  "point_integration_wh",
]);

// Copiadas de notify-new-order/index.ts (:66, :73) e o formatarBRL local
// dali (:93) — de propósito, e não importadas de lá: aquele módulo chama
// `serve()` no topo (guardado só contra o runner de teste), então importar
// dele levantaria um segundo servidor HTTP dentro desta função. Extrair as
// três para `_shared` é refatoração que a sessão principal decide, não esta
// tarefa.
export const pareceUuid = (valor: unknown): boolean => typeof valor === "string" && UUID.test(valor);

export const numeroDoPedido = (id: string): string => `#${String(id).slice(-6).toUpperCase()}`;

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarBRL(valor: unknown): string {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return "R$ 0,00";
  // \u00a0 escapado, e nao o caractere literal: NBSP cru no fonte dispara
  // no-irregular-whitespace (erro de eslint, teto zero) -- mesma razao do
  // original em notify-new-order/index.ts:96-98.
  return BRL.format(numero).replace(/\u00a0/g, " ");
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Dispara o push de "pedido pago" para os admins inscritos. Mesmo padrão de
 * `notify-new-order/index.ts:194-243`: carrega VAPID, monta o
 * `ApplicationServer`, busca os admins em `profiles` e as inscrições em
 * `push_subscriptions`, envia via `enviarParaInscritos`.
 *
 * Erros aqui NUNCA sobem: o pedido já está marcado 'pago' no banco quando
 * esta função roda, e uma falha de push não pode virar 500 — isso faria o MP
 * reenviar um evento que já foi tratado com sucesso, e reprocessar a RPC de
 * novo só para cair em 'ja_pago'. Só loga.
 */
async function disparoPushReal(args: {
  supabase: ReturnType<typeof createClient>;
  aviso: { title: string; body: string; url: string };
}): Promise<void> {
  const { supabase, aviso } = args;
  try {
    const { data: admins, error: erroAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (erroAdmins) throw erroAdmins;

    const ids = (admins ?? []).map((a: any) => a.id);
    if (ids.length === 0) {
      console.warn("webhook-mercadopago: nenhum admin cadastrado, aviso de pagamento sem destino");
      return;
    }

    const { data: inscricoes, error: erroInscricoes } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (erroInscricoes) throw erroInscricoes;

    if (!inscricoes || inscricoes.length === 0) {
      console.warn("webhook-mercadopago: nenhum admin inscrito para push");
      return;
    }

    const vapidKeys = await carregarChavesVapid(
      Deno.env.get("VAPID_PUBLIC_KEY"),
      Deno.env.get("VAPID_PRIVATE_KEY"),
    );
    const servidor = await webpush.ApplicationServer.new({
      contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.org",
      vapidKeys,
    });

    const itens = await enviarParaInscritos({
      servidor,
      inscricoes,
      mensagem: JSON.stringify(aviso),
      rotulo: "webhook-mercadopago",
      aoDetectarMorta: (endpoint: string) =>
        supabase.from("push_subscriptions").delete().eq("endpoint", endpoint),
    });

    const resumo = resumir(itens);
    console.log(
      `webhook-mercadopago: aviso de pagamento → ${resumo.enviados} entregues, ${resumo.falharam} falharam`,
    );
  } catch (erro) {
    console.error("webhook-mercadopago: falha ao disparar push de pagamento", erro);
  }
}

/**
 * `deps` é a mesma costura da `criar-pagamento` (index.ts:124-135): em
 * produção o `serve()` lá embaixo chama `handler(req)` com um único
 * argumento.
 *
 * Correção de 09/08/2026 (rodada de conserto 1): a versão anterior deste
 * comentário dizia que isso era necessário para produção não quebrar,
 * porque o segundo argumento que o `serve` do std passa (`ConnInfo`) cairia
 * em `deps`. A revisão MEDIU e refutou: passando um `ConnInfo` como
 * segundo argumento, o handler se comporta igual, porque TODA dep aqui usa
 * `??` com fallback real (`deps.supabase ?? createClient(...)`,
 * `deps.fetchImpl` → `fetch`, `deps.enviarPush ?? disparoPushReal`) — um
 * objeto estranho sem as chaves esperadas cai nos mesmos defaults. Continua
 * um único argumento porque é mais claro e não depende de todo fallback
 * continuar correto para sempre — não porque seja uma trava de segurança.
 */
async function handler(
  req: Request,
  deps: {
    supabase?: ReturnType<typeof createClient>;
    fetchImpl?: typeof fetch;
    enviarPush?: typeof disparoPushReal;
  } = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  // Do corpo saem exatamente dois campos: `data.id`, que diz QUAL COBRANÇA
  // perguntar ao MP, e `type` (abaixo), que só serve para descartar tópico
  // que não é de pagamento. Nenhum dos dois diz QUAL PEDIDO confirmar — isso
  // vem do `external_reference` que o MP devolve, autenticado pelo token do
  // gateway. É a invariante nº 1 desta função, e o teste do corpo hostil
  // existe para prendê-la.
  const dataId = (body?.data as Record<string, unknown> | undefined)?.id;
  if (dataId === undefined || dataId === null || dataId === "") {
    return json({ error: "data.id ausente." }, 400);
  }
  const dataIdStr = String(dataId);

  // A ÚNICA autenticação: sem ela, quem descobrir a URL forja um "aprovado".
  const assinaturaOk = await validarAssinatura({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataIdStr,
    segredo: Deno.env.get("MP_WEBHOOK_SECRET") ?? "",
    // Number.POSITIVE_INFINITY: a janela de `ts` fica DESLIGADA nesta
    // função. Corrigido em 09/08/2026 (rodada de conserto 1) — a versão
    // anterior usava 86400s (24h), medida contra um limite que não existe:
    // a revisão mediu que o MP NÃO PARA de reenviar depois da terceira
    // tentativa, ele estende o intervalo e continua sem limite documentado.
    // Nenhuma janela finita é segura — uma cadeia longa de reenvios
    // ultrapassa qualquer valor escolhido, e o ÚLTIMO reenvio vira 401
    // permanente.
    //
    // Desligar não custa nada porque O WEBHOOK NUNCA CONFIA NO QUE CHEGA:
    // ele só lê `data.id` daqui, e vai perguntar ao MP o status ATUAL logo
    // abaixo. Um header replayado — mesmo capturado meses atrás — produz
    // uma consulta NOVA ao MP e a decisão correta para o estado de agora; a
    // `confirmar_pagamento` fecha o resto (idempotência sob `FOR UPDATE`).
    // Não existe cenário em que aceitar um `ts` velho cause dano: quem
    // autentica aqui é o HMAC, não o relógio — é por isso que o SDK oficial
    // do MP entrega essa checagem desligada por padrão.
    toleranciaSegundos: Number.POSITIVE_INFINITY,
  });
  if (!assinaturaOk) {
    console.warn("webhook-mercadopago: assinatura inválida", dataIdStr);
    return json({ error: "Assinatura inválida." }, 401);
  }

  // Depois da migração para a Orders API (CHECKOUT-070, Tarefas 1-2), a
  // confirmação de PIX chega com `type: "order"`, não mais `type: "payment"`
  // — o filtro que existia aqui (descartar tudo que não fosse "payment")
  // jogaria fora TODO pedido pago: "aguardando" para sempre. Três rotas:
  //
  // 1. `type === "payment"` → caminho CLÁSSICO, intacto (pedidos criados
  //    antes do deploy ainda estão em voo e ainda notificam assim).
  // 2. `type === "order"` → caminho novo (Orders API).
  // 3. `type` ausente → decide pela FORMA do `data.id` (`idEhClassico`,
  //    `_shared/mercadopago.ts` — extraída na Tarefa 4, CHECKOUT-070, para
  //    `reconciliar-pagamentos`/`criar-pagamento` pararem de escrever a MESMA
  //    regex pela terceira vez): só dígitos é sempre pagamento clássico (o id
  //    de payment do MP é numérico); qualquer outra coisa (o ULID da order,
  //    maiúsculo, prefixo "ORD"/"ORDTST" em teste) vai para o caminho de
  //    order. Sem isto, "type ausente" cairia sempre no clássico — 404 do MP
  //    (id de order não existe em /v1/payments/) → 200 "ignorado" →
  //    pagamento perdido em silêncio.
  //
  // 4a. `type` presente e está na lista de CONHECIDOS irrelevantes
  //     (TOPICOS_IRRELEVANTES, acima) → descarta com 200 sem tocar o MP:
  //     barato de filtrar, caro de deixar passar (cada um consultado
  //     sujaria o log com `mercadopago: recusou 404` sem nunca ter sido um
  //     pagamento de verdade).
  // 4b. `type` presente mas DESCONHECIDO (nem payment/order, nem da lista
  //     acima) → NÃO descarta. Ninguém neste projeto jamais observou uma
  //     notificação real da Orders API (issue #212: `notification_url` não
  //     é aceito no corpo da Orders API, a entrega depende do cadastro no
  //     painel do MP) — o literal exato que o MP manda para essa cobrança é
  //     suposição, não medição. Se vier plural, prefixado, versionado, ou
  //     qualquer variação de "order" que este código não previu, decide
  //     pela FORMA do id, igual ao caso 3 (type ausente) — e loga com
  //     console.error, não warn: tópico desconhecido é sinal de que o
  //     contrato do MP mudou, não rotina.
  const tipoDoEvento = body?.type;
  let rota: "payment" | "order";
  if (tipoDoEvento === "payment") {
    rota = "payment";
  } else if (tipoDoEvento === "order") {
    rota = "order";
  } else if (typeof tipoDoEvento === "string" && TOPICOS_IRRELEVANTES.has(tipoDoEvento)) {
    console.warn(
      "webhook-mercadopago: type está na lista de tópicos irrelevantes, ignorado sem consultar o MP",
      tipoDoEvento,
    );
    return json({ ok: true, ignorado: "type não é payment nem order" }, 200);
  } else if (typeof tipoDoEvento === "string") {
    rota = idEhClassico(dataIdStr) ? "payment" : "order";
    console.error(
      `webhook-mercadopago: type "${tipoDoEvento}" desconhecido (nem payment/order, nem da lista de irrelevantes) — decidido pela forma do id -> rota "${rota}"`,
      dataIdStr,
    );
  } else {
    rota = idEhClassico(dataIdStr) ? "payment" : "order";
    console.log(`webhook-mercadopago: type ausente, decidido pela forma do id -> rota "${rota}"`, dataIdStr);
  }

  // As duas rotas convergem nestas quatro variáveis antes do restante do
  // handler (RPC, push, logs) — que não muda entre elas. `statusBrutoParaLog`
  // (achado de revisão, CHECKOUT-070 Tarefa 4) existe só para o log de
  // "status desconhecido" abaixo: sem ela, esse ramo — que existe
  // justamente para descobrir status NOVO do MP — não dizia qual status
  // tinha chegado.
  let statusMapeado: string | null;
  let externalReference: unknown;
  let idParaRpc: string;
  let statusBrutoParaLog: string;

  if (rota === "payment") {
    const consulta = await consultarPagamento({
      token: Deno.env.get("MP_ACCESS_TOKEN") ?? "",
      paymentId: dataIdStr,
      fetchImpl: deps.fetchImpl,
    });

    if (!consulta.ok) {
      // 404: "esse pagamento não existe" — reenviar não muda isso.
      if (consulta.status === 404) {
        return json({ ok: false, ignorado: "pagamento não encontrado" }, 200);
      }
      // Todo o resto (inclusive 401 — token do MP errado é emergência
      // operacional) mantém o evento vivo na fila do MP: 500 faz reenviar.
      console.error("webhook-mercadopago: consultarPagamento falhou", consulta.status, consulta.erro);
      return json({ error: consulta.erro }, 500);
    }

    // Usa o status que o MP DEVOLVEU, nunca o do corpo do webhook.
    statusMapeado = mapearStatus(consulta.status);
    externalReference = consulta.externalReference;
    idParaRpc = String(consulta.id);
    statusBrutoParaLog = consulta.status;
  } else {
    const consulta = await consultarOrder({
      token: Deno.env.get("MP_ACCESS_TOKEN") ?? "",
      orderId: dataIdStr,
      fetchImpl: deps.fetchImpl,
    });

    if (!consulta.ok) {
      // 404: "essa order não existe" — reenviar não muda isso.
      if (consulta.status === 404) {
        return json({ ok: false, ignorado: "order não encontrada" }, 200);
      }
      console.error("webhook-mercadopago: consultarOrder falhou", consulta.status, consulta.erro);
      return json({ error: consulta.erro }, 500);
    }

    const order = consulta.order as Record<string, unknown>;
    // MEDIDO contra a API real em 14/08/2026: `status` e `status_detail`
    // ficam na RAIZ da order. Existe um par igual dentro de
    // `transactions.payments[0]` — NÃO ler de lá: a raiz é a verdade do
    // pedido, `payments[0]` é um índice de array que vira escolha carregada
    // no dia em que houver mais de um pagamento.
    const statusRaiz = String(order.status ?? "");
    const statusDetailRaiz = String(order.status_detail ?? "");
    const statusBanco = mapearStatusOrder(statusRaiz, statusDetailRaiz);

    // `confirmar_pagamento` (20260810000000_confirmar_pagamento_guarda_
    // status.sql) não conhece 'expirado' — chamá-la com esse status cairia
    // no RETURN 'ignorado' final, indistinguível no log de todos os outros
    // caminhos de "ignorado" (status desconhecido, external_reference
    // inválido...). Filtra ANTES da RPC, com rótulo e log próprios.
    if (statusBanco === "expirado") {
      console.warn("webhook-mercadopago: order expirada, ignorada sem chamar a RPC", dataIdStr);
      return json({ ok: true, ignorado: "order expirada" }, 200);
    }

    statusMapeado = statusBanco;
    // MEDIDO: `external_reference` também fica na RAIZ da order — mesma
    // invariante que o caminho clássico já protege (o pedido NUNCA sai do
    // corpo do webhook; sai da resposta autenticada do MP).
    externalReference = order.external_reference;
    // O id da ORDER (ULID maiúsculo, "ORD..." em produção, "ORDTST..." em
    // teste) — `consultarOrder` já garante que `order.id` existe numa
    // resposta ok.
    idParaRpc = String(order.id);
    statusBrutoParaLog = `${statusRaiz}:${statusDetailRaiz}`;
  }

  if (statusMapeado === null) {
    console.warn("webhook-mercadopago: status desconhecido do MP", dataIdStr, rota, statusBrutoParaLog);
    return json({ ok: true, ignorado: "status desconhecido" }, 200);
  }

  if (!pareceUuid(externalReference)) {
    console.warn(
      "webhook-mercadopago: external_reference sem forma de UUID",
      externalReference,
      dataIdStr,
    );
    return json({ ok: true, ignorado: "external_reference inválido" }, 200);
  }
  const orderId = externalReference as string;

  const supabase =
    deps.supabase ??
    createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    );

  let resultado: string;
  try {
    const { data, error: erroRpc } = await supabase.rpc("confirmar_pagamento", {
      p_order_id: orderId,
      p_payment_id: idParaRpc,
      p_status: statusMapeado,
    });
    if (erroRpc) throw erroRpc;
    resultado = data as string;
  } catch (erro) {
    // Erro de banco mantém o evento vivo na fila do MP.
    console.error("webhook-mercadopago: confirmar_pagamento falhou", erro);
    return json({ error: "Erro ao confirmar pagamento." }, 500);
  }

  // Só estes dois retornos disparam push. `ja_pago`/`ja_estornado`/`ignorado`
  // são reenvio do MP encontrando um estado que já foi tratado — 200, sem
  // push, é o que impede o reenvio de virar spam para o lojista.
  // `divergente`/`inexistente` NÃO são esse caso benigno: significam que a
  // confirmação (já aprovada pelo MP) não bate com o pedido, e por isso são
  // logados como erro no bloco abaixo, não silenciados.
  if (resultado === "pago" || resultado === "pago_apos_expirar") {
    // A RPC devolve só um texto — o push precisa de nome/número/valor, que
    // vêm de uma leitura extra do pedido.
    let pedido: Record<string, unknown> | null = null;
    try {
      const { data } = await supabase
        .from("marketplace_orders")
        .select("id, customer_name, total, total_amount")
        .eq("id", orderId)
        .maybeSingle();
      pedido = data ?? null;
    } catch (erro) {
      // Pedido já está pago no banco; deixar o lojista sem aviso porque essa
      // leitura cosmética falhou é pior que mandar o push sem o valor.
      console.error("webhook-mercadopago: leitura do pedido para o push falhou", erro);
    }

    const valor = pedido?.total ?? pedido?.total_amount;
    const aviso =
      resultado === "pago_apos_expirar"
        ? {
            // "fora do fluxo", não "fora do prazo": a RPC devolve este
            // mesmo valor tanto quando o pedido EXPIROU quanto quando foi
            // CANCELADO pelo app e pago depois — "prazo" só é verdade na
            // primeira rota. O corpo continua igual: "estoque já devolvido"
            // já é verdade nas duas.
            title: "Pagamento fora do fluxo",
            body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)} · estoque já devolvido`,
            url: "/admin-orders",
          }
        : {
            title: "Pedido pago",
            body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)}`,
            url: "/admin-orders",
          };

    const enviarPush = deps.enviarPush ?? disparoPushReal;
    await enviarPush({ supabase, aviso });
  } else if (resultado === "divergente" || resultado === "inexistente") {
    // error, não warn: ao contrário dos outros retornos deste laço (ja_pago,
    // ignorado...), estes dois chegam com o pagamento JÁ APROVADO pelo MP —
    // a assinatura lá em cima já provou isso. 'divergente' é
    // gateway_payment_id que não bate com o pedido; 'inexistente' é pedido
    // que sumiu. A `criar-pagamento` cobre o cenário gêmeo (MP responde 200
    // na criação, o UPDATE seguinte falha) com o mesmo nível de log
    // ("cobrança criada mas não gravada") — sem isto aqui, o pedido expira
    // em 30 min, o estoque volta, e fica "dinheiro no Mercado Pago, nada no
    // app, 200 no log de acesso" até alguém notar batendo o extrato manual.
    // A reconciliação (reconciliar-pagamentos/index.ts:191-197) já trata os
    // dois com console.warn porque lá o `p_payment_id` sai da MESMA linha do
    // banco — divergir é quase impossível. Aqui o payment_id sai da resposta
    // do MP, então divergir é o caminho normal de um UPDATE que falhou.
    console.error(
      "webhook-mercadopago: confirmar_pagamento devolveu resultado inesperado — dinheiro pode ter entrado sem registro",
      { orderId, paymentId: idParaRpc, resultado },
    );
  }

  return json({ ok: true, resultado }, 200);
}

// O guard do runner de teste é COPIADO de notify-new-order/criar-pagamento:
// sem ele, `npm run test:edge` importa este módulo e sobe um servidor HTTP
// no meio da suíte.
const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

// (req) => handler(req), um único argumento — mais claro, ver o comentário
// acima de `handler` sobre por que isso NÃO é uma trava de segurança aqui.
if (!emTeste) serve((req) => handler(req));

export { handler };
