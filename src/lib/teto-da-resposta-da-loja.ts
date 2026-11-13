/**
 * Tamanho máximo da resposta da loja a uma pergunta de produto e a uma
 * avaliação. A resposta vira texto PÚBLICO na vitrine, então não pode ser sem
 * teto; a pergunta da cliente já para em 500 e a resposta ganha mais folga
 * (explica, dá medidas, prazos). A tela limita o campo e o hook recusa antes de
 * chamar o servidor — colar um texto enorme pode driblar o `maxLength` do HTML.
 */
export const TETO_DA_RESPOSTA_DA_LOJA = 2000;

/** Aviso curto, no mesmo tom dos outros campos com teto da casa. */
export const avisoDoTetoDaRespostaDaLoja = `Máximo de ${TETO_DA_RESPOSTA_DA_LOJA} caracteres`;
