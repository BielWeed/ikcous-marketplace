/**
 * "Avaliação para atender" — a avaliação que ainda pede um ato da loja:
 * responder (`merchant_reply` nulo) OU aprovar (`status = 'pendente'`, ainda
 * não publicada). Responder NÃO publica a avaliação (`reply_review_atomic` só
 * grava a resposta), então a pendente já respondida continua pedindo o Aprovar
 * e tem de continuar acendendo o sino.
 *
 * UMA regra só, lida pela lista de Notificações (`useAvisosDoLojista`) e pela
 * bolinha do sino (`AdminLayout`): duas contagens diferentes para a mesma
 * pergunta seria pior que nenhuma.
 *
 * `status` só tem dois valores (`publicada` | `pendente`, CHECK da migration
 * 20261031000000).
 */
export const FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER =
  "merchant_reply.is.null,status.eq.pendente";
