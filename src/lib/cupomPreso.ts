/**
 * "Cupom preso" (issues #210 e #116): o limite de usos de um cupom pode estar
 * ocupado por um pedido CANCELADO do próprio cliente, cuja vaga só volta
 * quando a varredura do banco roda. Sem isto o checkout dizia só "atingiu o
 * limite de uso" e o cliente — que não vê o pedido cancelado como dono da
 * vaga — achava que o cupom estava quebrado.
 *
 * Aqui mora só a decisão pura. Quem consulta o banco é o `validateCoupon`
 * (useCoupons.ts), pela RPC `vaga_do_cupom_presa`.
 */

/**
 * A frase que `validate_coupon_secure_v2` devolve na recusa por limite. Tem
 * âncora em tests/front/cupom-preso.test.ts: se uma migration futura
 * reescrever o texto, o teste fica vermelho em vez de a mensagem morrer calada.
 *
 * NÃO é a frase do último clique ("O cupom % já atingiu o limite de usos.",
 * de create_marketplace_order_v23/v24) — essa o classificador de
 * recusaDoPedido.ts já trata.
 */
export const FRASE_DE_LIMITE_DE_USO = "Cupom atingiu o limite de uso.";

export function ehRecusaPorLimiteDeUso(
  mensagem: string | null | undefined,
): boolean {
  return mensagem === FRASE_DE_LIMITE_DE_USO;
}

/**
 * Lê a resposta da RPC sem confiar no formato: só devolve os minutos quando
 * `presa` é exatamente `true` e `volta_em_minutos` é um número finito não
 * negativo. Qualquer outra coisa (não presa, sem prazo, formato novo) devolve
 * `null` — e `null` significa "mantém a frase de sempre", nunca uma promessa
 * sem número.
 */
export function minutosDaVagaPresa(resposta: unknown): number | null {
  if (typeof resposta !== "object" || resposta === null) return null;
  const { presa, volta_em_minutos: minutos } = resposta as {
    presa?: unknown;
    volta_em_minutos?: unknown;
  };
  if (presa !== true) return null;
  if (typeof minutos !== "number" || !Number.isFinite(minutos) || minutos < 0) {
    return null;
  }
  return minutos;
}

const MINUTOS_POR_HORA = 60;
/** A partir de duas horas o número em minutos vira ruído ("180 minutos"). */
const LIMITE_PARA_HORAS = 2 * MINUTOS_POR_HORA;

/**
 * A mensagem honesta. Arredonda sempre PARA CIMA — dizer "em até" e depois
 * voltar mais tarde seria a segunda promessa quebrada ao mesmo cliente — e
 * nunca diz "0 minutos".
 */
export function mensagemDeVagaPresa(codigo: string, minutos: number): string {
  const arredondado = Math.max(1, Math.ceil(minutos));
  const prazo =
    minutos >= LIMITE_PARA_HORAS
      ? `${Math.ceil(minutos / MINUTOS_POR_HORA)} horas`
      : `${arredondado} ${arredondado === 1 ? "minuto" : "minutos"}`;
  return `O cupom ${codigo} está no limite de usos agora. Uma vaga dele está presa num pedido seu que foi cancelado e volta sozinha em até ${prazo}.`;
}
