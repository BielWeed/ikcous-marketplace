/**
 * Avaliação sem resposta: `merchant_reply` nulo. É a metade "responder" da
 * regra de "avaliação para atender" abaixo, e também a contagem do chip "Sem
 * resposta" da tela Avaliações, que lê esta constante e não escreve a regra de
 * novo — o N do chip e a bolinha do sino respondem à mesma pergunta. O SQL do
 * filtro (`p_status = 'sem_resposta'` de `get_admin_reviews_paged`, migration
 * 20261399996000) usa o mesmo critério: `merchant_reply IS NULL`. Resposta em
 * branco (só espaços) NÃO conta como "sem resposta" aqui, como no sino: o app
 * nunca grava uma, e a tela a desenharia como respondida.
 */
export const FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA = "merchant_reply.is.null";

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
export const FILTRO_POSTGREST_AVALIACAO_PARA_ATENDER = `${FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA},status.eq.pendente`;
