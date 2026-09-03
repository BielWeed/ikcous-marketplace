import type { Order } from "@/types";

/**
 * Os números do resumo do topo da ficha do cliente (AdminUserDetailView),
 * calculados de UM lugar só.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   A ficha já teve três contagens que não conversavam (auditoria de
 *   20/08/2026, achados 5 e 17): o card de pedidos contava tudo, o LTV
 *   filtrava só `cancelled`, e a lista de Clientes usava outra regra
 *   ainda. A regra que estava inline na view se mudou para cá na frente
 *   "ficha do cliente" (03/09) — que acrescentou ÚLTIMA COMPRA e TICKET
 *   MÉDIO ao resumo. Regra de dinheiro/contagem escrita em dois lugares
 *   diverge; agora os quatro números nascem desta função única, testada
 *   em tests/front/admin-ficha-cliente-resumo.test.tsx.
 *
 * AS REGRAS (fonte: o servidor, não a cabeça de ninguém)
 *
 *   1. Um pedido "conta" quando não foi cancelado nem devolvido — a MESMA
 *   regra que o servidor usa na lista de Clientes (`get_admin_customers_paged`,
 *   com `status NOT IN ('cancelled','returned')`).
 *
 *   Até 21/08/2026 a ficha tinha o card "Cesta / Pedidos" mostrando
 *   `orders.length` (tudo, cancelados incluídos) e o LTV filtrava só
 *   `cancelled` (esquecendo `returned`). Resultado medido: o mesmo cliente
 *   aparecia com "Pedidos 6" na lista e "Cesta / Pedidos 16" na ficha, sem
 *   nada explicando os 10 de diferença. Com 72 dos 83 pedidos daquele banco
 *   cancelados, isso valia para quase todo cliente com histórico.
 *
 *   A ABA de pedidos continua mostrando o histórico inteiro de propósito:
 *   é o número de linhas que a tabela abaixo dela lista. Trocar por 6 faria
 *   a aba mentir sobre o próprio conteúdo. O que sai daqui não é o segundo
 *   número — é o mistério, porque o card passa a dizer quantos ficaram fora.
 *
 *   2. O `as string` no `returned` não é gambiarra: `OrderStatus`
 *   (types/index.ts) lista cinco valores e não inclui `returned`, mas o
 *   `mappers.ts:247` faz `row.status as OrderStatus` — um cast, não uma
 *   validação. Se o banco devolver `returned`, o valor chega aqui em tempo
 *   de execução com o tipo mentindo sobre ele, e o TypeScript acha a
 *   comparação impossível. Hoje nenhum pedido do banco está nesse estado,
 *   então isto é defesa: o servidor filtra por `returned` na lista, e as
 *   contagens têm de continuar iguais no dia em que o status aparecer.
 *
 *   3. Dinheiro reconhecido (PEDIDO CANCELADO NÃO ENTRA NO TOTAL GASTO):
 *   o total só soma pedidos que contam (regra 1) E com cobrança confirmada.
 *   A migration `20260823000000` (`ltv_do_cliente_conta_so_dinheiro_reconhecido`)
 *   trouxe o filtro de cobrança; a `20261021000000`
 *   (`receita_conta_so_dinheiro_que_entrou`) mudou a lista final: contam
 *   'pago', 'pago_apos_expirar' e 'recebido_na_entrega'. Ficam de fora —
 *   além de todo cancelado/devolvido — os pedidos com `payment_status`
 *   nulo, 'aguardando', 'recusado', 'expirado' e 'estornado'. Nulo DEIXOU
 *   de contar porque "pago na entrega" hoje é registrado explicitamente
 *   (RPC `registrar_pagamento_recebido`); até ali nulo era o único jeito
 *   de representar esse recebimento e por isso contava.
 *
 *   4. TICKET MÉDIO = total gasto ÷ pedidos COM dinheiro reconhecido.
 *   É a fórmula do ticket médio GLOBAL do painel (`get_admin_analytics_v2`:
 *   `avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0`,
 *   onde numerador e denominador usam a MESMA base de dinheiro reconhecido),
 *   aplicada ao recorte deste cliente. O denominador NÃO é
 *   `pedidosQueContam.length` de propósito: a contagem de pedidos existe
 *   para bater com a coluna "Pedidos" da lista de Clientes (regra 1, sem
 *   filtro de cobrança), e usá-la aqui diluiria o ticket com pedido que
 *   ninguém pagou — o mesmo PIX pendente que o teste da tela de Clientes
 *   (admin-customers-ticket-medio.test.tsx) usa para flagrar ticket de
 *   fonte errada. Cliente sem nenhum pedido pago tem ticket medido como 0
 *   (o `ELSE 0` do servidor), não um traco de dado ausente.
 *
 *   5. ÚLTIMA COMPRA = data do pedido que conta MAIS RECENTE (regra 1, SEM
 *   filtro de cobrança) — a MESMA regra do `last_order_date` do servidor em
 *   `get_admin_customers_paged` ("orders_count e last_order_date continuam
 *   contando qualquer pedido não cancelado/devolvido"). Um PIX aguardando
 *   feito ontem prova que o cliente ESTÁ ativo; escondê-lo por falta de
 *   cobrança confirmada faria a ficha dizer "última compra em março" sobre
 *   alguém que comprou ontem. Sem pedido que conta, é `null` — a view mostra
 *   "—" e não inventa data.
 */

/** Cobranças que significam dinheiro que entrou de verdade (regra 3). */
const DINHEIRO_RECONHECIDO: readonly string[] = [
  "pago",
  "pago_apos_expirar",
  "recebido_na_entrega",
];

export interface ResumoFichaCliente {
  /** Pedidos não cancelados/devolvidos — a base da CONTAGEM (regra 1). */
  pedidosQueContam: Order[];
  /** Dos que contam, os com dinheiro reconhecido — a base do DINHEIRO (regra 3). */
  pedidosPagos: Order[];
  /** Quantos do histórico ficaram fora da contagem (cancelado/devolvido). */
  pedidosDescartados: number;
  /** Soma do dinheiro reconhecido (regra 3). */
  totalGasto: number;
  /** Total gasto ÷ pedidos pagos; 0 quando não há pedido pago (regra 4). */
  ticketMedio: number;
  /** Data do pedido que conta mais recente; null se nunca comprou (regra 5). */
  ultimaCompra: Date | null;
}

export function calcularResumoFicha(orders: Order[]): ResumoFichaCliente {
  const pedidosQueContam = orders.filter(
    (o) => o.status !== "cancelled" && (o.status as string) !== "returned",
  );

  const pedidosPagos = pedidosQueContam.filter((o) =>
    DINHEIRO_RECONHECIDO.includes(o.paymentStatus ?? ""),
  );

  const totalGasto = pedidosPagos.reduce((sum, o) => sum + o.total, 0);

  const ticketMedio =
    pedidosPagos.length > 0 ? totalGasto / pedidosPagos.length : 0;

  const ultimaCompra = pedidosQueContam.reduce<Date | null>(
    (maisRecente, o) => {
      const data = new Date(o.createdAt);
      if (Number.isNaN(data.getTime())) return maisRecente;
      if (maisRecente === null || data > maisRecente) return data;
      return maisRecente;
    },
    null,
  );

  return {
    pedidosQueContam,
    pedidosPagos,
    pedidosDescartados: orders.length - pedidosQueContam.length,
    totalGasto,
    ticketMedio,
    ultimaCompra,
  };
}
