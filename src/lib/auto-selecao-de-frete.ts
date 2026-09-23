// A AUTO-SELEÇÃO DO FRETE É A MAIS BARATA (laudo caça-bugs 31/08, menor E).
// A ShippingCalculator auto-selecionava `options[0]` — a primeira da
// resposta — com um comentário dizendo "auto-select cheapest": o
// comprador podia nascer travado na opção cara sem ver que existia a
// barata. Regra explícita: MENOR preço; empate, MENOR prazo; sem lista,
// nada (a tela segue sem opção, como antes).
//
// EMENDA R2-3 (release 1.5.7, CONTRATO-1.5.7.md §8): com vários provedores
// ligados a "mais barata" passou a ter NOME próprio na tela —
// `destaquesDoFrete(opcoes).maisBarata` — e a auto-seleção usa o MESMO
// comparador dali, para nunca escolher algo que a tela não destaca como
// "Mais barata". A retirada nunca entra (já era assim, e `destaquesDoFrete`
// já a exclui).

import {
  type OpcaoParaDestaque,
  destaquesDoFrete,
} from "@/lib/destaques-do-frete";

export type OpcaoDeFrete = OpcaoParaDestaque;

export function opcaoMaisBarata<T extends OpcaoDeFrete>(
  opcoes: readonly T[] | null | undefined,
): T | null {
  if (!opcoes || opcoes.length === 0) return null;
  return destaquesDoFrete(opcoes).maisBarata;
}

// A MESMA ESCOLHA, COM O PREÇO DE AGORA: casar a escolha anterior só POR ID
// mantinha o objeto VELHO — preço de outra cotação — como preço do pedido.
// O id diz QUAL serviço foi escolhido; o objeto da lista nova carrega o
// preço válido. Sem escolha anterior, ou com o id sumido da lista, vale a
// regra da casa: a mais barata (que já exclui a retirada).
export function opcaoFrescaOuMaisBarata<T extends OpcaoDeFrete>(
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
  return opcaoMaisBarata(opcoes);
}
