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

  const timeZone = "America/Sao_Paulo";
  const hora = data.toLocaleTimeString("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const diaEmBrasilia = (d: Date) =>
    d.toLocaleDateString("sv-SE", { timeZone });
  const diaDoPedido = diaEmBrasilia(data);
  const hoje = diaEmBrasilia(agora);
  if (diaDoPedido === hoje) return `hoje ${hora}`;

  // Mesmo calendário do filtro de pedidos: Brasil sem horário de verão desde 2019.
  const ontem = diaEmBrasilia(new Date(agora.getTime() - 86_400_000));
  if (diaDoPedido === ontem) return `ontem ${hora}`;

  const dia = data.toLocaleDateString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });
  if (diaDoPedido.slice(0, 4) === hoje.slice(0, 4)) return dia;
  return `${dia}/${diaDoPedido.slice(2, 4)}`;
}
