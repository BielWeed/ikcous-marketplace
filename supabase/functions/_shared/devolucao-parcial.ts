// @ts-nocheck
/**
 * DEVOLUÇÃO PARCIAL ANTES DA CONFIRMAÇÃO (21/10/2026, revisão adversarial do
 * lote 1.5.47) — quando uma devolução PARCIAL do Mercado Pago prova que o
 * pagamento foi aprovado, e como registrar o dinheiro devolvido.
 *
 * O DEFEITO MEDIDO (P1): cliente paga um PIX de R$ 100; a notificação falha ou
 * atrasa; o lojista devolve R$ 20 pelo painel do Mercado Pago. Daí em diante
 * toda consulta da order responde `processed` + `partially_refunded`, par que
 * `mapearStatusOrder` traduz para `null` DE PROPÓSITO (um estorno parcial não
 * pode apagar a venda inteira dos relatórios — ver `MAPA_STATUS_ORDER`). O
 * webhook registra a devolução no ledger e para; a reconciliação ignora o
 * pedido como "status desconhecido"; a tela do cliente só aceita "pago e
 * creditado". Em 30 minutos a expiração cancela o pedido e devolve o estoque,
 * e o Financeiro mostra uma saída de R$ 20 sem a entrada de R$ 100.
 *
 * A REGRA: só se devolve dinheiro de um pagamento APROVADO. Uma devolução
 * parcial concluída é, portanto, a prova da aprovação — desde que o resto da
 * régua de prova também bata: é a cobrança GRAVADA no pedido (mesmo id da
 * vaga, mesmo `external_reference`), o valor ORIGINAL da cobrança confere com
 * o total do pedido (mesma tolerância da casa, `conferirValorDoPagamento`) e o
 * pedido ainda está esperando (`aguardando` ou `expirado`, sem `paid_at`).
 * Qualquer dúvida devolve `provado: false` e o comportamento de antes
 * continua valendo — esta função só ABRE a porta, nunca a fecha.
 *
 * O QUE ELA NÃO DECIDE: 'pago' × 'pago_apos_expirar' e a idempotência — quem
 * decide é a RPC `confirmar_pagamento`, sob `FOR UPDATE`. Nem mexe no mapa de
 * status: a devolução parcial continua sendo `null` para todo o resto.
 *
 * Formatos da Orders API (doc oficial, conferida em 21/10/2026): a resposta de
 * devolução parcial traz `status: "processed"` + `status_detail:
 * "partially_refunded"`, e `transactions.refunds[]` com `status: "processed"`
 * quando concluída; o GET da order traz também `transactions.payments[].
 * refunded_amount` (só quando houve devolução). Uma página irmã da mesma doc
 * diz `status: "refunded"` para a devolução parcial — a doc se contradiz, por
 * isso a decisão olha o DETALHE (`partially_refunded` / valor devolvido), nunca
 * o `status` principal sozinho.
 *
 * Pura: não toca rede nem banco, não loga.
 */
import { refundsDaOrder } from "./estorno.ts";
import {
  extrairValorDaOrder,
  idEhClassico,
  mapearStatusOrder,
  vagaEmVerificacao,
} from "./mercadopago.ts";
import { conferirValorDoPagamento } from "./prova-de-pagamento.ts";

/** Os dois `status` principais que a doc publica para a devolução parcial. */
const STATUS_DA_DEVOLUCAO_PARCIAL = new Set(["processed", "refunded"]);

/** Estados do PAGAMENTO que contam que o dinheiro nunca foi capturado. */
const PAGAMENTO_SEM_CAPTURA = new Set([
  "created",
  "canceled",
  "cancelled",
  "failed",
  "expired",
  "rejected",
  "pending",
  "processing",
  "in_process",
]);

const ESTADOS_QUE_ESPERAM_PAGAMENTO = new Set(["aguardando", "expirado"]);

export type DevolucaoConcluida = { id: string; valor: number };

export type MotivoDaRecusaDaDevolucaoParcial =
  | "order"
  | "nao_e_devolucao_parcial"
  | "sem_devolucao_concluida"
  | "devolucao_nao_comprovada_por_inteiro"
  | "devolucao_total_ou_maior"
  | "pedido_ausente"
  | "pedido_ja_resolvido"
  | "cobranca_diferente"
  | "referencia"
  | "moeda"
  | "contestacao"
  | "pagamentos"
  | "status_do_pagamento"
  | "valor_do_pagamento"
  | "valor_ausente"
  | "total_do_pedido"
  | "valor_divergente";

export type DecisaoDaDevolucaoParcial =
  | { provado: true; valorOriginal: number; devolvido: number; devolucoes: DevolucaoConcluida[] }
  | { provado: false; motivo: MotivoDaRecusaDaDevolucaoParcial };

const presente = (v: unknown): boolean => v !== undefined && v !== null;
const centavos = (valor: number): number => Math.round(valor * 100);

function comoNumero(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const temRegistro = (v: unknown): boolean => presente(v) && (!Array.isArray(v) || v.length > 0);

/**
 * As devoluções CONCLUÍDAS da order (`transactions.refunds[]` com `status:
 * "processed"`, id legível e valor finito positivo), sem repetir id. O que está
 * em andamento (`processing`), falhou ou veio ilegível não conta: na dúvida,
 * "ainda não" — a mesma régua do ledger do webhook (`registrarDesfechoDoEstorno`).
 */
export function devolucoesConcluidasDaOrder(order: unknown): DevolucaoConcluida[] {
  if (!order || typeof order !== "object" || Array.isArray(order)) return [];
  const vistos = new Set<string>();
  const concluidas: DevolucaoConcluida[] = [];
  for (const refund of refundsDaOrder(order as Record<string, unknown>)) {
    if (refund.status !== "processed") continue;
    const id = typeof refund.id === "string" || typeof refund.id === "number" ? String(refund.id) : "";
    const valor = comoNumero(refund.amount);
    if (!id || valor === null || !(valor > 0) || vistos.has(id)) continue;
    vistos.add(id);
    concluidas.push({ id, valor: Number(valor.toFixed(2)) });
  }
  return concluidas;
}

/**
 * Decide se a devolução PARCIAL concluída desta order prova que o pedido foi
 * pago. `order` é o objeto do GET autenticado por id (nunca o corpo do webhook);
 * `pedido` é a linha relida do banco (`id`, `total`/`total_amount`,
 * `gateway_payment_id`, `payment_status`, `paid_at`).
 */
export function devolucaoParcialProvaPagamento(args: {
  order: unknown;
  pedido: unknown;
}): DecisaoDaDevolucaoParcial {
  const recusa = (motivo: MotivoDaRecusaDaDevolucaoParcial): DecisaoDaDevolucaoParcial => ({
    provado: false,
    motivo,
  });

  const bruta = args.order;
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return recusa("order");
  const o = bruta as Record<string, unknown>;

  // Só o que o mapa de status devolve `null` para chega aqui: pares mapeados
  // (pago, estornado, contestação…) têm o seu próprio caminho.
  const status = typeof o.status === "string" ? o.status : "";
  const detalhe = typeof o.status_detail === "string" ? o.status_detail : "";
  if (!STATUS_DA_DEVOLUCAO_PARCIAL.has(status) || mapearStatusOrder(status, detalhe) !== null) {
    return recusa("nao_e_devolucao_parcial");
  }

  const transacoes = o.transactions && typeof o.transactions === "object"
    ? o.transactions as Record<string, unknown>
    : undefined;
  if (temRegistro(o.chargebacks) || temRegistro(transacoes?.chargebacks)) return recusa("contestacao");
  const pagamentos = transacoes?.payments;
  if (!Array.isArray(pagamentos) || pagamentos.length !== 1) return recusa("pagamentos");
  const pagamento = pagamentos[0];
  if (!pagamento || typeof pagamento !== "object") return recusa("pagamentos");
  const p = pagamento as Record<string, unknown>;
  if (temRegistro(p.chargebacks)) return recusa("contestacao");
  if (typeof p.status === "string" && PAGAMENTO_SEM_CAPTURA.has(p.status)) {
    return recusa("status_do_pagamento");
  }
  const detalheDoPagamento = typeof p.status_detail === "string" ? p.status_detail : "";
  const devolvidoNoPagamento = comoNumero(p.refunded_amount);
  const indicioDeParcial = detalhe === "partially_refunded" || detalheDoPagamento === "partially_refunded" ||
    (devolvidoNoPagamento !== null && devolvidoNoPagamento > 0);
  if (!indicioDeParcial) return recusa("nao_e_devolucao_parcial");

  if (presente(o.currency) && o.currency !== "BRL") return recusa("moeda");
  if (presente(o.currency_id) && o.currency_id !== "BRL") return recusa("moeda");

  // Dinheiro devolvido COM comprovação: só a LISTA de devoluções concluídas (id e
  // valor legíveis) prova — é ela que o chamador registra em `order_refunds`.
  // O `refunded_amount` agregado do pagamento é só CONFERÊNCIA CRUZADA, nunca
  // prova isolada: se a lista vier vazia ou somar MENOS que o agregado, parte do
  // dinheiro devolvido ficaria sem registro (receita superestimada e saldo
  // devolvível errado), então "na dúvida, ainda não". Soma MAIOR que o agregado
  // (o MP atualiza o agregado depois) segue valendo: o devolvido é a soma da lista.
  const devolucoes = devolucoesConcluidasDaOrder(o);
  const somaDasDevolucoes = devolucoes.reduce((s, d) => s + centavos(d.valor), 0);
  if (!(somaDasDevolucoes > 0)) return recusa("sem_devolucao_concluida");
  const agregadoEmCentavos = devolvidoNoPagamento !== null && devolvidoNoPagamento > 0
    ? centavos(devolvidoNoPagamento)
    : 0;
  if (somaDasDevolucoes < agregadoEmCentavos) return recusa("devolucao_nao_comprovada_por_inteiro");
  const devolvidoEmCentavos = somaDasDevolucoes;

  // O pedido: relido do banco, ainda esperando pagamento.
  const ped = args.pedido;
  if (!ped || typeof ped !== "object" || Array.isArray(ped)) return recusa("pedido_ausente");
  const pedido = ped as Record<string, unknown>;
  if (typeof pedido.id !== "string" || pedido.id.length === 0) return recusa("pedido_ausente");
  if (!ESTADOS_QUE_ESPERAM_PAGAMENTO.has(String(pedido.payment_status)) || pedido.paid_at !== null) {
    return recusa("pedido_ja_resolvido");
  }

  // A cobrança é a GRAVADA no pedido — nunca uma order órfã de outra tentativa
  // (mesmo `external_reference`, outro id) nem o sentinela ou o id clássico.
  const vaga = pedido.gateway_payment_id;
  if (typeof vaga !== "string" || vaga.length === 0 || vagaEmVerificacao(vaga) || idEhClassico(vaga)) {
    return recusa("cobranca_diferente");
  }
  if (typeof o.id !== "string" || o.id !== vaga) return recusa("cobranca_diferente");
  if (typeof o.external_reference !== "string" || o.external_reference !== pedido.id) {
    return recusa("referencia");
  }

  // O valor ORIGINAL da cobrança (raiz `total_amount`, ou o do pagamento único)
  // contra o total do pedido — a mesma régua das outras portas.
  if (presente(p.amount) && presente(o.total_amount)) {
    const doPagamento = comoNumero(p.amount);
    const daOrder = comoNumero(o.total_amount);
    if (doPagamento === null || daOrder === null || centavos(doPagamento) !== centavos(daOrder)) {
      return recusa("valor_do_pagamento");
    }
  }
  const valorOriginal = extrairValorDaOrder(o);
  const conferencia = conferirValorDoPagamento(valorOriginal, pedido.total ?? pedido.total_amount, o);
  if (!conferencia.provado) return recusa(conferencia.motivo);

  // Parcial é parcial: devolveu tudo (ou mais) não é esta regra. O teto é o MENOR entre a cobrança
  // e o total do pedido: cartão parcelado com juros pode ter cobrança > total do pedido, e uma
  // devolução acima do total do pedido não cabe no registro (`nao_cabe`) — recusa aqui, antes.
  const limiteEmCentavos = Math.min(centavos(conferencia.valor), centavos(conferencia.total));
  if (devolvidoEmCentavos >= limiteEmCentavos) return recusa("devolucao_total_ou_maior");

  return {
    provado: true,
    valorOriginal: conferencia.valor,
    devolvido: devolvidoEmCentavos / 100,
    devolucoes,
  };
}

/** O mínimo do cliente Supabase que o registro das devoluções usa. */
export type ClienteRpc = {
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type ResumoDoRegistroDasDevolucoes = {
  inseridas: number;
  jaRegistradas: number;
  /** Devolução do MP que passa do que o pedido ainda podia devolver: NÃO gravada. */
  naoCabem: DevolucaoConcluida[];
};

/**
 * Registra no ledger CADA devolução concluída da order, pela RPC
 * `registrar_estorno_externo_do_mp` (pedido travado, idempotente pelo id da
 * devolução: reentrega e cron concorrente devolvem `ja_registrado`). O mesmo
 * contrato que o webhook usa para o estorno feito no painel do MP.
 *
 * Falha de banco ou retorno ilegível LANÇA: quem chama não confirma nada e o
 * candidato volta no próximo ciclo (a RPC é idempotente, repetir é seguro).
 */
export async function registrarDevolucoesConcluidasDaOrder(args: {
  supabase: ClienteRpc;
  orderId: string;
  order: Record<string, unknown>;
  devolucoes?: DevolucaoConcluida[];
}): Promise<ResumoDoRegistroDasDevolucoes> {
  const { supabase, orderId, order } = args;
  const devolucoes = args.devolucoes ?? devolucoesConcluidasDaOrder(order);
  const status = typeof order.status === "string" ? order.status : "";
  const detalhe = typeof order.status_detail === "string" ? order.status_detail : "";
  const resumo: ResumoDoRegistroDasDevolucoes = { inseridas: 0, jaRegistradas: 0, naoCabem: [] };

  for (const devolucao of devolucoes) {
    const { data, error } = await supabase.rpc("registrar_estorno_externo_do_mp", {
      p_order_id: orderId,
      p_mp_refund_id: devolucao.id,
      p_valor: devolucao.valor,
      p_mp_status: status,
      p_mp_status_detail: detalhe || null,
    });
    if (error) throw error;
    const retorno = (data ?? null) as Record<string, unknown> | null;
    const resultado = retorno?.resultado;
    if (resultado === "inserido") resumo.inseridas++;
    else if (resultado === "ja_registrado") resumo.jaRegistradas++;
    else if (resultado === "nao_cabe" || retorno?.aviso === "saldo") resumo.naoCabem.push(devolucao);
    else throw new Error(`registrar_estorno_externo_do_mp devolveu resultado inesperado: ${String(resultado)}`);
  }
  return resumo;
}
