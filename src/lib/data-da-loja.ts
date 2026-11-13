// A data da compra que a cliente vê é a do calendário da LOJA, não a do fuso do
// aparelho: uma compra de 12/11 às 22h30 de Brasília é 01h30 UTC de 13/11, e
// quem abre o app em UTC lia o dia seguinte. As opções do formato passam
// intactas (sem opções, o mesmo "dd/mm/aaaa" de `toLocaleDateString("pt-BR")`).
export function dataNoFusoDaLoja(
  quando: Date,
  opcoes?: Intl.DateTimeFormatOptions,
): string {
  return quando.toLocaleDateString("pt-BR", {
    ...opcoes,
    timeZone: "America/Sao_Paulo",
  });
}
