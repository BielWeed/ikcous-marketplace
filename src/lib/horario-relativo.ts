/**
 * Horário relativo para o painel: o lojista pensa em "há 5 min", não em
 * "23/08" (Missão 06, direção A do card de pedido — aprovada pelo dono).
 * Regras: < 2 min = "agora mesmo"; < 60 min = "há N min"; hoje = "hoje HH:MM";
 * ontem = "ontem HH:MM"; mesmo ano = "DD/MM"; outro ano = "DD/MM/AA".
 * Data inválida devolve "" — o card simplesmente omite o metadado de tempo.
 */
export function horarioRelativo(iso: string, agora: Date = new Date()): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";

  const difMin = Math.floor((agora.getTime() - data.getTime()) / 60000);
  // Data no futuro (relógio do servidor/celular adiantado) também cai em
  // "agora mesmo" — de propósito: nunca mostrar "há -5 min".
  if (difMin < 2) return "agora mesmo";
  if (difMin < 60) return `há ${difMin} min`;

  const hora = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const mesmoDia = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (mesmoDia(data, agora)) return `hoje ${hora}`;

  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(data, ontem)) return `ontem ${hora}`;

  const dia = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  if (data.getFullYear() === agora.getFullYear()) return dia;
  return `${dia}/${String(data.getFullYear()).slice(-2)}`;
}
