/**
 * Tipo da mensagem que o Service Worker manda às abas quando o porteiro diz
 * que a loja está FORA DO AR (`adormecida`, 503, ou `encerrada`, 410): o SW já
 * apagou as páginas guardadas e a aba recarrega para mostrar a página da loja
 * fechada (`receptor-da-loja-fechada.ts`). Mora sozinho, sem nenhuma
 * dependência, porque o SW importa este arquivo e não pode carregar código do
 * app. Mensagem desconhecida é ignorada por quem não a entende: SW novo + app
 * velho (e o inverso) não quebram.
 */
export const TIPO_LOJA_FECHADA = "ikcous:loja-fechada";
