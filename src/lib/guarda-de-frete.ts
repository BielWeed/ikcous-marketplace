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

// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026): a lojista responde em três
// opções, e no banco isso são DUAS coisas já existentes ou novas —
// `store_config.local_delivery_enabled` (a entrega própria está ligada?) e a
// chave `store-pickup` em `enabled_shipping_methods` (a retirada está
// ligada?). Esta é a ÚNICA junção das duas; o painel e o checkout leem o
// modo por aqui, nunca recombinam os dois campos por conta própria.
//
//   Entrego            = entrega ligada + retirada desligada
//   Entrego e retiro   = entrega ligada + retirada ligada
//   Só retiro          = entrega desligada (a retirada vale para QUALQUER
//                        CEP; a trigger do banco exige a retirada ligada)
//
// COLUNA AUSENTE (banco ainda sem a migration) lê como o padrão de hoje:
// entrega ligada e 1 dia. O front vai ao ar DEPOIS do banco, mas o código
// não depende dessa ordem.
export type ModoDaEntregaNaCidade =
  | "entrego"
  | "entrego_e_retiro"
  | "so_retiro";

/** Prazo da entrega própria quando a loja não disse (o "1 dia" de sempre). */
export const DIAS_DA_ENTREGA_PROPRIA_PADRAO = 1;
const DIAS_MAXIMO_DA_ENTREGA_PROPRIA = 30;

/**
 * A entrega própria está ligada? Só `false` desliga: ausente, nulo ou valor
 * estranho leem como ligada — o comportamento de hoje e o que a edge faz
 * quando não consegue ler a coluna.
 */
export function entregaPropriaLigada(valor: unknown): boolean {
  return valor !== false;
}

/**
 * Prazo (em dias) da entrega própria: inteiro de 0 a 30 (o CHECK do banco);
 * qualquer outra coisa — ausente, nulo, fracionário, fora da faixa, texto —
 * lê como o padrão (1). Nunca inventa um prazo que a loja não escolheu.
 */
export function diasDaEntregaPropria(valor: unknown): number {
  if (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor <= DIAS_MAXIMO_DA_ENTREGA_PROPRIA
  ) {
    return valor;
  }
  return DIAS_DA_ENTREGA_PROPRIA_PADRAO;
}

/** O modo que a lojista escolheu para a cidade dela. */
export function modoDaEntregaNaCidade(
  config:
    | {
        readonly localDeliveryEnabled?: boolean | null;
        readonly enabledShippingMethods?: readonly string[] | null;
      }
    | null
    | undefined,
): ModoDaEntregaNaCidade {
  if (!entregaPropriaLigada(config?.localDeliveryEnabled)) return "so_retiro";
  return retiradaLigadaNaLista(config?.enabledShippingMethods)
    ? "entrego_e_retiro"
    : "entrego";
}

/**
 * A retirada vale para QUALQUER CEP? Só em "Só retiro" e só com a opção
 * `store-pickup` de fato marcada — o espelho do `v_retirada_livre` da RPC
 * do pedido (create_marketplace_order_v23/v24). Nos outros modos a edge só
 * oferece a retirada à área local, então a regra do convidado
 * ("fora da cidade é só com conta") segue valendo inteira.
 */
export function retiradaLivreParaQualquerCep(
  config: Parameters<typeof modoDaEntregaNaCidade>[0],
  idDaOpcaoMarcada: string | null | undefined,
): boolean {
  return (
    modoDaEntregaNaCidade(config) === "so_retiro" &&
    ehRetiradaNaLoja(idDaOpcaoMarcada)
  );
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

// FORMAS DE PAGAMENTO POR LOJA (25/09/2026): a loja liga/desliga pix, cartão
// e dinheiro NA ENTREGA (store_config.formas_pagamento_entrega, migration
// 20261174000000). Este é o SEGUNDO eixo de travamento do Finalizar — a
// guarda de cima (`pagamentoIncompativelComFrete`) já cobre "online"
// (selecionado com a flag desligada); esta cobre pix/card/cash desligados
// pela loja. As duas convivem: o Finalizar trava se QUALQUER uma acusar.
export function formaDePagamentoDesligadaNaLoja(args: {
  paymentMethod: "pix" | "card" | "cash" | "online";
  formasNaEntrega: readonly ("pix" | "card" | "cash")[];
}): boolean {
  if (args.paymentMethod === "online") return false;
  return !args.formasNaEntrega.includes(args.paymentMethod);
}

// A ORDEM DE FALLBACK quando o método selecionado deixa de estar disponível
// (checkout, brief 25/09/2026): "online" primeiro, SE a cliente está logada
// e a loja tem pagamento pelo app ligado — senão a primeira das formas na
// entrega ainda disponíveis, na ordem em que a loja as tem (o servidor
// preserva a ordem que o front manda). `null` quando NENHUMA das duas
// existe — convidado numa loja só "online" (mostra o aviso de login, NUNCA
// seleciona "online" para quem não tem conta) ou loja genuinamente sem
// forma de pagamento nenhuma (o invariante do banco — trigger
// store_config_exige_forma_de_pagamento — já deveria impedir esse estado;
// aqui é defesa em profundidade).
export function primeiraFormaDePagamentoDisponivel(args: {
  formasNaEntrega: readonly ("pix" | "card" | "cash")[];
  pagamentoOnlineLigado: boolean;
  logado: boolean;
}): "pix" | "card" | "cash" | "online" | null {
  if (args.logado && args.pagamentoOnlineLigado) return "online";
  return args.formasNaEntrega[0] ?? null;
}

// A OPÇÃO MARCADA × A COTAÇÃO NA TELA (captura do dono, 23/09/2026): o
// cartão com "Mais barata" era um, a opção marcada era outra e o total
// somava a marcada. O total SEMPRE deriva da opção marcada (CartContext),
// então a conferência que importa antes de criar o pedido é outra: a opção
// marcada ainda é, com o MESMO preço, uma opção da cotação que está na tela
// (o envelope do cache do navegador — a lista que a calculadora mostrou).
//   - `sem-evidencia`: não há lista legível (envelope ausente, formato
//     antigo) — não bloqueia, pelo mesmo motivo da checagem de revisão:
//     quem decide então é a RPC (que confere o preço pela cotação gravada);
//   - `confere`: mesmo id, mesmo preço em centavos;
//   - `preco-mudou`: mesmo id, preço diferente — `fresca` é o objeto certo;
//   - `sumiu`: o id não está na lista — a escolha é de outra cotação.
export type ConferenciaDoFreteEscolhido<T> =
  | { tipo: "sem-evidencia" }
  | { tipo: "confere" }
  | { tipo: "preco-mudou"; fresca: T }
  | { tipo: "sumiu" };

function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function conferirFreteEscolhidoComACotacao<
  T extends { id: string; price: number },
>(escolhida: T, opcoesDaCotacao: unknown): ConferenciaDoFreteEscolhido<T> {
  if (!Array.isArray(opcoesDaCotacao) || opcoesDaCotacao.length === 0) {
    return { tipo: "sem-evidencia" };
  }
  const mesma = (opcoesDaCotacao as unknown[]).find(
    (o): o is T =>
      !!o &&
      typeof o === "object" &&
      (o as { id?: unknown }).id === escolhida.id,
  );
  if (!mesma) return { tipo: "sumiu" };
  const preco = (mesma as { price?: unknown }).price;
  if (typeof preco !== "number" || !Number.isFinite(preco)) {
    return { tipo: "sumiu" };
  }
  return emCentavos(preco) === emCentavos(escolhida.price)
    ? { tipo: "confere" }
    : { tipo: "preco-mudou", fresca: mesma };
}
