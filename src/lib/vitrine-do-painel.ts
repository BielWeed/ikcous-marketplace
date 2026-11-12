import { soFotosReais } from "@/lib/foto-do-produto";
import { pluralizar } from "@/lib/pluralizar";
import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import { ordenarParaVitrine, produtoDisponivel } from "@/lib/vitrine";
import type { Product } from "@/types";

/**
 * As regras de "o que a loja mostra" nas faixas AUTOMÁTICAS: a HomeView
 * (newArrivals, offerProducts, bestsellerProducts) e a prévia do painel de
 * Vitrines chamam estas MESMAS funções. Produto pausado nunca aparece.
 *
 * Faixa automática só mostra o que a cliente consegue COMPRAR e que tem foto
 * de verdade: `produtoDisponivel` (a mesma regra do selo "Esgotado") e
 * `soFotosReais` (a imagem cinza "Sem Imagem" que o mapper inventa não conta).
 * Quem fica de fora continua no Catálogo e na busca, e uma faixa escolhida à
 * mão pela lojista NÃO passa por aqui: mostra o que ela escolheu. Um produto
 * pode estar em mais de uma faixa (lançamento em oferta e destaque aparece nas
 * três): cada faixa decide sozinha.
 *
 * "oferta" é o preço de vitrine abaixo do "De". A ordem dentro da faixa é a de
 * `ordenarParaVitrine` (mais novo primeiro, id no empate) e NÃO a ordem de
 * chegada da lista, que muda com o cache e a sincronização.
 */
type ParaVitrine = Pick<
  Product,
  | "id"
  | "isActive"
  | "isBestseller"
  | "stock"
  | "price"
  | "originalPrice"
  | "variants"
> &
  Pick<Partial<Product>, "createdTime" | "images">;

export function produtosAVenda<T extends Pick<Product, "isActive">>(
  produtos: readonly T[],
): T[] {
  return produtos.filter((p) => p.isActive);
}

export type FaixaAutomatica = "lancamentos" | "ofertas" | "destaques";

/** Quantos produtos da faixa ficaram de fora, por motivo. */
export interface ForaDaFaixa {
  esgotados: number;
  semFoto: number;
}

type ParaFaixa = Pick<Product, "stock" | "variants"> &
  Pick<Partial<Product>, "images">;

/**
 * Por que o produto não entra numa faixa automática, ou `null` se entra.
 * Esgotado vem ANTES de sem foto: o produto que é os dois conta uma vez só.
 */
function motivoDeFicarFora(produto: ParaFaixa): keyof ForaDaFaixa | null {
  if (!produtoDisponivel(produto)) return "esgotados";
  if (soFotosReais(produto.images).length === 0) return "semFoto";
  return null;
}

/** Quem a faixa considera antes de olhar estoque e foto (só ativos já entram). */
function candidatosDaFaixa<T extends ParaVitrine>(
  faixa: FaixaAutomatica,
  aVenda: readonly T[],
): T[] {
  if (faixa === "ofertas") {
    return aVenda.filter((p) => precoDeVitrine(p).precoOriginal !== null);
  }
  if (faixa === "destaques") return aVenda.filter((p) => p.isBestseller);
  return [...aVenda];
}

function daFaixa<T extends ParaVitrine>(
  faixa: FaixaAutomatica,
  aVenda: readonly T[],
): T[] {
  return ordenarParaVitrine(
    candidatosDaFaixa(faixa, aVenda).filter(
      (p) => motivoDeFicarFora(p) === null,
    ),
  );
}

/**
 * Últimos Lançamentos (e vitrine personalizada sem produtos escolhidos):
 * recebe os produtos À VENDA (ver `produtosAVenda`).
 */
export function lancamentosDaVitrine<T extends ParaVitrine>(
  aVenda: readonly T[],
): T[] {
  return daFaixa("lancamentos", aVenda);
}

/** Ofertas: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function ofertasDaVitrine<T extends ParaVitrine>(
  aVenda: readonly T[],
): T[] {
  return daFaixa("ofertas", aVenda);
}

/** Destaques em Alta: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function destaquesDaVitrine<T extends ParaVitrine>(
  aVenda: readonly T[],
): T[] {
  return daFaixa("destaques", aVenda);
}

/**
 * Quantos candidatos da faixa a loja deixou de fora, para a prévia do painel
 * avisar a lojista (sem isto o destaque que esgota some e ela acha que o app
 * quebrou). Recebe os produtos À VENDA, como as funções acima.
 */
export function foraDaFaixaAutomatica<T extends ParaVitrine>(
  faixa: FaixaAutomatica,
  aVenda: readonly T[],
): ForaDaFaixa {
  let esgotados = 0;
  let semFoto = 0;
  for (const produto of candidatosDaFaixa(faixa, aVenda)) {
    const motivo = motivoDeFicarFora(produto);
    if (motivo === "esgotados") esgotados += 1;
    else if (motivo === "semFoto") semFoto += 1;
  }
  return { esgotados, semFoto };
}

/** "Ficaram de fora desta faixa: 2 esgotados, 1 sem foto", ou `null` sem exclusões. */
export function fraseDoQueFicouFora(fora: ForaDaFaixa): string | null {
  const partes: string[] = [];
  if (fora.esgotados > 0) {
    partes.push(pluralizar(fora.esgotados, "esgotado", "esgotados"));
  }
  if (fora.semFoto > 0) partes.push(`${fora.semFoto} sem foto`);
  if (partes.length === 0) return null;
  const total = fora.esgotados + fora.semFoto;
  const verbo = total === 1 ? "Ficou" : "Ficaram";
  return `${verbo} de fora desta faixa: ${partes.join(", ")}`;
}
