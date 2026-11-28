/**
 * Trocar o VALOR de uma opção já gravada ("M" -> "GG") não renomeia a linha:
 * no salvar ela vira uma opção NOVA (decisão de produto, 27/11/2026). Renomear
 * a mesma linha fazia a cliente com "M" no carrinho ver "GG" sem aviso e o
 * estoque devolvido de um pedido de "M" cair no "GG".
 *
 * O que vai para `salvar_produto_com_grade` (o banco não muda):
 *  - a antiga entra em `p_apagar` E, na grade, desligada e sem SKU nem código de
 *    barras. O banco apaga primeiro; a que já tem venda é recusada (fica em
 *    `recusadas`) e então recebe o UPDATE: desligada, guardada para os pedidos
 *    antigos, com o código liberado para a nova (os dois são únicos na loja);
 *  - a nova vai sem id, com os códigos, o estoque e o preço da linha da tela.
 * As antigas vão na FRENTE da lista: o UPDATE que solta o código roda antes de
 * qualquer linha que o pegue.
 *
 * Só corrigir a grafia (mesma palavra, ignorando maiúscula, acento e espaços nas
 * pontas ou repetidos) segue editando a mesma linha.
 */
import type { ProductVariant } from "@/types";

/** "  Médio " e "medio" são a mesma opção; "M" e "GG", não. */
export function normalizarValorDaOpcao(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export interface TrocaDeValor {
  idAntigo: string;
  valorAntigo: string;
  valorNovo: string;
}

type VariacaoDoEnvio = Pick<ProductVariant, "id" | "name" | "value"> &
  Partial<Omit<ProductVariant, "id" | "name" | "value">>;

/**
 * @param aMandar as variações que o salvar ia mandar (já com o SKU limpo; a que
 *   não teve o estoque mexido chega sem `stockIncrement`)
 * @param naTela  a grade inteira da tela (de onde a nova herda o estoque)
 * @param gravadas a grade como a tela a abriu (o valor antigo de cada id)
 */
export function trocasDeValorComoOpcaoNova<V extends VariacaoDoEnvio>(
  aMandar: readonly V[],
  naTela: readonly Pick<ProductVariant, "id" | "stockIncrement">[],
  gravadas: readonly ProductVariant[],
): {
  variantes: Array<V | VariacaoDoEnvio>;
  apagar: string[];
  trocas: TrocaDeValor[];
} {
  const deAbertura = new Map(gravadas.map((v) => [v.id, v]));
  const antigas: VariacaoDoEnvio[] = [];
  const resto: Array<V | VariacaoDoEnvio> = [];
  const apagar: string[] = [];
  const trocas: TrocaDeValor[] = [];

  for (const v of aMandar) {
    const gravada = v.id.startsWith("temp-") ? undefined : deAbertura.get(v.id);
    if (
      !gravada ||
      normalizarValorDaOpcao(gravada.value) === normalizarValorDaOpcao(v.value)
    ) {
      resto.push(v);
      continue;
    }
    // A antiga leva o tipo ATUAL (um grupo só por produto) e o próprio valor,
    // preço e foto; sem `stockIncrement`, o estoque guardado dela não muda.
    antigas.push({
      id: gravada.id,
      productId: gravada.productId,
      name: v.name,
      value: gravada.value,
      sku: undefined,
      codigoBarras: undefined,
      priceOverride: gravada.priceOverride,
      active: false,
      imageUrl: gravada.imageUrl,
    });
    const estoqueDaLinha =
      naTela.find((t) => t.id === v.id)?.stockIncrement ??
      v.stockIncrement ??
      gravada.stockIncrement;
    resto.push({
      ...v,
      id: `temp-troca-${gravada.id}`,
      stockIncrement: estoqueDaLinha,
    });
    apagar.push(gravada.id);
    trocas.push({
      idAntigo: gravada.id,
      valorAntigo: gravada.value,
      valorNovo: v.value,
    });
  }

  return { variantes: [...antigas, ...resto], apagar, trocas };
}

/** O aviso quando o banco guardou a antiga (ela já tinha venda). */
export function fraseDaTrocaGuardada(troca: TrocaDeValor): string {
  return `O "${troca.valorAntigo}" já foi vendido, então guardamos ele desligado para os pedidos antigos e criamos o "${troca.valorNovo}" como opção nova. Confira o estoque das duas linhas.`;
}
