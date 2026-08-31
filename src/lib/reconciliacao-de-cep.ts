// A COTAÇÃO DE FRETE VALE PARA UM DESTINO (laudo caça-bugs 31/08, item E —
// reconciliação de CEP). O frete é cotado no CARRINHO (ShippingCalculator,
// campo de CEP próprio) e a entrega é endereçada no CHECKOUT (form do
// convidado, endereço do logado): são campos diferentes, e nada os amarrava
// — o cliente cotava no CEP A, entregava no B e pagava o frete de A.
//
// As duas metades da cura:
//   SERVIDOR (migration 20261039000000): RECUSA o pedido cujo CEP de
//   cotação difere do CEP de entrega — falha fechada contra quem chama a
//   RPC direto.
//   TELA (este arquivo + o efeito no CheckoutView que o consome): a opção
//   escolhida CAI no instante em que o destino muda; o carrinho volta a
//   "A calcular" e o cliente re-cota para o CEP certo sem nunca ver a
//   recusa.
//
// Cotação AUSENTE não contradiz destino nenhum: frete grátis e taxa fixa
// sem passagem pela calculadora chegam aqui sem cotação — e "não sei o CEP
// da cotação" não é motivo para derrubar escolha alheia. O portão de
// cobertura/área do SERVIDOR é quem policia esses caminhos.

export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function cotacaoValeParaDestino(
  cepDaCotacao: string | null | undefined,
  cepDeEntrega: string | null | undefined,
): boolean {
  const cotacao = cepDaCotacao ? soDigitos(cepDaCotacao) : "";
  const destino = cepDeEntrega ? soDigitos(cepDeEntrega) : "";
  if (cotacao === "" || destino === "") return true;
  return cotacao === destino;
}
