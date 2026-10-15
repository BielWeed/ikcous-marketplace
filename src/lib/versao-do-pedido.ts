import type { Order } from "@/types";

/**
 * Igualdade por CONTEÚDO de dois valores vindos do mapeador de pedidos
 * (objetos simples, listas, texto, número, booleano, nulo). Existe porque
 * cada busca ao servidor devolve objetos NOVOS para o mesmo pedido, e trocar
 * a tela por um objeto idêntico só faria o React refazer o que já está certo.
 */
function mesmoConteudo(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const camposDeA = Object.entries(a);
  const camposDeB = new Map(Object.entries(b));
  if (camposDeA.length !== camposDeB.size) return false;
  return camposDeA.every(
    ([chave, valor]) =>
      camposDeB.has(chave) && mesmoConteudo(valor, camposDeB.get(chave)),
  );
}

/**
 * Decide qual versão do MESMO pedido a tela deve mostrar, entre a que está nela
 * e uma que acabou de chegar (da lista que o tempo real atualiza, ou de uma
 * busca ao servidor).
 *
 * Três regras, na ordem:
 *  1. Versão MAIS VELHA (`updatedAt` estritamente menor) nunca ganha — o eco
 *     atrasado do tempo real e a resposta de busca que nasceu antes do
 *     pagamento não desfazem o que a tela já sabe. Data ausente ou ilegível não
 *     é "velha": nesse caso decide o conteúdo.
 *  2. Mesmo conteúdo: fica a que já está na tela (mesma referência, nenhum
 *     render à toa, nada pisca).
 *  3. Conteúdo diferente e não mais velha: ganha a nova. `updatedAt` IGUAL com
 *     conteúdo diferente também ganha — o cancelamento otimista da lista e a
 *     reversão dele mudam o status sem mexer em `updatedAt`.
 *
 * Pedidos de ids diferentes não se comparam: a que chegou é a do pedido novo.
 */
export function escolherVersaoDoPedido(atual: Order, chegou: Order): Order {
  if (atual.id !== chegou.id) return chegou;
  if (atual === chegou) return atual;
  const tAtual = Date.parse(atual.updatedAt);
  const tChegou = Date.parse(chegou.updatedAt);
  if (Number.isFinite(tAtual) && Number.isFinite(tChegou) && tChegou < tAtual) {
    return atual;
  }
  return mesmoConteudo(atual, chegou) ? atual : chegou;
}
