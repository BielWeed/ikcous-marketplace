/**
 * O histórico de campanhas do painel de avisos (AdminPushView) mostra o que a
 * lojista ENVIOU aos clientes. A tabela `push_notifications_log` que o alimenta
 * também recebeu, por muito tempo, uma linha para cada resposta da loja a uma
 * pergunta ou avaliação — escrita pelas RPCs `answer_question_atomic` e
 * `reply_review_atomic` sem enviar push nenhum (0 aparelhos, selo "Não
 * confirmada"). Essas linhas não são campanha: poluíam a tela e, depois de ~20
 * respostas, empurravam as campanhas de verdade para fora da lista de 20.
 *
 * A migration 20261240000000 parou de gravar a linha das PERGUNTAS, mas as que
 * já existem continuam no banco (apagar dado existente é decisão do dono) e a
 * linha das AVALIAÇÕES ainda é gravada (a consulta de medição 27m a usa como
 * rastro). Por isso o filtro mora aqui, na leitura: a busca traz mais linhas
 * do que a tela mostra (LIMITE_DA_BUSCA_DO_HISTORICO), as linhas de resposta
 * da loja saem, e sobram no máximo LIMITE_DO_HISTORICO campanhas.
 */

/** Quantas campanhas a tela mostra. */
export const LIMITE_DO_HISTORICO = 20;

/**
 * Quantas linhas a busca pede ao banco. Maior que o que a tela mostra para que
 * linhas de resposta da loja (que saem do filtro) não ocupem os lugares das
 * campanhas.
 */
export const LIMITE_DA_BUSCA_DO_HISTORICO = 100;

/**
 * Os títulos que as RPCs de resposta gravam no log de push (comparação exata:
 * uma campanha da lojista com título parecido NÃO é escondida). A grafia sem
 * acento é a do corpo vivo de `reply_review_atomic` de 3 argumentos; a com
 * acento, a do baseline e da de 2 argumentos.
 */
export const TITULOS_DE_RESPOSTA_DA_LOJA: readonly string[] = [
  "Sua pergunta foi respondida!",
  "Sua avaliacao foi respondida!",
  "Sua avaliação foi respondida!",
];

/**
 * Tira as linhas de resposta da loja e devolve, na ordem recebida (a busca já
 * vem da mais nova para a mais antiga), no máximo `maximo` campanhas.
 */
export function somenteCampanhasReais<T extends { title: string }>(
  linhas: readonly T[],
  maximo: number = LIMITE_DO_HISTORICO,
): T[] {
  return linhas
    .filter((linha) => !TITULOS_DE_RESPOSTA_DA_LOJA.includes(linha.title))
    .slice(0, maximo);
}
