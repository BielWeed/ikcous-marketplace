/**
 * A ESPERA ENTRE O TOQUE E O CARRINHO (14/10/2026).
 *
 * A recusa "Os valores do pedido mudaram. Atualize o carrinho..." oferece um
 * botão que leva ao carrinho. Antes, nada relia o catálogo no caminho: a
 * cliente chegava com os MESMOS preços e levava a mesma recusa de novo. Quem
 * relê é o `CartContext` (`renovarCarrinhoPeloCatalogo`); esta função só
 * decide COMO esperar por ele.
 *
 * A regra que manda aqui: a releitura melhora o carrinho, mas NUNCA pode
 * prender a cliente. Então a espera tem teto, e leitura que falha (ou nem
 * existe) libera na hora. A releitura que estourou o teto não é cancelada —
 * ela segue em segundo plano e corrige o carrinho quando a rede responder.
 */

/** Quanto a cliente espera, no máximo, antes de ser levada ao carrinho. */
export const TETO_DA_RELEITURA_DO_CARRINHO_MS = 3000;

/** Como a espera terminou: leu / passou do teto / a leitura falhou. */
export type DesfechoDaReleitura = "relido" | "estourou" | "falhou";

/**
 * Executa `reler` e devolve quando ela termina OU quando o teto estoura, o que
 * vier primeiro. Nunca rejeita: o chamador sempre pode seguir para a próxima
 * tela.
 */
export async function relerOCarrinhoComTeto(
  reler: () => Promise<unknown>,
  tetoMs: number = TETO_DA_RELEITURA_DO_CARRINHO_MS,
): Promise<DesfechoDaReleitura> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<DesfechoDaReleitura>((resolve) => {
    relogio = setTimeout(() => resolve("estourou"), tetoMs);
  });

  const leitura = (async (): Promise<DesfechoDaReleitura> => {
    try {
      await reler();
      return "relido";
    } catch (erro) {
      // Chamar uma ação que não existe também cai aqui: seguir sem reler é
      // sempre melhor que travar.
      console.error("[Checkout] Releitura do carrinho falhou:", erro);
      return "falhou";
    }
  })();

  try {
    return await Promise.race([leitura, estouro]);
  } finally {
    clearTimeout(relogio);
  }
}
