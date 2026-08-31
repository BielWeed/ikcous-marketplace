// Laudo caça-bugs 31/08 (B2): a guarda do Finalizar vivia inline no
// CheckoutView como `cart.length > 0 && shipping > 0 &&
// !selectedShippingOption` — e IGNORAVA a bandeira `freteIndefinido`.
// Provedor de cotação com taxa 0 configurada deixava `shipping === 0`, a
// guarda não disparava, e o pedido fechava com frete R$ 0 sem cotação
// nenhuma, depois do carrinho ter dito "A calcular". Extraída para função
// pura pelo mesmo motivo da `travaDeEnvio`: condição de dinheiro se prova
// em unit test que discrimina, não colada num componente que só renderiza
// com um formulário inteiro válido.
//
// Semântica (espelha a ordem do memo `freteIndefinido` no CartContext):
//   - carrinho vazio não tem o que finalizar — livre (a tela nem mostra
//     o botão nesse caso);
//   - opção selecionada define o frete — LIVRE, antes de qualquer outra
//     checagem (mesma ordem do memo: `if (selectedShippingOption) return false`);
//   - frete indefinido ("A calcular") — TRAVADO, mesmo com shipping === 0:
//     é exatamente o caso que a guarda velha deixava passar;
//   - frete positivo sem opção escolhida — TRAVADO (o defeito original de
//     18/08: cotação falhou, tela sem opção, frete de fallback cobrado);
//   - frete grátis (shipping 0 legítimo por item/limite) — livre.
export function finalizarBloqueadoPorFrete(args: {
  carrinhoVazio: boolean;
  freteIndefinido: boolean;
  shipping: number;
  temOpcaoSelecionada: boolean;
}): boolean {
  if (args.carrinhoVazio) return false;
  if (args.temOpcaoSelecionada) return false;
  if (args.freteIndefinido) return true;
  return args.shipping > 0;
}
