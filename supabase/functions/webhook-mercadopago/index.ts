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
 * autenticada pelo token do gateway (o do LOJISTA quando ele cadastrou a
 * chave dele, o `MP_ACCESS_TOKEN` da plataforma quando não —
 * `_shared/credenciais-mp.ts`, tarefa mp-2). Por isso o pedido sai de
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
// Tarefa mp-2 (15/09/2026): as DUAS chaves deste webhook (o segredo que
// autentica a notificação e o token que reconsulta o MP) saem daqui — da
// chave do LOJISTA quando ela existe, do ambiente quando não existe cadastro.
// Frente 8 (29/09/2026, decisão do dono), a regra fechada do SEGREDO em uma
// frase: a reserva do ambiente (`MP_WEBHOOK_SECRET`) só vale quando NÃO há
// cadastro nenhum (origem "ambiente") — para origem "lojista" SEM a chave de
// assinatura própria a reserva MORRE (500 nomeado antes da assinatura,
// alinhado ao gate do PIX na criação: a confirmação de uma loja não depende
// de segredo global da plataforma), e origem "indisponivel" segue fechando
// com 500 antes da assinatura, porque o MP está assinando com o segredo DO
// LOJISTA.
import { resolverCredenciaisMp } from "../_shared/credenciais-mp.ts";
import {
  avaliarAssinatura,
  buscarOrdersDoPedido,
  camposDaAssinatura,
  chaveDoCartaoDaTentativa,
  consultarOrder,
  consultarPagamento,
  extrairValorDaOrder,
  idEhClassico,
  limiteInferiorDoSentinela,
  mapearStatus,
  mapearStatusOrder,
  orderEhDeCartao,
  parcelasDaOrder,
  recusaLiberaAVaga,
  resolverSentinela,
  sentinelaDaChave,
  tipoDoPagamentoDaOrder,
  TOLERANCIA_DE_VALOR,
  vagaEmVerificacao,
} from "../_shared/mercadopago.ts";
import { comTempoLimite, corsHeaders, readKey } from "../_shared/webpush.ts";
import {
  consultarContestacao,
  registrarContestacao,
  type ResultadoDaConsultaDoCaso,
  STATUS_DA_CONTESTACAO,
} from "../_shared/contestacao.ts";
// FASE 2 (04/10/2026): o push ao lojista, o comprovante ao cliente e o aviso de
// pagamento atrasado saem do módulo ÚNICO dos três caminhos que confirmam
// pagamento (imediata, este webhook e o cron) — `_shared/efeitos-do-pagamento.ts`.
// O push contado e o "aviso ao admin uma vez" moram em `aviso-ao-lojista.ts`.
import {
  type AvisarAdminUmaVez,
  avisarAdminUmaVez as avisarAdminUmaVezCompartilhado,
  dispararPushContadoReal,
} from "../_shared/aviso-ao-lojista.ts";
import {
  aplicarEfeitosDoPagamentoConfirmado,
  type DepsDosEfeitos,
  desfechoComEfeito,
} from "../_shared/efeitos-do-pagamento.ts";
// Os testes e o contrato antigo importam estes dois DAQUI: a definição é uma só.
export {
  assuntoDoAvisoDePagamentoAtrasado,
  htmlDoAvisoDePagamentoAtrasado,
} from "../_shared/efeitos-do-pagamento.ts";
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
 * Push aos admins inscritos — o mecanismo mora em `_shared/aviso-ao-lojista.ts`
 * (`dispararPushContadoReal`), compartilhado com a reconciliação e a
 * confirmação imediata. Estes dois são só o prefixo de log deste arquivo.
 *
 * Erros NUNCA sobem: o pedido já está marcado 'pago' no banco quando o push
 * roda, e uma falha de push não pode virar 500 — isso faria o MP reenviar um
 * evento que já foi tratado com sucesso. Só loga.
 *
 * C-P (02/10/2026): `disparoPushContadoReal` devolve QUANTAS inscrições
 * receberam o push — o aviso de cobrança duplicada precisa disso para só dar a
 * reserva por gasta quando o push CHEGOU. `disparoPushReal` mantém a
 * assinatura de sempre (devolve void) para os outros pushes deste arquivo.
 */
async function disparoPushReal(args: {
  supabase: ReturnType<typeof createClient>;
  aviso: { title: string; body: string; url: string };
}): Promise<void> {
  await disparoPushContadoReal(args);
}

function disparoPushContadoReal(args: {
  supabase: ReturnType<typeof createClient>;
  aviso: { title: string; body: string; url: string };
}): Promise<number> {
  return dispararPushContadoReal({ ...args, rotulo: "webhook-mercadopago" });
}


/**
 * C-P (02/10/2026) — pausas da reconsulta de quem encontra o aviso
 * 'em_envio' (outra entrega da MESMA order está com a reserva). Três
 * reconsultas, pausas crescentes: 8 s é a SOMA DAS PAUSAS, não um prazo. O
 * tempo real desta etapa é pausas + até 4 chamadas de reserva (+ confirmar
 * ou liberar) + o push (teto de 5 s na resposta); as RPCs são aguardadas sem
 * tempo-limite próprio, então não há latência garantida. A soma foi escolhida
 * para deixar folga aos 22 s que o MP dá para o 200/201, junto com o resto do
 * handler (consulta ao MP, leituras).
 */
const PAUSAS_DO_AVISO_EM_ENVIO_MS = [1000, 2500, 4500];

const dormirDeVerdade = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));


/**
 * C-P (02/10/2026) — o push "Cobrança de cartão duplicada?" sai UMA vez por
 * (pedido, order do MP), sem gastar a vez quando o push não chega. Sem a
 * reserva ele saía a cada ENTREGA: o MP manda uma notificação por
 * atualização da order mais os reenvios, e este handler relê o estado ATUAL
 * — três entregas da mesma order aprovada divergente davam três pushes iguais
 * (W7).
 *
 * A reserva é um PRAZO (migration 20261191000000), não uma trava definitiva.
 * `reservar_aviso_ao_lojista` devolve:
 *   'reservado' → a vaga é desta chamada: o push sai por
 *      `disparoPushContadoReal` (diz quantas inscrições o receberam); chegou a
 *      ≥ 1 → `confirmar_aviso_ao_lojista`; não chegou a ninguém (erro, nenhum
 *      admin inscrito, nenhuma entrega) → `liberar_aviso_ao_lojista`;
 *   'enviado' → já entregue: nada a fazer;
 *   'em_envio' → outra entrega está avisando AGORA. Esta NÃO supõe sucesso
 *      ("singleflight"): espera o RESULTADO da dona reconsultando
 *      (`PAUSAS_DO_AVISO_EM_ENVIO_MS`, a própria reserva toma posse se a dona
 *      liberou ou se o prazo venceu). Virou 'reservado' → faz o push como a
 *      dona faria; virou 'enviado' → nada; continuou 'em_envio' → devolve
 *      "pendente", e quem chama responde NÃO-2xx para o MP reentregar (~15 min
 *      depois, quando o prazo de 2 min já venceu ou o aviso já saiu).
 * Confirmar/liberar rodam quando o push TERMINA, mesmo depois do teto de 5 s
 * da resposta (`comTempoLimite` mantém o isolado vivo com `waitUntil`); se o
 * isolado morrer antes, o prazo de 2 minutos solta a chave sozinho. Falha de
 * confirmar/liberar só loga — o prazo cobre.
 *
 * A chave é a MESMA nos dois ramos que avisam (S5, a adoção que perdeu a
 * corrida, e o `cartao_divergente`): é o mesmo fato e o mesmo texto, e o S5
 * numa entrega costuma virar o ramo divergente na reentrega seguinte. Outra
 * order aprovada no mesmo pedido é outra chave — avisa de novo.
 *
 * FALHA ABERTA: erro da RPC, exceção, função ausente (edge publicada antes da
 * migration) ou valor desconhecido → avisa mesmo assim, sem confirmar/liberar
 * (a vaga não é desta chamada) — perder um aviso de dinheiro é pior que
 * repetir um. O `console.error` do `cartao_divergente` continua saindo em
 * TODA entrega.
 *
 * LIMITES (já existiam antes da C-P) — a entrega NÃO é garantida: a dona da
 * reserva cujo push não chega a ninguém libera e responde 200; na falha
 * aberta, o push que não chega a ninguém também não se repete nesta entrega.
 * Nos dois casos, só uma nova notificação do MP para a mesma order tenta de
 * novo.
 */
async function avisarCobrancaDuplicadaUmaVez(args: {
  supabase: ReturnType<typeof createClient>;
  enviarPushContado: typeof disparoPushContadoReal;
  dormir: (ms: number) => Promise<void>;
  orderId: string;
  idOrder: string;
  aviso: { title: string; body: string; url: string };
}): Promise<"ok" | "pendente"> {
  const { supabase, enviarPushContado, dormir, orderId, idOrder, aviso } = args;
  const chave = `cartao_divergente:${orderId}:${idOrder}`;

  // null = a reserva falhou (falha aberta: avisa sem prazo)
  const reservar = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.rpc("reservar_aviso_ao_lojista", { p_chave: chave });
      if (error) throw error;
      if (data === "reservado" || data === "em_envio" || data === "enviado") return data;
      throw new Error(`reservar_aviso_ao_lojista devolveu valor desconhecido: ${String(data)}`);
    } catch (erro) {
      console.error(
        "webhook-mercadopago: reservar_aviso_ao_lojista falhou — avisa mesmo assim (falha aberta)",
        { orderId, idOrder, erro },
      );
      return null;
    }
  };

  let estado = await reservar();
  for (const pausa of PAUSAS_DO_AVISO_EM_ENVIO_MS) {
    if (estado !== "em_envio") break;
    await dormir(pausa);
    estado = await reservar();
  }
  if (estado === "enviado") {
    console.warn(
      "webhook-mercadopago: aviso de cobrança duplicada já entregue — push não repetido",
      { orderId, idOrder },
    );
    return "ok";
  }
  if (estado === "em_envio") {
    console.warn(
      "webhook-mercadopago: aviso de cobrança duplicada continua em envio por outra entrega — pedindo reentrega ao MP",
      { orderId, idOrder },
    );
    return "pendente";
  }
  const reservaDestaChamada = estado === "reservado";

  const desfecho = (async () => {
    let entregues = 0;
    try {
      entregues = await enviarPushContado({ supabase, aviso });
    } catch (erro) {
      console.error("webhook-mercadopago: push de cobrança duplicada falhou", { orderId, idOrder, erro });
    }
    if (!reservaDestaChamada) return;
    const rpc = entregues > 0 ? "confirmar_aviso_ao_lojista" : "liberar_aviso_ao_lojista";
    try {
      const { error } = await supabase.rpc(rpc, { p_chave: chave });
      if (error) throw error;
    } catch (erro) {
      console.error(
        `webhook-mercadopago: ${rpc} falhou — a reserva expira sozinha em 2 minutos`,
        { orderId, idOrder, erro },
      );
    }
  })();
  await comTempoLimite(desfecho, 5000);
  return "ok";
}

/**
 * Lote A (04/10/2026): aviso ao admin UMA vez por chave — `avisarAdminUmaVez`
 * de `_shared/aviso-ao-lojista.ts` (a mesma reserva com prazo da C-P, sem a
 * espera "singleflight"), com o prefixo de log deste arquivo. Usado pela
 * contestação que o app não consegue registrar sozinho (sem CBK, conflito,
 * decisão revertida) e, desde a FASE 2, também pela reconsulta periódica do
 * cron (`reconciliar-pagamentos`), que chama o MESMO miolo.
 */
function avisarAdminUmaVez(args: {
  supabase: ReturnType<typeof createClient>;
  enviarPushContado: typeof disparoPushContadoReal;
  chave: string;
  aviso: { title: string; body: string; url: string };
}): Promise<void> {
  return avisarAdminUmaVezCompartilhado({ ...args, rotulo: "webhook-mercadopago" });
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
 * Relê o `valor_estornado` do pedido — a fonte canônica do acumulado
 * (`concluir_estorno` é o único que o soma). Usada depois de um 23505: o
 * acumulado em memória deste lote não enxerga o que OUTRA entrega concluiu
 * entre a leitura inicial e agora.
 */
async function releValorEstornado(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select("valor_estornado")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  const valor = Number((data as Record<string, unknown> | null)?.valor_estornado);
  if (!data || !Number.isFinite(valor)) {
    throw new Error("webhook-mercadopago: valor_estornado ilegível ao reler o pedido");
  }
  return valor;
}

/**
 * A REGRA ÚNICA do acumulado em memória (`pedido.valor_estornado`) depois de
 * QUALQUER `concluir_estorno` deste passo — recuperação da janela de falha,
 * linha pendente do app, estorno externo (Lote A, bloqueios da revisão de
 * 04/10/2026). Só soma o valor da linha quando a RPC diz que concluiu AGORA
 * (`ja_concluida === false`): é o único caso em que ESTA entrega pôs o
 * dinheiro no banco. `ja_concluida === true` (outra entrega concluiu a MESMA
 * linha entre a nossa leitura e a RPC) ou retorno ilegível: o acumulado em
 * memória não sabe o que mudou — relê o `valor_estornado` do banco, a fonte
 * canônica. Somar no escuro contava o mesmo dinheiro duas vezes e o clamp do
 * refund seguinte gravava MENOS do que saiu (pedido de 100, refunds 20 e 70:
 * o banco terminava em 80, e nenhuma reentrega corrigia).
 */
async function acumularConclusao(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
  pedido: PedidoParaEstorno;
  dataRpc: unknown;
  amount: number;
}): Promise<void> {
  const { supabase, orderId, pedido, dataRpc, amount } = args;
  const jaConcluida = (dataRpc as { ja_concluida?: unknown } | null)?.ja_concluida;
  if (jaConcluida === false) {
    pedido.valor_estornado = Number((pedido.valor_estornado + amount).toFixed(2));
    return;
  }
  pedido.valor_estornado = await releValorEstornado(supabase, orderId);
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
  // Lote A (R1): a consulta do CASO da contestação (GET /v1/chargebacks/
  // {case_id}) e o aviso ao admin uma vez — injetados pelo handler.
  consultarCaso: (caseId: string) => Promise<ResultadoDaConsultaDoCaso>;
  avisar: AvisarAdminUmaVez;
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
      "id, amount, status, solicitado_por, mp_refund_id, mp_chargeback_id, mp_status, tentativas, concluido_em, created_at",
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
      const { data: dataRecuperacao, error: erroRecuperacao } = await supabase.rpc("concluir_estorno", {
        p_refund_id: linha.id,
      });
      if (!erroRecuperacao) {
        // Lote A: a linha órfã somou AGORA no banco — o acumulado em memória
        // (lido antes) tem de enxergar, senão o clamp do estorno externo
        // seguinte tenta mais do que sobra e a RPC recusa.
        await acumularConclusao({
          supabase,
          orderId,
          pedido,
          dataRpc: dataRecuperacao,
          amount: Number(linha.amount ?? 0),
        });
      } else {
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
      // O id da PRÓPRIA linha sai do conjunto (achado MÉDIO da revisão do
      // P1 de estorno, 29/09): com a regra nova, a linha em_processamento
      // CARREGA o id do refund dela — deixá-lo no conjunto fazia
      // refundQueCobreALinha excluir o refund dela mesma e a linha ficava
      // tentar_depois para sempre (só o cron concluía). Os ids das OUTRAS
      // linhas permanecem: um refund credita UMA linha (P0). Paridade com
      // o cron, que exclui a própria linha com .neq('id', ...).
      // Segunda camada para o lote (achado da revisão final, teste W2c):
      // DUAS pendentes com o MESMO id (ledger anômalo) não concluem as
      // duas — o acúmulo em memória de `pedido.valor_estornado` (I-B,
      // abaixo) + a guarda de soma bruta (E37) recusam a 2ª linha ainda
      // neste ciclo; ela fica para o cron, que relê o banco por linha.
      idsJaReivindicados: Array.from(reivindicados).filter(
        (id) => id !== linha.mp_refund_id,
      ),
      temPreVeredito: false,
    });
    if (resultado.tipo === "concluido") {
      const { data: dataConcluir, error: erroConcluir } = await supabase.rpc("concluir_estorno", {
        p_refund_id: linha.id,
        // '' (refund sem id legível na resposta) vira NULL — o COALESCE da
        // RPC preserva o que já existia (revisão de 29/09).
        p_mp_refund_id: resultado.mp_refund_id || null,
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
      // Lote A: só soma se a RPC concluiu AGORA; `ja_concluida` (outra
      // entrega concluiu a mesma linha) relê do banco — `acumularConclusao`.
      await acumularConclusao({ supabase, orderId, pedido, dataRpc: dataConcluir, amount: linha.amount });
      // BLOQUEIA-1 (laudo Opus rodada 2, PR #449): o retrato local acompanha
      // a conclusão. O saldo do estorno externo agora é lido no banco, sob a
      // trava (`registrar_estorno_externo_do_mp`) — o retrato não decide mais
      // dinheiro, mas fica coerente para qualquer leitura seguinte do lote.
      linhaBanco.status = "concluido";
    }
    // tentar_depois → nada (o cron continua com ela).
  }

  // ── B) Contestação (status === "charged_back") — Lote A (R1/R1-NULL) ─────
  // ANTES dos refunds externos (revisão do Lote A, ordem): no MESMO GET, um
  // caso FINAL a favor da loja libera a reserva, e o REF que só não cabia por
  // causa dela entra inteiro neste mesmo evento — com o REF primeiro, a RPC
  // dele via a reserva (nao_cabe) e ninguém o revisitava depois. A RPC do REF
  // lê o saldo sob a mesma trava, então a ordem não conta dinheiro duas vezes.
  if (status === STATUS_DA_CONTESTACAO) {
    await registrarContestacao({
      supabase,
      orderId,
      corpo,
      ehPayments,
      pedido,
      consultarCaso: args.consultarCaso,
      avisar: args.avisar,
      rotulo: "webhook-mercadopago",
    });
  }

  // Item 4 do passo A: refunds "processed"/"approved" que SOBRARAM fora de
  // `reivindicados` = estorno feito FORA do app (painel do MP) — ou o refund
  // REGULAR numa order contestada (REF tem identidade própria; nenhum
  // contrato do MP liga REF a CBK — doc refund-order/post).
  //
  // Lote A (revisão, defeito pré-existente): TODO refund daqui entra pela RPC
  // `registrar_estorno_externo_do_mp` (20261196000000), com o pedido TRAVADO,
  // e entra INTEIRO ou não entra. Antes, um clamp sobre o retrato lido no
  // começo descontava a linha do APP ainda sem POST (intenção, não dinheiro):
  // pedido 100, REF 20 concluído, APP 20 solicitado, REF novo 70 -> gravava
  // 60, e a reentrega pulava o REF já "reivindicado" — os 10 nunca voltavam.
  // Não cabe no dinheiro real (estornado + reserva de contestação): nada é
  // gravado, a identidade fica livre (a reentrega tenta de novo) e o admin é
  // avisado uma vez. O APP não é liberado aqui: quando o saldo acaba, o
  // executor dele não manda POST — recusa a linha nova e SEGURA a incerta
  // (`linhaPodeJaTerChegadoAoMp`, _shared/estorno.ts) até o MP dar veredito.
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
    // um refund). Pula este refund (nenhuma RPC); o resto do handler
    // continua (confirmar_pagamento do status atual roda do mesmo jeito).
    if (!Number.isFinite(valorRefundBruto) || valorRefundBruto <= 0) {
      console.error(
        "webhook-mercadopago: refund sem valor legível ou não-positivo — pulando (não é 'não sei' = 0)",
        orderId,
        refundId,
      );
      continue;
    }
    const valorRefund = Number(valorRefundBruto.toFixed(2));

    const { data, error } = await supabase.rpc("registrar_estorno_externo_do_mp", {
      p_order_id: orderId,
      p_mp_refund_id: refundId,
      p_valor: valorRefund,
      p_mp_status: status,
      p_mp_status_detail: statusDetail || null,
    });
    if (error) throw error;
    const retornoExterno = (data ?? null) as Record<string, unknown> | null;
    if (typeof retornoExterno?.resultado !== "string") {
      throw new Error("webhook-mercadopago: registrar_estorno_externo_do_mp devolveu retorno ilegível — o MP reenvia");
    }
    // Estado CANÔNICO (lido sob a trava) para quem vier depois neste lote.
    const valorCanonico = Number(retornoExterno.valor_estornado);
    if (Number.isFinite(valorCanonico)) pedido.valor_estornado = valorCanonico;
    if (retornoExterno.resultado === "inserido" || retornoExterno.resultado === "ja_registrado") {
      reivindicados.add(refundId);
    }
    if (retornoExterno.aviso === "saldo") {
      console.error(
        "webhook-mercadopago: devolução do MP não cabe no que o pedido ainda pode devolver — não registrada, admin avisado",
        { orderId, refundId, valorRefund },
      );
      await args.avisar(`estorno_externo_nao_cabe:${orderId}:${refundId}`, {
        title: "Devolução do Mercado Pago para conferir",
        body: `${numeroDoPedido(orderId)} · o Mercado Pago registrou uma devolução que passa do que este pedido ainda podia devolver — o app não registrou essa devolução; confira no painel do Mercado Pago`,
        url: "/admin-orders",
      });
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
// `camposDaAssinatura` (mp-10): morava AQUI, copiada — este arquivo precisa
// dos dois campos em três lugares (a recusa barata logo abaixo, o log de
// entrada e o log de falha), e a recusa TEM de concordar com o que
// `avaliarAssinatura` aceitaria. Duas cópias do mesmo parse podiam divergir
// em silêncio; agora as duas usam a MESMA função, importada de
// `_shared/mercadopago.ts`.

async function handler(
  req: Request,
  deps: {
    supabase?: ReturnType<typeof createClient>;
    fetchImpl?: typeof fetch;
    enviarPush?: DepsDosEfeitos["enviarPush"];
    // C-P: o push do aviso de cobrança duplicada, que diz quantas inscrições o receberam.
    enviarPushContado?: typeof disparoPushContadoReal;
    // C-P rodada 3: a espera da reconsulta do aviso 'em_envio' (injetável no teste).
    dormir?: (ms: number) => Promise<void>;
    enviarComprovante?: DepsDosEfeitos["enviarComprovante"];
    enviarAvisoAtrasado?: DepsDosEfeitos["enviarAvisoAtrasado"];
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
  const { ts: tsDoHeader, v1: v1Recebido } = camposDaAssinatura(req.headers.get("x-signature"));
  console.log("webhook-mercadopago: notificação recebida", {
    dataIdCorpo: dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
    temXRequestId: req.headers.get("x-request-id") !== null,
    ts: tsDoHeader,
  });

  // PORTA BARATA (tarefa mp-7, 16/09/2026): requisição que não tem NEM A
  // FORMA de uma notificação do MP morre aqui — antes do client de service
  // role, antes de resolver credenciais, antes do SELECT em `app_settings`.
  // Até esta tarefa, TODA requisição que chegasse à URL pagava esse SELECT
  // antes de qualquer autenticação (a função roda com `verify_jwt = false`),
  // então quem descobrisse a URL fazia a loja gastar banco de graça. A
  // decisão é IDÊNTICA à que `avaliarAssinatura` já tomaria — sem `ts` ou
  // sem `v1` ela devolve `valido: false` sem sequer importar a chave do
  // HMAC — só que agora sem pagar nada; por isso lê os campos pela MESMA
  // função de parse, e não por uma segunda regra que pudesse divergir.
  //
  // `console.warn` CURTO e sem o bloco de diagnóstico da assinatura
  // inválida (dataId, x-request-id, v1, candidatos): isto é o chão de ruído
  // da internet, não um caso para investigar, e logar tudo aqui seria dar a
  // quem varre a URL um jeito de encher o log.
  //
  // O que NÃO entra: cache/memoização da resolução de credenciais. O que
  // barateia é recusar antes, não guardar segredo em memória entre
  // requisições.
  if (!tsDoHeader || !v1Recebido) {
    console.warn("webhook-mercadopago: sem x-signature utilizável — recusado antes de tocar o banco");
    return json({ error: "Assinatura inválida." }, 401);
  }

  // Tarefa mp-2 (15/09/2026): o client de service role SUBIU para cá — ele
  // era montado lá embaixo, depois da consulta ao MP, e agora é preciso
  // ANTES: as credenciais do Mercado Pago (segredo do HMAC e token de
  // consulta) moram no registro cifrado do lojista em app_settings, e é este
  // client que o lê. Nada mais muda de ordem; quem já usava `supabase` mais
  // abaixo continua com o MESMO objeto.
  const supabase =
    deps.supabase ??
    createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    );

  // De QUEM são as chaves desta loja: do lojista (cadastro na tela de
  // Ajustes, cifrado) ou da plataforma (env). A regra fechada — nunca cair no
  // token do ambiente quando existe cadastro ilegível — mora em
  // `_shared/credenciais-mp.ts`.
  const credenciaisMp = await resolverCredenciaisMp(supabase);

  // Tarefa mp-7 (16/09/2026): cadastro do lojista PRESENTE e ilegível
  // (`origem: "indisponivel"` — cofre ausente ou chave trocada) fecha AQUI,
  // antes de avaliar a assinatura. Nesse estado o lojista cadastrou o
  // segredo DELE, o MP assina a notificação com ELE, e a reserva do
  // ambiente abaixo não bate: a resposta era 401 "assinatura inválida" e o
  // 500 com o motivo certo (mais abaixo, na checagem do token) ficava
  // INALCANÇÁVEL. O dinheiro não se perdia (`reconciliar-pagamentos` pega em
  // 24h), mas o diagnóstico MENTIA durante os 30 min do PIX — quem estava de
  // plantão caçava o segredo errado em vez de devolver a chave do cofre.
  //
  // 500 e não 200 pelo mesmo motivo de sempre: o evento FICA na fila do MP,
  // que reenvia, e a notificação volta sozinha quando a credencial voltar ao
  // lugar. Vem ANTES do roteamento, então neste estado até tópico
  // irrelevante recebe 500 — é o estado quebrado da loja inteira, e o custo
  // é um reenvio do MP, não dinheiro.
  if (credenciaisMp.origem === "indisponivel") {
    // Só origem e motivo: nem token nem segredo entram em log. O data.id vai
    // truncado (LIMITE_LOG_DATA_ID): este ramo roda ANTES da assinatura, e
    // quem descobrir a URL não pode escrever conteúdo próprio sem limite aqui.
    console.error(
      `webhook-mercadopago: sem credencial do Mercado Pago (origem: ${credenciaisMp.origem}, motivo: ${credenciaisMp.motivo ?? "sem_token"})`,
      dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
    );
    return json({ error: "Credencial do Mercado Pago indisponível." }, 500);
  }

  // RESERVA SÓ DO SEGREDO, E SÓ SEM CADASTRO (frente 8, 29/09/2026 — decisão
  // do dono, alinhando a notificação à política do PIX da criação): origem
  // "ambiente" (deploy da plataforma, sem cadastro nenhum) continua usando o
  // `MP_WEBHOOK_SECRET` do env — ali ele é a chave CERTA por definição. Para
  // lojista com cadastro e SEM a chave de assinatura própria, o segredo do
  // ambiente NÃO é mais reserva: a confirmação de pagamento de uma loja não
  // pode depender de um segredo GLOBAL compartilhado com a plataforma
  // (decisão do dono no app multi-loja), e o PIX dessa loja nem nasce mais
  // (gate da frente 3 em criar-pagamento) — as camadas agora dizem o mesmo.
  //
  // A justificativa ANTIGA da reserva ("sem ela, notificação legítima viraria
  // 401 e o pedido expiraria") ficou obsoleta: notificação do lojista é
  // assinada com a chave do PAINEL DELE e falharia contra o segredo da
  // plataforma de qualquer jeito — a reserva só "funcionava" quando o painel
  // da loja era configurado com o segredo da plataforma, o setup errado.
  //
  // 500 e não 401/200 pelo mesmo motivo do estado `indisponivel` acima: o
  // evento FICA na fila do MP, que reenvia — a loja se cura cadastrando a
  // chave em Ajustes, e o reconciliador (10 min, honra `pago_apos_expirar`)
  // segue de backstop. Log CURTO, sem segredo nem dado do corpo.
  if (credenciaisMp.origem === "lojista" && !credenciaisMp.segredoWebhook) {
    console.error(
      "webhook-mercadopago: lojista sem chave de assinatura própria — a reserva do ambiente não vale; cadastrar a chave em Ajustes",
      dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
    );
    return json(
      { error: "Chave de assinatura do webhook não configurada para esta loja." },
      500,
    );
  }

  const segredoWebhook = credenciaisMp.segredoWebhook ??
    Deno.env.get("MP_WEBHOOK_SECRET") ?? "";

  // A ÚNICA autenticação: sem ela, quem descobrir a URL forja um "aprovado".
  // Amarra SEMPRE o `data.id` do CORPO (nunca o da query string — ver o
  // comentário de `avaliarAssinatura` em `_shared/mercadopago.ts`), porque é
  // esse o valor que todo o processamento abaixo usa (rota, consulta ao MP,
  // RPC `confirmar_pagamento`).
  const avaliacao = await avaliarAssinatura({
    xSignature: req.headers.get("x-signature"),
    xRequestId: req.headers.get("x-request-id"),
    dataId: dataIdStr,
    segredo: segredoWebhook,
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
    // offline do segredo do webhook, achado de revisão de 16/08/2026) — o
    // que transforma suspeita em causa provada quando o MP reenviar a
    // notificação real. NUNCA loga o segredo — nem o do lojista, nem o
    // `MP_WEBHOOK_SECRET` da plataforma.
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

  // Tarefa mp-2: sem token não há como perguntar ao MP o que de fato
  // aconteceu — e o webhook NUNCA confia no corpo que chegou. 500 (não 200)
  // de propósito: o evento FICA na fila do MP, que reenvia, e quando alguém
  // devolver a credencial ao lugar a notificação volta e o pedido confirma.
  // Depois do roteamento, e não antes: tópico irrelevante continua sendo
  // descartado com 200 sem nunca ter precisado de credencial nenhuma.
  //
  // Tarefa mp-7: o que sobra para este ramo é a origem "ambiente" sem
  // `MP_ACCESS_TOKEN` (motivo `ambiente_sem_token`) — a origem
  // "indisponivel" já fechou lá em cima, antes da assinatura, porque naquele
  // estado o 401 saía primeiro e escondia este mesmo log.
  if (!credenciaisMp.token) {
    // Só origem e motivo: nem token nem segredo entram em log.
    console.error(
      `webhook-mercadopago: sem credencial do Mercado Pago (origem: ${credenciaisMp.origem}, motivo: ${credenciaisMp.motivo ?? "sem_token"})`,
      dataIdStr.slice(0, LIMITE_LOG_DATA_ID),
    );
    return json({ error: "Credencial do Mercado Pago indisponível." }, 500);
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
  // Fase 3.5 (cartão): a recusa desta order LIBERA a vaga em vez de chegar a
  // `confirmar_pagamento` — ver `recusaLiberaAVaga` (_shared/mercadopago.ts)
  // e o passo logo depois do `pareceUuid`, mais abaixo. Só a rota `order`
  // liga isto; a rota `payment` tem a sua própria trava (bloco `payment`
  // perto da RPC).
  let liberarAVaga = false;
  // Achado B2 (2ª revisão de risco, 26/09/2026): só a rota `order` sabe pela
  // FORMA da resposta se a cobrança é de cartão (`orderEhDeCartao`) — usado
  // mais abaixo para decidir se vale a pena tentar ADOTAR uma vaga vazia (ou
  // com o sentinela "verificando:" que `criar-pagamento` grava num 409
  // `idempotency_key_already_used`, Achado B2 em `criar-pagamento/index.ts`).
  let ordemDeCartaoNaNotificacao = false;
  // Lote A (04/10/2026, R1): o `status` CRU que o MP devolveu na consulta
  // autenticada (nunca o do corpo do webhook), nas duas rotas — é ele que
  // decide se a notificação é uma CONTESTAÇÃO (ver o desvio logo depois do
  // passo do ledger, mais abaixo). O rótulo mapeado não serve: o mapa
  // compartilhado traduz todo `charged_back` para 'estornado'.
  let statusBrutoConfiavel = "";

  if (rota === "payment") {
    const consulta = await consultarPagamento({
      token: credenciaisMp.token,
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
    statusBrutoConfiavel = String(consulta.status ?? "");
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
    // N1 (3ª revisão de risco, 26/09/2026): a order desta notificação PODE
    // ser de cartão (payer com e-mail e CPF do titular) — não dá para saber
    // antes de consultar, então `corpoNoLog: false` protege as duas formas
    // (o log de erro do PIX já não tinha dado sensível para esconder, e
    // continua sem ter — só passa a receber o mesmo resumo sem dado
    // pessoal que o cartão já usa nos outros pontos desta function).
    const consulta = await consultarOrder({
      token: credenciaisMp.token,
      orderId: dataIdStr,
      fetchImpl: deps.fetchImpl,
      corpoNoLog: false,
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
    liberarAVaga = recusaLiberaAVaga(order, statusBanco);
    ordemDeCartaoNaNotificacao = orderEhDeCartao(order);

    // Hardening (item não-verificável do laudo do revisor-risco, 26/09/2026):
    // se o GET da order falhar em trazer `payment_method.type` legível
    // (order de cartão com a resposta incompleta — nunca medido contra a API
    // real, mas possível), `orderEhDeCartao` não tem como saber que é cartão
    // pela FORMA da resposta, e uma recusa de cartão cairia no caminho de
    // PIX logo abaixo (`confirmar_pagamento('recusado')`, que CANCELA o
    // pedido — errado para cartão, spec decisão 3). Segundo sinal:
    // `metodo_online` ('credito'/'debito'/'pix'), que `criar-pagamento` já
    // carimba no PRÓPRIO pedido ao ocupar a vaga — lido do banco, não do
    // JSON que pode vir incompleto.
    //
    // Só entra quando o PRIMEIRO sinal (a forma da resposta) NÃO decidiu
    // cartão (`!liberarAVaga`), e só para 'recusado': 'expirado' já sai sem
    // chamar RPC nenhuma (nem confirmar, nem liberar) três linhas abaixo,
    // qualquer que seja o método — não tem o mesmo risco, e gastar a leitura
    // aqui não mudaria nada.
    if (!liberarAVaga && statusBanco === "recusado" && pareceUuid(order.external_reference)) {
      const { data: metodoRow, error: erroMetodo } = await supabase
        .from("marketplace_orders")
        .select("metodo_online, gateway_payment_id")
        .eq("id", order.external_reference)
        .maybeSingle();
      // Lote A (R10, 04/10/2026): a falha desta leitura era IGNORADA —
      // `metodoRow` vinha null, um pedido de CARTÃO parecia PIX, e a recusa
      // seguia para `confirmar_pagamento('recusado')`, que CANCELA o pedido e
      // devolve o estoque. Sem saber o método, nada é decidido: 500, o MP
      // reenvia (mesma régua do Achado S4 para a leitura do id gravado).
      if (erroMetodo) {
        console.error(
          "webhook-mercadopago: falha ao ler o metodo_online do pedido numa recusa de order sem tipo legível — evento mantido na fila do MP",
          { idOrder: String(order.id ?? ""), erro: erroMetodo },
        );
        return json({ error: "Erro ao verificar a forma de pagamento do pedido." }, 500);
      }
      const metodoGravado = (metodoRow as Record<string, unknown> | null)?.metodo_online;
      const vagaGravada = (metodoRow as Record<string, unknown> | null)?.gateway_payment_id;
      if (metodoGravado === "credito" || metodoGravado === "debito") {
        console.warn(
          "webhook-mercadopago: recusa de order sem payment_method.type legível — decidida pelo metodo_online gravado no pedido (cartão), liberando a vaga em vez de confirmar_pagamento",
          { idOrder: String(order.id ?? ""), metodoGravado },
        );
        liberarAVaga = true;
      } else if (
        metodoGravado == null &&
        typeof vagaGravada === "string" &&
        vagaEmVerificacao(vagaGravada)
      ) {
        // Frente 9 (29/09/2026): o metodo_online NÃO cobre o SENTINELA — ele
        // deixa a coluna NULL por desenho (fechamento S3: o sentinela nunca
        // carimba método), então a recusa ilegível de um cartão sob sentinela
        // caía no caminho de PIX: confirmar_pagamento('recusado') CANCELAVA o
        // pedido e devolvia o estoque com o cliente na tela de retry (venda
        // perdida). O sentinela é mecanismo EXCLUSIVO do cartão (Achado B2 —
        // o PIX não gera sentinela), então vaga sentinela + método
        // desconhecido decide CARTÃO: liberar a vaga; quem solta o sentinela
        // de verdade é o resolverVagaEmVerificacao no retry do cliente.
        console.warn(
          "webhook-mercadopago: recusa de order sem payment_method.type legível — vaga em SENTINELA (mecanismo exclusivo do cartão), liberando em vez de confirmar_pagamento cancelar o pedido",
          { idOrder: String(order.id ?? "") },
        );
        liberarAVaga = true;
      }
    }

    // `confirmar_pagamento` (20260810000000_confirmar_pagamento_guarda_
    // status.sql) não conhece 'expirado' — chamá-la com esse status cairia
    // no RETURN 'ignorado' final, indistinguível no log de todos os outros
    // caminhos de "ignorado" (status desconhecido, external_reference
    // inválido...). Filtra ANTES da RPC, com rótulo e log próprios.
    //
    // Fase 3.5: o cartão expirado (desafio 3DS que ninguém concluiu) NÃO
    // para aqui — ele segue até o passo de liberar a vaga, depois do
    // `pareceUuid`. O PIX expirado continua exatamente como antes.
    if (statusBanco === "expirado" && !liberarAVaga) {
      console.warn("webhook-mercadopago: order expirada, ignorada sem chamar a RPC", dataIdStr);
      return json({ ok: true, ignorado: "order expirada" }, 200);
    }

    statusMapeado = statusBanco;
    statusBrutoConfiavel = statusRaiz;
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

  // CARTÃO RECUSADO NÃO MATA O PEDIDO (Fase 3.5, spec decisão 3). O ramo
  // 'recusado' de `confirmar_pagamento` CANCELA o pedido e devolve o estoque
  // — certo para PIX, errado para cartão, em que a recusa é o começo da
  // próxima tentativa (outro cartão ou PIX, na mesma reserva de 30 min).
  // Aqui a recusa (ou a expiração) de uma order de cartão — e o
  // cancelamento de qualquer order, que neste app é a própria
  // `criar-pagamento` trocando PIX por cartão — só LIBERA a vaga:
  // `liberar_cobranca_do_pedido` solta `gateway_payment_id` SE ele ainda for
  // esta order e o pedido ainda estiver 'aguardando'. Idempotente por
  // construção: o reenvio do MP encontra a vaga já solta e devolve false.
  //
  // `p_gateway_payment_id` é o `order.id` da resposta AUTENTICADA do MP,
  // igual ao `p_payment_id` da `confirmar_pagamento` — nunca o do corpo.
  // Erro de banco devolve 500: o evento fica na fila do MP e volta.
  if (liberarAVaga) {
    let liberou: boolean;
    try {
      const { data, error: erroLiberar } = await supabase.rpc("liberar_cobranca_do_pedido", {
        p_order_id: orderId,
        p_gateway_payment_id: idParaRpc,
      });
      if (erroLiberar) throw erroLiberar;
      liberou = data === true;

      // Achado S1 (3ª revisão de risco, 26/09/2026): esta recusa/cancelamento
      // pode não bater com o que está NA VAGA — a Orders API respondeu 409
      // `idempotency_key_already_used` a um RETRY desta mesma tentativa
      // (token novo, mesma chave), e `criar-pagamento` gravou um SENTINELA
      // (`verificando:<pedido>:c<n>`, Achado B2) em vez do id desta order.
      // Sem este segundo passo, a recusa de verdade (nenhuma cobrança
      // aprovada existe) não soltava NADA — o pedido ficava preso até a
      // reserva morrer, mesmo com o motivo já conhecido (ver o comentário
      // grande de `resolverVagaEmVerificacao`, `criar-pagamento/index.ts`,
      // para o outro lado deste fechamento). Só tenta se a primeira
      // tentativa não bateu, e só com o valor REAL da vaga — nunca
      // inventado: se ela guarda uma cobrança de verdade (ou outro
      // sentinela), a RPC recusa de novo e nada muda.
      //
      // Ponto 2 (4ª revisão de risco, 26/09/2026): este fallback soltava
      // QUALQUER sentinela achado na vaga, sem checar se esta notificação
      // tinha ALGUMA coisa a ver com a tentativa que ele representa — dois
      // cenários reproduzidos pelo revisor:
      //   Q2  — a recusa ATRASADA (ou reenviada) da tentativa c0 soltava o
      //         sentinela da tentativa c1, ainda em análise no MP;
      //   Q2b — o cancelamento ATRASADO de um PIX ANTIGO (troca PIX→cartão,
      //         ramo (c) de `criar-pagamento`) também soltava o sentinela de
      //         uma tentativa de CARTÃO seguinte.
      // Nos dois, o cliente acabava pagando duas vezes: a cobrança que
      // soltou por engano E a que ficou presa atrás dela. Dois cintos:
      //   1. Só entra aqui para notificação de CARTÃO (`ordemDeCartaoNa
      //      Notificacao`) — fecha Q2b (a notificação é sobre um PIX) sem
      //      precisar de rede nenhuma.
      //   2. Antes de soltar, confirma por BUSCA (`buscarOrdersDoPedido` +
      //      `resolverSentinela`, `_shared/mercadopago.ts` — MESMA função do
      //      Ponto 1) que NENHUMA order de cartão deste pedido está viva ou
      //      aprovada — fecha Q2 (a notificação pode ser de uma tentativa
      //      BEM mais velha que a que o sentinela representa). Busca que
      //      falha, corpo ilegível, ou "nada encontrado" (a order do PRÓPRIO
      //      sentinela pode não estar indexada ainda) NUNCA solta — mesma
      //      regra de segurança do Ponto 1.
      if (!liberou && ordemDeCartaoNaNotificacao) {
        const { data: linhaComSentinela, error: erroLeituraSentinela } = await supabase
          .from("marketplace_orders")
          .select("gateway_payment_id")
          .eq("id", orderId)
          .maybeSingle();
        if (erroLeituraSentinela) throw erroLeituraSentinela;
        const idNaVaga = (linhaComSentinela as Record<string, unknown> | null)?.gateway_payment_id;
        if (typeof idNaVaga === "string" && vagaEmVerificacao(idNaVaga)) {
          // Segunda leitura, só quando o sentinela está mesmo lá — a
          // primeira (acima) mantém a MESMA string de colunas de antes
          // (`"gateway_payment_id"`, sozinha) porque o caminho do estorno
          // (Achado B1/S4) pede exatamente essa string para uma leitura
          // DIFERENTE; misturar as duas faria a injeção de falha de teste
          // desse achado enxergar chamada errada.
          //
          // Nit (5ª revisão de risco, 26/09/2026): `error` desta leitura
          // ignorado ANTES — o efeito já era seguro (`created_at` vai vazio,
          // `desde` vira "" na busca, que segue tentando com uma janela mais
          // larga), mas ficava difícil distinguir no log "leitura falhou" de
          // "created_at está mesmo ausente". O desfecho não muda: sem
          // `created_at`, a busca (que ainda pode funcionar com `begin_date`
          // cru) decide, e o sentinela NUNCA solta às cegas.
          const { data: linhaComCriacao, error: erroLeituraCriacao } = await supabase
            .from("marketplace_orders")
            .select("created_at, tentativas_de_pagamento")
            .eq("id", orderId)
            .maybeSingle();
          if (erroLeituraCriacao) {
            console.error(
              "webhook-mercadopago: falha ao ler created_at do pedido para a busca do Ponto 2 — segue sem 'desde'; sentinela NUNCA solta às cegas",
              { orderId, erro: erroLeituraCriacao },
            );
          }
          const busca = await buscarOrdersDoPedido({
            token: credenciaisMp.token,
            pedidoId: orderId,
            desde: String((linhaComCriacao as Record<string, unknown> | null)?.created_at ?? ""),
            fetchImpl: deps.fetchImpl,
          });
          // B1 (5ª revisão de risco, 26/09/2026): o LIMITE INFERIOR vem do
          // PRÓPRIO sentinela (gravado uma vez, na escrita — `montarSentinela`,
          // `_shared/mercadopago.ts`) — a MESMA regra do Ponto 1
          // (`resolverVagaEmVerificacao`, `criar-pagamento/index.ts`), nunca
          // recalculada aqui.
          const limiteInferiorMs = limiteInferiorDoSentinela(idNaVaga);
          const resolucao = busca.ok ? resolverSentinela(busca.orders, limiteInferiorMs) : null;
          // Revisão de risco de 30/09/2026 (3ª rodada, MENOR 1): MESMA regra
          // do Ponto 1 no criar-pagamento — um sentinela com a chave de uma
          // tentativa ANTERIOR (`c<n>` com `tentativas_de_pagamento` já em
          // n+1) nunca solta pela busca: o limite inferior dele é o instante
          // da tentativa n, e a janela pode trazer só a order MORTA de uma
          // tentativa POSTERIOR enquanto a `c<n>` ambígua ainda não foi
          // indexada — liberar abriria um cartão novo (chave nova) ao lado
          // dela. Sem a leitura (erro acima), não dá para saber: não solta.
          const chaveDaTentativaAtual = erroLeituraCriacao
            ? null
            : chaveDoCartaoDaTentativa(
              orderId,
              (linhaComCriacao as Record<string, unknown> | null)?.tentativas_de_pagamento,
            );
          const sentinelaDaTentativaAtual =
            chaveDaTentativaAtual !== null && sentinelaDaChave(idNaVaga, chaveDaTentativaAtual);
          if (resolucao?.acao === "liberar" && sentinelaDaTentativaAtual) {
            const { data: liberouSentinela, error: erroLiberarSentinela } = await supabase.rpc(
              "liberar_cobranca_do_pedido",
              { p_order_id: orderId, p_gateway_payment_id: idNaVaga },
            );
            if (erroLiberarSentinela) throw erroLiberarSentinela;
            liberou = liberouSentinela === true;
          } else {
            console.warn(
              "webhook-mercadopago: recusa/cancelamento não amarrado ao sentinela (Ponto 2) — busca não confirmou que todas as orders de cartão do pedido estão mortas (ou o sentinela é de tentativa anterior), sentinela mantido",
              { orderId, idOrder: idParaRpc, sentinela: idNaVaga, buscaOk: busca.ok, sentinelaDaTentativaAtual },
            );
          }
        }
      }
    } catch (erro) {
      console.error(
        "webhook-mercadopago: liberar_cobranca_do_pedido falhou — evento mantido na fila do MP",
        orderId,
        erro,
      );
      return json({ error: "Erro ao liberar a cobrança." }, 500);
    }
    console.log(
      "webhook-mercadopago: recusa de cartão (ou order cancelada) — vaga da cobrança liberada, pedido segue aguardando",
      { orderId, idOrder: idParaRpc, status: statusBrutoParaLog, liberou },
    );
    return json({ ok: true, resultado: liberou ? "cobranca_liberada" : "nada_a_liberar" }, 200);
  }

  // PASSO NOVO (T5): gatilhos lidos do objeto CONSULTADO, nunca do corpo do
  // webhook. Fora disso o passo não roda (0 leituras extras) — ver o
  // docstring de `registrarDesfechoDoEstorno`.
  const statusDoEstorno = typeof corpoConsultado?.status === "string" ? corpoConsultado.status : "";
  const statusDetailDoEstorno = typeof corpoConsultado?.status_detail === "string"
    ? corpoConsultado.status_detail
    : "";
  const gatilhoDeEstorno = statusDoEstorno === "refunded" ||
    statusDetailDoEstorno === "partially_refunded" ||
    statusDoEstorno === STATUS_DA_CONTESTACAO;

  if (gatilhoDeEstorno && corpoConsultado) {
    // Achado B1 (2ª revisão de risco, 26/09/2026): este passo lia status/
    // status_detail/refunds do objeto CONSULTADO desta notificação — que
    // pode ser uma ORDER ÓRFÃ (Achado A1: cartão aprovado no MP, nunca
    // gravado porque outra tentativa ganhou a vaga) com o MESMO
    // `external_reference` do pedido (as duas orders vêm da MESMA
    // `criar-pagamento`). Reembolsar a ÓRFÃ no painel do MP registrava esse
    // reembolso no ledger do pedido REAL e `concluir_estorno`
    // (2026110000100_concluir_estorno.sql:118-125) virava o pedido PAGO em
    // 'estornado' — dinheiro que o cliente pagou e a loja já recebeu,
    // cancelado por um estorno que aconteceu em OUTRA cobrança. Roda ANTES
    // do guard do Achado A3 (mais abaixo — aquele só protege a chamada a
    // `confirmar_pagamento`, nunca chega a rodar para este passo) e nas DUAS
    // rotas — a órfã pode ser notificada tanto por `order` quanto, se o
    // painel do MP estiver inscrito no tópico clássico, por `payment`.
    //
    // Só registra quando o objeto CONSULTADO É a cobrança GRAVADA:
    //  - `idParaRpc` já É `order.id` na rota `order` — compara direto, sem
    //    chamada nova ao MP.
    //  - Rota `payment`: o pagamento clássico não tem "order.id" comparável.
    //    Gravado CLÁSSICO e IGUAL ao id notificado (legado, single-charge-
    //    per-pedido de antes da Orders API): mesma cobrança, sem reconsulta —
    //    comportamento de antes, byte a byte. Gravado diferente (clássico ou
    //    não): reconsulta a ORDER GRAVADA e só confia nela se ELA MESMA
    //    mostrar o MESMO gatilho de estorno — nunca no que a notificação
    //    disse sobre outra cobrança.
    // Achado S4 (3ª revisão de risco, 26/09/2026): esta leitura ignorava
    // `error` — uma falha de banco (statement timeout, pool esgotado) fazia
    // `linhaParaEstorno` virar `null` do MESMO jeito que "pedido sem essa
    // cobrança gravada", e um estorno LEGÍTIMO da cobrança GRAVADA caía no
    // ramo `estornado_orfao` abaixo: nunca registrava no ledger, e o pedido
    // só virava 'estornado' pela RPC lá embaixo — sem `valor_estornado` nem
    // razão. 500 aqui, como o resto do arquivo já faz para toda falha de
    // leitura: o MP reenvia, e a notificação não se perde.
    const { data: linhaParaEstorno, error: erroLeituraParaEstorno } = await supabase
      .from("marketplace_orders")
      .select("gateway_payment_id")
      .eq("id", orderId)
      .maybeSingle();
    if (erroLeituraParaEstorno) {
      console.error(
        "webhook-mercadopago: falha ao ler a cobrança gravada antes de registrar um estorno — evento mantido na fila do MP",
        { orderId, erro: erroLeituraParaEstorno },
      );
      return json({ error: "Erro ao verificar a cobrança gravada." }, 500);
    }
    const idGravadoParaEstorno = (linhaParaEstorno as Record<string, unknown> | null)?.gateway_payment_id;
    const idGravadoParaEstornoStr =
      typeof idGravadoParaEstorno === "string" && idGravadoParaEstorno.length > 0 ? idGravadoParaEstorno : null;

    // O FORMATO do corpo confiável — não a rota da NOTIFICAÇÃO — é o que os
    // leitores de estorno usam: `registrarDesfechoDoEstorno` deriva
    // `ehPayments = rota === "payment"` para decidir ONDE os refunds moram
    // (`corpo.refunds[]` com terminal "approved" no formato Payments;
    // `transactions[].refunds[]` com terminal "processed" no formato Order)
    // e de onde vem o valor pago (`transaction_amount` vs
    // `extrairValorDaOrder`). Quando a guarda abaixo reconsulta a ORDER
    // gravada, o corpo confiável é uma ORDER: passá-lo com a rota "payment"
    // da notificação fazia o passo ler o formato errado — campos que uma
    // ORDER não tem — e um estorno REAL da cobrança gravada, notificado pelo
    // tópico clássico, nunca entrava no ledger (zero inserts, zero
    // concluir_estorno): o pedido só virava 'estornado' pela RPC de
    // pagamento, sem `valor_estornado` nem razão (W9, missão pagamentos,
    // 28/09/2026).
    let formatoConfiavelParaEstorno: "payment" | "order" = rota;
    let corpoConfiavelParaEstorno: Record<string, unknown> | null = null;
    if (idGravadoParaEstornoStr !== null && idGravadoParaEstornoStr === idParaRpc) {
      corpoConfiavelParaEstorno = corpoConsultado;
    } else if (rota === "payment" && idGravadoParaEstornoStr && !idEhClassico(idGravadoParaEstornoStr)) {
      const consultaGravadaParaEstorno = await consultarOrder({
        token: credenciaisMp.token,
        orderId: idGravadoParaEstornoStr,
        fetchImpl: deps.fetchImpl,
        corpoNoLog: false,
      });
      if (!consultaGravadaParaEstorno.ok) {
        console.error(
          "webhook-mercadopago: não foi possível confirmar a cobrança GRAVADA antes de registrar um estorno — evento mantido na fila do MP",
          { orderId, idGravado: idGravadoParaEstornoStr, status: consultaGravadaParaEstorno.status },
        );
        return json({ error: consultaGravadaParaEstorno.erro }, 500);
      }
      const ordemGravadaParaEstorno = consultaGravadaParaEstorno.order as Record<string, unknown>;
      const statusGravado = typeof ordemGravadaParaEstorno.status === "string" ? ordemGravadaParaEstorno.status : "";
      const statusDetailGravado = typeof ordemGravadaParaEstorno.status_detail === "string"
        ? ordemGravadaParaEstorno.status_detail
        : "";
      const gatilhoNaGravada = statusGravado === "refunded" ||
        statusDetailGravado === "partially_refunded" ||
        statusGravado === STATUS_DA_CONTESTACAO;
      corpoConfiavelParaEstorno = gatilhoNaGravada ? ordemGravadaParaEstorno : null;
      // O corpo confiável deste ramo é a ORDER reconsultada — os leitores
      // têm de usar o formato Order, mesmo que a NOTIFICAÇÃO tenha vindo
      // pelo tópico clássico ("payment").
      if (corpoConfiavelParaEstorno) formatoConfiavelParaEstorno = "order";
    }

    if (!corpoConfiavelParaEstorno) {
      console.error(
        "webhook-mercadopago: estorno_orfao — a notificação é sobre uma cobrança DIFERENTE da gravada, e a gravada não confirma o mesmo estorno — ledger do pedido NÃO tocado",
        { orderId, idNotificado: idParaRpc, idGravado: idGravadoParaEstornoStr },
      );
      const avisoEstornoOrfao = {
        title: "Estorno de cobrança sem registro",
        body: `${numeroDoPedido(orderId)} · confira o painel do Mercado Pago antes de mexer neste pedido`,
        url: "/admin-orders",
      };
      await comTempoLimite(
        (deps.enviarPush ?? disparoPushReal)({ supabase, aviso: avisoEstornoOrfao }),
        5000,
      );
    } else {
      try {
        await registrarDesfechoDoEstorno({
          supabase,
          orderId,
          rota: formatoConfiavelParaEstorno,
          corpo: corpoConfiavelParaEstorno,
          consultarCaso: (caseId) =>
            consultarContestacao({ token: credenciaisMp.token, caseId, fetchImpl: deps.fetchImpl }),
          avisar: (chave, aviso) =>
            avisarAdminUmaVez({
              supabase,
              enviarPushContado: deps.enviarPushContado ?? disparoPushContadoReal,
              chave,
              aviso,
            }),
        });
      } catch (erro) {
        console.error(
          "webhook-mercadopago: registrarDesfechoDoEstorno falhou — evento mantido na fila do MP",
          orderId,
          erro,
        );
        return json({ error: "Erro ao registrar o desfecho do estorno." }, 500);
      }
    }
  }

  // CONTESTAÇÃO (chargeback) NÃO PASSA POR `confirmar_pagamento` — Lote A
  // (04/10/2026, R1). O mapa compartilhado (`_shared/mercadopago.ts`) traduz
  // `charged_back` (clássico) e `charged_back:in_process/settled/reimbursed`
  // (Orders) para 'estornado', e continua assim de propósito: o checkout da
  // `criar-pagamento` lê esse rótulo (crítica de desenho A1 do lote). Mas
  // aqui 'estornado' iria para `confirmar_pagamento`, onde é IRREVERSÍVEL
  // (20260901000000 — não existe estornado->pago, e não deve existir): uma
  // disputa EM ANÁLISE (`in_process`) ou GANHA pela loja (`reimbursed` =
  // valor creditado ao vendedor) marcava o pedido pago como estornado.
  // Semântica oficial (transaction-status):
  // https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/status/transaction-status
  // — `in_process` = disputa em andamento; `settled` = valor devolvido ao
  // COMPRADOR; `reimbursed` = valor creditado ao VENDEDOR. A página de
  // status da ORDER
  // (https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status)
  // descreve `reimbursed` como "valor devolvido ao pagador" — o contrário. A
  // divergência é da doc do MP; vale a do STATUS DA TRANSAÇÃO, e por isso o
  // ledger decide pelo `status_detail` do PAGAMENTO contestado, nunca pelo
  // agregado da order (`registrarDesfechoDoEstorno`, ramo B).
  //
  // O passo do ledger (acima) já registrou o que havia para registrar: a
  // reserva, a conclusão (que vira 'estornado' SÓ quando o total estornado
  // cobre o pago — `concluir_estorno`, 2026110000100) ou a liberação. Daqui
  // em diante nada muda no pedido: 200 com rótulo próprio. Vale para as duas
  // rotas; o bloco A3 (rota `payment`, mais abaixo) tem a guarda gêmea para
  // a ORDER GRAVADA contestada notificada como outro status.
  if (statusBrutoConfiavel === STATUS_DA_CONTESTACAO) {
    console.log(
      "webhook-mercadopago: contestação (chargeback) tratada pelo ledger — confirmar_pagamento NÃO é chamada",
      dataIdStr,
      rota,
      statusBrutoParaLog,
    );
    return json({ ok: true, resultado: "contestacao_no_ledger" }, 200);
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
  // 🔒 GATILHO para deixar de ser opcional: religar cartão (Fase 3.5)
  // ou qualquer relaxamento da trava de uma-cobrança-por-pedido.
  // ⚠️ O GATILHO FOI ATINGIDO em 26/09/2026: a Fase 3.5 religou o cartão E
  // relaxou a trava (a vaga é liberada numa recusa/troca). A metade de
  // RECUSA desta rota já foi fechada (bloco "RECUSA PELA ROTA `payment`",
  // acima: descarta, a rota `order` decide). A metade de 'pago'/'estornado'
  // continua como descrita aqui — perguntar ao MP pelo `ORD…` gravado é
  // decisão pendente, levada ao revisor da Fase 3.5, não feita de carona.
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

  // RECUSA PELA ROTA `payment` DE UMA COBRANÇA DA ORDERS API (Fase 3.5): o
  // pagamento clássico que o MP notifica por dentro de uma order (cartão
  // recusado, PIX cancelado na troca para cartão) chegaria aqui como
  // 'recusado' — e a substituição do id pelo gravado no banco, logo abaixo,
  // faria `confirmar_pagamento('recusado')` CANCELAR o pedido que a
  // recusa de cartão devia deixar vivo. A rota `order` é quem decide essas
  // recusas (libera a vaga do cartão, confirma a do PIX); esta aqui
  // descarta com 200. Só fica de fora quem ainda fala a língua clássica: o
  // valor gravado com forma de id clássico (PIX legado), que segue o caminho
  // de sempre. Vaga vazia também é descartada — a RPC devolveria
  // 'divergente' sem escrever nada, com um log de "dinheiro sem registro"
  // que seria alarme falso para uma recusa.
  if (rota === "payment" && statusMapeado === "recusado") {
    const idGravado = (linhaDoPedido as Record<string, unknown> | null)?.gateway_payment_id;
    const gravadoEhClassico = typeof idGravado === "string" && idGravado.length > 0 && idEhClassico(idGravado);
    if (!gravadoEhClassico) {
      console.log(
        "webhook-mercadopago: recusa pela rota `payment` de cobrança da Orders API — decidida pela rota `order`, ignorada aqui",
        { orderId, idDevolvidoPeloMp: idParaRpc, idGravadoNoBanco: idGravado ?? null },
      );
      return json({ ok: true, ignorado: "recusa decidida pela rota order" }, 200);
    }
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

  // Achado B2 (2ª revisão de risco, 26/09/2026) — ADOÇÃO: uma cobrança de
  // CARTÃO pode ficar "ambígua" do lado de `criar-pagamento` — a Orders API
  // respondeu 409 `idempotency_key_already_used` a um retry (token novo,
  // MESMA chave) e a vaga do pedido ficou vazia (NULL) ou com um SENTINELA
  // ("verificando:...", `vagaEmVerificacao`) sem NUNCA saber se a cobrança
  // da tentativa anterior foi aprovada. Quando ESTA notificação diz que ela
  // FOI aprovada e a vaga ainda está livre/em verificação, ADOTA: um UPDATE
  // condicional (a MESMA disciplina de sempre — grava só se a condição
  // bater) troca o NULL/sentinela pelo id de verdade, e só então a RPC
  // `confirmar_pagamento` (mais abaixo) encontra o que precisa para
  // confirmar. Sem isto, o cliente ficava preso em "aguardando" pelo resto
  // da reserva (`criar-pagamento` devolvia "aguardando" sem parar,
  // Achado B2) mesmo com o cartão JÁ aprovado — ninguém jamais gravava a
  // vaga para a RPC achar.
  if (rota === "order" && ordemDeCartaoNaNotificacao && statusMapeado === "pago") {
    const idGravadoAtual = (linhaDoPedido as Record<string, unknown> | null)?.gateway_payment_id;
    const idGravadoAtualStr = typeof idGravadoAtual === "string" ? idGravadoAtual : null;
    const vagaAdotavel = idGravadoAtualStr === null || vagaEmVerificacao(idGravadoAtualStr);
    if (vagaAdotavel) {
      // Achado S3 (3ª revisão de risco, 26/09/2026): a ADOÇÃO só gravava
      // `gateway_payment_id` — `metodo_online`/`parcelas` ficavam NULL (vaga
      // NULL) ou com o valor do RETRY que gravou o sentinela (vaga
      // sentinela, nunca a forma da cobrança que de fato foi aprovada — ver
      // o fechamento simétrico em `respostaCartaoEmVerificacao`,
      // `criar-pagamento/index.ts`, que parou de gravar essas duas colunas
      // no sentinela por este MESMO motivo). O comprovante e o Financeiro
      // liam isso e contavam a venda como PIX. `corpoConsultado` já É a
      // order RECONSULTADA desta notificação (`rota === "order"`, acima) —
      // lê a forma de verdade dela, nunca do corpo do webhook.
      const tipoCartaoAdotado = tipoDoPagamentoDaOrder(corpoConsultado);
      const metodoOnlineAdotado = tipoCartaoAdotado === "credit_card"
        ? "credito"
        : tipoCartaoAdotado === "debit_card"
          ? "debito"
          : null;
      // INVARIANTE DA VAGA: só a RPC `liberar_cobranca_do_pedido` esvazia a
      // vaga, e só por prova ou cancelamento confirmado. Esta adoção é CAS —
      // TROCA o valor antigo (NULL ou o sentinela, conferido no WHERE abaixo)
      // pelo id da order, nunca grava NULL. Mantém assim.
      let queryAdocao = supabase
        .from("marketplace_orders")
        .update({
          gateway_payment_id: idParaRpc,
          metodo_online: metodoOnlineAdotado,
          parcelas: parcelasDaOrder(corpoConsultado),
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);
      queryAdocao = idGravadoAtualStr === null
        ? queryAdocao.is("gateway_payment_id", null)
        : queryAdocao.eq("gateway_payment_id", idGravadoAtualStr);
      // Menor (4ª revisão de risco, 26/09/2026): antes este `error` era
      // ignorado — uma falha de BANCO (timeout, deadlock passageiro) fazia
      // `adotado` virar `undefined` do MESMO jeito que "perdeu a corrida
      // para outra adoção" (o ramo `else`, abaixo), e o código seguia como
      // se alguém MAIS tivesse resolvido a vaga, quando na verdade NINGUÉM
      // tentou de novo — a cobrança aprovada ficava sem registro. 500
      // mantém o evento na fila do MP: o próximo reenvio tenta a adoção de
      // novo.
      const { data: adotado, error: erroAdocao } = await queryAdocao.select("id").maybeSingle();
      if (erroAdocao) {
        console.error(
          "webhook-mercadopago: UPDATE de adoção (Achado B2) falhou — evento mantido na fila do MP",
          { orderId, idOrder: idParaRpc, erro: erroAdocao },
        );
        return json({ error: "Erro ao adotar a cobrança." }, 500);
      }
      if (adotado) {
        console.warn(
          "webhook-mercadopago: cartao_adotado — cobrança aprovada ligada a uma vaga que estava vazia/em verificação (Achado B2)",
          { orderId, idOrder: idParaRpc, idGravadoAntes: idGravadoAtualStr },
        );
      } else {
        // Perdeu a corrida para OUTRA adoção/confirmação concorrente — segue
        // para `confirmar_pagamento` normalmente; a guarda (d) da RPC decide
        // com o estado REAL (idempotente, mesmo padrão do resto do arquivo).
        console.warn(
          "webhook-mercadopago: não foi possível adotar a vaga (ocupada entre a leitura e a tentativa) — segue para confirmar_pagamento normalmente",
          { orderId, idOrder: idParaRpc },
        );
        // Achado S5 (3ª revisão de risco, 26/09/2026): quem ganhou a corrida
        // pode ter sido OUTRA cobrança aprovada (não a `confirmar_pagamento`
        // desta MESMA order, que a RPC abaixo trata sozinha) — sem reler, o
        // pedido seguia com dinheiro de duas cobranças aprovadas e nenhum
        // aviso além do `console.warn` acima. Mesmo aviso do `cartao_
        // divergente` logo abaixo, para o admin conferir e devolver.
        const { data: linhaAposCorrida } = await supabase
          .from("marketplace_orders")
          .select("gateway_payment_id")
          .eq("id", orderId)
          .maybeSingle();
        const idNaVagaAposCorrida = (linhaAposCorrida as Record<string, unknown> | null)
          ?.gateway_payment_id;
        if (
          typeof idNaVagaAposCorrida === "string" &&
          idNaVagaAposCorrida.length > 0 &&
          idNaVagaAposCorrida !== idParaRpc &&
          !vagaEmVerificacao(idNaVagaAposCorrida)
        ) {
          console.error(
            "webhook-mercadopago: cartao_divergente — order aprovada perdeu a corrida da adoção para OUTRA cobrança gravada — possível cobrança duplicada",
            { orderId, idOrder: idParaRpc, idGravadoNaVaga: idNaVagaAposCorrida },
          );
          const avisoDivergenteAposCorrida = {
            title: "Cobrança de cartão duplicada?",
            body: `${numeroDoPedido(orderId)} · confira o painel do Mercado Pago`,
            url: "/admin-orders",
          };
          // C-P: uma vez por (pedido, order); quem chega junto espera o resultado
          // da outra entrega — ver `avisarCobrancaDuplicadaUmaVez` (e os limites lá).
          // Rodada 3: "pendente" = outra entrega segue com a reserva depois da
          // espera; 503 faz o MP reentregar. O que rodou até aqui é idempotente
          // (leituras, consulta GET ao MP, a adoção CAS que não casou) e o que
          // fica para a reentrega é `confirmar_pagamento`, que daria 'divergente'
          // (só lê).
          const avisoS5 = await avisarCobrancaDuplicadaUmaVez({
            supabase,
            enviarPushContado: deps.enviarPushContado ?? disparoPushContadoReal,
            dormir: deps.dormir ?? dormirDeVerdade,
            orderId,
            idOrder: idParaRpc,
            aviso: avisoDivergenteAposCorrida,
          });
          if (avisoS5 === "pendente") {
            return json(
              { error: "Aviso de cobrança duplicada em envio por outra entrega — reentregue." },
              503,
            );
          }
        }
      }
    } else if (idGravadoAtualStr !== idParaRpc) {
      // A vaga já tem OUTRA cobrança de verdade (não vazia, não sentinela, e
      // diferente desta) — esta order aprovada é uma DIVERGÊNCIA de verdade:
      // duas cobranças aprovadas para o mesmo pedido (ex.: o cliente pagou
      // com um segundo cartão numa tentativa nova enquanto a ambígua também
      // caiu aprovada). A RPC abaixo recusa com 'divergente' (nunca
      // sobrescreve a vaga real) — o dinheiro da SEGUNDA cobrança fica sem
      // dono, e o admin precisa saber para conferir e devolver.
      console.error(
        "webhook-mercadopago: cartao_divergente — order aprovada, mas a vaga já tem OUTRA cobrança gravada — possível cobrança duplicada",
        { orderId, idOrder: idParaRpc, idGravadoNaVaga: idGravadoAtualStr },
      );
      const avisoDivergente = {
        title: "Cobrança de cartão duplicada?",
        body: `${numeroDoPedido(orderId)} · confira o painel do Mercado Pago`,
        url: "/admin-orders",
      };
      // C-P: uma vez por (pedido, order); quem chega junto espera o resultado
      // da outra entrega — ver `avisarCobrancaDuplicadaUmaVez` (e os limites lá).
      // Rodada 3: "pendente" → 503 (ver o ramo S5, acima: mesma auditoria).
      const avisoDv = await avisarCobrancaDuplicadaUmaVez({
        supabase,
        enviarPushContado: deps.enviarPushContado ?? disparoPushContadoReal,
        dormir: deps.dormir ?? dormirDeVerdade,
        orderId,
        idOrder: idParaRpc,
        aviso: avisoDivergente,
      });
      if (avisoDv === "pendente") {
        return json(
          { error: "Aviso de cobrança duplicada em envio por outra entrega — reentregue." },
          503,
        );
      }
    }
  }

  if (rota === "payment") {
    const idGravadoNoBanco = (linhaDoPedido as Record<string, unknown> | null)?.gateway_payment_id;
    if (
      typeof idGravadoNoBanco === "string" &&
      idGravadoNoBanco.length > 0 &&
      !idEhClassico(idGravadoNoBanco)
    ) {
      // Achado N3 (3ª revisão de risco, 26/09/2026): a vaga pode estar com o
      // SENTINELA (`verificando:...`, Achado B2) em vez de um id de order de
      // verdade — reconsultar isso pela Orders API SEMPRE falha (não é um id
      // que ela reconhece), e o 500 de "não conseguiu confirmar antes de
      // aplicar", mais abaixo, fazia o MP reenviar a MESMA notificação
      // clássica em loop (W6). A rota `payment` não tem como resolver o
      // sentinela por si só (não fala da cobrança de cartão que o ocupa) —
      // quem resolve é a ADOÇÃO da rota `order` (acima) ou
      // `resolverVagaEmVerificacao` em `criar-pagamento` (busca as orders de
      // cartão na Orders API, Ponto 1 da 4ª revisão de risco, 26/09/2026).
      // Aqui só ignora, sem reenviar: reenviar não muda nada até um dos dois
      // caminhos rodar.
      if (vagaEmVerificacao(idGravadoNoBanco)) {
        console.warn(
          "webhook-mercadopago: rota `payment` sobre um pedido com a vaga em verificação (sentinela) — ignorado, sem reconsultar",
          { orderId, idGravadoNoBanco },
        );
        return json({ ok: true, ignorado: "vaga em verificação" }, 200);
      }
      console.warn(
        "webhook-mercadopago: gateway_payment_id gravado não é um id clássico — a rota `payment` do MP devolveu um id que nunca bateria com o valor gravado (cobrança criada pela Orders API, painel provavelmente inscrito no tópico clássico). Enviando à RPC o valor GRAVADO NO BANCO, não o que o MP devolveu.",
        { orderId, idDevolvidoPeloMp: idParaRpc, idGravadoNoBanco },
      );

      // Achado A3 (revisão de risco, 26/09/2026): substituir o id às cegas
      // bastava enquanto só existia UMA cobrança de Orders API por pedido —
      // a rota `payment` falava sempre do MESMO pagamento gravado. Com o
      // cartão (Fase 3.5), o mesmo `external_reference` pode ter mais de uma
      // ORDER ao longo da vida do pedido (uma recusada/cancelada, ou — pior,
      // Achado A1 — uma ÓRFÃ que nunca chegou a ser gravada). Uma notificação
      // clássica de 'pago'/'estornado' pode ser sobre QUALQUER uma delas — se
      // for sobre a ÓRFÃ (ex.: reembolsada no painel do MP) e este bloco só
      // trocasse o id, a RPC receberia `p_status` da órfã aplicado ao id
      // GRAVADO: um reembolso de uma cobrança nunca registrada marcaria a
      // cobrança de VERDADE como estornada.
      //
      // Só para 'pago'/'estornado' (nunca 'aguardando', que não escreve nada
      // de qualquer jeito, nem 'recusado', que o bloco de RECUSA acima já
      // filtrou antes de chegar aqui): reconsulta a ORDER GRAVADA — não a que
      // a notificação falou — e só segue se ELA MESMA confirma o MESMO
      // desfecho. Sem confirmar, 200 ignorado com log: reenviar não muda uma
      // verificação que já rodou, e o dinheiro fica onde a página do MP já
      // mostra (o painel do lojista resolve manualmente).
      if (statusMapeado === "pago" || statusMapeado === "estornado") {
        // Achado R6 (2ª revisão de risco, 26/09/2026): `corpoNoLog: false` —
        // a cobrança gravada pode ser de CARTÃO (payer com e-mail e CPF do
        // titular); sem isto, um 4xx/5xx aqui logaria o corpo cru.
        const consultaGravado = await consultarOrder({
          token: credenciaisMp.token,
          orderId: idGravadoNoBanco,
          fetchImpl: deps.fetchImpl,
          corpoNoLog: false,
        });
        if (!consultaGravado.ok) {
          console.error(
            "webhook-mercadopago: rota `payment` não conseguiu confirmar o id GRAVADO antes de aplicar o status — evento mantido na fila do MP",
            { orderId, idGravadoNoBanco, status: consultaGravado.status },
          );
          return json({ error: consultaGravado.erro }, 500);
        }
        const orderGravada = consultaGravado.order as Record<string, unknown>;
        // Lote A (R1): a ORDER GRAVADA em contestação nunca chega a
        // `confirmar_pagamento` — o rótulo 'estornado' que o mapa dá a ela não
        // é o desfecho da disputa (ver o desvio da contestação, acima). O
        // ledger já rodou com ESTA order (guarda B1, que a reconsulta quando a
        // notificação clássica é de estorno).
        if (String(orderGravada.status ?? "") === STATUS_DA_CONTESTACAO) {
          console.log(
            "webhook-mercadopago: rota `payment` — a ORDER GRAVADA está em contestação (chargeback); confirmar_pagamento NÃO é chamada",
            { orderId, idDevolvidoPeloMp: idParaRpc, idGravadoNoBanco, statusMapeado },
          );
          return json({ ok: true, resultado: "contestacao_no_ledger" }, 200);
        }
        const statusDoGravado = mapearStatusOrder(
          String(orderGravada.status ?? ""),
          String(orderGravada.status_detail ?? ""),
        );
        if (statusDoGravado !== statusMapeado) {
          console.warn(
            "webhook-mercadopago: rota `payment` é sobre uma cobrança diferente da gravada, e a GRAVADA não confirma o mesmo desfecho — ignorado (provável cobrança órfã de outra tentativa, Achado A1)",
            { orderId, idDevolvidoPeloMp: idParaRpc, idGravadoNoBanco, statusMapeado, statusDoGravado },
          );
          return json({ ok: true, ignorado: "id gravado não confirma o mesmo desfecho" }, 200);
        }
      }

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

  // Os efeitos do pagamento confirmado (push ao lojista, comprovante ao cliente
  // ou aviso de pagamento atrasado) moram em `_shared/efeitos-do-pagamento.ts`,
  // o módulo ÚNICO dos três caminhos que confirmam (imediata, webhook, cron).
  // Só 'pago' e 'pago_apos_expirar' disparam: são o retorno de QUEM FEZ a
  // transição sob o `FOR UPDATE` da RPC. `ja_pago`/`ja_estornado`/`ignorado`
  // são reenvio do MP (ou o outro caminho) encontrando um estado que já foi
  // tratado — 200, sem efeito, é o que impede o reenvio de virar spam para o
  // lojista. `divergente`/`inexistente` NÃO são esse caso benigno: significam
  // que a confirmação (já aprovada pelo MP) não bate com o pedido, e por isso
  // são logados como erro no bloco abaixo, não silenciados. Falha de push ou
  // de e-mail nunca sobe (o módulo engole e loga): o pedido já está pago.
  if (desfechoComEfeito(resultado)) {
    await aplicarEfeitosDoPagamentoConfirmado({
      supabase,
      orderId,
      resultado,
      enviarPush: deps.enviarPush,
      enviarComprovante: deps.enviarComprovante,
      enviarAvisoAtrasado: deps.enviarAvisoAtrasado,
    });
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
  } else if (resultado === "ignorado" && statusMapeado === "pago") {
    // Lote A (A5): pagamento APROVADO pelo MP que a RPC recusou aplicar — o
    // pedido já estava 'recusado'/'estornado' (ou NULL histórico) com este
    // mesmo id (confirmar_pagamento, ramo 'pago': "nao inventar transicao").
    // Antes saía 200 em silêncio: dinheiro no MP, pedido sem pagamento no
    // app. Só observabilidade — não muda fluxo, resposta nem chama outra
    // RPC. Sem dado pessoal: id do pedido e do gateway só como prefixo.
    console.error(
      "webhook-mercadopago: confirmar_pagamento devolveu 'ignorado' para um pagamento APROVADO — conferir no painel do MP",
      {
        pedido8: orderId.slice(0, 8),
        idGateway: `${String(idParaRpc).slice(0, 8)}…`,
        statusRecebido: statusMapeado,
        retorno: resultado,
      },
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
