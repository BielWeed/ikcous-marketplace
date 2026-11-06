import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * "há 3 minutos" para pergunta, avaliação e dúvida. Com o relógio do celular
 * atrasado a data do servidor fica no FUTURO e o date-fns diria "em 3 minutos":
 * a data nunca passa de agora ("há menos de um minuto"). Ilegível ou ausente
 * vira texto vazio (o date-fns lança erro e derrubaria a tela).
 */
export function tempoRelativo(data: string | Date | null | undefined): string {
  if (!data) return "";
  const quando = new Date(data).getTime();
  if (Number.isNaN(quando)) return "";
  return formatDistanceToNow(new Date(Math.min(quando, Date.now())), {
    addSuffix: true,
    locale: ptBR,
  });
}

const MS_MINUTO = 60_000;
const MS_HORA = 60 * MS_MINUTO;
const MS_DIA = 24 * MS_HORA;

/**
 * Distância curta para o painel de banners ("em 5h 30m", "há 2 dias"). Só vira
 * dias a partir de 48 h: com 47 h a frase "em 1 dia" prometia metade do
 * tempo que falta. Abaixo de 1 minuto: "em instantes" / "há instantes".
 */
export function distanciaCurta(data: string | Date | null | undefined): string {
  if (!data) return "";
  const alvo = new Date(data);
  if (Number.isNaN(alvo.getTime())) return "";
  const diferenca = alvo.getTime() - Date.now();
  const absoluto = Math.abs(diferenca);
  const futuro = diferenca > 0;

  const minutos = Math.floor(absoluto / MS_MINUTO);
  const horas = Math.floor(absoluto / MS_HORA);
  const dias = Math.floor(absoluto / MS_DIA);

  if (minutos === 0) return futuro ? "em instantes" : "há instantes";
  const prefixo = futuro ? "em" : "há";
  if (dias >= 2) return `${prefixo} ${dias} dias`;
  if (horas > 0) return `${prefixo} ${horas}h ${minutos % 60}m`;
  return `${prefixo} ${minutos}m`;
}
