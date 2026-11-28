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

/** "1.234,56" -> 123456; "70" -> 7000; "70.00" (sem milhar de verdade) -> 7000. */
function centavosDe(numero: string): number {
  const [inteiroBruto, fracaoBruta = ""] = numero
    .replace(/[.,]+$/, "")
    .split(",");
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
  for (const [, numero] of texto.matchAll(REAIS)) {
    centavos.push(centavosDe(numero));
  }
  for (const [, numero] of texto.matchAll(PERCENTUAL_OFF)) {
    const percentual = Number(numero.replace(",", "."));
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
