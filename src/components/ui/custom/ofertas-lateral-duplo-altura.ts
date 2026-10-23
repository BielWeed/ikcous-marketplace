// Alturas do "Lateral em duas fileiras", num lugar só, usado pelo cartão, pelo esqueleto e pela seção:
// a vitrine não pode pular quando o esqueleto troca pelo cartão real, nem variar com o nome ou o preço.
// O cartão tem altura FIXA: borda 2 + padding 8 (topo) e 4 (base) + nome 32 + respiro 2 + preço 24
// + "De" 16 + estoque 16 = 104. Nome, preço, "De" e estoque têm linha de altura fixa (nowrap/clamp),
// então nada depende de nome, preço nem largura da tela.
export const ALTURA_CARTAO_DUPLO = 104;
/** Espaço entre os dois cartões da coluna (gap-2). */
export const ESPACO_ENTRE_FILEIRAS_DUPLO = 8;
// Moldura da seção, sem os cartões: py-1 do trilho (8) + py-4 (32) + título (24+20) + pontinhos (12+6) = 102.
const MOLDURA_DA_SECAO_DUPLO = 102;
/** Seção com duas fileiras: 2 x 104 + 8 + 102 = 318. */
export const ALTURA_SECAO_DUPLO =
  2 * ALTURA_CARTAO_DUPLO +
  ESPACO_ENTRE_FILEIRAS_DUPLO +
  MOLDURA_DA_SECAO_DUPLO;
/** Seção com UMA oferta (uma fileira só): 104 + 102 = 206. */
export const ALTURA_SECAO_DUPLO_UMA_FILEIRA =
  ALTURA_CARTAO_DUPLO + MOLDURA_DA_SECAO_DUPLO;

export type FileirasDoDuplo = 1 | 2;

/**
 * Quantas fileiras a faixa tem para `qtd` ofertas: só 1 oferta ocupa uma fileira; 2 ou mais, duas
 * (a coluna tem 2 cartões). Sem informação (primeira visita, memória antiga), a aposta é duas.
 */
export function fileirasDaFaixa(qtd: number | undefined): FileirasDoDuplo {
  return qtd === 1 ? 1 : 2;
}

export function alturaDaSecaoDuplo(fileiras: FileirasDoDuplo): number {
  return fileiras === 1 ? ALTURA_SECAO_DUPLO_UMA_FILEIRA : ALTURA_SECAO_DUPLO;
}
