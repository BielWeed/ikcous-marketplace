export type PapelDeTabela =
  | "table"
  | "rowgroup"
  | "row"
  | "columnheader"
  | "cell";

// J5 / J2-D: com `display: block` (o bloco do celular) o navegador apaga o
// papel de tabela do leitor de tela, então os papéis voltam por atributo
// explícito. O espalhamento (`{...papel("row")}`) é de propósito: escrito como
// `role="row"` no JSX, as regras de a11y do eslint e do biome chamam de
// "redundante" o que aqui é a única forma de manter a semântica.
export function papel(role: PapelDeTabela): { role: PapelDeTabela } {
  return { role };
}
