/** Uma fila incompleta nunca ganha uma barra cheia por arredondamento. */
export function taxaDeResposta(respondidas: number, total: number) {
  if (total <= 0) return { text: "—", width: 0 };
  const percentual = Math.round((respondidas / total) * 100);
  if (respondidas < total && percentual === 100) {
    return { text: "Quase 100%", width: 99 };
  }
  return { text: `${percentual}%`, width: percentual };
}
