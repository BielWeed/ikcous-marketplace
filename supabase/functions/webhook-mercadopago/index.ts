// @ts-nocheck
/**
 * webhook-mercadopago — fecha o laço da cobrança (Fase 3, Task 4): recebe a
 * confirmação do Mercado Pago e é o ÚNICO caminho que faz um pedido virar
 * 'pago' de verdade — `criar-pagamento` (Fase 2) nunca escreve isso.
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *
 * Roda com `verify_jwt = false` (config.toml) porque o MP não manda JWT.
 * Quem autentica é o `x-signature`, validado por `avaliarAssinatura` — sem
 * ele, qualquer um que descubra a URL forja um "aprovado" e leva produto de
 * graça. É por isso que a checagem de assinatura vem ANTES de qualquer
 * leitura de corpo além do `data.id` (que a própria assinatura depende
 * dele) e antes de qualquer chamada ao MP ou ao banco.
 *
 * POR QUE O `p_order_id` VEM DA RESPOSTA DO MP, NÃO DO CORPO DO WEBHOOK
 *
 * O corpo só é autenticado pelo `x-signature`, que amarra o `data.id` do
 * CORPO — não amarra nenhum outro campo, e não amarra a query string (a
 * assinatura NÃO aceita mais o `data.id` da query como fonte de manifesto
 * desde 16/08/2026: era um campo que o mesmo atacante também controla,
 * enquanto todo o processamento abaixo usa sempre o do corpo). Um corpo
 * forjado com a MESMA assinatura de um pagamento real não existe (a
 * assinatura barra isso), mas o corpo em si nunca carrega o pedido: quem
 * sabe a qual pedido um pagamento pertence é o `external_reference` que
 * `criarPagamento`/`consultarPagamento` leem de volta da API do MP,
 * autenticada pelo `MP_ACCESS_TOKEN`. Por isso o pedido sai de
 * `consulta.externalReference`, nunca de `body`.
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
  avaliarAssinatura,
  consultarOrder,
  consultarPagamento,
  extrairValorDaOrder,
  idEhClassico,
  mapearStatus,
  mapearStatusOrder,
  TOLERANCIA_DE_VALOR,
} from "../_shared/mercadopago.ts";
import {
  carregarChavesVapid,
  corsHeaders,
  enviarParaInscritos,
  readKey,
  resumir,
} from "../_shared/webpush.ts";
import { enviarComprovantePedido } from "../_shared/comprovante.ts";
// PEÇA 5 (12/09/2026): `dispararAvisoDePagamentoAtrasadoReal`, mais abaixo,
// fala SMTP direto (sem passar por `_shared/comprovante.ts`, que não é
// arquivo desta peça) e usa `escaparHtml` para o mesmo motivo que
// `_shared/comprovante.ts` já usa: nome de loja é texto que ALGUÉM digitou.
import { enviarEmail, remetenteConfigurado } from "../_shared/smtp.ts";
import { escaparHtml } from "../_shared/pedido.ts";
// T5 do plano de estorno pelo app (08/09/2026): o webhook é o segundo
// caminho (e o único, para estorno feito FORA do app) que registra o
// desfecho de uma devolução — reusa a MESMA decisão pura do P0
// (`decidirConclusaoPelaConsulta`) sobre o objeto que ESTE handler já
// consultou, sem um segundo GET (item 4 do brief P0: uma decisão, dois
// chamadores).
import {
  decidirConclusaoPelaConsulta,
  refundsDaOrder,
  type LinhaEstorno,
  type PedidoParaEstorno,
} from "../_shared/estorno.ts";

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
 * Manda ao CLIENTE o comprovante do pedido (PEDIDO-070) chamando DIRETO o
 * miolo de `send-order-confirmation` — `_shared/comprovante.ts` — em vez de
 * `supabase.functions.invoke`. É o mesmo movimento que `notify-new-order`
 * já faz para reusar a `send-push` via `_shared/webpush.ts` (ver o
 * cabeçalho daquele arquivo): a function de origem não pode ser importada
 * pelo `index.ts` dela mesma porque chama `serve()` no topo, então o miolo
 * mora em `_shared` e os dois chamadores importam de lá.
 *
 * REDESENHO DE 25/08/2026 — POR QUE NÃO A QUARTA CORREÇÃO NA PORTA HTTP
 *   O comprovante foi consertado três vezes chamando `send-order-
 *   confirmation` pela porta pública (desenhada para o navegador): (1) faltava
 *   a chamada; (2) o texto mentia no pagamento atrasado — incompatibilidade
 *   de CONTRATO; (3) a chave (JWT novo x legado) — incompatibilidade de
 *   AUTENTICAÇÃO. As rodadas 2 e 3 são o mesmo defeito com roupa diferente:
 *   cada volta descobria mais um jeito de a porta HTTP não servir a um
 *   chamador servidor. A correção não é acertar o contrato da porta pela
 *   quarta vez — é não passar por ela: chamando a função direto, por
 *   import, não existe mais fronteira nenhuma para autenticar. Some o HTTP,
 *   o `verify_jwt`, o header forçado, a chave legada enquistada e a
 *   dependência do calendário de desligamento das chaves legadas
 *   (INFRA-260, #126) — não porque a INFRA-260 foi concluída, mas porque
 *   esta chamada específica deixou de depender dela.
 *
 * SÓ PARA `resultado === "pago"` — achado de revisão de contexto limpo,
 * 25/08/2026, mantido no redesenho. O chamador (mais abaixo) restringe este
 * disparo a 'pago', mesmo o push ao lojista saindo também para
 * 'pago_apos_expirar'. Motivo: `enviarComprovantePedido`
 * (`_shared/comprovante.ts`) só sabe ler o literal 'pago' —
 * `aguardandoPagamento` compara `payment_status !== 'pago'`, e
 * 'pago_apos_expirar' cai nesse `true`. Disparar para esse retorno faria o
 * comprovante mentir DUAS vezes: diria que o pagamento ainda está
 * "aguardando confirmação" (já foi confirmado — é por isso que chegamos
 * aqui) e que o pedido "entra na fila de separação" (o pedido segue
 * `status='cancelled'`, estoque já devolvido; nunca entra em separação). E
 * não há segunda chance: `reivindicar_email_de_confirmacao` é reserva única
 * e definitiva, então o e-mail certo nunca poderia ser mandado depois.
 *
 * PEÇA 5 (revisão de dinheiro-não-recebido, 12/09/2026): 'pago_apos_expirar'
 * deixa de ficar mudo — ver `dispararAvisoDePagamentoAtrasadoReal`, mais
 * abaixo, que manda um texto PRÓPRIO e honesto (nunca este comprovante
 * padrão) e compete pela MESMA reserva. `_shared/comprovante.ts` não é
 * arquivo desta peça (outro executor do lote edita em paralelo) — por isso o
 * texto novo não virou um parâmetro ali, e mora duplicado aqui e em
 * `reconciliar-pagamentos/index.ts` (mesmo nome de função). Consolidar as
 * duas cópias em `_shared/comprovante.ts` é candidato a tarefa própria, com
 * revisão própria — a sessão principal decide, não este executor.
 *
 * A REPETIÇÃO NÃO PRECISA DE TRAVA AQUI
 *   O MP é reentrante por natureza (reenvia a mesma notificação até receber
 *   200), mas `enviarComprovantePedido` já reserva o envio com
 *   `reivindicar_email_de_confirmacao` — um UPDATE condicional atômico em
 *   que só a primeira chamada ganha (a MESMA trava que já protege o
 *   caminho do front, chamando a MESMA RPC, sem mudar uma linha dela).
 *   Reenvio do MP chamando esta função de novo é seguro: a chamada seguinte
 *   cai em `ja_enviado` e não manda nada. Além disso, esta função só é
 *   alcançada quando `confirmar_pagamento` (RPC, `FOR UPDATE`) devolve
 *   'pago' — um reenvio que chegue depois de o pagamento já ter sido
 *   registrado recebe 'ja_pago' e nem tenta chamar o comprovante de novo
 *   (ver o teste "push dispara em exatamente 2 dos 9 retornos possíveis").
 *
 * Erros aqui NUNCA sobem, pela mesma razão do push (`disparoPushReal`,
 * acima): o pedido já está 'pago' no banco quando esta função roda, e uma
 * falha de e-mail não pode virar 500 — isso faria o MP reenviar um evento
 * que já foi tratado com sucesso. Só loga — tanto a exceção inesperada
 * (`catch`) quanto o desfecho `{ ok: false, motivo }` que
 * `enviarComprovantePedido` devolve sem lançar (SMTP não configurado,
 * pedido sem e-mail, reserva já gasta por outro chamador etc.).
 */
async function dispararComprovanteReal(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
}): Promise<void> {
  const { supabase, orderId } = args;
  try {
    const desfecho = await enviarComprovantePedido({ supabase, orderId });
    if (!desfecho.ok) {
      console.error(
        "webhook-mercadopago: comprovante ao cliente não enviado",
        { orderId, motivo: desfecho.motivo },
      );
    }
  } catch (erro) {
    console.error(
      "webhook-mercadopago: falha ao disparar comprovante ao cliente",
      erro,
    );
  }
}

/**
 * PEÇA 5 (revisão de dinheiro-não-recebido, 12/09/2026): o texto HONESTO
 * para 'pago_apos_expirar' — nunca o HTML de `_shared/comprovante.ts`
 * (`htmlDoPedido`), que mentiria "aguardando confirmação" e "entra na fila
 * de separação" para um pedido já confirmado e `status='cancelled'` (ver o
 * comentário de `dispararAvisoDePagamentoAtrasadoReal`, abaixo). Pura e
 * EXPORTADA para o teste conferir o TEXTO sem tocar SMTP nem banco — mesmo
 * padrão de `formatarBRL`/`numeroDoPedido`, acima.
 *
 * Não promete estoque disponível nem reenvio automático (a política do dono
 * é HONRAR o pagamento tardio, mas a reanálise ainda é manual — não há botão
 * de reanálise pelo cliente hoje): diz só o que já é fato — o pagamento
 * chegou, o pedido foi cancelado antes disso, e a loja vai resolver.
 *
 * NUNCA afirmar "prazo" nem "automaticamente" aqui (achado bloqueante da
 * revisão, 12/09/2026): `confirmar_pagamento` devolve 'pago_apos_expirar' por
 * DOIS caminhos (migration 20260810000000, linhas 118-125 e 173-180) — a
 * varredura de 30 min (aí sim é "prazo" e "automático") E o cliente que
 * CANCELA pelo app com o QR na mão e paga o PIX segundos depois, dentro da
 * janela (aí "prazo" e "automático" são as duas mentiras). Mesmo motivo do
 * "fora do fluxo", não "fora do prazo" do push acima: só "já estava
 * cancelado" e "estoque já tinha voltado" são verdade nos dois casos.
 */
export function htmlDoAvisoDePagamentoAtrasado(args: {
  orderId: string;
  nomeDaLoja: string;
}): string {
  const { orderId, nomeDaLoja } = args;
  const loja = String(nomeDaLoja ?? "").trim();
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa;">
        Pedido ${escaparHtml(numeroDoPedido(orderId))}
      </p>
      ${loja ? `<p style="margin: 0 0 20px; font-size: 18px; font-weight: 800;">${escaparHtml(loja)}</p>` : ""}
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #3f3f46;">
        Recebemos a confirmação do seu pagamento para este pedido, mas ele já estava cancelado e o estoque já tinha voltado para a loja quando o pagamento foi confirmado — por isso não entrou na fila de separação.
      </p>
      <p style="margin: 0; font-size: 14px; line-height: 20px; color: #3f3f46;">
        A loja já foi avisada do pagamento e vai entrar em contato para resolver (reenvio, se ainda houver estoque, ou devolução do valor pago).
      </p>
    </div>
  `;
}

export function assuntoDoAvisoDePagamentoAtrasado(orderId: string, nomeDaLoja: string): string {
  const loja = String(nomeDaLoja ?? "").trim();
  const numero = numeroDoPedido(orderId);
  return loja ? `Pedido ${numero} · ${loja}` : `Pedido ${numero}`;
}

/**
 * Manda ao CLIENTE um aviso HONESTO de pagamento confirmado FORA do prazo
 * (PEÇA 5, revisão de dinheiro-não-recebido, 12/09/2026) — o gêmeo de
 * `dispararComprovanteReal`, acima, para o retorno 'pago_apos_expirar' da
 * RPC, que aquela função nunca atende (ver o parágrafo "PEÇA 5" no
 * comentário dela).
 *
 * MESMA trava anti-duplicata do comprovante padrão: os dois competem pela
 * MESMA reserva (`reivindicar_email_de_confirmacao`, UPDATE condicional
 * atômico, só a PRIMEIRA chamada ganha) — um pedido nunca recebe os dois
 * textos, e um reenvio do MP (ou a `reconciliar-pagamentos`, que chama esta
 * MESMA função duplicada) que chegue depois de qualquer um dos dois cai em
 * `reservou !== true` e não manda nada.
 *
 * Mesma forma de erro do resto do arquivo: NUNCA lança para quem chama — o
 * pedido já está 'pago_apos_expirar' no banco quando isto roda, e uma falha
 * de e-mail não pode virar 500 (o MP reenviaria um evento já tratado).
 */
async function dispararAvisoDePagamentoAtrasadoReal(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
}): Promise<void> {
  const { supabase, orderId } = args;
  try {
    // Falha fechada ANTES de reservar — mesmo motivo do comprovante padrão
    // (`_shared/comprovante.ts`): reservar sem poder enviar deixaria o
    // pedido marcado "já avisado" para sempre, sem o cliente ter recebido
    // nada.
    if (!remetenteConfigurado()) {
      console.error(
        "webhook-mercadopago: SMTP não configurado — aviso de pagamento atrasado não enviado",
        orderId,
      );
      return;
    }

    const { data: pedido, error: erroPedido } = await supabase
      .from("marketplace_orders")
      .select("id, user_id, customer_data")
      .eq("id", orderId)
      .maybeSingle();
    if (erroPedido) throw erroPedido;
    if (!pedido) {
      console.warn(
        "webhook-mercadopago: pedido do aviso de pagamento atrasado não encontrado",
        orderId,
      );
      return;
    }

    // Mesma ordem de `emailDoCliente` (`_shared/comprovante.ts`): o e-mail
    // que a pessoa digitou NAQUELE pedido primeiro; o da conta só quando o
    // pedido não traz nenhum.
    let destinatario = String(
      (pedido as Record<string, unknown>).customer_data
        ? ((pedido as Record<string, unknown>).customer_data as Record<string, unknown>).email ?? ""
        : "",
    ).trim();
    if (!destinatario && (pedido as Record<string, unknown>).user_id) {
      const { data: conta } = await supabase.auth.admin.getUserById(
        String((pedido as Record<string, unknown>).user_id),
      );
      destinatario = String(conta?.user?.email ?? "").trim();
    }
    if (!destinatario) {
      console.warn(
        "webhook-mercadopago: pedido pago_apos_expirar sem e-mail de cliente",
        orderId,
      );
      return;
    }

    // A TRAVA anti-duplicata — ver o docstring desta função.
    const { data: reservou, error: erroReserva } = await supabase.rpc(
      "reivindicar_email_de_confirmacao",
      { p_order_id: orderId },
    );
    if (erroReserva) throw erroReserva;
    if (reservou !== true) return; // já enviado (padrão ou este mesmo aviso)

    const { data: config } = await supabase
      .from("store_config")
      .select("store_name")
      .limit(1)
      .maybeSingle();
    const nomeDaLoja = (config as Record<string, unknown> | null)?.store_name ?? "";

    try {
      await enviarEmail({
        para: destinatario,
        assunto: assuntoDoAvisoDePagamentoAtrasado(orderId, String(nomeDaLoja ?? "")),
        html: htmlDoAvisoDePagamentoAtrasado({ orderId, nomeDaLoja: String(nomeDaLoja ?? "") }),
      });
    } catch (erroEnvio) {
      // Devolve a reserva: o SMTP recusou, então ninguém recebeu nada — uma
      // tentativa posterior tem de ser possível (mesmo padrão do comprovante
      // padrão).
      await supabase
        .rpc("liberar_email_de_confirmacao", { p_order_id: orderId })
        .then(undefined, (erroLiberar: unknown) => {
          console.error(
            "webhook-mercadopago: liberar reserva do aviso de pagamento atrasado falhou",
            orderId,
            erroLiberar,
          );
        });
      throw erroEnvio;
    }

    console.log(`webhook-mercadopago: aviso de pagamento atrasado enviado para ${orderId}`);
  } catch (erro) {
    console.error(
      "webhook-mercadopago: falha ao enviar aviso de pagamento atrasado ao cliente",
      orderId,
      erro,
    );
  }
}

/** Terminal de sucesso de um refund INDIVIDUAL na Payments API clássica —
 * MESMA constante do P0 (`_shared/estorno.ts`, `STATUS_REFUND_APROVADO_
 * PAYMENTS`), copiada aqui porque não é exportada: a Payments de cartão está
 * DESLIGADA hoje (Restrição Global veda `fetch` real em teste) e esta grafia
 * nunca foi medida contra a API real — a T8 (sandbox) decide se troca. */
const STATUS_REFUND_APROVADO_PAYMENTS = "approved";
/** Terminal de sucesso de um refund na Orders API — MESMA constante do P0
 * (`STATUS_REFUND_CONCLUIDO`), via `refundsDaOrder` + este filtro. */
const STATUS_REFUND_CONCLUIDO_ORDERS = "processed";

/**
 * Insere uma linha `sistema` já `concluido` e chama `concluir_estorno` na
 * sequência — o padrão que A4 (estorno feito fora do app) e B/settled-sem-
 * linha (chargeback cujo `in_process` nunca chegou) COMPARTILHAM: "nasce
 * concluido, nunca solicitado" (pré-requisito 3 do plano — linha nova é
 * dinheiro NOVO; esta linha é dinheiro que JÁ saiu). `valorOriginal` só
 * difere de `amount` quando o clamp (disponível < valor do MP) reduziu —
 * nesse caso o motivo ganha o valor real do MP, para o lojista não estranhar
 * a diferença.
 *
 * Erro nomeado `estorno_acima_do_total` (a RPC recusou por segurança) →
 * console.error e `false` (SEGUE — 200 no fim, item 6 do brief: reenviar não
 * muda a conta e 500 aqui viraria reenvio infinito). Qualquer outro erro de
 * banco → lança (o chamador devolve 500 — fila do MP).
 */
async function inserirEstornoConcluido(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
  amount: number;
  valorOriginal: number;
  motivoBase: string;
  mpRefundId: string | null;
  mpStatus: string;
  mpStatusDetail: string | null;
}): Promise<boolean> {
  const { supabase, orderId, amount, valorOriginal, motivoBase, mpRefundId, mpStatus, mpStatusDetail } = args;
  const clampou = amount < valorOriginal;
  const motivo = motivoBase + (clampou ? `, valor no MP R$ ${valorOriginal.toFixed(2)}` : "");

  const { data: linhaInserida, error: erroInsert } = await supabase
    .from("order_refunds")
    .insert({
      order_id: orderId,
      amount,
      solicitado_por: "sistema",
      status: "concluido",
      motivo,
      mp_refund_id: mpRefundId,
      mp_status: mpStatus,
      mp_status_detail: mpStatusDetail,
    })
    .select("id")
    .maybeSingle();
  if (erroInsert) throw erroInsert;
  if (!linhaInserida) {
    console.error(
      "webhook-mercadopago: insert do estorno fora do app não devolveu a linha",
      orderId,
      mpRefundId,
    );
    return false;
  }

  const { error: erroConcluir } = await supabase.rpc("concluir_estorno", {
    p_refund_id: (linhaInserida as Record<string, unknown>).id,
    p_mp_refund_id: mpRefundId,
    p_mp_status: mpStatus,
    p_mp_status_detail: mpStatusDetail,
  });
  if (erroConcluir) {
    if (String((erroConcluir as { message?: string }).message ?? "").includes("estorno_acima_do_total")) {
      console.error(
        "webhook-mercadopago: concluir_estorno (estorno fora do app) recusou — acima do total",
        orderId,
        mpRefundId,
        erroConcluir,
      );
      return false;
    }
    throw erroConcluir;
  }
  return true;
}

/**
 * PASSO NOVO (T5, plano 20260907-plano-estorno-pelo-app.md): registra o
 * desfecho do estorno — inclusive o feito FORA do app (painel do MP) e a
 * contestação (chargeback) — a partir do objeto JÁ CONSULTADO ao MP (`corpo`;
 * sem segundo GET). Chamada DEPOIS da consulta e da conferência de
 * `pareceUuid(externalReference)`, ANTES do retorno antecipado de
 * `statusMapeado === null` (PEDIDO-05: `processed:partially_refunded` mapeia
 * para `null` de propósito, e sem este passo esse caso saía por "status
 * desconhecido" sem registrar nada).
 *
 * Gatilhos (lidos do objeto CONSULTADO, nunca do corpo do webhook — quem
 * chama já filtrou): `status === "refunded"`, `status_detail ===
 * "partially_refunded"`, ou `status === "charged_back"`. `status`/
 * `status_detail` ficam na RAIZ do objeto nas DUAS rotas: `consultarOrder`
 * devolve a order com eles na raiz (medido 14/08/2026); `consultarPagamento`
 * agora devolve `corpo` (item (b) do brief), o JSON cru do payment, que
 * também os tem na raiz (campo padrão da API clássica do MP).
 *
 * INVARIANTE (achado 1, laudo rodada 2 do PR #440 — P0): um refund do MP
 * credita UMA linha do ledger. `decidirConclusaoPelaConsulta` (P0) já
 * cumpre essa regra por linha; este passo cumpre a mesma regra AO LONGO do
 * lote (processa as linhas pendentes da mais velha para a mais nova,
 * acumulando `reivindicados` e `pedido.valor_estornado` EM MEMÓRIA entre
 * elas — I-B do laudo do #438: sem o acumulado em memória, a 2ª linha do
 * MESMO pedido no MESMO lote decidiria com o `valor_estornado` velho).
 */
async function registrarDesfechoDoEstorno(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
  rota: "payment" | "order";
  corpo: Record<string, unknown>;
}): Promise<void> {
  const { supabase, orderId, rota, corpo } = args;
  const ehPayments = rota === "payment";
  const status = typeof corpo.status === "string" ? corpo.status : "";
  const statusDetail = typeof corpo.status_detail === "string" ? corpo.status_detail : "";

  // Leitura FRESCA, service role (item 1 do passo A): todas as linhas do
  // pedido (qualquer status — precisamos delas para `reivindicados` e para
  // saber o que já está em curso) e o pedido.
  const { data: refundsRowsBrutos, error: erroRefundsRows } = await supabase
    .from("order_refunds")
    .select(
      "id, amount, status, solicitado_por, mp_refund_id, mp_status, tentativas, concluido_em, created_at",
    )
    .eq("order_id", orderId);
  if (erroRefundsRows) throw erroRefundsRows;
  const linhasBanco = (refundsRowsBrutos ?? []) as Array<Record<string, unknown>>;

  const { data: pedidoRow, error: erroPedidoRow } = await supabase
    .from("marketplace_orders")
    .select("id, gateway_payment_id, total, valor_estornado, payment_status, paid_at, status")
    .eq("id", orderId)
    .maybeSingle();
  if (erroPedidoRow) throw erroPedidoRow;
  if (!pedidoRow) {
    // O pedido some é tratado pelo restante do handler (a RPC
    // confirmar_pagamento tem o rótulo 'inexistente' próprio) — aqui só
    // desiste de registrar o desfecho do estorno, sem derrubar o evento.
    console.error(
      "webhook-mercadopago: pedido do estorno não encontrado ao registrar o desfecho",
      orderId,
    );
    return;
  }

  // `pedido` é MUTÁVEL de propósito (I-B): `valor_estornado` sobe EM
  // MEMÓRIA a cada linha concluída dentro deste MESMO lote.
  const pedido: PedidoParaEstorno = {
    id: String((pedidoRow as Record<string, unknown>).id),
    gateway_payment_id: String((pedidoRow as Record<string, unknown>).gateway_payment_id ?? ""),
    total: Number((pedidoRow as Record<string, unknown>).total),
    valor_estornado: Number((pedidoRow as Record<string, unknown>).valor_estornado ?? 0),
    payment_status: (pedidoRow as Record<string, unknown>).payment_status as string | null,
    paid_at: (pedidoRow as Record<string, unknown>).paid_at as string | null,
    status: String((pedidoRow as Record<string, unknown>).status),
  };

  // Item 5 do brief (janela de falha entre o INSERT e a RPC, W6): toda linha
  // 'sistema' já 'concluido' mas com concluido_em NULO (crash de um ciclo
  // anterior entre o INSERT e a RPC) recebe concluir_estorno de novo —
  // idempotente por contrato (COALESCE dos campos do MP na RPC, prova P13).
  // Roda ANTES de qualquer outra decisão deste passo.
  for (const linha of linhasBanco) {
    if (
      linha.solicitado_por === "sistema" &&
      linha.status === "concluido" &&
      (linha.concluido_em === null || linha.concluido_em === undefined)
    ) {
      const { error: erroRecuperacao } = await supabase.rpc("concluir_estorno", {
        p_refund_id: linha.id,
      });
      if (erroRecuperacao) {
        if (
          String((erroRecuperacao as { message?: string }).message ?? "").includes(
            "estorno_acima_do_total",
          )
        ) {
          console.error(
            "webhook-mercadopago: concluir_estorno (recuperação da janela de falha) recusou — acima do total",
            orderId,
            linha.id,
            erroRecuperacao,
          );
        } else {
          throw erroRecuperacao;
        }
      }
    }
  }

  // `reivindicados`: mp_refund_id de TODAS as linhas do pedido (qualquer
  // status) que já têm id — um refund do MP credita UMA linha (P0).
  const reivindicados = new Set<string>(
    linhasBanco
      .map((l) => l.mp_refund_id)
      .filter((id): id is string => typeof id === "string"),
  );

  // ── A) Estorno (refunded / partially_refunded) ───────────────────────────
  const statusTerminal = ehPayments ? STATUS_REFUND_APROVADO_PAYMENTS : STATUS_REFUND_CONCLUIDO_ORDERS;
  const refundsBrutos = ehPayments
    ? (Array.isArray(corpo.refunds)
      ? (corpo.refunds as unknown[]).filter((r) => r && typeof r === "object") as Array<
        Record<string, unknown>
      >
      : [])
    : refundsDaOrder(corpo);
  // UMA passagem só (ANOTADO do laudo Opus rodada 2): loga o que NÃO é
  // terminal (item 2 do passo A) e já separa o que é, sem percorrer
  // `refundsBrutos` duas vezes.
  const refundsConcluidos: Array<Record<string, unknown>> = [];
  for (const r of refundsBrutos) {
    if (r.status !== statusTerminal) {
      // Refund em outro status (in_process, rejected, …) não conta ainda —
      // item 2 do passo A.
      console.log(
        "webhook-mercadopago: refund em status não terminal, ignorado neste ciclo",
        orderId,
        r.status,
      );
      continue;
    }
    refundsConcluidos.push(r);
  }

  // Linhas PENDENTES do pedido (mais velha primeiro) — nunca 'sistema'
  // (dinheiro que já saiu por fora, não em curso pelo app).
  const pendentes = linhasBanco
    .filter((l) =>
      (l.status === "solicitado" || l.status === "em_processamento") &&
      l.solicitado_por !== "sistema"
    )
    .sort((a, b) => {
      const da = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
      const db = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
      return da - db;
    });

  for (const linhaBanco of pendentes) {
    const linha: LinhaEstorno = {
      id: String(linhaBanco.id),
      order_id: orderId,
      amount: Number(linhaBanco.amount),
      status: linhaBanco.status as LinhaEstorno["status"],
      mp_refund_id: (linhaBanco.mp_refund_id as string | null) ?? null,
      tentativas: Number(linhaBanco.tentativas ?? 0),
    };
    const resultado = decidirConclusaoPelaConsulta({
      corpo,
      ehPayments,
      linha,
      pedido,
      idsJaReivindicados: Array.from(reivindicados),
      temPreVeredito: false,
    });
    if (resultado.tipo === "concluido") {
      const { error: erroConcluir } = await supabase.rpc("concluir_estorno", {
        p_refund_id: linha.id,
        p_mp_refund_id: resultado.mp_refund_id,
        p_mp_status: resultado.mp_status,
        p_mp_status_detail: resultado.mp_status_detail,
      });
      if (erroConcluir) {
        if (
          String((erroConcluir as { message?: string }).message ?? "").includes(
            "estorno_acima_do_total",
          )
        ) {
          console.error(
            "webhook-mercadopago: concluir_estorno recusou — acima do total",
            orderId,
            linha.id,
            erroConcluir,
          );
          continue;
        }
        throw erroConcluir;
      }
      if (resultado.mp_refund_id) reivindicados.add(resultado.mp_refund_id);
      // I-B: acumulado EM MEMÓRIA — a próxima linha do lote decide com ele.
      pedido.valor_estornado = Number((pedido.valor_estornado + linha.amount).toFixed(2));
      // BLOQUEIA-1 (laudo Opus rodada 2, PR #449): `somaEmCurso` (abaixo)
      // percorre `linhasBanco` como foi lida no INÍCIO do passo — sem
      // marcar esta linha como concluída AQUI, no objeto local, ela
      // continua contando como 'solicitado'/'em_processamento' nesse
      // array, e o valor dela seria descontado DUAS vezes do `disponivel`
      // do estorno externo (uma via `pedido.valor_estornado`, acima; outra
      // via `somaEmCurso`). Mutar o objeto local é seguro: `linhaBanco` é a
      // MESMA referência que `linhasBanco` guarda (ambos vêm do mesmo
      // SELECT desta chamada) — `somaEmCurso`, chamada mais abaixo NESTE
      // MESMO lote, já enxerga o status atualizado.
      linhaBanco.status = "concluido";
    }
    // tentar_depois → nada (o cron continua com ela).
  }

  // Item 4 do passo A: refunds "processed"/"approved" que SOBRARAM fora de
  // `reivindicados` = estorno feito FORA do app (painel do MP).
  const somaEmCurso = (rows: Array<Record<string, unknown>>) =>
    rows
      .filter((l) => l.status === "solicitado" || l.status === "em_processamento")
      .reduce((acc, l) => acc + Number(l.amount ?? 0), 0);

  for (const refund of refundsConcluidos) {
    const refundId = typeof refund.id === "string" || typeof refund.id === "number"
      ? String(refund.id)
      : "";
    if (!refundId || reivindicados.has(refundId)) continue;

    const valorRefundBruto = Number(refund.amount);
    // ANTES-DE-CRESCER-1 (laudo Opus rodada 2, PR #449): valor ilegível OU
    // não-positivo é "não sei", NUNCA "zero" — `amount: 0` violaria
    // `CHECK (amount > 0)` no banco (500 em laço, o MP reenvia para
    // sempre); `amount <= 0` também violaria o mesmo CHECK, e não-positivo
    // não tem leitura de negócio aqui (refund de valor zero/negativo não é
    // um refund). Pula este refund (nenhum insert, nenhuma RPC); o resto do
    // handler continua (confirmar_pagamento do status atual roda do mesmo
    // jeito).
    if (!Number.isFinite(valorRefundBruto) || valorRefundBruto <= 0) {
      console.error(
        "webhook-mercadopago: refund sem valor legível ou não-positivo — pulando (não é 'não sei' = 0)",
        orderId,
        refundId,
      );
      continue;
    }
    const valorRefund = valorRefundBruto;
    const disponivel = Number(
      (pedido.total - pedido.valor_estornado - somaEmCurso(linhasBanco)).toFixed(2),
    );

    if (disponivel <= 0) {
      console.error(
        "webhook-mercadopago: estorno externo além do que o pedido pode registrar",
        orderId,
        refundId,
        { disponivel, valorRefund },
      );
      continue;
    }

    const amountClampado = Math.min(valorRefund, disponivel);
    const ok = await inserirEstornoConcluido({
      supabase,
      orderId,
      amount: amountClampado,
      valorOriginal: valorRefund,
      motivoBase: "estorno feito fora do app (Mercado Pago)",
      mpRefundId: refundId,
      mpStatus: status,
      mpStatusDetail: statusDetail || null,
    });
    if (ok) {
      reivindicados.add(refundId);
      pedido.valor_estornado = Number((pedido.valor_estornado + amountClampado).toFixed(2));
    }
  }

  // ── B) Chargeback (status === "charged_back") ────────────────────────────
  if (status === "charged_back") {
    const linhaChargeback = linhasBanco.find(
      (l) => l.solicitado_por === "sistema" && l.mp_status === "charged_back",
    );

    // Valor pago: payment → transaction_amount (do corpo cru); order →
    // extrairValorDaOrder — MESMO clamp do item A4.
    const valorPagoBruto = ehPayments ? Number(corpo.transaction_amount) : extrairValorDaOrder(corpo);
    // ANTES-DE-CRESCER-1: valor ilegível OU não-positivo é "não sei", nunca
    // "zero" — só afeta os DOIS ramos que nascem uma linha NOVA com
    // `amountCb` (in_process sem linha, settled sem linha); a linha
    // EXISTENTE (settled/reimbursed) usa o próprio `linhaChargeback.amount`,
    // já gravado, e não lê valorPago.
    const valorPagoValido = typeof valorPagoBruto === "number" && Number.isFinite(valorPagoBruto) &&
      valorPagoBruto > 0;
    const valorPago = valorPagoValido ? valorPagoBruto : 0;
    const disponivelCb = Number(
      (pedido.total - pedido.valor_estornado - somaEmCurso(linhasBanco)).toFixed(2),
    );
    const amountCb = Math.min(valorPago, disponivelCb > 0 ? disponivelCb : 0);

    if (statusDetail === "in_process") {
      if (!linhaChargeback) {
        if (!valorPagoValido) {
          console.error(
            "webhook-mercadopago: chargeback (in_process) sem valor pago legível — pulando (não é 'não sei' = 0)",
            orderId,
          );
        } else if (disponivelCb <= 0) {
          console.error(
            "webhook-mercadopago: chargeback além do que o pedido pode reservar",
            orderId,
          );
        } else {
          const { error: erroInsertCb } = await supabase.from("order_refunds").insert({
            order_id: orderId,
            amount: amountCb,
            solicitado_por: "sistema",
            status: "em_processamento",
            motivo: "contestação (chargeback) em análise no Mercado Pago",
            mp_status: "charged_back",
            mp_status_detail: "in_process",
            mp_refund_id: null,
            ultimo_erro: null,
          });
          if (erroInsertCb) throw erroInsertCb;
        }
      }
      // já existe: nada (dedupe por solicitado_por='sistema' AND
      // mp_status='charged_back').
    } else if (statusDetail === "settled") {
      if (linhaChargeback) {
        const { error: erroConcluirCb } = await supabase.rpc("concluir_estorno", {
          p_refund_id: linhaChargeback.id,
          p_mp_refund_id: null,
          p_mp_status: "charged_back",
          p_mp_status_detail: "settled",
        });
        if (erroConcluirCb) {
          if (
            String((erroConcluirCb as { message?: string }).message ?? "").includes(
              "estorno_acima_do_total",
            )
          ) {
            console.error(
              "webhook-mercadopago: concluir_estorno (chargeback settled) recusou — acima do total",
              orderId,
              erroConcluirCb,
            );
          } else {
            throw erroConcluirCb;
          }
        }
      } else if (!valorPagoValido) {
        console.error(
          "webhook-mercadopago: chargeback (settled) sem valor pago legível — pulando (não é 'não sei' = 0)",
          orderId,
        );
      } else if (disponivelCb <= 0) {
        console.error(
          "webhook-mercadopago: chargeback (settled) além do que o pedido pode registrar",
          orderId,
        );
      } else {
        // A notificação de in_process nunca chegou: nasce já concluido,
        // como em A4 (mesmo helper — "nasce concluido, nunca solicitado").
        await inserirEstornoConcluido({
          supabase,
          orderId,
          amount: amountCb,
          valorOriginal: valorPago,
          motivoBase: "estorno feito fora do app (Mercado Pago)",
          mpRefundId: null,
          mpStatus: "charged_back",
          mpStatusDetail: "settled",
        });
      }
    } else if (statusDetail === "reimbursed") {
      if (linhaChargeback) {
        const { error: erroUpdateCb } = await supabase
          .from("order_refunds")
          .update({
            status: "recusado",
            mp_status_detail: "reimbursed",
            ultimo_erro: "o Mercado Pago decidiu a contestação a favor da loja: o dinheiro ficou com você",
            updated_at: new Date().toISOString(),
          })
          .eq("id", linhaChargeback.id)
          .in("status", ["em_processamento"]);
        if (erroUpdateCb) throw erroUpdateCb;
      } else {
        console.log(
          "webhook-mercadopago: chargeback reimbursed sem linha em_processamento — nada a atualizar",
          orderId,
        );
      }
      // nunca soma.
    }
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
    enviarComprovante?: typeof dispararComprovanteReal;
    enviarAvisoAtrasado?: typeof dispararAvisoDePagamentoAtrasadoReal;
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

  // Log de ENTRADA, antes de qualquer validação: distingue "chegou e
  // recusamos" (assinatura inválida) de "nunca chegou" (o MP não notificou).
  // É o log que teria provado esta causa sem precisar reproduzir o bug.
  //
  // `dataIdCorpo` é TRUNCADO: este log roda ANTES de qualquer autenticação,
  // então quem descobrir a URL escreve conteúdo próprio aqui em volume
  // arbitrário se o valor não tiver limite (achado de revisão, 16/08/2026).
  // 64 caracteres sobra folga sobre o maior `data.id` legítimo do MP (ULID
  // de Order, 29 caracteres; id de payment clássico é numérico, menor ainda).
  const LIMITE_LOG_DATA_ID = 64;
  const tsDoHeader = req.headers.get("x-signature")?.match(/(?:^|,)\s*ts=([^,]*)/)?.[1] ?? null;
  console.log("webhook-mercadopago: notificação recebida", {
    dataIdCorpo: dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
    temXRequestId: req.headers.get("x-request-id") !== null,
    ts: tsDoHeader,
  });

  // A ÚNICA autenticação: sem ela, quem descobrir a URL forja um "aprovado".
  // Amarra SEMPRE o `data.id` do CORPO (nunca o da query string — ver o
  // comentário de `avaliarAssinatura` em `_shared/mercadopago.ts`), porque é
  // esse o valor que todo o processamento abaixo usa (rota, consulta ao MP,
  // RPC `confirmar_pagamento`).
  const avaliacao = await avaliarAssinatura({
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
  if (!avaliacao.valido) {
    // Log de FALHA: dataId (corpo, truncado), x-request-id, ts, o v1
    // recebido e os RÓTULOS dos candidatos tentados (sem hash nenhum, nem
    // prefixo dele — publicar hash calculado é um oráculo de verificação
    // offline do `MP_WEBHOOK_SECRET`, achado de revisão de 16/08/2026) — o
    // que transforma suspeita em causa provada quando o MP reenviar a
    // notificação real. NUNCA loga `MP_WEBHOOK_SECRET`.
    const v1Recebido = req.headers.get("x-signature")?.match(/(?:^|,)\s*v1=([^,]*)/)?.[1] ?? null;
    console.warn("webhook-mercadopago: assinatura inválida", {
      dataIdCorpo: dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
      xRequestId: req.headers.get("x-request-id"),
      ts: tsDoHeader,
      v1Recebido,
      candidatos: avaliacao.candidatos,
    });
    return json({ error: "Assinatura inválida." }, 401);
  }
  // Log de SUCESSO: qual candidato casou — é esta linha que prova a causa
  // por inversão quando o MP reenviar a notificação real (a versão anterior
  // desta função só aceitava "corpo-original" e recusava 100% das
  // notificações reais da Orders API; ver o comentário de
  // `avaliarAssinatura` em `_shared/mercadopago.ts`).
  console.log(`webhook-mercadopago: assinatura válida — manifesto: ${avaliacao.candidatoCasou}`, dataIdStr);

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

  // As duas rotas convergem nestas cinco variáveis antes do restante do
  // handler (leitura do pedido, conferência de valor, RPC, push, logs) — o
  // que não muda entre elas. `statusBrutoParaLog`
  // (achado de revisão, CHECKOUT-070 Tarefa 4) existe só para o log de
  // "status desconhecido" abaixo: sem ela, esse ramo — que existe
  // justamente para descobrir status NOVO do MP — não dizia qual status
  // tinha chegado. `valorPagoMp` (laudo 31/08, achado A3) é o valor que o
  // MP APROVOU, na grafia de cada rota — undefined quando o corpo não
  // trouxe número (a conferência trata ausência como "não deu para
  // conferir", nunca como 0).
  let statusMapeado: string | null;
  let externalReference: unknown;
  let idParaRpc: string;
  let statusBrutoParaLog: string;
  let valorPagoMp: number | undefined;
  // T5 (estorno pelo app): o objeto JÁ CONSULTADO, nas duas rotas, para o
  // passo novo (`registrarDesfechoDoEstorno`) ler `status`/`status_detail`/
  // `refunds[]`/`transaction_amount_refunded` SEM um segundo GET.
  let corpoConsultado: Record<string, unknown> | null = null;

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
    // Valor aprovado, direto da resposta autenticada (laudo 31/08, A3):
    // undefined quando o corpo não trouxe número — nunca 0.
    valorPagoMp = typeof consulta.valor === "number" ? consulta.valor : undefined;
    // Item (b) do brief da T5: o JSON cru — `status_detail`/`refunds[]`/
    // `transaction_amount_refunded` moram nele, não nos campos já tipados.
    corpoConsultado = (consulta as Record<string, unknown>).corpo as Record<string, unknown> | undefined ?? null;
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
    // Valor aprovado na grafia da Orders API — STRING com duas casas na
    // raiz (`total_amount`) ou em `transactions.payments[0].amount`
    // (laudo 31/08, A3; conversão só de campo presente, ver helper).
    valorPagoMp = extrairValorDaOrder(order);
    corpoConsultado = order;
  }

  // ⚠️ Reordenado pela T5 (08/09/2026): o retorno antecipado de
  // `statusMapeado === null` costumava vir ANTES do `pareceUuid`. Ele agora
  // vem DEPOIS do passo novo (`registrarDesfechoDoEstorno`, chamado logo
  // abaixo) porque `processed:partially_refunded` mapeia para `null` DE
  // PROPÓSITO (PEDIDO-05) — sem esta troca, todo estorno PARCIAL saía por
  // "status desconhecido" sem registrar nada no ledger. Efeito colateral da
  // ORDEM: o `pareceUuid` agora decide PRIMEIRO — um evento com status
  // desconhecido (nem estorno, nem par mapeado) E `external_reference` sem
  // forma de UUID responde "external_reference inválido" (o `return` abaixo),
  // nunca chega no "status desconhecido" mais adiante. Nenhum dos dois é
  // silencioso (os dois logam e devolvem 200), só muda QUAL rótulo aparece no
  // log quando as duas condições coincidem.
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

  // PASSO NOVO (T5): gatilhos lidos do objeto CONSULTADO, nunca do corpo do
  // webhook. Fora disso o passo não roda (0 leituras extras) — ver o
  // docstring de `registrarDesfechoDoEstorno`.
  const statusDoEstorno = typeof corpoConsultado?.status === "string" ? corpoConsultado.status : "";
  const statusDetailDoEstorno = typeof corpoConsultado?.status_detail === "string"
    ? corpoConsultado.status_detail
    : "";
  const gatilhoDeEstorno = statusDoEstorno === "refunded" ||
    statusDetailDoEstorno === "partially_refunded" ||
    statusDoEstorno === "charged_back";

  if (gatilhoDeEstorno && corpoConsultado) {
    try {
      await registrarDesfechoDoEstorno({ supabase, orderId, rota, corpo: corpoConsultado });
    } catch (erro) {
      console.error(
        "webhook-mercadopago: registrarDesfechoDoEstorno falhou — evento mantido na fila do MP",
        orderId,
        erro,
      );
      return json({ error: "Erro ao registrar o desfecho do estorno." }, 500);
    }
  }

  if (statusMapeado === null) {
    // PEDIDO-05: `processed:partially_refunded` mapeia para `null` de
    // propósito — o passo acima JÁ registrou o desfecho (se houver linha
    // pendente ou refund externo). Responder diferente do "status
    // desconhecido" genérico: 200 com rótulo próprio, log info (não warn).
    if (statusDetailDoEstorno === "partially_refunded") {
      console.log(
        "webhook-mercadopago: estorno parcial registrado",
        dataIdStr,
        rota,
        statusBrutoParaLog,
      );
      return json({ ok: true, resultado: "estorno_parcial_registrado" }, 200);
    }
    console.warn("webhook-mercadopago: status desconhecido do MP", dataIdStr, rota, statusBrutoParaLog);
    return json({ ok: true, ignorado: "status desconhecido" }, 200);
  }

  // CORREÇÃO DOS TRÊS ELOS (achado de auditoria, 21/08/2026): `criar-pagamento`
  // (index.ts:590) SEMPRE grava em `gateway_payment_id` o id da ORDER (ULID,
  // prefixo "ORD") — mesmo quando o painel do MP está inscrito no tópico
  // clássico e esta rota (`payment`) recebe do MP um id NUMÉRICO
  // (`consulta.id`, acima). Os dois nunca batem: `confirmar_pagamento`
  // (20260810000000_confirmar_pagamento_guarda_status.sql:52-55) devolve
  // 'divergente' e nada é gravado — o pedido expira em 30 min, o estoque
  // volta à prateleira, e o dinheiro já está no Mercado Pago.
  //
  // A API clássica (GET /v1/payments/{id}, doc oficial medida em 21/08/2026,
  // 62 campos) não devolve NENHUM campo que aponte de volta para o id da
  // order — não existe tradução possível a partir da resposta do MP. A saída
  // é mandar para a RPC o valor que JÁ ESTÁ gravado no pedido, não o que o MP
  // devolveu.
  //
  // ⚠️ Isto NÃO é "o mesmo padrão que `reconciliar-pagamentos/index.ts:262-
  // 269` já usa" — é a mesma LINHA de código, não a mesma PROVA. Em
  // `reconciliar`, o `p_payment_id` é o mesmo id pelo qual se PERGUNTOU ao
  // MP: a resposta "pago" é sobre aquela cobrança exata, e a guarda (d) de
  // `confirmar_pagamento` (id confere letra a letra) segue comparando duas
  // fontes independentes. Aqui, pergunta-se ao MP sobre o pagamento
  // NUMÉRICO e manda-se à RPC um id que o MP NUNCA VIU nesta conversa — o
  // valor comparado é lido desta mesma linha do banco segundos antes, então
  // a (d) é satisfeita PELA CONSTRUÇÃO do valor, não por verificação: ela
  // DEIXA DE TER VALOR PROBATÓRIO nesta rota — este ajuste não a toca, mas
  // também não pode se apoiar nela para nada.
  //
  // ⚠️ Precisão (achado de revisão, 21/08/2026): a (c) NÃO protege contra
  // confirmar o PEDIDO errado — protege contra confirmar um pedido SEM
  // cobrança nossa (`gateway_payment_id IS NOT NULL`). Quem protege contra o
  // PEDIDO errado é a invariante nº 1 deste arquivo: o `orderId` sai sempre
  // do `external_reference` da RESPOSTA AUTENTICADA do MP (linhas 467-475),
  // nunca do corpo do webhook — é essa disciplina, não uma guarda do banco,
  // que barra o corpo forjado (teste "corpo hostil não decide o pedido —
  // p_order_id vem SEMPRE da resposta do MP", index_test.ts). Quem for
  // procurar "onde mora a defesa contra creditar o pedido errado" e achar só
  // a RPC corre o risco de afrouxar essa disciplina no handler achando que a
  // rede de proteção está do outro lado — não está.
  //
  // ✅ CONFERÊNCIA DE VALOR (laudo caça-bugs 31/08, achado A3 — decisão do
  // Gabriel: "siga"): o silêncio documentado neste parágrafo VIROU
  // conferência. O VALOR que o MP aprovou, lido da resposta autenticada de
  // cada rota (`valorPagoMp`), é comparado com o total do pedido no bloco
  // de leitura logo abaixo — que agora é ÚNICO e serve as duas rotas. PIX
  // parcial deixa de entrar como pedido pago, e a porta fecha ANTES do
  // gatilho que este texto previa (religar cartão, Fase 3.5). A guarda (d)
  // da RPC nunca deu essa conferência de graça nesta rota: o
  // `gateway_payment_id` gravado é sempre o id da ORDER ("ORD...") e o que
  // esta rota recebe do MP é o id CLÁSSICO numérico — era por isso que a
  // conferência precisava morar AQUI, acima da RPC, e não dentro dela.
  //
  // 🔒 É POR ISSO que o bloco abaixo é restrito a `rota === "payment"`: na
  // rota `order` a (d) ainda compara duas fontes de verdade INDEPENDENTES (o
  // `order.id` que o MP devolveu contra o `ORD…` gravado no banco) — foi
  // essa comparação que já pegou o defeito real de gravar `payments[0].id`
  // no lugar de `order.id` (`index_test.ts:43-49`). Estender este bloco para
  // a rota `order` anularia a (d) no fluxo vivo e principal de hoje.
  //
  // A alternativa mais forte — e que NÃO está sendo feita agora, por escopo
  // mínimo deliberado — é usar o `ORD…` que o código já tem na mão para
  // perguntar ao MP por ELE (`consultarOrder`, já existe neste arquivo),
  // reconstruindo o elo inteiro ("a cobrança que registramos está paga") e
  // devolvendo à (d) o seu valor de prova, ao custo de uma chamada HTTP.
  // 🔒 GATILHO para deixar de ser opcional: religar cartão (Fase 3.5,
  // `criar-pagamento/index.ts:688`, hoje desligado por `metodo !== "pix"`)
  // ou qualquer relaxamento da trava de uma-cobrança-por-pedido.
  //
  // Só entra quando o valor gravado NÃO tem forma de id clássico
  // (`idEhClassico`, `_shared/mercadopago.ts`): se os dois lados já falam a
  // mesma língua (cobrança criada ANTES desta migração, ou um clone que não
  // migrou), nada muda, e o aviso abaixo não dispara — é o controle negativo
  // que prova que este ramo não fica sempre ligado.
  //
  // Falha ao LER esse valor NÃO pode virar "seguir com o id que o MP
  // devolveu": se o gravado for o ORD e o código seguir com o numérico, a
  // guarda (d) recusa do mesmo jeito que hoje — só que sem o log que explica
  // por quê, e arriscar um palpite não tem vantagem nenhuma sobre tentar de
  // novo. Por isso a falha de leitura devolve 500 (evento mantido na fila do
  // MP, que reenvia) — o mesmo padrão que este handler já usa para toda
  // falha de banco (abaixo, "confirmar_pagamento falhou").
  //
  // A leitura é ÚNICA (laudo 31/08) e serve as DUAS conferências que
  // precedem a RPC: o valor (abaixo) e o gateway_payment_id (bloco do
  // `payment`, mais abaixo). Trocar duas leituras da mesma linha por uma
  // não é economia de virtude: cada leitura extra é uma chance de as duas
  // conferências verem linhas DIFERENTES num intervalo de reescrita.
  const { data: linhaDoPedido, error: erroLeituraPedido } = await supabase
    .from("marketplace_orders")
    .select("total, total_amount, gateway_payment_id")
    .eq("id", orderId)
    .maybeSingle();

  if (erroLeituraPedido) {
    console.error(
      "webhook-mercadopago: falha ao ler o pedido antes de confirmar — evento mantido na fila do MP",
      orderId,
      erroLeituraPedido,
    );
    return json({ error: "Erro ao consultar o pedido." }, 500);
  }

  // CONFERÊNCIA DE VALOR (laudo 31/08, achado A3): o valor que o MP APROVOU
  // tem que bater com o total do pedido. PIX é pago de valor parcial no
  // mundo real; sem esta porta, um pagamento parcial entrava como pedido
  // pago — e o mesmo buraco ficaria aberto na religação do cartão.
  //
  // A MESMA conferência existe na reconciliar-pagamentos (regra em um lugar
  // só no _shared): sem ela lá, um divergente recusado aqui era confirmado
  // depois pelo cron, por status, sem ninguém olhar o valor — a dobradiça
  // do outro lado da porta (ressalva 1 da revisão do PR #366).
  //
  // Divergente: NÃO confirma, NÃO push, e devolve 200 com rótulo próprio —
  // reenvio do MP não muda o valor pago, e manter o evento na fila só
  // geraria tempestade de reenvio. O dinheiro que entrou sem virar pedido
  // pago fica parado nos dois portões e cabe ao lojista resolver no painel
  // do MP; o log aqui é error de propósito, no padrão dos
  // 'divergente'/'inexistente' da RPC.
  //
  // Valor AUSENTE na resposta do MP (campo que não veio — nunca 0): avisa e
  // segue, que é o comportamento de antes. Falha AQUI não pode bloquear
  // pedido legítimo: quem decide o valor aprovado é o MP, e a ausência do
  // campo é sinal de forma nova de resposta, não de fraude. Pedido
  // inexistente (linhaDoPedido null) também não trava aqui — a RPC tem o
  // rótulo 'inexistente' próprio para isso.
  if (linhaDoPedido && typeof valorPagoMp === "number") {
    const brutoTotal =
      (linhaDoPedido as Record<string, unknown>).total ??
      (linhaDoPedido as Record<string, unknown>).total_amount;
    const totalDoPedido = typeof brutoTotal === "number" ? brutoTotal : Number(brutoTotal);
    if (!Number.isFinite(totalDoPedido)) {
      // Total imprestável no banco é IMPOSSÍVEL no schema vivo (NOT NULL com
      // CHECK >= 0) — se um dia acontecer, tem que fazer barulho e seguir
      // pelo comportamento de antes, não pular a conferência em silêncio
      // (ressalva 2 da revisão do PR #366).
      console.warn(
        "webhook-mercadopago: total do pedido imprestável — conferência de valor não rodou",
        { orderId, rota, brutoTotal },
      );
    } else if (Math.abs(valorPagoMp - totalDoPedido) > TOLERANCIA_DE_VALOR) {
      console.error(
        "webhook-mercadopago: VALOR pago diverge do total do pedido — pedido NÃO confirmado; conferir no painel do MP",
        { orderId, rota, valorPago: valorPagoMp, totalDoPedido, paymentId: idParaRpc },
      );
      return json({ ok: true, ignorado: "valor divergente" }, 200);
    }
  } else if (linhaDoPedido && valorPagoMp === undefined) {
    console.warn(
      "webhook-mercadopago: valor aprovado não veio na resposta do MP — conferência de valor não rodou (comportamento anterior)",
      { orderId, rota },
    );
  }

  if (rota === "payment") {
    const idGravadoNoBanco = (linhaDoPedido as Record<string, unknown> | null)?.gateway_payment_id;
    if (
      typeof idGravadoNoBanco === "string" &&
      idGravadoNoBanco.length > 0 &&
      !idEhClassico(idGravadoNoBanco)
    ) {
      console.warn(
        "webhook-mercadopago: gateway_payment_id gravado não é um id clássico — a rota `payment` do MP devolveu um id que nunca bateria com o valor gravado (cobrança criada pela Orders API, painel provavelmente inscrito no tópico clássico). Enviando à RPC o valor GRAVADO NO BANCO, não o que o MP devolveu.",
        { orderId, idDevolvidoPeloMp: idParaRpc, idGravadoNoBanco },
      );
      idParaRpc = idGravadoNoBanco;
    }
  }

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

    // PEDIDO-070: o cliente também precisa saber que o pagamento entrou.
    // 'pago' recebe o comprovante padrão; 'pago_apos_expirar' NUNCA pode
    // receber esse mesmo texto (ver "SÓ PARA resultado === 'pago'" no
    // comentário de `dispararComprovanteReal`, acima) — recebe o aviso
    // honesto de `dispararAvisoDePagamentoAtrasadoReal` (PEÇA 5,
    // 12/09/2026), que compete pela MESMA reserva contra duplicidade.
    if (resultado === "pago") {
      const enviarComprovante = deps.enviarComprovante ?? dispararComprovanteReal;
      await enviarComprovante({ supabase, orderId });
    } else if (resultado === "pago_apos_expirar") {
      const enviarAvisoAtrasado = deps.enviarAvisoAtrasado ?? dispararAvisoDePagamentoAtrasadoReal;
      await enviarAvisoAtrasado({ supabase, orderId });
    }
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
