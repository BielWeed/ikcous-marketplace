/**
 * "Para preparar" — UMA regra só no painel (onda F do painel simples, F1).
 *
 * Espelho literal de `pendencias.pedidos_para_preparar` em `painel_inicio`
 * (`supabase/migrations/20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql`,
 * a definição mais nova; o trecho dos pedidos é o da 20261199000000):
 *
 *   status IN ('new','pending','processing')
 *   AND COALESCE(payment_status,'') NOT IN ('aguardando','expirado','recusado','estornado')
 *
 * Antes desta lib, o selo da aba Pedidos e o sino contavam só o `status`:
 * um PIX gerado e ainda não pago (que espera a CLIENTE) aparecia como
 * "esperando você", e o selo discordava do "Pedidos para preparar" do
 * Início. O teste `tests/front/pedidos-para-preparar.test.ts` lê o SQL e
 * reprova se as listas abaixo derivarem dele.
 */

/**
 * Status em que o pedido ainda está na loja. `"new"` é valor histórico da
 * coluna (o enum `OrderStatus` do front nunca o modelou), mantido porque o
 * banco ainda o soma. A ordem é a do antigo `STATUS_PEDIDOS_COM_ACAO_PENDENTE`.
 */
export const STATUS_PARA_PREPARAR = ["pending", "new", "processing"] as const;

/**
 * Pagamentos que tiram o pedido de "para preparar": ainda não pago
 * (`aguardando`), não pago a tempo (`expirado`), negado (`recusado`) ou
 * devolvido (`estornado`). `null` e `''` NÃO estão aqui — pedido sem
 * cobrança online (balcão, dinheiro na entrega, históricos) prepara.
 */
export const PAGAMENTOS_QUE_NAO_PREPARAM = [
  "aguardando",
  "expirado",
  "recusado",
  "estornado",
] as const;

/**
 * Pedido ABERTO (status em `STATUS_PARA_PREPARAR`) com um destes pagamentos
 * não está para preparar nem esperando a cliente — ex.: PIX recusado depois
 * que o lojista já avançou para "Em Separação", ou contestação no cartão de
 * um pedido pago ainda aberto. Sai de todo contador (a regra do Início não
 * muda) e o topo de Pedidos mostra um aviso só de leitura com a contagem
 * (revisão da onda F, S3). Subconjunto de `PAGAMENTOS_QUE_NAO_PREPARAM`.
 */
export const PAGAMENTOS_A_CONFERIR_EM_ABERTO = [
  "recusado",
  "estornado",
] as const satisfies readonly (typeof PAGAMENTOS_QUE_NAO_PREPARAM)[number][];

/**
 * O mesmo predicado de pagamento para o `.or(...)` do PostgREST. O
 * `COALESCE(payment_status,'')` do SQL vira as duas pontas: `is.null` cobre
 * o nulo e `not.in` cobre o resto (inclusive `''`, que não está na lista).
 * Montado das constantes para não haver uma terceira cópia escrita à mão.
 */
export const FILTRO_POSTGREST_PARA_PREPARAR = `payment_status.is.null,payment_status.not.in.(${PAGAMENTOS_QUE_NAO_PREPARAM.join(",")})`;

interface PedidoParaAvaliar {
  status: string;
  paymentStatus?: string | null;
}

function statusAberto(status: string): boolean {
  return (STATUS_PARA_PREPARAR as readonly string[]).includes(status);
}

/** O pedido está na loja e o pagamento não impede de preparar. */
export function estaParaPreparar({
  status,
  paymentStatus,
}: PedidoParaAvaliar): boolean {
  return (
    statusAberto(status) &&
    !(PAGAMENTOS_QUE_NAO_PREPARAM as readonly string[]).includes(
      paymentStatus ?? "",
    )
  );
}

/** O pedido está na loja esperando a cliente pagar o PIX/cartão. */
export function estaAguardandoPagamento({
  status,
  paymentStatus,
}: PedidoParaAvaliar): boolean {
  return statusAberto(status) && paymentStatus === "aguardando";
}
