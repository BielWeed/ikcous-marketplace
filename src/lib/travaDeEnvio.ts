/**
 * Trava síncrona de envio — CHECKOUT-030 (#27).
 *
 * O PROBLEMA QUE ELA RESOLVE
 *
 * `handleSubmitEvent` do checkout abre com `await form.trigger()` e só marca
 * `isSubmitting` depois. Entre o toque e o botão ficar desabilitado existe uma
 * janela de pelo menos um `await` mais um render — e `disabled={isSubmitting}`
 * não fecha essa janela, porque estado do React só chega na tela no render
 * seguinte.
 *
 * Dois toques rápidos entram os dois nessa janela e criam DOIS pedidos: estoque
 * debitado duas vezes e cupom de uso único consumido duas vezes. Não é caso
 * exótico — celular com tela travada emite o toque repetido sozinho, e é
 * justamente quando o aparelho está lento que a janela fica maior.
 *
 * POR QUE `ref` E NÃO ESTADO
 *
 * `ref.current` muda no mesmo instante da atribuição, dentro do mesmo tique do
 * JavaScript. É a única coisa que o segundo clique consegue enxergar antes de
 * qualquer `await`. Esta função devolve a trava sem depender do React para que
 * ela possa ser provada sem montar a tela inteira do checkout — o componente só
 * guarda o objeto num `useRef`.
 *
 * O QUE ELA NÃO RESOLVE
 *
 * Se a RPC gravar o pedido e a resposta estourar por tempo, o `catch` do
 * checkout libera a trava e o cliente toca de novo — criando um segundo pedido
 * que, do ponto de vista do navegador, é legítimo. Isso só se resolve no banco,
 * com chave de idempotência, que é a outra metade da #27.
 */
export interface TravaDeEnvio {
  /**
   * Fecha a trava e diz se QUEM CHAMOU pode seguir.
   *
   * @returns `true` para o primeiro chamador, `false` para todos os seguintes
   * até que `liberar()` seja chamado.
   */
  tentarEntrar: () => boolean;
  /** Reabre a trava. Vai no `finally` de quem entrou, nunca antes. */
  liberar: () => void;
}

export function criarTravaDeEnvio(): TravaDeEnvio {
  let fechada = false;

  return {
    tentarEntrar: () => {
      if (fechada) return false;
      fechada = true;
      return true;
    },
    liberar: () => {
      fechada = false;
    },
  };
}
