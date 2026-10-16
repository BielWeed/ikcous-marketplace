/**
 * O VETO DE RECARGA — "é seguro recarregar AGORA?", perguntado NO INSTANTE de
 * recarregar (atualização única e obrigatória, 16/10/2026).
 *
 * Por que existe: o instalador decide COMEÇAR a atualização num ponto de
 * parada seguro, mas entre o começo e a recarga de verdade passa tempo — o
 * service worker assumindo (até ~1,2 s no apply normal), a purga apagando
 * caches (segundos) — e a pessoa pode entrar no checkout nesse intervalo. Os
 * caminhos que recarregam por conta própria (o apply do service worker, a purga
 * obrigatória) consultam este veto imediatamente antes do `reload` e, se
 * vetado, NÃO recarregam: a recarga fica pendente e o gate a faz no próximo
 * ponto de parada seguro (modo "so-recarregar"). Sem laço: vetou, a conta é do
 * gate, não de quem vetou.
 *
 * Quem responde é o instalador montado (ele conhece a tela, o trabalho sujo e
 * o resto): registra o avaliador dele aqui. Sem instalador, vale o que este
 * módulo sabe sozinho — operação sensível e pedido pendente do checkout —, que
 * é mais conservador que nada.
 */
import { existeAlgumPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";

import { decidirMomentoSeguro } from "./momento-seguro";
import { marcarRecargaPendente } from "./recarga-pendente";

let avaliador: (() => boolean) | null = null;

/** Registra (ou, com `null`, remove) quem responde ao vivo se o momento é
 * seguro. Um por vez: o instalador montado. Devolve a função que desfaz SÓ o
 * que este registro fez (se outro avaliador entrou depois, ela não o remove). */
export function definirAvaliadorDeMomentoSeguro(
  novo: (() => boolean) | null,
): () => void {
  avaliador = novo;
  return () => {
    if (avaliador === novo) avaliador = null;
  };
}

/** O que dá para saber sem a tela: operação sensível e pedido pendente. */
function momentoSeguroSemTela(): boolean {
  return decidirMomentoSeguro({
    view: "",
    adminDirty: false,
    pedidoPendenteDoCheckout: existeAlgumPedidoPendenteDoCheckout(),
    documentoOculto: false,
    trocouDeTela: false,
  }).livre;
}

/** `true` = nada sensível em andamento neste instante. Avaliador com defeito
 * vale como NÃO seguro: na dúvida, não se recarrega. */
export function momentoSeguroAgora(): boolean {
  if (avaliador === null) return momentoSeguroSemTela();
  try {
    return avaliador();
  } catch {
    return false;
  }
}

/** Recarrega agora se for seguro (devolve `true`). Vetado: não recarrega, deixa
 * a recarga PENDENTE para o próximo ponto de parada seguro do gate e devolve
 * `false`. */
export function recarregarSeSeguro(recarregar: () => void): boolean {
  if (momentoSeguroAgora()) {
    recarregar();
    return true;
  }
  marcarRecargaPendente();
  return false;
}
