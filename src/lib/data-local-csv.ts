const FORMATADOR_DATA_DA_LOJA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function dataLocal(valor: string): string {
  const data = new Date(valor);
  // Data ilegível não derruba a planilha inteira: a coluna sai vazia.
  if (Number.isNaN(data.getTime())) return "";
  const partes = FORMATADOR_DATA_DA_LOJA.formatToParts(data);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")} ${parte("hour")}:${parte("minute")}`;
}
