/**
 * Idade de um pedido pendente (laudo varredura profunda #2, achado L-8).
 *
 * O problema: pedido "na entrega" nasce sem prazo nenhum (nunca expira, por
 * decisão deliberada — a varredura de expiração não o toca), debita estoque e
 * afunda na lista ordenada por data. O custo da decisão recaía sobre a
 * memória do lojista: nada mostrava HÁ QUANTO TEMPO o pedido esperava.
 *
 * A função devolve a idade em DIAS CHEIOS de um pedido que ainda está no
 * primeiro estado (aguardando o lojista agir) — `null` para qualquer outro
 * caso (status avançado, sem data de criação). O texto da ficha é quem decide
 * quando o aviso aparece.
 */
// Status reais que esperam o lojista: "pending" (o comum) e "new" (o CHECK
// do banco permite; zero vivos hoje — anotação da revisão do #397).
const ESTADOS_QUE_ESPERAM_O_LOJISTA = new Set(["pending", "new"]);

export function idadeDoPedidoPendente(
  created_at: string | null | undefined,
  status: string | null | undefined,
  agora: number = Date.now(),
): number | null {
  if (!created_at || !status || !ESTADOS_QUE_ESPERAM_O_LOJISTA.has(status)) {
    return null;
  }
  const criadoEm = Date.parse(created_at);
  if (Number.isNaN(criadoEm)) return null;

  const dias = Math.floor((agora - criadoEm) / 86_400_000);
  return Math.max(0, dias);
}

/** Frase da ficha — só existe quando vale mostrar (≥ 3 dias de espera). */
export function fraseDeEsperaDoPedido(dias: number | null): string | null {
  if (dias == null || dias < 3) return null;
  if (dias === 3) return "Este pedido espera você há 3 dias.";
  return `Este pedido espera você há ${dias} dias.`;
}
