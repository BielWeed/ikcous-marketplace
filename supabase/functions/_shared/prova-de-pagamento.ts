// @ts-nocheck
/**
 * PROVA DE PAGAMENTO — quando a consulta autenticada do cliente basta para
 * confirmar o pedido NA HORA (04/10/2026, laudo do crítico de desenho).
 *
 * O DEFEITO MEDIDO: no ensaio TEST c35ce4dd o `verificar` da `criar-pagamento`
 * viu a order `processed:accredited` e a tela mostrou "Pagamento aprovado!
 * Confirmando seu pedido...", mas o banco só virou 'pago' ~2 min depois, pela
 * reconciliação — a consulta nunca chamava `confirmar_pagamento`. Esta função
 * decide QUANDO ela pode chamar: só com PROVA, nunca com indício.
 *
 * A REGRA, campo a campo (cada uma recusa sozinha; teste isolado por campo em
 * `prova-de-pagamento_test.ts`). Contrato conferido pelo coordenador na fonte
 * primária (referência GET /v1/orders/{id},
 * https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get)
 * e nas páginas de integração de cartão e PIX (ver as fixtures):
 *
 *   (a) o objeto veio de GET /v1/orders/{id} — nunca da busca por
 *       `external_reference`, de um POST de criação, de um PUT/POST de
 *       cancelamento nem do corpo de um webhook (forjável). `origem` é
 *       declarada por quem chama, e só "get_por_id" passa;
 *   (b) o id consultado é a vaga RELIDA do banco (`gateway_payment_id`), e o
 *       `order.id` devolvido é esse mesmo — sentinela (`verificando:`) e id
 *       clássico (PIX legado, /v1/payments) nunca passam;
 *   (c) `external_reference` === o pedido (a resposta do MP é autenticada
 *       pelo token; é ela, nunca o banco, que diz de QUEM é o dinheiro);
 *   (d) o par da RAIZ `status`/`status_detail` é `processed:accredited` e
 *       mapeia para 'pago' (`mapearStatusOrder`) — "approved" é vocabulário
 *       da Payments API (autorizado ≠ capturado), NÃO da Orders, e não passa;
 *   (e) `total_amount` presente, finito, > 0 (`extrairValorDaOrder`, a mesma
 *       leitura do webhook) e `!(Math.abs(valor - total) > TOLERANCIA_DE_VALOR)`
 *       contra o total RELIDO do banco — a MESMA expressão do webhook;
 *   (f) VALOR PAGO capturado: `total_paid_amount` da raiz — ou, só quando ele
 *       não vem, `paid_amount` do pagamento — presente, finito, > 0 e
 *       `>= total - TOLERANCIA_DE_VALOR` (juros de parcelamento podem fazer o
 *       pago passar do pedido; pago MENOR é parcial e recusa). Os DOIS
 *       ausentes: não se afirma captura — recusa `valor_pago_ausente`, e a
 *       confirmação fica para webhook/reconciliação (contrato de antes). A
 *       raiz manda quando existe porque a doc publica `paid_amount` 47,28
 *       contra `total_amount` 50,00 nos dois exemplos oficiais de cartão
 *       aprovado — o `paid_amount` do pagamento não é "quanto entrou do
 *       pedido", e exigi-lo >= total recusaria o próprio exemplo da doc;
 *   (g) CONTRADIÇÃO recusa, AUSÊNCIA não: `currency`/`currency_id` presente
 *       ≠ "BRL"; `country_code` presente fora de {"BR", "BRA"} (a referência
 *       do GET publica "BR"; as páginas de integração de cartão e de PIX
 *       publicam "BRA" — as duas grafias são o Brasil); `type` presente ≠
 *       "online"; `transactions.payments` com tamanho ≠ 1; pagamento com
 *       `status`/`status_detail` presente fora de processed/accredited;
 *       `amount` do pagamento presente ≠ `total_amount` presente; QUALQUER
 *       estorno ou contestação crua (`refunds`/`chargebacks` não vazios, na
 *       raiz ou em `transactions`) — a referência do GET mostra um
 *       chargeback `in_process` ao lado de uma raiz `processed:accredited`;
 *   (h) `paid_amount`/`total_paid_amount` NUNCA são comparados por
 *       IGUALDADE com o total (o exemplo de cartão da doc traz
 *       `total_paid_amount "200.00"` para `total_amount "50.00"`).
 *
 * O QUE ESTA FUNÇÃO NÃO DECIDE: se o pedido ainda está 'aguardando' (quem
 * chama relê o banco antes) e o desfecho no banco — quem decide 'pago',
 * 'pago_apos_expirar' ou 'ja_pago' é a RPC `confirmar_pagamento`, sob
 * `FOR UPDATE`. Esta é só a porta: sem prova, a RPC nem é chamada.
 *
 * Pura: não toca rede nem banco, não loga (o objeto de cartão carrega e-mail
 * e CPF do pagador — quem chama loga só o `motivo`).
 */
import {
  extrairValorDaOrder,
  idEhClassico,
  mapearStatusOrder,
  TOLERANCIA_DE_VALOR,
  vagaEmVerificacao,
} from "./mercadopago.ts";

/** A única origem que prova: o GET autenticado da order pelo id da vaga. */
export const ORIGEM_GET_POR_ID = "get_por_id";

export type MotivoDaRecusaDaProva =
  | "origem"
  | "vaga"
  | "id"
  | "referencia"
  | "status"
  | "moeda"
  | "pais"
  | "tipo"
  | "pagamentos"
  | "status_do_pagamento"
  | "valor_do_pagamento"
  | "estorno"
  | "chargeback"
  | "valor_ausente"
  | "total_do_pedido"
  | "valor_divergente"
  | "valor_pago"
  | "valor_pago_ausente";

export type ResultadoDaProva =
  | { provado: true; valor: number; valorPago: number }
  | { provado: false; motivo: MotivoDaRecusaDaProva };

const presente = (v: unknown): boolean => v !== undefined && v !== null;

/** String ou número que vira número finito; o resto vira `null`. */
function comoNumero(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Lista PRESENTE e não vazia — ou qualquer coisa presente que não seja lista
 * (forma desconhecida de um campo de estorno/contestação nunca é "nada"). */
const temRegistro = (v: unknown): boolean => presente(v) && (!Array.isArray(v) || v.length > 0);

/** Os dois países que a doc publica para o Brasil (ver o topo, regra (g)). */
const PAISES_DO_BRASIL = new Set(["BR", "BRA"]);

export function provarPagamentoPelaConsulta(args: {
  origem: string;
  idConsultado: string;
  vagaRelida: unknown;
  pedidoId: string;
  totalRelido: unknown;
  order: unknown;
}): ResultadoDaProva {
  const recusa = (motivo: MotivoDaRecusaDaProva): ResultadoDaProva => ({ provado: false, motivo });

  // (a)
  if (args.origem !== ORIGEM_GET_POR_ID) return recusa("origem");

  // (b) a vaga relida, e o id consultado é ela.
  const vaga = args.vagaRelida;
  if (typeof vaga !== "string" || vaga.length === 0) return recusa("vaga");
  if (vagaEmVerificacao(vaga) || idEhClassico(vaga)) return recusa("vaga");
  if (args.idConsultado !== vaga) return recusa("vaga");
  const order = args.order;
  if (!order || typeof order !== "object" || Array.isArray(order)) return recusa("id");
  const o = order as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id !== vaga) return recusa("id");

  // (c)
  if (typeof o.external_reference !== "string" || o.external_reference !== args.pedidoId) {
    return recusa("referencia");
  }

  // (d) o par da RAIZ — literal E pelo mapa (defesa: um par novo no mapa
  // nunca vira prova sem passar por aqui de novo).
  const status = typeof o.status === "string" ? o.status : "";
  const detalhe = typeof o.status_detail === "string" ? o.status_detail : "";
  if (status !== "processed" || detalhe !== "accredited" || mapearStatusOrder(status, detalhe) !== "pago") {
    return recusa("status");
  }

  // (g) contradição recusa, ausência não.
  if (presente(o.currency) && o.currency !== "BRL") return recusa("moeda");
  if (presente(o.currency_id) && o.currency_id !== "BRL") return recusa("moeda");
  if (presente(o.country_code) && !PAISES_DO_BRASIL.has(String(o.country_code))) return recusa("pais");
  if (presente(o.type) && o.type !== "online") return recusa("tipo");
  const transacoes = o.transactions && typeof o.transactions === "object"
    ? o.transactions as Record<string, unknown>
    : undefined;
  if (temRegistro(o.refunds) || temRegistro(transacoes?.refunds)) return recusa("estorno");
  if (temRegistro(o.chargebacks) || temRegistro(transacoes?.chargebacks)) return recusa("chargeback");
  const pagamentos = transacoes?.payments;
  if (!Array.isArray(pagamentos) || pagamentos.length !== 1) return recusa("pagamentos");
  const pagamento = pagamentos[0];
  if (!pagamento || typeof pagamento !== "object") return recusa("pagamentos");
  const p = pagamento as Record<string, unknown>;
  if (presente(p.status) && p.status !== "processed") return recusa("status_do_pagamento");
  if (presente(p.status_detail) && p.status_detail !== "accredited") return recusa("status_do_pagamento");
  if (temRegistro(p.refunds)) return recusa("estorno");
  if (temRegistro(p.chargebacks)) return recusa("chargeback");
  if (presente(p.amount) && presente(o.total_amount)) {
    const doPagamento = comoNumero(p.amount);
    const daOrder = comoNumero(o.total_amount);
    if (doPagamento === null || daOrder === null || doPagamento !== daOrder) return recusa("valor_do_pagamento");
  }

  // (e) valor presente, finito e > 0, contra o total RELIDO — a expressão
  // do webhook (os dois lados já são finitos aqui, NaN nunca chega).
  const valor = extrairValorDaOrder(o);
  if (typeof valor !== "number" || !Number.isFinite(valor) || !(valor > 0)) return recusa("valor_ausente");
  const total = comoNumero(args.totalRelido);
  if (total === null || !(total > 0)) return recusa("total_do_pedido");
  if (Math.abs(valor - total) > TOLERANCIA_DE_VALOR) return recusa("valor_divergente");

  // (f) o valor PAGO: a raiz manda quando existe; o do pagamento só sem ela.
  const brutoPago = presente(o.total_paid_amount) ? o.total_paid_amount : p.paid_amount;
  if (!presente(brutoPago)) return recusa("valor_pago_ausente");
  const valorPago = comoNumero(brutoPago);
  if (valorPago === null || !(valorPago > 0)) return recusa("valor_pago");
  if (valorPago < total - TOLERANCIA_DE_VALOR) return recusa("valor_pago");

  return { provado: true, valor, valorPago };
}
