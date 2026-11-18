/** Ordem de exibição em português; não decide igualdade de categorias. */
export const compararNomes = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
}).compare;
