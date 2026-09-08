import { formatCurrency } from "@/lib/utils";

/**
 * Textos do estorno pelo app NA TELA DO CLIENTE (T7 do plano-mãe
 * `20260907-plano-estorno-pelo-app.md`). Funções PURAS — sem `supabase`, sem
 * `confirm`, sem JSX — para poder testar a tabela inteira sem montar
 * componente nenhum.
 *
 * Desde 07/09/2026 o cancelamento de um pedido PAGO e NÃO ENVIADO grava uma
 * linha em `order_refunds` na mesma transação (Task 1 do plano-mãe), e o
 * cron/edge (`estornar-pagamento`, `reconciliar-pagamentos`) tocam o
 * Mercado Pago sozinhos a partir dela — não existe mais "o dinheiro NÃO
 * volta automaticamente" para esse caso. O que ainda depende de alguém é
 * exatamente o caso oposto: pedido JÁ ENVIADO, onde a devolução física do
 * produto precisa acontecer antes de qualquer estorno fazer sentido.
 */

/** Status possíveis de UMA linha de `order_refunds` (mesmo vocabulário de
 * `useEstornosDoPedido.ts`, o hook do PAINEL — este arquivo não o importa,
 * de propósito: o cliente lê menos colunas que o lojista). */
export type StatusDevolucaoDoCliente =
  | "solicitado"
  | "em_processamento"
  | "concluido"
  | "falhou"
  | "recusado";

export interface LinhaDevolucaoDoCliente {
  amount: number;
  status: StatusDevolucaoDoCliente;
  solicitado_por: string;
  concluido_em: string | null;
}

const TEXTO_NAO_PAGO =
  "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.";

const TEXTO_PAGO_NAO_ENVIADO =
  "Você já pagou este pedido. Se cancelar, o dinheiro volta sozinho para você: PIX cai na sua conta; cartão aparece como crédito na fatura (o prazo é do seu banco). Tem certeza?";

const TEXTO_PAGO_JA_ENVIADO =
  "Este pedido já foi enviado. Se cancelar, você precisa devolver o produto à loja, e o dinheiro é devolvido pela loja depois que o produto chegar de volta. Tem certeza?";

const TEXTO_PAGO_NA_ENTREGA =
  "Você pagou este pedido na entrega. Se cancelar, combine a devolução do dinheiro diretamente com a loja. Tem certeza?";

interface ParametrosConfirmarCancelamento {
  pagamentoJaEntrou: boolean;
  jaFoiEnviado: boolean;
  /**
   * `payment_status === 'recebido_na_entrega'` — pago na mão, nunca passou
   * pelo Mercado Pago (Task 3b de
   * docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md). O brief
   * desta tarefa (`20260908-brief-t7-...md`) lista um QUARTO texto para este
   * caso na tabela "Textos exatos", mas fixa a assinatura da função com só
   * DOIS booleanos (`pagamentoJaEntrou`, `jaFoiEnviado`) — nenhuma
   * combinação deles alcança o texto de `recebido_na_entrega` sem um
   * terceiro sinal. Este campo é a extensão mínima que resolve isso:
   * opcional, aditivo, não muda o comportamento de quem já chamava a função
   * só com os dois campos originais. Sinalizado no relatório da tarefa como
   * decisão do executor, não do brief.
   */
  pagamentoNaEntrega?: boolean;
}

/**
 * Texto do `confirm()` antes de cancelar um pedido (`OrderDetailsView`,
 * `handleCancelOrder`). `!pagamentoJaEntrou` cobre tanto "nunca pagou" quanto
 * qualquer outro estado que não seja pago/pago_apos_expirar/
 * recebido_na_entrega — o texto original, sem mudar uma vírgula.
 */
export function textoConfirmarCancelamento({
  pagamentoJaEntrou,
  jaFoiEnviado,
  pagamentoNaEntrega = false,
}: ParametrosConfirmarCancelamento): string {
  if (!pagamentoJaEntrou) return TEXTO_NAO_PAGO;
  if (pagamentoNaEntrega) return TEXTO_PAGO_NA_ENTREGA;
  if (jaFoiEnviado) return TEXTO_PAGO_JA_ENVIADO;
  return TEXTO_PAGO_NAO_ENVIADO;
}

const TEXTO_EM_ANDAMENTO =
  "Devolução: em andamento — o dinheiro volta sozinho (PIX na conta; cartão na fatura).";

const TEXTO_LOJA_FAZ_DEPOIS =
  "Devolução: a loja faz depois de receber o produto de volta.";

const TEXTO_LOJA_JA_RECEBEU =
  "Devolução: a loja já recebeu o produto e vai devolver o dinheiro.";

const TEXTO_LOJA_CUIDANDO =
  "Devolução: a loja está cuidando disso — fale com ela se demorar.";

const ESTADOS_EM_CURSO: readonly StatusDevolucaoDoCliente[] = [
  "solicitado",
  "em_processamento",
];

interface ParametrosTextoDevolucao {
  linhas: LinhaDevolucaoDoCliente[];
  cancelledAfterShipping: boolean;
  returnedToSellerAt?: string | null;
}

/**
 * Texto do estado da devolução, mostrado no bloco de pagamento de um pedido
 * `cancelled` pago online. `null` = nada a mostrar (não há linha, e o
 * cancelamento não foi depois do envio — combinação que Task 1 do plano-mãe
 * não deveria produzir para pedido pago-não-enviado, porque a própria RPC já
 * grava a linha `solicitado` na mesma transação do cancelamento; se aparecer
 * mesmo assim, o mais seguro é a tela não afirmar nada sobre um estado que
 * não devia existir).
 */
export function textoDevolucao({
  linhas,
  cancelledAfterShipping,
  returnedToSellerAt,
}: ParametrosTextoDevolucao): string | null {
  const emAndamento = linhas.some((linha) =>
    ESTADOS_EM_CURSO.includes(linha.status),
  );
  if (emAndamento) return TEXTO_EM_ANDAMENTO;

  const concluidas = linhas.filter((linha) => linha.status === "concluido");
  if (concluidas.length > 0) {
    const total = concluidas.reduce((soma, linha) => soma + linha.amount, 0);
    return `Devolução concluída: ${formatCurrency(total)}`;
  }

  if (linhas.length === 0) {
    if (!cancelledAfterShipping) return null;
    return returnedToSellerAt ? TEXTO_LOJA_JA_RECEBEU : TEXTO_LOJA_FAZ_DEPOIS;
  }

  // Só sobram linhas `falhou`/`recusado` — nunca o texto técnico do erro
  // (`mp_status_detail`, `ultimo_erro`): o cliente não tem o que fazer com
  // isso, só a loja.
  return TEXTO_LOJA_CUIDANDO;
}
