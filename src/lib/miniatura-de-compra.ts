import { imagemRedimensionada } from "@/lib/imageUrl";

/**
 * Foto pequena das telas de compra (carrinho, pedidos, sugestões de frete).
 * Fonte ÚNICA: as telas a desenham e o aquecedor (`useCacheWarmer`) a aquece,
 * então a string tem de ser a mesma nos dois.
 */
export const miniaturaDeCompra = (url: string | undefined | null) =>
  imagemRedimensionada(url, { width: 160, quality: 70 });
