/**
 * O preço digitado na grade de variações e o Preço de Venda do produto.
 *
 * O lojista digitava o preço na grade (passo 2, "Aplicar para todas") e o
 * formulário do produto pedia o MESMO preço de novo. Esta regra liga os dois
 * sem mudar o que a loja cobra: o servidor continua cobrando "o preço da
 * variação, ou o do produto quando ela está em Auto" (`preco-vendido.ts`).
 *
 * O que ela decide, só na hora de entregar as linhas ao formulário:
 *  - produto JÁ com preço: nada muda. O que se digita na grade vale só para as
 *    combinações novas (preço próprio) e o preço do produto fica como está;
 *  - produto SEM preço e TODAS as linhas com preço maior que zero: o produto
 *    recebe o MENOR preço, e as linhas iguais a ele viram Auto (seguem o
 *    produto); as mais caras mantêm o preço próprio;
 *  - produto SEM preço e só ALGUMAS linhas com preço (ou nenhuma, ou zero):
 *    não se chuta — o produto continua pedindo o Preço de Venda.
 *
 * Preço zero fica como preço próprio da linha (brinde é legítimo, ver
 * `preco-vendido.ts`), mas nunca vira Preço de Venda do produto.
 */

/** Mesma limpeza do preço do modal unitário ("89,90" vira "89.90"): o valor
 *  digitado só vira número na hora de efetivar, não a cada tecla. */
export const limparNumero = (val: string): string => {
  if (!val) return "";
  let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
  const parts = clean.split(".");
  if (parts.length > 2) {
    clean = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return clean;
};

/** O preço de uma linha do passo 2: `undefined` quando o campo está vazio ou
 *  não é número; nunca negativo. */
export const precoDaLinha = (bruto: string): number | undefined => {
  const limpo = limparNumero(bruto);
  if (!limpo) return undefined;
  const numero = Number.parseFloat(limpo);
  return Number.isNaN(numero) ? undefined : Math.max(0, numero);
};

export interface PrecoResolvidoDaGrade {
  /** Preço próprio de cada linha, na ordem da grade; `undefined` = Auto. */
  precos: Array<number | undefined>;
  /** O Preço de Venda que a grade dá ao produto. Só existe quando o produto
   *  estava sem preço e todas as linhas tinham um. */
  precoDoProduto?: number;
}

const emCentavos = (valor: number): number => Math.round(valor * 100);

/**
 * @param precoDoProduto o campo Preço de Venda do formulário, como está agora
 *   (vazio quando a lojista ainda não preencheu).
 * @param precosDigitados o texto do preço de cada linha do passo 2.
 */
export function resolverPrecoDaGrade(
  precoDoProduto: string,
  precosDigitados: string[],
): PrecoResolvidoDaGrade {
  const proprios = precosDigitados.map(precoDaLinha);

  // Produto que já tem um valor no campo (mesmo um inválido): a grade não
  // escreve por cima do que a lojista digitou.
  if (precoDoProduto.trim() !== "") return { precos: proprios };

  const positivos: number[] = [];
  for (const preco of proprios) {
    if (preco === undefined || preco <= 0) return { precos: proprios };
    positivos.push(preco);
  }
  if (positivos.length === 0) return { precos: proprios };

  const menor = Math.min(...positivos);
  return {
    precos: proprios.map((preco) =>
      preco !== undefined && emCentavos(preco) === emCentavos(menor)
        ? undefined
        : preco,
    ),
    precoDoProduto: menor,
  };
}
