// Um número só para a altura do cartão Lateral, usado pelo cartão, pelo esqueleto e pela seção:
// a vitrine não pode pular quando o esqueleto troca pelo cartão real, nem variar com o nome.
// Garantia: nenhuma linha do texto quebra (nome com 2 linhas reservadas, preço, "De" e "Economiza"
// em linha única com nowrap), então a altura não depende de nome, preço nem largura da tela.
// Conta (nome SEMPRE com 2 linhas reservadas), em px, 23/10/2026:
//   borda 2 + padding 12+12 + nome 40 + espaço 4 + "De" 16 + preço 32 + economia 16
//   + respiro 4 + botão 48 = 186
export const ALTURA_CARTAO_LATERAL = 186;
// Seção = cartão + py-1 do trilho (8) + py-4 (32) + título (24+20) + pontinhos (12+6).
export const ALTURA_SECAO_LATERAL = ALTURA_CARTAO_LATERAL + 102;
