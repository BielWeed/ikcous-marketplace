// BANDEIRA DO ENVIO EM CURSO — liga a tela de finalizar (CheckoutView) ao
// roteador (App.handleNavigate) sem um conhecer o outro.
//
// POR QUE EXISTE (caça 8, 03/11/2026): com o pedido a caminho (até 30 s em rede
// lenta), tocar numa aba da barra de baixo desmontava a tela; a resposta de
// sucesso chegava com a tela já morta (`montadoRef = false`) e era descartada
// SEM esvaziar o carrinho nem esquecer a chave do pedido. O cupom de uso único
// que o 1º pedido gastou mudava a compra, a impressão digital girava e nascia
// OUTRO pedido, sem desconto. O Voltar já era retido durante o envio (caça 7);
// a barra de baixo e o cabeçalho passam por `handleNavigate`, que não sabia do
// envio. Este módulo é o que ele consulta.
//
// A bandeira é do módulo (uma por aba/JS): só existe um checkout montado por
// vez, e o dono dela (a tela) a solta no desmonte. O teto de 30 s do envio
// (`aguardarComPrazo`) garante que ela não fica ligada para sempre.

/** Aviso único: o Voltar do checkout e o roteador dizem a MESMA frase. */
export const AVISO_ENVIO_DO_CHECKOUT_EM_CURSO =
  "Aguarde, estamos enviando seu pedido.";

let envioEmCurso = false;

export function marcarEnvioDoCheckout(emCurso: boolean): void {
  envioEmCurso = emCurso;
}

export function haEnvioDoCheckoutEmCurso(): boolean {
  return envioEmCurso;
}
