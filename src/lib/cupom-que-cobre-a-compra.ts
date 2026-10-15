// CUPOM QUE COBRE A COMPRA INTEIRA (decisão do dono, 14/10/2026): com o
// total em R$ 0,00 a cliente não paga pelo app (o app não cobra pedido sem
// valor) nem fecha envio por transportadora (que exige pagamento antecipado);
// só fecha pagando na retirada ou na entrega. O formulário do cupom AVISA a
// lojista — nunca proíbe o cupom.
import type { Coupon } from "@/types";

/**
 * Um desconto fixo nesse valor ou acima costuma cobrir um pedido pequeno
 * inteiro. Palpite de produto, não regra do servidor: o aviso não bloqueia
 * nada, então errar para mais só mostra uma linha a mais.
 */
export const VALOR_FIXO_QUE_PODE_COBRIR_UM_PEDIDO = 100;

/**
 * O cupom pode zerar uma compra?
 *  - porcentagem: só 100% zera (95% ainda deixa 5% do produto);
 *  - valor fixo: quando já cobre o MÍNIMO de compra que o próprio cupom
 *    exige (comprando o mínimo, a conta zera), ou quando é um valor alto.
 */
export function cupomPodeCobrirACompraInteira(
  cupom: Pick<Partial<Coupon>, "type" | "value" | "minPurchase">,
): boolean {
  const valor = Number(cupom.value ?? 0);
  if (!(valor > 0)) return false;
  if (cupom.type === "percentage") return valor >= 100;
  const minimo = Number(cupom.minPurchase ?? 0);
  if (minimo > 0 && valor >= minimo) return true;
  return valor >= VALOR_FIXO_QUE_PODE_COBRIR_UM_PEDIDO;
}

export const AVISO_CUPOM_PODE_COBRIR_A_COMPRA =
  "Se o cupom cobrir a compra e o frete for grátis, a cliente fecha pagando na retirada ou na entrega; pelo app ou por transportadora, não fecha.";

export const AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP =
  "Atenção: sua loja só recebe pagamento pelo app. Se este cupom cobrir a compra inteira e o frete for grátis, a cliente não consegue fechar o pedido — o app não cobra R$ 0,00 e não há pagamento na retirada ou na entrega ligado. Ligue uma forma em Ajustes > Pagamentos, ou use um desconto menor.";
