import type { Category } from "@/types";

const comparavel = (nome: string) => nome.toLowerCase().trim();

/**
 * A categoria que a Home deve usar de fato. O endereço (`/?category=...`)
 * pode trazer um nome que a loja não tem — link velho, banner mal gravado —
 * e aí a vitrine ficava vazia e sem botão marcado. Nome que não está entre as
 * categorias ATIVAS cai em "Todas"; nome que existe volta com a grafia da
 * loja (o botão só marca com o nome idêntico).
 *
 * Não decide nada enquanto as categorias carregam, nem quando a lista veio
 * vazia (falha de rede): sem lista não há como saber que o nome é inválido.
 * Categoria sem produto NÃO é descartada: a lojista pode criar uma "em breve".
 */
export function categoriaValidaDaHome(
  selecionada: string,
  categorias: readonly Pick<Category, "name" | "isActive">[],
  carregando: boolean,
): string {
  if (!selecionada || selecionada === "Todas") return selecionada;
  if (carregando || categorias.length === 0) return selecionada;

  const achada = categorias.find(
    (c) => c.isActive && comparavel(c.name) === comparavel(selecionada),
  );
  return achada ? achada.name : "Todas";
}
