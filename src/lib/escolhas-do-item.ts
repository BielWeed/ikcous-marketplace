import type { CartItem, Product, ProductVariant } from "@/types";

/**
 * PRODUTO COM DUAS ESCOLHAS SEPARADAS NO CARRINHO (cadastro antigo).
 *
 * Produto cadastrado antes da "variante composta" tem a cor e o tamanho em
 * LINHAS separadas de `product_variants` ("Cor: Azul" e "Tamanho: P"): não
 * existe a linha "Azul + P". O carrinho guardava só o id da PRIMEIRA escolha, e
 * a identidade da linha era `produto + esse id` -- "Azul-P" e "Azul-M"
 * caíam na mesma linha (quantidade 2, nome do primeiro).
 *
 * O desenho, e por que ele é pequeno:
 *   - `CartItem.variantId` continua sendo UM id (o primeiro, pela ordem
 *     DETERMINÍSTICA de `ordenarPelaGrade`) e é ele que o pedido e o frete
 *     enviam e o preço lê. As demais escolhas ficam em
 *     `CartItem.outrasVariantIds`.
 *   - DINHEIRO, a verdade: o servidor cobra e baixa estoque só desse primeiro
 *     id (`COALESCE(v.price_override, p.preco_venda)`); o ajuste de preço da
 *     outra escolha NUNCA é cobrado. Antes o primeiro id era o do primeiro
 *     grupo TOCADO; agora é o primeiro pela ordem fixa, e a página, o card, o
 *     carrinho e o servidor mostram e cobram o MESMO número
 *     (`precoDaEscolha`). Para quem tem 0 ou 1 escolha nada muda.
 *   - A identidade da LINHA é a CHAVE COMPOSTA `idA~idB` (`chaveDaVariacao`).
 *     Com uma escolha só (a maioria) a chave é o próprio `variantId`, byte a
 *     byte a de antes: carrinho salvo no aparelho e linha de `cart_items` já
 *     gravada continuam abrindo e se fundindo como sempre.
 *   - As ações do carrinho (`addToCart`, `removeFromCart`, `updateQuantity`)
 *     aceitam a chave composta no mesmo parâmetro `variantId`: a cadeia de
 *     cards e telas que só repassa esse texto não muda de assinatura.
 *   - O banco guarda a chave composta em `cart_items.variant_id` (texto, único
 *     por usuário+produto+variant_id); o pedido NUNCA a recebe -- as RPCs
 *     convertem `variant_id` em uuid, então o checkout manda só o primeiro id
 *     e leva as duas escolhas por escrito na observação (`notaDasEscolhas`).
 */

/** Nunca aparece num uuid (só hex e hífen) nem em id de teste comum. */
export const SEPARADOR_DE_ESCOLHAS = "~";

/** Repetido não conta duas vezes: a chave e o estoque olham o CONJUNTO. */
function semRepeticao(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** "" sem escolha, `idA` com uma, `idA~idB` com duas. */
export function chaveDaVariacao(
  variantId?: string | null,
  outrasVariantIds: readonly string[] = [],
): string {
  return semRepeticao([variantId, ...outrasVariantIds]).join(
    SEPARADOR_DE_ESCOLHAS,
  );
}

/** Desfaz `chaveDaVariacao`; texto vazio/nulo = sem variação. */
export function separarChave(chave?: string | null): {
  variantId?: string;
  outrasVariantIds: string[];
} {
  const [variantId, ...outras] = semRepeticao(
    (chave ?? "").split(SEPARADOR_DE_ESCOLHAS),
  );
  return { variantId, outrasVariantIds: outras };
}

/** A chave como o carrinho a compara: sem repetição, "" quando vazia. */
export const normalizarChave = (chave?: string | null): string => {
  const { variantId, outrasVariantIds } = separarChave(chave);
  return chaveDaVariacao(variantId, outrasVariantIds);
};

type ItemComEscolhas = Pick<CartItem, "variantId" | "outrasVariantIds">;

/** A chave composta da linha do carrinho. */
export const chaveDaLinha = (item: ItemComEscolhas): string =>
  chaveDaVariacao(item.variantId, item.outrasVariantIds);

/**
 * Identidade da linha: produto + escolhas. Com uma escolha (ou nenhuma) é
 * exatamente o `${produto}-${variantId || ""}` que o carrinho sempre usou.
 */
export const chaveDoItem = (
  item: ItemComEscolhas & Pick<CartItem, "product">,
) => `${item.product.id}-${chaveDaLinha(item)}`;

/**
 * Ordem FIXA das variações escolhidas: pelo rótulo do grupo ("Cor" antes de
 * "Tamanho") e, no empate, pelo id. Não depende da ordem dos toques (Azul
 * depois P e P depois Azul são a mesma combinação) NEM da ordem das linhas que
 * o banco devolve (`product_variants(*)` vem sem ORDER BY, e uma linha
 * atualizada pode ir para o fim): o primeiro id, a chave e o preço cobrado não
 * mudam por isso.
 */
export function ordenarPelaGrade(
  escolhidas: readonly ProductVariant[],
): ProductVariant[] {
  const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...escolhidas].sort(
    (a, b) => comparar(a.name, b.name) || comparar(a.id, b.id),
  );
}

/**
 * O preço que o servidor cobra por uma escolha: o da variação PRINCIPAL (a
 * primeira pela ordem fixa), nunca o último ajuste tocado. Página, card,
 * carrinho e pedido leem daqui.
 */
export function precoDaEscolha(
  produto: { price: number },
  escolhidas: readonly ProductVariant[],
): number {
  return ordenarPelaGrade(escolhidas)[0]?.priceOverride ?? produto.price;
}

/** Soma `quantidade` ao uso de CADA variação que a linha usa. */
export function somarUso(
  uso: Map<string, number>,
  linha: ItemComEscolhas,
  quantidade: number,
): void {
  for (const id of semRepeticao([
    linha.variantId,
    ...(linha.outrasVariantIds ?? []),
  ])) {
    uso.set(id, (uso.get(id) ?? 0) + quantidade);
  }
}

/** Quanto cada variação já está levada pelas linhas dadas (por id). */
export function usoPorVariante(
  linhas: readonly (ItemComEscolhas & Pick<CartItem, "quantity">)[],
): Map<string, number> {
  const uso = new Map<string, number>();
  for (const linha of linhas) somarUso(uso, linha, linha.quantity);
  return uso;
}

/**
 * Quantas unidades a LINHA pode levar: sem variação, o estoque do produto; com
 * variação, o menor estoque entre TODAS as escolhidas (levar "Azul P" precisa
 * de azul E de P), MENOS o que as OUTRAS linhas do carrinho já levam da mesma
 * variação -- o servidor baixa todas as linhas contra o mesmo id principal,
 * então Azul-M x2 e Azul-P x4 com 5 azuis falhariam no último clique. Variação
 * que o produto já não tem conta zero.
 */
export function estoqueDaLinha(
  product: Product,
  variantId?: string | null,
  outrasVariantIds: readonly string[] = [],
  outrasLinhas: readonly CartItem[] = [],
): number {
  const principal = variantId
    ? product.variants?.find((v) => v.id === variantId)
    : undefined;
  if (!principal) return product.stock || 0;
  const uso = usoPorVariante(
    outrasLinhas.filter((linha) => linha.product.id === product.id),
  );
  const sobra = (id: string, estoque: number) => estoque - (uso.get(id) ?? 0);
  const demais = outrasVariantIds.map((id) =>
    sobra(id, product.variants?.find((v) => v.id === id)?.stockIncrement ?? 0),
  );
  return Math.min(sobra(principal.id, principal.stockIncrement), ...demais);
}

/**
 * Identidade do carrinho para a chave de idempotência do pedido: duas compras
 * que só diferem na SEGUNDA escolha (Azul-P x Azul-M) não podem ter a mesma
 * assinatura, senão a retentativa devolveria o pedido da outra.
 */
export function assinaturaDosItens(itens: readonly CartItem[]): string {
  return itens
    .map((item) =>
      JSON.stringify([item.product.id, chaveDaLinha(item), item.quantity]),
    )
    .sort()
    .join("|");
}

/**
 * A observação do pedido com a escolha de cada linha. O pedido só recebe UM
 * `variant_id` por linha; as duas escolhas vão aqui, e linha com duas escolhas
 * leva a quantidade junto (as linhas do mesmo produto ficam com o mesmo
 * `variant_id` no pedido, então só o texto diz qual quantidade é de qual).
 */
export function notaDasEscolhas(itens: readonly CartItem[]): string {
  return itens
    .filter((item) => item.variantNames)
    .map((item) => {
      const texto = `${item.product.name}: ${item.variantNames}`;
      return item.outrasVariantIds?.length
        ? `${texto} (${item.quantity} un.)`
        : texto;
    })
    .join("\n");
}
