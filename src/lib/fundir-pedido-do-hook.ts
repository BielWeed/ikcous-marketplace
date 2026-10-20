// O detalhe do pedido (OrderDetailsView) guarda a SUA cópia do pedido
// (`setOrder`, preenchida pelo `loadOrder` ao abrir) e a lista do hook
// `useOrders` é a que o realtime mantém viva. Antes, nada copiava uma para a
// outra: o PIX era confirmado, o hook recebia `payment_status='pago'`, e a
// tela aberta seguia mostrando "Retomar pagamento" até a cliente sair e
// voltar. Esta função decide quando a cópia do hook é mais nova e como fundi-la
// sem perder o que só o `loadOrder` trouxe.
//
// Regra: só vale a cópia do hook quando o `updatedAt` dela é ESTRITAMENTE mais
// novo (toda escrita de pagamento/status no banco grava `updated_at = now()`).
// Igual, mais velho ou data ilegível → a cópia da tela fica como está (mesma
// referência: o React não re-renderiza e nada pisca). Assim uma lista velha do
// cache nunca desfaz um dado que a tela acabou de buscar.
//
// Fusão: os campos da cópia nova vencem, MENOS os que a linha do realtime nunca
// traz e o `mapOrderFromDB` zera sem as junções — `items` e o endereço de
// `customer` (ver `mesclarAtualizacaoRealtime` em useOrders.ts). Valor
// `undefined` na cópia nova nunca apaga o que a tela já tem.
import type { Order } from "@/types";

function instante(valor: string | undefined): number {
  return valor ? Date.parse(valor) : Number.NaN;
}

export function fundirPedidoDoHook(atual: Order, doHook: Order): Order {
  if (!(instante(doHook.updatedAt) > instante(atual.updatedAt))) return atual;

  const definidos = Object.fromEntries(
    Object.entries(doHook).filter(([, valor]) => valor !== undefined),
  ) as Partial<Order>;

  const enderecoDoHook = doHook.customer?.address;
  const enderecoAtual = atual.customer?.address;

  return {
    ...atual,
    ...definidos,
    items: doHook.items?.length > 0 ? doHook.items : atual.items,
    customer:
      !enderecoDoHook && enderecoAtual
        ? atual.customer
        : (doHook.customer ?? atual.customer),
  };
}

/**
 * A cópia da lista (a que o tempo real mantém) pode chegar sem os itens e sem o
 * endereço que só a abertura do pedido (`loadOrder`) trouxe. Qualquer que seja
 * a regra que escolheu a cópia nova, ela não pode esvaziar a tela: itens e
 * endereço que a cópia nova não traz ficam os da tela. Cópia com itens e
 * endereço vale como veio.
 */
export function manterItensEEnderecoDaTela(daTela: Order, nova: Order): Order {
  const enderecoNovo = nova.customer?.address;
  const enderecoDaTela = daTela.customer?.address;
  return {
    ...nova,
    items: nova.items?.length > 0 ? nova.items : daTela.items,
    customer:
      !enderecoNovo && enderecoDaTela
        ? daTela.customer
        : (nova.customer ?? daTela.customer),
  };
}
