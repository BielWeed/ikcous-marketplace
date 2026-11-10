import type { Category, Product } from "@/types";

const comparavel = (nome: string) => nome.toLowerCase().trim();

/**
 * A categoria que o filtro da busca deve usar de fato. A lojista pode ter
 * renomeado a categoria (ou escondido) depois de a cliente escolhê-la: o filtro
 * guardado deixava a lista vazia sem a cliente ver por quê. Categoria que a
 * loja não tem mais cai em "Todas".
 *
 * Não decide enquanto o catálogo carrega nem com a lista de produtos vazia
 * (falha de rede): sem lista não há como saber que o nome é inválido.
 * Vale o que a loja tem: a categoria da lista (ativa; a escondida não vale,
 * porque some das opções) ou, se a lista não a conhece, a de algum produto à
 * venda — as opções da busca saem dos produtos, então ela continua escolhível.
 */
export function categoriaValidaDaBusca(
  selecionada: string,
  produtos: readonly Pick<Product, "category">[],
  carregando = false,
  categorias?: readonly Pick<Category, "name" | "isActive">[],
): string {
  if (selecionada === "Todas" || carregando || produtos.length === 0) {
    return selecionada;
  }
  const alvo = comparavel(selecionada);
  const daLista = categorias?.find((c) => comparavel(c.name) === alvo);
  if (daLista) return daLista.isActive ? selecionada : "Todas";
  return produtos.some((p) => comparavel(p.category) === alvo)
    ? selecionada
    : "Todas";
}
