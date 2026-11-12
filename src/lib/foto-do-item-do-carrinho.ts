import type { CartItem } from "@/types";
import { criarEixosDaVariacao, eixoEhCor } from "@/utils/eixos-da-variacao";

/**
 * Qual foto uma linha do carrinho mostra: a da cor/variação que a cliente
 * escolheu, quando ela tem foto própria; senão a da mesma cor em outro tamanho
 * (como a página do produto); senão a primeira do produto.
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
  const ids = [item.variantId, ...(item.outrasVariantIds ?? [])];
  const temFoto = (url?: string) => !!url && url.trim() !== "";
  for (const id of ids) {
    if (!id) continue;
    const foto = variacoes.find((v) => v.id === id)?.imageUrl;
    if (temFoto(foto)) return foto;
  }
  // Sem foto própria: a foto da cor costuma estar numa linha só da grade.
  const { grupos } = criarEixosDaVariacao(variacoes);
  for (const id of ids) {
    for (const g of grupos) {
      const escolhida = g.linhas.find((l) => l.variante.id === id);
      const foto = g.linhas.find(
        (l) =>
          temFoto(l.variante.imageUrl) &&
          g.eixos
            .filter(eixoEhCor)
            .some((e) => l.valores[e.indice] === escolhida?.valores[e.indice]),
      )?.variante.imageUrl;
      if (escolhida && foto) return foto;
    }
  }
  return item.product.images?.[0];
}
