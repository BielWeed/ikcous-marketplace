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

/**
 * QUEM ESCOLHEU a opção que está marcada (captura do dono, 23/09/2026):
 * `cliente` = um toque no cartão; `automatica` = a regra da casa (a mais
 * barata) escolheu sozinha. Só a escolha da CLIENTE sobrevive a uma
 * cotação nova — a automática é sempre refeita contra a lista de agora.
 */
export type OrigemDaEscolhaDoFrete = "cliente" | "automatica";

// A MESMA ESCOLHA, COM O PREÇO DE AGORA: casar a escolha anterior só POR ID
// mantinha o objeto VELHO — preço de outra cotação — como preço do pedido.
// O id diz QUAL serviço foi escolhido; o objeto da lista nova carrega o
// preço válido.
//
// SÓ A ESCOLHA DA CLIENTE É PRESERVADA (captura do dono, 23/09/2026): a
// versão anterior preservava por id QUALQUER seleção — inclusive a que o
// próprio app tinha feito numa cotação anterior. Com vários provedores, a
// primeira cotação podia chegar sem o Melhor Envio (PAC da SuperFrete,
// R$ 25,31, auto-selecionado) e a seguinte trazer a Loggi a R$ 10,49 com o
// selo "Mais barata" — e o PAC "sobrevivia" como se a cliente o tivesse
// escolhido, e o total cobrava R$ 25,31. Agora:
//   - escolha da CLIENTE ainda na lista → o objeto fresco dela;
//   - qualquer outro caso (sem escolha, escolha automática, escolha que
//     sumiu) → a regra da casa: a mais barata (que já exclui a retirada).
/**
 * Devolve a opção E a ORIGEM do resultado — é a origem que o carrinho
 * guarda ao lado da opção, para a próxima cotação saber se deve preservar
 * ou refazer a escolha.
 */
export function resolverEscolhaDoFrete<T extends OpcaoDeFrete>(
  selecionada: T | null | undefined,
  opcoes: readonly T[] | null | undefined,
  escolhidaPelaCliente: boolean,
): { opcao: T | null; origem: OrigemDaEscolhaDoFrete } {
  if (!opcoes || opcoes.length === 0) {
    return { opcao: null, origem: "automatica" };
  }
  const mesmaEscolha =
    selecionada && escolhidaPelaCliente
      ? opcoes.find((opt) => opt.id === selecionada.id)
      : undefined;
  if (mesmaEscolha) return { opcao: mesmaEscolha, origem: "cliente" };
  // RETIRADA NA LOJA (release 1.5.3): a retirada custa R$ 0 e seria SEMPRE
  // a "mais barata" — mas buscar na loja é decisão da cliente, nunca do app.
  // Ela fica FORA do fallback: só é mantida quando a própria cliente a
  // escolheu (mesmo id, acima). Se sobrar só ela, `null`: a tela mostra a
  // opção e espera o clique.
  return { opcao: opcaoMaisBarata(opcoes), origem: "automatica" };
}
