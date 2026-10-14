import { mapProductFromDB } from "@/lib/mappers";
import { precoVendido } from "@/lib/preco-vendido";
import { reconferirCarrinho } from "@/lib/reconferirCarrinho";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, Product } from "@/types";

/**
 * O CARRINHO RELÊ O CATÁLOGO (14/10/2026).
 *
 * O carrinho guardava a cópia do produto do dia em que o item entrou. Preço,
 * estoque e situação (à venda ou pausado) nunca eram relidos: a lojista mudava
 * o preço, a cliente voltava, o carrinho mostrava o preço velho e o servidor
 * recusava o pedido com "Os valores do pedido mudaram". Este arquivo é a parte
 * PURA do conserto — o que fazer com o que o banco devolveu. Quem LÊ o banco é
 * o CartContext.
 *
 * Duas ideias que sustentam tudo aqui:
 *
 * 1) `consultados` não é o mesmo que "veio na resposta". O carrinho pode ganhar
 *    um item enquanto a leitura está em voo; um id que NUNCA foi perguntado não
 *    pode ser tratado como "sumiu do catálogo" (e apagado). Só some do carrinho
 *    o que foi perguntado e não voltou.
 * 2) A vitrine pública (`vw_produtos_public`) só devolve produto à venda
 *    (`ativo` e não apagado): "perguntei e não voltou" quer dizer pausado ou
 *    removido. É a mesma convenção que `syncFromDB` já usava.
 */

export interface CatalogoLido {
  /** Ids de produto que foram PERGUNTADOS ao banco nesta leitura. */
  consultados: ReadonlySet<string>;
  /** O produto ATUAL de cada id que voltou (já com as variações). */
  produtos: ReadonlyMap<string, Product>;
}

type LinhaDoBanco = Record<string, unknown>;

/**
 * Monta o catálogo lido a partir das linhas CRUAS do banco (produto + variações),
 * com o mesmo mapeador que o resto do app usa — assim o produto novo tem a
 * mesma forma do produto que a cliente guardou.
 */
export function montarCatalogo(
  idsConsultados: readonly string[],
  linhasDeProduto: readonly LinhaDoBanco[],
  linhasDeVariacao: readonly LinhaDoBanco[],
): CatalogoLido {
  const produtos = new Map<string, Product>();
  for (const linha of linhasDeProduto) {
    const id = typeof linha.id === "string" ? linha.id : null;
    if (!id) continue;
    const doProduto = linhasDeVariacao.filter((v) => v.product_id === id);
    produtos.set(
      id,
      mapProductFromDB({ ...linha, product_variants: doProduto }),
    );
  }
  return { consultados: new Set(idsConsultados), produtos };
}

/**
 * Quantas unidades a cliente pode levar desta LINHA do carrinho, segundo o
 * produto atual — ou `null` quando a linha não pode mais ser vendida.
 *
 * Linha com variação: vale o estoque DA VARIAÇÃO, e variação que sumiu ou foi
 * desativada não vende (o servidor exige `v.active = true`). Linha sem
 * variação: o estoque do produto, como `addToCart` e `updateQuantity` já
 * contam.
 */
function unidadesDisponiveis(
  produto: Product,
  variantId: string | undefined,
): number | null {
  if (!variantId) return produto.stock;
  const variacao = produto.variants?.find((v) => v.id === variantId);
  if (!variacao || variacao.active === false) return null;
  return variacao.stockIncrement;
}

function renovarItem(
  item: CartItem,
  catalogo: CatalogoLido,
  agora: number,
): CartItem | null {
  const id = item.product.id;
  if (!catalogo.consultados.has(id)) return item;

  const atual = catalogo.produtos.get(id);
  const disponivel = atual ? unidadesDisponiveis(atual, item.variantId) : null;
  if (!atual || disponivel === null || disponivel <= 0) return null;

  const quantity = Math.min(item.quantity, disponivel);
  const mesmoProduto = JSON.stringify(item.product) === JSON.stringify(atual);
  if (mesmoProduto && quantity === item.quantity) return item;

  return {
    ...item,
    product: mesmoProduto ? item.product : atual,
    quantity,
    // A quantidade só é carimbada de novo quando ELA mudou: trocar a cópia do
    // produto não é uma edição da cliente e não pode ganhar do carrinho de
    // outro aparelho na regra "quem escreveu por último vence".
    ...(quantity === item.quantity ? {} : { lastModifiedAt: agora }),
  };
}

/**
 * Aplica o catálogo atual ao carrinho:
 *   - o produto do item passa a ser o ATUAL (preço, estoque, nome, fotos), e a
 *     quantidade que a cliente escolheu é mantida;
 *   - quantidade acima do estoque desce ao que há;
 *   - item cujo produto sumiu, foi pausado ou esgotou SAI — só ele, nunca o
 *     carrinho inteiro;
 *   - item que não foi consultado fica como está.
 *
 * Nada mudou -> devolve o MESMO array (mesma referência): o React não
 * re-renderiza e o sync com o banco não dispara à toa.
 */
export function aplicarCatalogoAoCarrinho(
  itens: CartItem[],
  catalogo: CatalogoLido,
  agora: number = Date.now(),
): CartItem[] {
  let mudou = false;
  const resultado: CartItem[] = [];
  for (const item of itens) {
    const novo = renovarItem(item, catalogo, agora);
    if (novo !== item) mudou = true;
    if (novo) resultado.push(novo);
  }
  return mudou ? resultado : itens;
}

const comVariacao = (nome: string, variantNames?: string) =>
  variantNames ? `${nome} (${variantNames})` : nome;

/**
 * As frases para a cliente — em português de loja, sem jargão — do que mudou
 * entre o carrinho que ela VIA (`itens`) e o catálogo atual.
 *
 * Quem conta o que mudou é o `reconferirCarrinho` (a mesma conferência que a
 * mensagem do banco manda fazer: "Atualize o carrinho"). Ele olha UM preço e
 * UM estoque por produto, e o carrinho tem linhas com variação (preço e
 * estoque PRÓPRIOS da variação) — por isso cada linha é conferida sozinha,
 * com o preço e o estoque que valem para ELA. Nenhum aviso quando nada mudou.
 */
export async function avisosDoCarrinho(
  itens: readonly CartItem[],
  catalogo: CatalogoLido,
): Promise<string[]> {
  const frases: string[] = [];

  for (const item of itens) {
    const id = item.product.id;
    if (!catalogo.consultados.has(id)) continue;

    const atual = catalogo.produtos.get(id);
    const disponivel = atual
      ? unidadesDisponiveis(atual, item.variantId)
      : null;

    const variacaoAntes = item.variantId
      ? item.product.variants?.find((v) => v.id === item.variantId)
      : undefined;
    const variacaoAgora =
      atual && item.variantId
        ? atual.variants?.find((v) => v.id === item.variantId)
        : undefined;

    const { mudancas } = await reconferirCarrinho(
      [
        {
          ...item,
          product: {
            ...item.product,
            price: precoVendido(item.product, variacaoAntes),
          },
        },
      ],
      {
        lerProdutos: async () =>
          atual
            ? [
                {
                  id,
                  nome: atual.name,
                  preco: precoVendido(atual, variacaoAgora),
                  estoque: disponivel ?? 0,
                  ativo: disponivel !== null,
                },
              ]
            : [],
      },
    );

    const saiu = disponivel === null || disponivel <= 0;
    for (const m of mudancas) {
      const nome = `"${comVariacao(m.nome, item.variantNames)}"`;
      if (m.tipo === "sumiu") {
        frases.push(`${nome} não está mais à venda e saiu do seu carrinho.`);
      } else if (m.tipo === "estoque") {
        frases.push(
          (m.para ?? 0) <= 0
            ? `${nome} esgotou e saiu do seu carrinho.`
            : `Só restam ${m.para} unidade${m.para === 1 ? "" : "s"} de ${nome}. Ajustamos a quantidade no seu carrinho.`,
        );
      } else if (!saiu) {
        frases.push(
          `O preço de ${nome} mudou de ${formatCurrency(m.de ?? 0)} para ${formatCurrency(m.para ?? 0)}.`,
        );
      }
    }
  }

  return frases;
}
