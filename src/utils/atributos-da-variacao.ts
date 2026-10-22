import type { ParDeAtributo } from "./variante-composta";

// Leitura compartilhada com a loja, sem importar o cadastro inteiro do painel.
export const SEPARADOR_DE_ATRIBUTOS = " / ";
export const MAX_ATRIBUTOS_DA_GRADE = 3;

export function dividirEmAtributos(
  name: string,
  value: string,
): ParDeAtributo[] {
  const nomes = name.split(SEPARADOR_DE_ATRIBUTOS);
  const valores = value.split(SEPARADOR_DE_ATRIBUTOS);
  if (nomes.length === valores.length) {
    return nomes.map((nome, i) => ({ name: nome, value: valores.at(i) ?? "" }));
  }
  return [{ name, value }];
}
