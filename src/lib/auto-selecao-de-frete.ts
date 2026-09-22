// A AUTO-SELEÇÃO DO FRETE É A MAIS BARATA (laudo caça-bugs 31/08, menor E).
// A ShippingCalculator auto-selecionava `options[0]` — a primeira da
// resposta — com um comentário dizendo "auto-select cheapest": o
// comprador podia nascer travado na opção cara sem ver que existia a
// barata. Regra explícita: MENOR preço; empate, MENOR prazo; sem lista,
// nada (a tela segue sem opção, como antes).

import { ehRetiradaNaLoja } from "@/lib/guarda-de-frete";

export interface OpcaoDeFrete {
  price: number;
  deliveryDays: number;
}

export function opcaoMaisBarata<T extends OpcaoDeFrete>(
  opcoes: readonly T[] | null | undefined,
): T | null {
  if (!opcoes || opcoes.length === 0) return null;
  return [...opcoes].sort(
    (a, b) => a.price - b.price || a.deliveryDays - b.deliveryDays,
  )[0];
}

// A MESMA ESCOLHA, COM O PREÇO DE AGORA: casar a escolha anterior só POR ID
// mantinha o objeto VELHO — preço de outra cotação — como preço do pedido.
// O id diz QUAL serviço foi escolhido; o objeto da lista nova carrega o
// preço válido. Sem escolha anterior, ou com o id sumido da lista, vale a
// regra da casa: a mais barata.
export function opcaoFrescaOuMaisBarata<
  T extends OpcaoDeFrete & { id: string },
>(
  selecionada: T | null | undefined,
  opcoes: readonly T[] | null | undefined,
): T | null {
  if (!opcoes || opcoes.length === 0) return null;
  const mesmaEscolha = selecionada
    ? opcoes.find((opt) => opt.id === selecionada.id)
    : undefined;
  if (mesmaEscolha) return mesmaEscolha;
  // RETIRADA NA LOJA (release 1.5.3): a retirada custa R$ 0 e seria SEMPRE
  // a "mais barata" — mas buscar na loja é decisão da cliente, nunca do app.
  // Ela fica FORA do fallback: só é mantida quando a própria cliente a
  // escolheu (mesmo id, acima). Se sobrar só ela, `null`: a tela mostra a
  // opção e espera o clique.
  return opcaoMaisBarata(opcoes.filter((opt) => !ehRetiradaNaLoja(opt.id)));
}
