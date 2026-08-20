/**
 * O que a tela de Push (AdminPushView) AFIRMA sobre quem vai receber uma
 * notificação.
 *
 * POR QUE ISTO ERA UM DEFEITO
 *   Auditoria de 20/08/2026, achados 6, 7 e 12. Dos quatro botões de
 *   público, só o segmento SELECIONADO era medido pela RPC
 *   `get_segmented_push_targets`. Os outros três eram fabricados dentro do
 *   componente: `Math.ceil(subCount * 0.3)`, `Math.floor(subCount * 0.25)` e
 *   `Math.floor(subCount * 0.45)`. Com 8 aparelhos no banco, a tela mostrava
 *   3, 2 e 3 — o real era 2, 0 e 0. Dois segmentos vazios anunciados como se
 *   tivessem gente.
 *
 *   O mesmo padrão aparecia no cartão "Clientes Prontos para Receber":
 *   `iOS: {subCount * 0.4}` e `Android: {subCount * 0.6}`, sem nenhuma
 *   coluna de plataforma existir em `push_subscriptions`. Não há o que
 *   medir — a correção tira os dois selos, não inventa substituto.
 *
 *   E os textos de alcance chamavam de "clientes" o que é contagem de
 *   INSCRIÇÕES de aparelho/navegador — visitante sem conta conta igual a
 *   cliente cadastrado, e um cliente com dois aparelhos conta como dois.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ
 *   Não decide QUANDO buscar a medição — isso é responsabilidade do
 *   componente, que chama a RPC e guarda o resultado. Esta função só decide
 *   o que MOSTRAR a partir do que já foi medido (ou não).
 */

/**
 * Uma contagem de aparelhos já medida, ou `null` quando a medição ainda não
 * chegou ou falhou. Nunca um percentual do total.
 */
export type ContagemMedida = number | null;

/**
 * Formata uma contagem para o rótulo do botão de segmento. `null` vira um
 * traço — nunca zero, porque zero é a afirmação de que o segmento está
 * vazio, e isso só pode ser dito depois de medir de verdade.
 */
export function rotuloDaContagem(contagem: ContagemMedida): string {
  return contagem === null ? "—" : String(contagem);
}

/**
 * "N aparelho(s)" — a palavra que substitui "clientes" nos textos de
 * alcance ("Receberão: N aparelhos", "Enviar Notificação Agora (N
 * aparelhos)"). `push_subscriptions` é inscrição de aparelho/navegador, não
 * cliente: visitante sem conta entra na contagem, e um cliente com dois
 * aparelhos conta duas vezes.
 *
 * `null` vira "— aparelhos" pelo mesmo motivo de `rotuloDaContagem`: o total
 * ainda não foi medido, ou a medição falhou, e zero é uma afirmação forte
 * demais para chutar (achado do revisor sobre o commit 6e406b4, 20/08/2026).
 */
export function textoDeAlcanceEmAparelhos(
  contagemDeAparelhos: ContagemMedida,
): string {
  if (contagemDeAparelhos === null) return "— aparelhos";
  return contagemDeAparelhos === 1
    ? "1 aparelho"
    : `${contagemDeAparelhos} aparelhos`;
}
