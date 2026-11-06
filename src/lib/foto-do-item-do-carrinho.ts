import type { CartItem } from "@/types";

/**
 * Qual foto uma linha do carrinho mostra: a da cor/variação que a cliente
 * escolheu, quando ela tem foto própria; senão a primeira do produto.
 *
 * Antes o carrinho e o resumo do pedido liam sempre `product.images[0]`, e duas
 * linhas do mesmo produto em cores diferentes mostravam a MESMA foto (a página
 * do produto e o card já mostram a foto da cor). Só diz QUAL endereço usar: o
 * tamanho da miniatura e o plano B quando a foto falha continuam nas telas.
 *
 * Linha com duas escolhas (cadastro antigo, `outrasVariantIds`): vale a
 * primeira, na ordem da linha (`variantId` primeiro), que tenha foto.
 * Variação que sumiu do produto, foto vazia ou produto sem variações: a foto
 * do produto, como era. Sem foto nenhuma devolve `undefined`.
 */
export function fotoDoItemDoCarrinho(item: CartItem): string | undefined {
  const variacoes = item.product.variants ?? [];
  for (const id of [item.variantId, ...(item.outrasVariantIds ?? [])]) {
    if (!id) continue;
    const foto = variacoes.find((v) => v.id === id)?.imageUrl;
    if (foto && foto.trim() !== "") return foto;
  }
  return item.product.images?.[0];
}
