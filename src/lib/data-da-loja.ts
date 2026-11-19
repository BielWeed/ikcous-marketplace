// A data da compra que a cliente vê é a do calendário da LOJA, não a do fuso do
// aparelho: uma compra de 12/11 às 22h30 de Brasília é 01h30 UTC de 13/11, e
// quem abre o app em UTC lia o dia seguinte. As opções do formato passam
// intactas (sem opções, o mesmo "dd/mm/aaaa" de `toLocaleDateString("pt-BR")`).
export const FUSO_DA_LOJA = "America/Sao_Paulo";

export function dataNoFusoDaLoja(
  quando: Date,
  opcoes?: Intl.DateTimeFormatOptions,
): string {
  return quando.toLocaleDateString("pt-BR", {
    ...opcoes,
    timeZone: FUSO_DA_LOJA,
  });
}

/** Exibe um instante no fuso da loja, sem inventar data quando a entrada é inválida. */
export function formatarDataHoraBrasilia(
  iso: string | null | undefined,
  formato: "completo" | "curto" = "completo",
): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";

  const dia = { day: "2-digit", month: "2-digit" } as const;
  const hora = { hour: "2-digit", minute: "2-digit" } as const;
  if (formato === "curto") {
    return `${dataNoFusoDaLoja(data, dia)} às ${data.toLocaleTimeString(
      "pt-BR",
      {
        ...hora,
        timeZone: FUSO_DA_LOJA,
      },
    )}`;
  }
  return data.toLocaleString("pt-BR", {
    ...dia,
    ...hora,
    year: "numeric",
    timeZone: FUSO_DA_LOJA,
  });
}
