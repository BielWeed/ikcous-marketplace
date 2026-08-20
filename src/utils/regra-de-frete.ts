/**
 * O que a tela de Frete AFIRMA sobre a regra que a loja acabou de configurar.
 *
 * POR QUE ISTO É UMA FUNÇÃO, E NÃO TEXTO NO JSX
 *   Até 21/08/2026 as frases moravam em condicionais dentro do markup, uma por
 *   card, cada uma olhando só o próprio interruptor. Duas delas mentiam, e pelo
 *   mesmo motivo: descreviam o RESULTADO do pedido a partir de metade da regra.
 *
 *   - "Frete grátis desativado. Todos os pedidos terão cobrança de entrega."
 *     Falso quando a Taxa Padrão também está desligada: `shipping_fee = 0` é
 *     uma taxa VÁLIDA e usada de propósito (ver `flatFeeConfigurada` na edge
 *     function `calculate-shipping`, com teste próprio dizendo "zero
 *     CONFIGURADO pela loja e utilizavel — frete gratis de verdade"). Nesse
 *     estado o app cota R$ 0,00 para o Brasil inteiro. A loja desliga os dois
 *     interruptores achando que voltou ao padrão e passa a pagar a entrega de
 *     todo pedido.
 *   - "Frete grátis ativo para pedidos a partir de R$ X."
 *     Verdadeiro só para cliente autenticado. A condição aparece em três
 *     lugares do código (`CartContext`, `StoreContext` e a RPC
 *     `create_marketplace_order_v23`/`v24`) e em nenhum da tela. Quem compra
 *     como convidado passa do mínimo e paga frete.
 *
 *   Juntar tudo numa função só resolve a causa, não o sintoma: a regra depende
 *   de QUATRO campos que moram em dois cards diferentes, então nenhum card
 *   isolado consegue dizer a verdade. E deixa a tabela de estados exercitável
 *   por teste, sem navegador — que é o que impede o próximo estado de nascer
 *   sem frase.
 *
 * O QUE ESTAS FRASES NÃO FAZEM
 *   Não descrevem o preço final do pedido. Ele ainda depende de coisas que
 *   esta tela não controla: produto marcado com frete grátis próprio, CEP
 *   dentro da faixa local, e cotação de transportadora. Por isso cada frase
 *   fala da REGRA daquele card ("quando nenhuma regra de frete grátis se
 *   aplica, a entrega custa X"), e não do desfecho ("todo pedido paga X").
 *   Prometer o desfecho a partir de metade dos dados foi exatamente o defeito.
 */

export interface EstadoDaRegraDeFrete {
  /** `store_config.free_shipping_min`. Zero ou menos = regra desligada. */
  readonly freeShippingMin: number;
  /** `store_config.shipping_fee`. Zero é valor válido, não ausência. */
  readonly shippingFee: number;
  readonly shippingCoverage: "local" | "national";
  readonly shippingProvider: "flat_fee" | "melhor_envio" | "frenet";
}

export interface FrasesDaRegraDeFrete {
  /** Linha do card "Frete Grátis". */
  readonly freteGratis: string;
  /** Linha do card "Taxa Padrão de Entrega". */
  readonly taxa: string;
  /**
   * Aviso destacado, só no estado em que a loja passa a entregar de graça
   * para o país inteiro sem ter pedido isso. `null` no resto.
   */
  readonly avisoDeEntregaGratuita: string | null;
}

/**
 * Dinheiro como a pessoa escreve: R$ 100, R$ 49,90 — nunca "R$ 49.9" nem um
 * R$ 50 arredondado por cima de 49,90.
 */
function reais(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return Number.isInteger(seguro)
    ? `R$ ${seguro}`
    : `R$ ${seguro.toFixed(2).replace(".", ",")}`;
}

export function frasesDaRegraDeFrete(
  estado: EstadoDaRegraDeFrete,
): FrasesDaRegraDeFrete {
  const { freeShippingMin, shippingFee, shippingCoverage, shippingProvider } =
    estado;

  const temRegraPorValor = freeShippingMin > 0;
  const taxaCobra = shippingFee > 0;

  const freteGratis = temRegraPorValor
    ? `Quem entrou na conta não paga entrega a partir de ${reais(freeShippingMin)}. Quem compra sem entrar na conta não recebe esse desconto.`
    : "Nenhuma regra por valor: passar de qualquer valor de compra não zera a entrega.";

  const taxa = taxaCobra
    ? `Quando nenhuma regra de frete grátis se aplica, a entrega custa ${reais(shippingFee)}.`
    : "A taxa está em R$ 0 — quando nenhuma outra regra se aplica, a entrega sai sem custo para quem compra.";

  // O aviso só vale onde a taxa fixa é DE FATO o que o cliente vai pagar.
  // Na cobertura local a edge function responde pela taxa local e nem olha
  // esta; com transportadora, o preço vem da cotação. Avisar nesses dois
  // casos seria a tela afirmando um efeito que não acontece — o mesmo erro
  // que esta correção existe para desfazer.
  const taxaFixaGovernaOPreco =
    shippingCoverage === "national" && shippingProvider === "flat_fee";

  const avisoDeEntregaGratuita =
    !taxaCobra && taxaFixaGovernaOPreco
      ? "Atenção: com a taxa em R$ 0 e a cotação nacional pela taxa fixa, todo pedido sai com entrega grátis, para qualquer CEP do país. Quem paga a entrega é a loja."
      : null;

  return { freteGratis, taxa, avisoDeEntregaGratuita };
}
