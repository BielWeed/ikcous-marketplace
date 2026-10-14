// COMPRA QUE FECHA EM R$ 0,00 (decisão do dono, 14/10/2026): cupom que zera o
// produto + frete grátis (ou retirada na loja) deixa o total em zero. Pagar
// pelo app NÃO existe nesse caso — `criar-pagamento` recusa pedido zerado, e a
// cobrança do Mercado Pago não nasce sem valor. A compra fecha pelo caminho
// "pagar na retirada/entrega", que já funciona hoje com total zero.
//
// Esta função é a DECISÃO da tela (pura, testada em tabela): com o total
// final em zero ela diz se o grupo "No app" some, qual forma "na
// entrega/retirada" marcar e quando o Finalizar tem de travar (com a
// explicação certa). Com total acima de zero devolve o "nada muda" — a tela
// fica byte a byte a de antes.
//
// NÃO duplica regra: as formas aceitas pela loja chegam prontas
// (`formasPagamentoNaEntregaValidas`), a modalidade chega classificada
// (`ehModalidadeDaLoja`) e "frete fechado" é o MESMO `!semFreteSelecionado` do
// botão — total que a tela mostra como "a calcular" nunca vira "sem valor a
// pagar".
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";

export type MeioDePagamentoDoCheckout = FormaDePagamentoNaEntrega | "online";

/**
 * Por que o Finalizar trava com total zero:
 *  - `transportadora`: envio por transportadora exige pagamento antecipado, e
 *    pagamento antecipado não existe sem valor;
 *  - `loja-so-no-app`: a loja só recebe pelo app (nenhuma forma na
 *    retirada/entrega ligada), e o app não cobra R$ 0,00.
 */
export type TravaDoTotalZero = "transportadora" | "loja-so-no-app";

export interface DecisaoDoTotalZero {
  /** Total fechado e igual (ou abaixo) de zero. */
  zerado: boolean;
  /** O grupo "No app" some da lista de meios de pagamento. */
  escondeApp: boolean;
  /** Motivo de travar o Finalizar; `null` quando o pedido pode fechar. */
  travaPor: TravaDoTotalZero | null;
  /**
   * A forma "na retirada/entrega" a marcar sozinha — a PRIMEIRA que a loja
   * aceita (ordem da loja) — quando a atual não serve (era "online" ou uma
   * forma que a loja não oferece). `null` quando não há nada a trocar.
   */
  meioParaMarcar: FormaDePagamentoNaEntrega | null;
  /** O Finalizar tem de ficar travado: trava de verdade ou "online" marcado. */
  bloqueiaFinalizar: boolean;
}

const SEM_MUDANCA: DecisaoDoTotalZero = {
  zerado: false,
  escondeApp: false,
  travaPor: null,
  meioParaMarcar: null,
  bloqueiaFinalizar: false,
};

export function formasDePagamentoParaTotalZero(args: {
  /** Total que a tela cobraria (produtos − cupom + frete). */
  totalFinal: number;
  /**
   * Total FECHADO: há itens e o frete está escolhido e cotado
   * (`cart.length > 0 && !semFreteSelecionado`). Fora disso o total é "a
   * calcular" e a decisão não fala.
   */
  freteFechado: boolean;
  /** Entrega local OU retirada na loja (`ehModalidadeDaLoja`). */
  modalidadeDaLoja: boolean;
  /** As formas que a loja aceita na retirada/entrega, na ordem dela. */
  formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  paymentMethod: MeioDePagamentoDoCheckout;
}): DecisaoDoTotalZero {
  // Em centavos: 0,004 de ponto flutuante não é "tem valor a pagar".
  const zerado = args.freteFechado && Math.round(args.totalFinal * 100) <= 0;
  if (!zerado) return SEM_MUDANCA;

  if (!args.modalidadeDaLoja) {
    return {
      zerado: true,
      escondeApp: true,
      travaPor: "transportadora",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    };
  }

  if (args.formasNaEntrega.length === 0) {
    return {
      zerado: true,
      escondeApp: true,
      travaPor: "loja-so-no-app",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    };
  }

  const atualServe =
    args.paymentMethod !== "online" &&
    args.formasNaEntrega.includes(args.paymentMethod);

  return {
    zerado: true,
    escondeApp: true,
    travaPor: null,
    meioParaMarcar: atualServe ? null : args.formasNaEntrega[0],
    // "online" marcado com total zero: um pedido que o servidor recusaria. O
    // efeito troca a forma no mesmo ciclo; o botão fica travado até lá.
    bloqueiaFinalizar: args.paymentMethod === "online",
  };
}

/** Frase do grupo de pagamento quando a compra não tem valor a pagar. */
export function textoDoPedidoSemValor(args: {
  decisao: DecisaoDoTotalZero;
  ehRetirada: boolean;
}): string {
  if (args.decisao.travaPor === "transportadora") {
    return "Este pedido não tem valor a pagar, mas o envio por transportadora só fecha com pagamento antecipado pelo app — e o app não cobra pedido sem valor.";
  }
  if (args.decisao.travaPor === "loja-so-no-app") {
    return "Este pedido não tem valor a pagar, mas esta loja só recebe pelo app — e o app não cobra pedido sem valor.";
  }
  return args.ehRetirada
    ? "Este pedido não tem valor a pagar. Você fecha o pedido sem cobrança pelo app e combina o acerto na retirada."
    : "Este pedido não tem valor a pagar. Você fecha o pedido sem cobrança pelo app e combina o acerto na entrega.";
}

/** Saída que a tela oferece quando o Finalizar trava com total zero. */
export function saidaDoTotalZero(args: {
  travaPor: TravaDoTotalZero;
  temCupom: boolean;
}): string {
  if (args.travaPor === "transportadora") {
    return args.temCupom
      ? "Escolha retirada na loja ou entrega local (se a loja oferecer), tire o cupom, ou fale com a loja."
      : "Escolha retirada na loja ou entrega local (se a loja oferecer), ou fale com a loja.";
  }
  return args.temCupom
    ? "Tire o cupom para pagar pelo app, ou fale com a loja para combinar."
    : "Fale com a loja para combinar.";
}
