import { useEffect, useState } from "react";

/**
 * Quanto a folha de baixo demora para sair (`duration-300` do Sheet) mais uma
 * folga: a limpeza só pode vir depois da animação, nunca no meio dela.
 */
export const DURACAO_DA_SAIDA_DA_FOLHA_MS = 320;

/**
 * Folha montada por condição (`{aberta && <Folha/>}`) some SECA ao fechar: a
 * tela-mãe a desmonta antes de a animação de saída rodar. Este gancho segura a
 * ÚLTIMA `chave` por `ms` depois que ela vira `null`/`undefined`, para a folha
 * continuar montada com `open={aberta}` e o Radix animar a saída; passado o
 * prazo, `chave` volta a `null` e a folha desmonta (zerando o que guardava).
 *
 * A `chave` é um TEXTO (o id da vitrine aberta; `"aberta"` para folha sem
 * dado) e não o objeto: quem chama costuma recalcular o objeto a cada render, e
 * guardar objeto assim faria laço de render. Quem precisa do dado o resolve
 * pela chave retida (ex.: `secoes.find(s => s.id === chave)`), já atualizado.
 *
 *  - `aberta`: o estado REAL (use-o em `open` e em qualquer lógica de "aberta").
 *  - `chave`: a atual, ou a última durante a saída; `null` depois.
 *  - `abertura`: conta quantas vezes a folha ABRIU (ou trocou de chave). Use-o
 *    como `key` da folha: reabrir durante a saída da anterior (que ainda está
 *    montada) tem de nascer de novo, com o estado vazio, e não herdar o que a
 *    anterior guardava.
 */
export function useConteudoAteASaida(
  chaveAtual: string | null | undefined,
  ms: number = DURACAO_DA_SAIDA_DA_FOLHA_MS,
): {
  readonly aberta: boolean;
  readonly chave: string | null;
  readonly abertura: number;
} {
  const chave = chaveAtual ?? null;
  const aberta = chave !== null;
  // Estado derivado no render (o padrão da documentação do React para "guardar
  // o que veio de renders anteriores"): só texto e número, comparados por
  // valor, então não há laço.
  const [guardado, setGuardado] = useState({
    chave,
    aberta,
    abertura: aberta ? 1 : 0,
  });
  const abriuOuTrocou =
    aberta && (!guardado.aberta || chave !== guardado.chave);
  if (aberta !== guardado.aberta || abriuOuTrocou) {
    setGuardado({
      chave: chave ?? guardado.chave,
      aberta,
      abertura: guardado.abertura + (abriuOuTrocou ? 1 : 0),
    });
  }

  const [expirou, setExpirou] = useState(false);
  useEffect(() => {
    if (aberta) {
      setExpirou(false);
      return;
    }
    const prazo = window.setTimeout(() => setExpirou(true), ms);
    return () => window.clearTimeout(prazo);
  }, [aberta, ms]);

  return {
    aberta,
    chave: chave ?? (expirou ? null : guardado.chave),
    abertura: guardado.abertura,
  };
}
