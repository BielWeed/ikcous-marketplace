/**
 * O aviso sob o Preço de Venda: as variações que NÃO vão acompanhar o preço
 * novo que a lojista acabou de digitar.
 *
 * O servidor cobra "o preço próprio da variação, ou o do produto quando ela
 * não tem" (`preco-vendido.ts`). Uma variação com preço próprio IGUAL ao preço
 * antigo do produto parece seguir o produto, mas não segue: baixar o Preço de
 * Venda de 89,90 para 69,90 deixava P, M e G cobrando 89,90, sem aviso
 * nenhum. Decisão do sócio (28/11/2026):
 *  - presas (preço próprio = preço SALVO do produto): a tela as lista e
 *    oferece um botão que tira o preço próprio delas (`semPrecoProprio`);
 *  - diferentes (outro preço próprio): só uma linha informativa — o preço foi
 *    posto de propósito e continua como está.
 *
 * Fica de fora: variação desligada, a que já segue o produto (sem preço
 * próprio) e a de preço zero (brinde é legítimo; a cobrança honra o zero).
 */
import { precoDaLinha } from "@/utils/preco-da-grade";

export interface VariacaoComPrecoProprio {
  value: string;
  priceOverride?: number | null;
  active: boolean;
}

export interface VariacoesQueNaoSeguemOPreco<V> {
  /** O Preço de Venda que está gravado no banco. */
  precoAntigo: number;
  /** O Preço de Venda digitado agora no formulário. */
  precoNovo: number;
  /** Preço próprio igual ao preço antigo: ficariam presos nele. */
  presas: V[];
  /** Preço próprio diferente: continuam como estão. */
  diferentes: V[];
}

const emCentavos = (valor: number): number => Math.round(valor * 100);

/** Um preço do formulário ("89.90", "89,9") ou do banco (89.9); `undefined`
 *  quando vazio, zero ou não é número. */
const precoPositivo = (
  bruto: string | number | null | undefined,
): number | undefined => {
  if (bruto === null || bruto === undefined) return undefined;
  const numero = typeof bruto === "number" ? bruto : precoDaLinha(bruto);
  return numero !== undefined && Number.isFinite(numero) && numero > 0
    ? numero
    : undefined;
};

/**
 * @param precoSalvo o Preço de Venda gravado (o `price` com que o formulário
 *   abriu); vazio no produto novo.
 * @param precoDigitado o campo Preço de Venda como está agora.
 * @param variacoes as variações do formulário, na ordem da tela.
 * @returns `null` quando não há o que avisar (preço igual, sem preço salvo ou
 *   digitado, ou nenhuma variação ligada com preço próprio maior que zero).
 */
export function variacoesQueNaoSeguemOPreco<V extends VariacaoComPrecoProprio>(
  precoSalvo: string | number | null | undefined,
  precoDigitado: string | number | null | undefined,
  variacoes: V[],
): VariacoesQueNaoSeguemOPreco<V> | null {
  const precoAntigo = precoPositivo(precoSalvo);
  const precoNovo = precoPositivo(precoDigitado);
  if (precoAntigo === undefined || precoNovo === undefined) return null;
  if (emCentavos(precoAntigo) === emCentavos(precoNovo)) return null;

  const presas: V[] = [];
  const diferentes: V[] = [];
  for (const variacao of variacoes) {
    const proprio = variacao.priceOverride;
    if (!variacao.active || proprio == null || !(proprio > 0)) continue;
    if (emCentavos(proprio) === emCentavos(precoAntigo)) presas.push(variacao);
    else diferentes.push(variacao);
  }
  if (presas.length === 0 && diferentes.length === 0) return null;
  return { precoAntigo, precoNovo, presas, diferentes };
}

/**
 * A variação sem preço próprio, passando a seguir o Preço de Venda.
 *
 * `null`, NUNCA `undefined`: o caminho de gravação de uma variação
 * (`useProducts.ts`, `updateVariant`) pula a chave `undefined` e o preço
 * antigo sobreviveria no banco (laudo 0109). O tipo `ProductVariant` só
 * declara `number | undefined`, mas o banco devolve `null` na coluna vazia e
 * todo leitor do formulário trata os dois iguais (`?? null`, `== null`).
 */
export function semPrecoProprio<V extends { priceOverride?: number | null }>(
  variacao: V,
): V {
  return { ...variacao, priceOverride: null };
}

/** "P", "P e M", "P, M e G". */
export function juntarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}
