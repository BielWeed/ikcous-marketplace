const FORMATADOR_DATA_DA_LOJA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function lerPartesDaDataLocal(data: Date) {
  const partes = FORMATADOR_DATA_DA_LOJA.formatToParts(data);
  return (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
}

export function dataLocal(valor: string): string {
  const data = new Date(valor);
  // Data ilegível não derruba a planilha inteira: a coluna sai vazia.
  if (Number.isNaN(data.getTime())) return "";
  const parte = lerPartesDaDataLocal(data);
  return `${parte("day")}/${parte("month")}/${parte("year")} ${parte("hour")}:${parte("minute")}`;
}

export function carimboLocalParaNomeDeArquivo(data: Date): string {
  const parte = lerPartesDaDataLocal(data);
  return `${parte("year")}-${parte("month")}-${parte("day")}-${parte("hour")}-${parte("minute")}`;
}
