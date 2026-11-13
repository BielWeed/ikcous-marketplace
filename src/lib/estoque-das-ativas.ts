import type { Product } from "@/types";

// Espelha `mapProductFromDB`: com ao menos uma variação ATIVA o estoque do
// produto é a soma das ativas; sem nenhuma ativa o produto vende pelo estoque
// de base (é assim que o servidor vende), nunca por uma soma que daria 0.
//
// Módulo próprio, fora do motor de sincronização, pelo mesmo motivo do
// `geracao-do-cofre.ts`: o `StoreContext` precisa da regra sem depender do que
// o motor exporta (testes substituem o motor inteiro).
export function estoqueDasAtivas(
  variants: NonNullable<Product["variants"]>,
  estoqueDeBase: number,
): number {
  if (!variants.some((v) => v.active)) return estoqueDeBase;
  return variants.reduce(
    (acc, v) => acc + (v.active ? Number(v.stockIncrement) || 0 : 0),
    0,
  );
}
