// Tamanho da letra dos valores do Financeiro: UM lugar só.
//
// Dinheiro NUNCA quebra de linha, então quem se ajusta é o tamanho da letra,
// pelo número de caracteres do texto que a tela mostra. Com o "olho" ligado
// (Ocultar) a tela mostra a máscara, e a máscara tem sempre o mesmo tamanho:
// o comprimento usado passa a ser o DELA, nunca o do valor real — senão o
// tamanho da letra entrega a ordem de grandeza do valor a quem olha por cima
// do ombro (R$ 50,00 em 22px, R$ 12.345,67 em 15px).
//
// Cada tela mantém a sua tabela de faixas quando ela é só dela (coluna e
// linha do Caixa, linha do Extrato, tabela do Resultado); as que eram
// idênticas em três telas moram aqui.

import { formatarBRL } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

/** O que a tela escreve no lugar do valor quando "Ocultar" está ligado. */
export const MASCARA_DO_VALOR = "R$ ••••••";

/**
 * Número de caracteres do valor como a tela o escreve (com sinal, se houver).
 * Oculto: o da máscara, igual para qualquer valor.
 */
export function comprimentoDoValor(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): number {
  if (ocultos) return MASCARA_DO_VALOR.length;
  return formatarBRL(valor).length + (comSinal || valor < 0 ? 1 : 0);
}

/**
 * Faixas dos valores de meia largura da tela de 338px (cartão de ~117px de
 * miolo), medidas com a fonte do painel (Inter negrito, números tabulares):
 * 22px normal, 20px, 18px quando longo, e daí para baixo.
 */
const TAMANHOS_DE_MEIA_LARGURA: readonly (readonly [number, string])[] = [
  [8, "text-[22px] leading-tight"],
  [9, "text-[20px] leading-tight"],
  [10, "text-[18px] leading-tight"],
  [12, "text-[15px] leading-tight"],
  [14, "text-[13px] leading-tight"],
];
const TAMANHO_MINIMO_DE_MEIA_LARGURA = "text-xs leading-tight";

/** Tamanho da letra de um valor de `n` caracteres numa metade da tela. */
export function tamanhoDeMeiaLargura(n: number): string {
  const faixa = TAMANHOS_DE_MEIA_LARGURA.find(([ate]) => n <= ate);
  return faixa?.[1] ?? TAMANHO_MINIMO_DE_MEIA_LARGURA;
}

/**
 * Valor do cartão grande (herói / topo): largura cheia, encolhe só quando o
 * texto de `n` caracteres é muito longo.
 */
export function classeDoValorGrande(n: number): string {
  return cn(
    "whitespace-nowrap font-bold leading-none tracking-tight",
    n <= 13
      ? "text-[clamp(2rem,10vw,2.75rem)]"
      : "text-[clamp(1.5rem,7vw,2rem)]",
  );
}
