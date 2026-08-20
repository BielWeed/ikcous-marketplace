/**
 * O que a tela de Cupons (AdminCouponsView) AFIRMA sobre um cupom vencido.
 *
 * POR QUE ISTO ERA UM DEFEITO
 *   Auditoria do painel do lojista, lote 1 ("as duas promessas falsas"). A
 *   tela promete, por escrito, que "após esse prazo, o cupom é desativado
 *   automaticamente pelo sistema". Um cupom com `valid_until` no passado
 *   continuava com o selo verde "Ativo" e continuava contado no indicador
 *   "Cupons Ativos" — mesmo o servidor já recusando esse cupom, tanto na
 *   validação (`validate_coupon_secure_v2`) quanto no fechamento do pedido.
 *   O defeito era só o rótulo e a contagem, nunca o comportamento.
 *
 * A REGRA
 *   `active` é a chavinha — o desligamento MANUAL, decidido por quem opera a
 *   loja. Vencimento é derivado da data, nunca gravado como um terceiro
 *   estado no banco. As duas coisas podem discordar (cupom desligado na
 *   chavinha E vencido), e quando isso acontece a intenção declarada da
 *   chavinha ganha: o rótulo é "Inativo", não "Expirado".
 *
 *   O corte de vencimento espelha o que os RPCs de checkout já aplicam
 *   (`supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql`,
 *   `... AND (valid_until IS NULL OR valid_until > now())`): um cupom deixa
 *   de valer no instante exato de `valid_until`, não um segundo depois.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ
 *   Não decide o texto do selo sozinha nem estiliza nada — só classifica.
 *   O componente é quem liga o rótulo à cor e ao ícone.
 */

/** O que já chegou do banco sobre um cupom — só os dois campos que decidem
 * o rótulo importam aqui. */
export interface CupomParaStatus {
  active: boolean;
  validUntil?: string | null;
}

export type RotuloDeCupom = "Ativo" | "Inativo" | "Expirado";

/**
 * Um cupom sem `validUntil` nunca expira. Com `validUntil`, expira no
 * instante em que essa data chega — `<=`, não `<`, para casar com o
 * `> now()` que os RPCs de checkout exigem para aceitar o cupom.
 */
export function cupomEstaExpirado(
  validUntil: string | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!validUntil) return false;
  const prazo = new Date(validUntil).getTime();
  if (Number.isNaN(prazo)) return false;
  return prazo <= agora.getTime();
}

/**
 * O rótulo que a tela mostra. A chavinha manual (`active`) vence qualquer
 * outra leitura: um cupom desligado é "Inativo" mesmo se também estiver
 * vencido. Só um cupom LIGADO e vencido vira "Expirado".
 */
export function rotuloDoCupom(
  cupom: CupomParaStatus,
  agora: Date = new Date(),
): RotuloDeCupom {
  if (!cupom.active) return "Inativo";
  if (cupomEstaExpirado(cupom.validUntil, agora)) return "Expirado";
  return "Ativo";
}
