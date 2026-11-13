// Ordem dos avisos de status do mesmo pedido.
//
// O painel dispara "Saiu para entrega" e "Entregue" sem esperar um pelo outro; se
// o primeiro atrasa na rede e o segundo chega antes, o aparelho mostrava
// "Entregue" e DEPOIS "Saiu para entrega" (mesma `tag`): a cliente ficava com a
// informação errada. O painel carimba cada aviso com o instante em que o status
// foi gravado (`data.emitidoEm`, em milissegundos) e o service worker, antes de
// mostrar um aviso de pedido, olha o que o mesmo pedido já tem na bandeja: se o
// de lá é MAIS NOVO, ele é o que fica.
//
// Sem carimbo (painel ou app antigo, campanha, teste do aparelho), carimbo que
// não é número, ou empate: mostra, exatamente como antes. Nenhum aviso legítimo
// deixa de aparecer por causa desta regra.

/** Nome do campo do carimbo dentro de `data` do aviso. */
export const CAMPO_DO_CARIMBO_DO_AVISO = "emitidoEm";

type DataComCarimbo = { [K in typeof CAMPO_DO_CARIMBO_DO_AVISO]?: unknown };

/** O carimbo de `data`, ou `null` quando não há um número finito. */
export function carimboDoAviso(data: unknown): number | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const carimbo = (data as DataComCarimbo).emitidoEm;
  return typeof carimbo === "number" && Number.isFinite(carimbo)
    ? carimbo
    : null;
}

/** Dos avisos que o pedido já tem na bandeja, o de carimbo MAIOR que o que chegou
 *  (o mais novo deles), ou `null` quando nenhum é mais novo. */
export function avisoMaisNovoQue<T extends { data?: unknown }>(
  carimboDoQueChegou: number,
  naBandeja: ReadonlyArray<T>,
): T | null {
  let maisNovo: T | null = null;
  let maiorCarimbo = carimboDoQueChegou;
  for (const aviso of naBandeja) {
    const carimbo = carimboDoAviso(aviso.data);
    if (carimbo !== null && carimbo > maiorCarimbo) {
      maisNovo = aviso;
      maiorCarimbo = carimbo;
    }
  }
  return maisNovo;
}
