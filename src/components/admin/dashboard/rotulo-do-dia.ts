/** Rótulo de calendário sem conversão de fuso horário. */
export function rotuloDoDia(date: string, mostrarAno: boolean): string {
  const partes = date.split("-");
  if (partes.length < 3) return date;
  const diaEMes = `${partes[2]}/${partes[1]}`;
  return mostrarAno ? `${diaEMes}/${partes[0].slice(-2)}` : diaEMes;
}

export function serieCobreMaisDeUmAno(
  dias: readonly { date: string }[],
): boolean {
  return dias.some((dia) => dia.date.slice(0, 4) !== dias[0].date.slice(0, 4));
}
