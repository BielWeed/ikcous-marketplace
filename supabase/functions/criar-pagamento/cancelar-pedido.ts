/**
 * CANCELAR PEDIDO ANULA A COBRANÇA PRIMEIRO (S1, dinheiro, 04/10/2026) — a
 * ação `cancelar` da edge `criar-pagamento`.
 *
 * O DEFEITO: as três telas que cancelam pedido (o pedido do cliente, a
 * retomada do pagamento no checkout e a ficha do painel) só mudavam o BANCO.
 * O PIX aberto — e, pelo painel, até o cartão vivo — continuava pagável no
 * Mercado Pago; pago depois, virava `pago_apos_expirar` (Política P1): dinheiro
 * fora do fluxo, sem estorno automático, estoque já devolvido.
 *
 * O DESENHO (decidido no plano, não reaberto aqui):
 *   1. Pedido aguardando com a cobrança na vaga: PRIMEIRO anula a order no
 *      MP; SÓ a resposta que PROVA "order cancelada" (POST cancel → order
 *      `canceled`, ou um GET que já a mostra morta) autoriza o cancelamento
 *      no banco, pela RPC `cancelar_pedido_com_cobranca` (migration
 *      20261198000000) com CAS na vaga e no `payment_status` que esta função
 *      leu. Timeout, 5xx, 409, `processing`, corpo ambíguo: NÃO cancela no
 *      banco, responde "tente de novo" — e nenhuma segunda tentativa
 *      automática que crie efeito (o único passo extra é um GET, leitura,
 *      para reconhecer "acabou de ser paga").
 *   2. MP diz paga → não cancela, responde `ja_pago`. Quem grava o pago é o
 *      caminho de servidor que já existe (webhook-mercadopago / reconciliar-
 *      pagamentos → `confirmar_pagamento`) — esta função nunca escreve
 *      pagamento.
 *   3. Cartão em análise (`processing`) ou no desafio 3DS (`action_required`)
 *      → ninguém cancela (o admin também não). Sentinela `verificando:`:
 *      cliente nunca; admin só quando a busca no MP não acha NENHUMA order
 *      viva do pedido — e a RPC ainda recusa se o sentinela tem menos de
 *      2 min (o POST do cartão pode estar no ar). O admin recebe um aviso: a
 *      busca da Orders API é UNVERIFIED em produção.
 *   4. Pedido sem cobrança na vaga (ou já pago): sem MP — a mesma RPC, com o
 *      CAS no que foi lido (vaga NULL inclusive). A corrida "PIX em criação":
 *      o POST do PIX acontece com a vaga LIVRE e grava por CAS com
 *      `status <> 'cancelled'`; perdeu por cancelamento, a própria criação
 *      cancela no MP a order que acabou de criar e o QR nunca sai
 *      (compensação da Frente B, `criar-pagamento/index.ts`, "pedido
 *      cancelado durante a criação"). O cartão, ao contrário, ocupa a vaga
 *      com o sentinela ANTES do POST — é por isso que o sentinela recente
 *      barra até o admin.
 *
 * AUTORIZAÇÃO: o dono do pedido pelo `sub` do token (o gateway já validou o
 * JWT, `verify_jwt = true` — a mesma regra do resto desta função); quem não é
 * dono só passa como ADMIN ATUAL (`verificarAdminAtual`: papel `admin` em
 * `auth.users` — lido no servidor de Auth agora — E em `profiles.role`;
 * contradição nega; nunca o papel do JWT), ANTES de qualquer efeito no MP. A
 * RPC confere de novo, sob o lock. Não é dono nem admin: o
 * MESMO 404 "Pedido não encontrado." do resto da função (sem oráculo de id).
 */
import {
  buscarOrdersDoPedido,
  cancelarOrder,
  consultarOrder,
  idEhClassico,
  mapearStatusOrder,
  orderCancelada,
  orderEhDeCartao,
  vagaEmVerificacao,
} from "../_shared/mercadopago.ts";
import type { CredenciaisMp } from "../_shared/credenciais-mp.ts";
import { adminAtualDaSessao, type OpcoesDoAdminAtual } from "../_shared/admin-atual.ts";
import { readKey } from "../_shared/webpush.ts";

/** O que a tela faz com a resposta — contrato com src/hooks/useOrders.ts. */
export type DesfechoDoCancelamento =
  | "cancelado"
  | "ja_pago"
  | "em_analise"
  | "mudou"
  | "recuperavel"
  | "recusado";

export const MENSAGENS_DO_CANCELAMENTO = {
  cancelado: "Pedido cancelado.",
  ja_pago:
    "Este pedido acabou de ser pago e não foi cancelado. A confirmação do pagamento chega em instantes.",
  em_analise:
    "Há um pagamento com cartão em análise para este pedido. Ele não pode ser cancelado agora — aguarde a confirmação do banco.",
  mudou: "O pagamento deste pedido mudou agora há pouco. Confira o pedido e tente de novo.",
  recuperavel:
    "Não foi possível cancelar agora: o Mercado Pago não confirmou a anulação da cobrança. Tente de novo em instantes.",
  avisoSentinela:
    "Não achamos cobrança deste pedido no Mercado Pago. Confira no painel do Mercado Pago se nenhum cartão foi cobrado.",
  pagamentoAntigo:
    "Esta cobrança é de um formato antigo e não pode ser anulada automaticamente. Fale com o suporte antes de cancelar.",
} as const;

/**
 * Só estes status de uma order PROVAM que ela não captura mais dinheiro —
 * mais estrito que `STATUS_ORDER_MORTOS` (_shared/mercadopago.ts) de
 * propósito: `refunded`/`charged_back` são dinheiro que JÁ passou pela
 * order, e um pedido ainda "aguardando" com uma delas é estado inesperado —
 * aqui isso é "não sei", nunca "pode cancelar".
 */
const STATUS_QUE_PROVAM_ORDER_MORTA = new Set(["canceled", "cancelled", "expired", "failed"]);

function orderProvadamenteMorta(order: Record<string, unknown>): boolean {
  return STATUS_QUE_PROVAM_ORDER_MORTA.has(String(order.status ?? ""));
}

function orderPaga(order: Record<string, unknown>): boolean {
  return mapearStatusOrder(String(order.status ?? ""), String(order.status_detail ?? "")) === "pago";
}

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any;

export type ArgsCancelarPedido = {
  /** Client de SERVICE ROLE (a RPC nova é só dele). */
  supabase: ClienteSupabase;
  pedidoId: string;
  /** `sub` do token já validado pelo gateway (null = sem sessão). */
  sub: string | null;
  authorization: string | null;
  json: (corpo: unknown, status: number) => Response;
  /** Resolvidas só quando há cobrança a anular. */
  obterCredenciais: () => Promise<CredenciaisMp>;
  /** Devolve o id do usuário se ele é admin AGORA; null caso contrário. */
  verificarAdminAtual: (authorization: string | null) => Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export async function cancelarPedidoPelaEdge(args: ArgsCancelarPedido): Promise<Response> {
  const { supabase, pedidoId, sub, authorization, json, fetchImpl } = args;
  const responder = (desfecho: DesfechoDoCancelamento, extra: Record<string, unknown> = {}) =>
    json(
      {
        cancelamento: desfecho,
        mensagem: MENSAGENS_DO_CANCELAMENTO[desfecho as keyof typeof MENSAGENS_DO_CANCELAMENTO] ?? null,
        ...extra,
      },
      200,
    );
  const naoEncontrado = () => json({ error: "Pedido não encontrado.", terminal: true }, 404);

  const { data: pedido, error: erroLeitura } = await supabase
    .from("marketplace_orders")
    .select("id, user_id, status, payment_status, gateway_payment_id, metodo_online, created_at")
    .eq("id", pedidoId)
    .maybeSingle();
  if (erroLeitura) {
    console.error("criar-pagamento: cancelar — falha ao ler o pedido", { pedidoId, erro: erroLeitura });
    return json({ error: "Não foi possível verificar o pedido.", cancelamento: "recuperavel" }, 503);
  }
  if (!pedido) return naoEncontrado();

  // Quem age: o dono, ou o admin de AGORA. Nunca os dois papéis misturados:
  // o dono age como cliente (regras do cliente), mesmo que também seja staff.
  const ehDono = typeof sub === "string" && sub.length > 0 && pedido.user_id === sub;
  let ator: string | null = ehDono ? sub : null;
  let ehAdmin = false;
  if (!ehDono) {
    const adminId = await args.verificarAdminAtual(authorization);
    if (adminId) {
      ator = adminId;
      ehAdmin = true;
    }
  }
  if (!ator) return naoEncontrado();

  if (pedido.status === "cancelled") {
    return responder("cancelado", {
      jaEstava: true,
      pedido: { status: pedido.status, paymentStatus: pedido.payment_status },
    });
  }

  const vaga = typeof pedido.gateway_payment_id === "string" && pedido.gateway_payment_id.length > 0
    ? pedido.gateway_payment_id
    : null;

  const cancelarNoBanco = async (aviso?: string): Promise<Response> => {
    const { data, error } = await supabase.rpc("cancelar_pedido_com_cobranca", {
      p_order_id: pedidoId,
      p_ator: ator,
      p_vaga_esperada: vaga,
      p_pagamento_esperado: pedido.payment_status ?? null,
      p_notes: null,
    });
    if (error) {
      // P0001 é a recusa de REGRA (ex.: cliente não cancela pedido entregue)
      // — a mensagem do banco é a resposta. Qualquer outro código é falha.
      if (error.code === "P0001" && typeof error.message === "string") {
        return json({ error: error.message, cancelamento: "recusado", terminal: true }, 409);
      }
      console.error("criar-pagamento: cancelar — a RPC falhou", { pedidoId, codigo: error.code });
      return responder("recuperavel");
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const relido = (r.pedido ?? {}) as Record<string, unknown>;
    const fotoDoPedido = { status: relido.status ?? null, paymentStatus: relido.payment_status ?? null };
    if (r.cancelado === true) {
      return responder("cancelado", {
        jaEstava: r.ja_estava === true,
        pedido: fotoDoPedido,
        ...(aviso ? { aviso } : {}),
      });
    }
    if (r.motivo === "cobranca_em_criacao") return responder("em_analise");
    return responder("mudou", { pedido: fotoDoPedido });
  };

  // Sem cobrança a anular: nada a fazer no MP. `payment_status` NULL com a
  // vaga ocupada NÃO é "sem cobrança": é transitório (a cobrança existe e o
  // desfecho não foi gravado) — segue o caminho que exige a prova do MP, como
  // 'aguardando' (mesma regra da recusa em pedido__mudar_status, 20261198).
  const desfechoGravado = pedido.payment_status !== null && pedido.payment_status !== undefined &&
    pedido.payment_status !== "aguardando";
  if (vaga === null || desfechoGravado) return await cancelarNoBanco();

  if (idEhClassico(vaga)) {
    // Pagamento da API clássica (anterior à Orders API): não há como anular
    // por aqui. Nada muda no banco.
    return json({ error: MENSAGENS_DO_CANCELAMENTO.pagamentoAntigo, cancelamento: "recusado", terminal: true }, 409);
  }

  const credenciais = await args.obterCredenciais();
  const token = credenciais.token;
  if (!token) {
    console.error(
      `criar-pagamento: cancelar — sem credencial do Mercado Pago (origem: ${credenciais.origem}, motivo: ${credenciais.motivo ?? "sem_token"})`,
    );
    return responder("recuperavel");
  }

  if (vagaEmVerificacao(vaga)) {
    // O sentinela: a cobrança ambígua pode estar viva por baixo.
    if (!ehAdmin) return responder("em_analise");
    const busca = await buscarOrdersDoPedido({
      token,
      pedidoId,
      desde: String(pedido.created_at ?? ""),
      fetchImpl,
    });
    if (!busca.ok) return responder("recuperavel");
    if (busca.orders.some((o) => !orderProvadamenteMorta(o))) return responder("em_analise");
    return await cancelarNoBanco(MENSAGENS_DO_CANCELAMENTO.avisoSentinela);
  }

  const consulta = await consultarOrder({ token, orderId: vaga, fetchImpl, corpoNoLog: false });
  if (!consulta.ok || String(consulta.order?.id ?? "") !== vaga) return responder("recuperavel");
  const order = consulta.order as Record<string, unknown>;
  if (String(order.external_reference ?? "") !== pedidoId) {
    console.error("criar-pagamento: cancelar — a order da vaga é de OUTRO pedido; nada foi cancelado", {
      pedidoId,
      idOrder: vaga,
    });
    return responder("recuperavel");
  }
  if (orderPaga(order)) return responder("ja_pago");
  if (orderProvadamenteMorta(order)) return await cancelarNoBanco();

  const ehCartao = orderEhDeCartao(order) || pedido.metodo_online === "credito" ||
    pedido.metodo_online === "debito";
  const status = String(order.status ?? "");
  if (ehCartao && (status === "processing" || status === "action_required")) return responder("em_analise");
  if (status === "refunded" || status === "charged_back") {
    console.error("criar-pagamento: cancelar — order com dinheiro estornado num pedido ainda aguardando", {
      pedidoId,
      idOrder: vaga,
      status,
    });
    return responder("recuperavel");
  }

  const cancelamento = await cancelarOrder({
    token,
    orderId: vaga,
    chaveIdempotencia: `cancelar:${vaga}`,
    fetchImpl,
  });
  if (cancelamento.ok && orderCancelada(cancelamento.order) && String(cancelamento.order?.id ?? "") === vaga) {
    return await cancelarNoBanco();
  }

  // Não provou. Só LÊ de novo para reconhecer a corrida "pagou no meio";
  // qualquer outra coisa é "tente de novo" — sem segunda escrita no MP.
  console.warn("criar-pagamento: cancelar — o MP não confirmou a anulação; nada mudou no banco", {
    pedidoId,
    idOrder: vaga,
    status: cancelamento.ok ? cancelamento.order?.status : cancelamento.status,
  });
  const releitura = await consultarOrder({ token, orderId: vaga, fetchImpl, corpoNoLog: false });
  if (releitura.ok && String(releitura.order?.id ?? "") === vaga && orderPaga(releitura.order as Record<string, unknown>)) {
    return responder("ja_pago");
  }
  return responder("recuperavel");
}

/** Costura de teste da conferência de admin (ver `_shared/admin-atual.ts`). */
export type OpcoesDaConferenciaDeAdmin = Partial<OpcoesDoAdminAtual>;

/**
 * Admin de AGORA — a MESMA conferência de `estornar-pagamento` (a regra mora em
 * `_shared/admin-atual.ts`, igual à `is_admin_atual()` da 20261197000000):
 * papel `admin` em `auth.users` (o `app_metadata` que o Auth devolve em
 * `getUser`, lido do banco a cada chamada, nunca do JWT) E em
 * `profiles.role`; contradição = NÃO é admin. Portão ANTES de qualquer efeito
 * no Mercado Pago. A RPC confere de novo, sob o lock.
 */
export async function verificarAdminAtualReal(
  authorization: string | null,
  opcoes: OpcoesDaConferenciaDeAdmin = {},
): Promise<string | null> {
  return await adminAtualDaSessao(authorization, {
    url: opcoes.url ?? Deno.env.get("SUPABASE_URL") ?? "",
    chavePublica: opcoes.chavePublica ?? readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    chaveDeServico: opcoes.chaveDeServico ?? readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    fetchImpl: opcoes.fetchImpl,
    rotulo: "criar-pagamento: cancelar —",
  });
}
