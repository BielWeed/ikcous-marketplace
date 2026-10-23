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
 *   - `CartItem.variantId` continua sendo UM id (o primeiro, pela ordem do
 *     cadastro) e é ele que o pedido e o frete enviam e o preço lê: nada do
 *     dinheiro muda de lugar. As demais escolhas ficam em
 *     `CartItem.outrasVariantIds`.
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
 * Coloca as variações escolhidas na ORDEM DO CADASTRO (grupo que aparece
 * primeiro na lista do produto vem primeiro). Sem isso o "primeiro id" mudava
 * com a ordem dos toques -- Azul depois P e P depois Azul seriam duas linhas
 * para a mesma combinação.
 */
export function ordenarPelaGrade(
  variantes: readonly ProductVariant[] | undefined,
  escolhidas: readonly ProductVariant[],
): ProductVariant[] {
  const posicaoDoGrupo = new Map<string, number>();
  for (const v of variantes ?? []) {
    if (!posicaoDoGrupo.has(v.name))
      posicaoDoGrupo.set(v.name, posicaoDoGrupo.size);
  }
  const posicao = (v: ProductVariant) =>
    posicaoDoGrupo.get(v.name) ?? Number.MAX_SAFE_INTEGER;
  return [...escolhidas].sort((a, b) => posicao(a) - posicao(b));
}

/**
 * Quantas unidades a LINHA pode levar: sem variação, o estoque do produto; com
 * variação, o menor estoque entre TODAS as escolhidas (levar "Azul P" precisa
 * de azul E de P). Variação que o produto já não tem conta zero.
 */
export function estoqueDaLinha(
  product: Product,
  variantId?: string | null,
  outrasVariantIds: readonly string[] = [],
): number {
  const principal = variantId
    ? product.variants?.find((v) => v.id === variantId)
    : undefined;
  if (!principal) return product.stock || 0;
  const demais = outrasVariantIds.map(
    (id) => product.variants?.find((v) => v.id === id)?.stockIncrement ?? 0,
  );
  return Math.min(principal.stockIncrement, ...demais);
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
