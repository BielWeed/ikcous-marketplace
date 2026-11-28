import { percentualDeDesconto } from "./percentual-de-desconto";
import { precoDeVitrine, precosPossiveis } from "./preco-de-vitrine";

/**
 * Banner com preço velho. O subtítulo e as sugestões do painel congelam o preço
 * do momento em que a lojista escolheu o produto ("Por apenas R$ 70,00",
 * "30% OFF em Vestido"); a promoção acaba, o preço volta a R$ 100 e o banner
 * segue anunciando R$ 70 -- oferta anunciada (CDC art. 30). O painel AVISA; o
 * texto é da lojista e nada aqui o reescreve.
 */

// As regex só acham o número; o milhar e a vírgula se resolvem em código --
// quantificador dentro de quantificador é o formato que trava regex.
/** "R$ 1.234,56", "R$1234,56", "R$ 70" (inclusive com o espaço inquebrável do Intl). */
const REAIS = /R\$\s*(\d[\d.,]*)/g;
/** "30% OFF", "30 % OFF", "30%OFF", "12,5% off". */
const PERCENTUAL_OFF = /(\d[\d,]*)\s*%\s*OFF\b/gi;

/**
 * Valor que o banner cita mas que NÃO é o preço do produto: o preço do combo
 * ("Leve 2 por R$ 150"), o cupom ("cupom de R$ 20", "R$ 20 OFF", "desconto de
 * R$ 30"), o frete ("frete R$ 9,90") e o mínimo de compra ("acima de R$ 199").
 * Conferi-los contra o preço do produto só dava falso aviso. Olha só o que
 * encosta no valor -- "Frete grátis! Vestido por R$ 70" segue conferido -- e
 * só tira o valor que é dos outros: "com desconto R$ 79,90", "frete grátis
 * R$ 70" e "leve 1 vestido R$ 70" citam o preço do produto e são conferidos.
 */
const ANTES_DE_COMBO = /\b(?:leve|compre)\s+(?:[2-9]|\d{2,})\b[^\d$]{0,15}$/i;
// "R$ 70 cada" e "R$ 70 a/à/por unidade" é preço da peça; "R$ 70 cada 2
// peças" / "cada duas" / "cada 1 dúzia" é preço do grupo (fica fora, como o
// combo, e é conferido antes). Na dúvida, não avisar: aviso falso irrita mais
// que aviso que falta. Só espaço na mesma linha: "R$ 70 cada" + quebra + "2
// cores" segue sendo preço da peça.
const DEPOIS_DE_PRECO_UNITARIO =
  /^\s+(?:cada\b|(?:a|à|À|por)\s+unidade\b)/i;
const DEPOIS_DE_PRECO_DE_GRUPO =
  /^\s+cada[^\S\r\n]+(?:\d|(?:dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|d[uú]zia|dezena|centena|meia[^\S\r\n]+d[uú]zia)\b)/i;
const ANTES_DE_VALOR_DE_FORA =
  /(?:\bacima\s+de\s*|\bdesconto\s+de\s*|\bcupom(?:\sde\sdesconto)?(?:\sde)?\s*[:\-–]?\s*|\bfrete(?:\sfixo)?(?:\sde)?\s*[:\-–]?\s*)$/i;
const DEPOIS_DE_VALOR_DE_FORA = /^\s*(?:OFF\b|de\s+desconto\b)/i;

/**
 * "1.234,56" -> 123456; "70" -> 7000; "70.00" -> 7000; "70.50" -> 7050 (ponto
 * com exatamente dois dígitos depois e sem vírgula é a vírgula dos centavos);
 * "1.299" -> 129900 (três dígitos depois do ponto é milhar).
 */
function centavosDe(numero: string): number {
  const limpo = numero.replace(/[.,]+$/, "");
  const decimalComPonto = /^(\d+)\.(\d{2})$/.exec(limpo);
  if (decimalComPonto) {
    return Number(decimalComPonto[1]) * 100 + Number(decimalComPonto[2]);
  }
  const [inteiroBruto, fracaoBruta = ""] = limpo.split(",");
  const grupos = inteiroBruto.split(".");
  const comMilhar =
    grupos.length > 1 &&
    grupos[0].length <= 3 &&
    grupos.slice(1).every((grupo) => grupo.length === 3);
  const inteiro = comMilhar ? grupos.join("") : grupos[0];
  const fracao = /^\d{1,2}$/.test(fracaoBruta) ? fracaoBruta : "";
  return Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
}

/** Os valores que um texto de banner promete: reais em centavos e "% OFF". */
export function valoresCitados(texto: string | null | undefined): {
  centavos: number[];
  percentuais: number[];
} {
  const centavos: number[] = [];
  const percentuais: number[] = [];
  if (!texto) return { centavos, percentuais };
  const antes = (achado: RegExpExecArray) => texto.slice(0, achado.index);
  for (const achado of texto.matchAll(REAIS)) {
    const depois = texto.slice(achado.index + achado[0].length);
    const trechoAntes = antes(achado);
    if (
      ANTES_DE_VALOR_DE_FORA.test(trechoAntes) ||
      DEPOIS_DE_VALOR_DE_FORA.test(depois) ||
      DEPOIS_DE_PRECO_DE_GRUPO.test(depois) ||
      (ANTES_DE_COMBO.test(trechoAntes) &&
        !DEPOIS_DE_PRECO_UNITARIO.test(depois))
    ) {
      continue;
    }
    centavos.push(centavosDe(achado[1]));
  }
  for (const achado of texto.matchAll(PERCENTUAL_OFF)) {
    const trechoAntes = antes(achado);
    if (
      ANTES_DE_VALOR_DE_FORA.test(trechoAntes) ||
      ANTES_DE_COMBO.test(trechoAntes)
    )
      continue;
    const percentual = Number(achado[1].replace(",", "."));
    if (Number.isFinite(percentual)) percentuais.push(percentual);
  }
  return { centavos, percentuais };
}

export type PrecoAnunciadoVelho =
  | { tipo: "preco"; citado: number; atual: number; aPartirDe: boolean }
  | { tipo: "percentual"; citado: number; atual: number };

const emCentavos = (reais: number) => Math.round(reais * 100);

/**
 * O primeiro valor dos textos que não bate, ao centavo, com o que o produto
 * pratica agora; `null` quando todos batem ou quando o texto não cita valor.
 *
 * Bate: o preço de QUALQUER opção ligada (com ou sem estoque, pela regra que o
 * servidor cobra), o "De" riscado quando ele é maior que esse preço, a
 * economia que a vitrine mostra ("Economize R$ 30,00") e o "% OFF" calculado
 * pela mesma conta do selo da vitrine. Reais vêm antes do percentual. O aviso
 * diz o preço da vitrine (o menor à venda) e se ele é "a partir de".
 */
export function precoAnunciadoVelho(
  textos: ReadonlyArray<string | null | undefined>,
  produto: Parameters<typeof precoDeVitrine>[0],
): PrecoAnunciadoVelho | null {
  const citados = textos.map(valoresCitados);
  const reaisCitados = citados.flatMap((c) => c.centavos);
  const percentuaisCitados = citados.flatMap((c) => c.percentuais);
  if (reaisCitados.length === 0 && percentuaisCitados.length === 0) return null;

  const original = produto.originalPrice;
  const reaisQueBatem = new Set<number>();
  const percentuaisQueBatem = new Set<number>();
  for (const preco of precosPossiveis(produto, false)) {
    reaisQueBatem.add(emCentavos(preco));
    if (original != null && emCentavos(original) > emCentavos(preco)) {
      reaisQueBatem.add(emCentavos(original));
      reaisQueBatem.add(emCentavos(original) - emCentavos(preco));
      percentuaisQueBatem.add(percentualDeDesconto(original, preco));
    }
  }

  const vitrine = precoDeVitrine(produto);
  const reaisErrado = reaisCitados.find((c) => !reaisQueBatem.has(c));
  if (reaisErrado !== undefined) {
    return {
      tipo: "preco",
      citado: reaisErrado / 100,
      atual: vitrine.preco,
      aPartirDe: vitrine.aPartirDe,
    };
  }
  const percentualErrado = percentuaisCitados.find(
    (p) => !percentuaisQueBatem.has(p),
  );
  if (percentualErrado !== undefined) {
    return {
      tipo: "percentual",
      citado: percentualErrado,
      atual: vitrine.desconto,
    };
  }
  return null;
}
