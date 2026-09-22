// OS IDS QUE SÃO MODALIDADE DA PRÓPRIA LOJA (não transportadora). O id é o
// contrato — mesmo token na RPC do pedido (create_marketplace_order_v23/
// v24) e na edge calculate-shipping (`_shared/retirada-na-loja.ts`).
//
// RETIRADA NA LOJA (release 1.5.3, migration 20261169000000): o id
// `store-pickup` é também a CHAVE que a loja põe em
// `store_config.enabled_shipping_methods` para ligar a retirada (ausente =
// desligada). A edge só a oferece à cliente da área local, com o endereço
// físico da loja; a RPC revalida tudo e grava frete 0.
export const ID_ENTREGA_LOCAL = "local-delivery";
export const ID_RETIRADA_NA_LOJA = "store-pickup";

/** Comparação EXATA, sem trim nem caixa — mesma régua fail-closed da RPC. */
export function ehRetiradaNaLoja(id: string | null | undefined): boolean {
  return id === ID_RETIRADA_NA_LOJA;
}

/**
 * Entrega local OU retirada: a loja é quem entrega/entrega em mãos, então os
 * meios de pagamento "na entrega" que ela permite continuam valendo. Qualquer
 * outro id é transportadora (exige antecipado).
 */
export function ehModalidadeDaLoja(id: string | null | undefined): boolean {
  return id === ID_ENTREGA_LOCAL || id === ID_RETIRADA_NA_LOJA;
}

// `enabled_shipping_methods` NULL vale ["sedex","pac"] na edge
// (calculate-shipping) e no StoreContext — a mesma leitura aqui, para que
// ligar a retirada numa loja sem lista gravada NÃO troque "sedex+pac" por
// "todas as transportadoras" (lista só com a chave da retirada).
const METODOS_QUANDO_NULO: readonly string[] = ["sedex", "pac"];

/** A chave `store-pickup` está na lista gravada da loja? */
export function retiradaLigadaNaLista(
  metodos: readonly string[] | null | undefined,
): boolean {
  return (metodos ?? METODOS_QUANDO_NULO).includes(ID_RETIRADA_NA_LOJA);
}

/**
 * A lista gravada com a retirada ligada/desligada e TODO o resto intacto
 * (chaves de transportadora na mesma ordem). Quem grava por esta função
 * nunca apaga a escolha de serviços de outra tela.
 */
export function listaComRetirada(
  metodos: readonly string[] | null | undefined,
  ligada: boolean,
): string[] {
  const semRetirada = (metodos ?? METODOS_QUANDO_NULO).filter(
    (m) => m !== ID_RETIRADA_NA_LOJA,
  );
  return ligada ? [...semRetirada, ID_RETIRADA_NA_LOJA] : semRetirada;
}

/** Só as chaves de transportadora (a retirada não é transportadora). */
export function chavesDeTransportadoraDaLista(
  metodos: readonly string[] | null | undefined,
): string[] {
  return (metodos ?? []).filter((m) => m !== ID_RETIRADA_NA_LOJA);
}

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
// 🔴 REGRA APERTADA em 21/09/2026 (alinhamento com o FRETE V2 EMENDA
// 03/09, o ELSIF do bloco 4 da RPC viva): o servidor recusa pedido com id
// de entrega AUSENTE — o front passa a exigir o mesmo, e a opção ausente
// TRAVA o Finalizar MESMO com `shipping === 0` por frete grátis legítimo
// (item com `freeShipping`, limite atingido): sem id, o carrinho pode até
// exibir R$ 0, mas não existe ESCOLHA de entrega atrás dele, e é a escolha
// que o servidor gravou no pedido. A calculadora continua no CartView
// também com frete grátis — escolher a opção ali não custa a gratuidade.
//
// Semântica (a bandeira `freteIndefinido` e o `shipping` param de decidir
// — mantidos na assinatura porque o chamador já os computa e a história do
// B2 segue explicando por que eles JÁ NÃO bastam sozinhos):
//   - carrinho vazio não tem o que finalizar — livre (a tela nem mostra
//     o botão nesse caso);
//   - opção selecionada — LIVRE, qualquer preço (local grátis com price 0
//     inclusive: a escolha existe e é o que o servidor grava);
//   - SEM opção selecionada — TRAVADO, sempre: frete indefinido ("A
//     calcular") ou frete 0 legítimo, o servidor recusa o id ausente e o
//     front espelha a mesma exigência.
export function finalizarBloqueadoPorFrete(args: {
  carrinhoVazio: boolean;
  freteIndefinido: boolean;
  shipping: number;
  temOpcaoSelecionada: boolean;
}): boolean {
  if (args.carrinhoVazio) return false;
  if (args.temOpcaoSelecionada) return false;
  return true;
}

// REGRA DO FRETE × PAGAMENTO (21/09/2026, autorizada pelo dono): o checkout
// deixava escolher PIX/cartão/dinheiro NA ENTREGA mesmo com frete de
// TRANSPORTADORA (Melhor Envio/Frenet) para outra cidade — a transportadora
// não é a loja saindo com o troco: envio por transportadora EXIGE pagamento
// antecipado (método "online", PIX pago no app). Entrega local
// (id "local-delivery") preserva as modalidades que a loja permite.
//
// A MODALIDADE SE DECIDE PELO ID, nunca pelo preço nem pelo texto: frete
// grátis de transportadora (price 0, id "melhor-envio-*"/"frenet-*")
// CONTINUA transportadora; entrega local grátis (price 0, id
// "local-delivery") continua local. Mesmo contrato da RPC viva
// (create_marketplace_order_v23/v24): fora "local-delivery", a opção só
// nasce de cotação resolvida no servidor — o front espelha a classificação.
//
// Semântica (mesmo espírito da `finalizarBloqueadoPorFrete` — condição de
// dinheiro se prova em unit test que discrimina, não colada no componente):
//   - método "online" com a flag DESLIGADA -> TRAVADO, qualquer modalidade:
//     "online" não é selecionável com a flag desligada, então selecionado
//     assim é estado STALE (ou forjado) — um antecipado que não pode ser
//     pago;
//   - sem opção selecionada -> esta guarda NÃO fala: modalidade
//     DESCONHECIDA. As opções "na entrega" continuam visíveis (escondê-las
//     permitiria submit com um meio oculto), a disponibilidade do Finalizar
//     é da `finalizarBloqueadoPorFrete`, e pedido com opção ausente é
//     recusado pela própria RPC;
//   - entrega local -> LIVRE (modalidades da loja intactas);
//   - transportadora + método != "online" -> TRAVADO.
export function pagamentoIncompativelComFrete(args: {
  temOpcaoSelecionada: boolean;
  ehEntregaLocal: boolean;
  paymentMethod: "pix" | "card" | "cash" | "online";
  pagamentoOnlineLigado: boolean;
}): boolean {
  if (args.paymentMethod === "online" && !args.pagamentoOnlineLigado) {
    return true;
  }
  if (!args.temOpcaoSelecionada) return false;
  if (args.ehEntregaLocal) return false;
  return args.paymentMethod !== "online";
}
