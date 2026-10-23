// Um número só para a altura do cartão Lateral, usado pelo cartão, pelo esqueleto e pela seção:
// a vitrine não pode pular quando o esqueleto troca pelo cartão real, nem variar com o nome.
// O cartão tem altura FIXA (não mínima): nome com 2 linhas reservadas, preço, "Economiza" e estoque
// em linhas de altura fixa com nowrap, então nada depende de nome, preço nem largura da tela.
// Conta, em px, 23/10/2026: borda 2 + padding 10+10 + nome 36 + respiro 2 + preço 28 + economia 16
//   + estoque 16 = 120, mais 4 de folga = 124 (o carrinho de 44 px fica sobreposto na faixa de baixo).
export const ALTURA_CARTAO_LATERAL = 124;
// Seção = cartão + py-1 do trilho (8) + py-4 (32) + título (24+20) + pontinhos (12+6) = 226.
export const ALTURA_SECAO_LATERAL = ALTURA_CARTAO_LATERAL + 102;
