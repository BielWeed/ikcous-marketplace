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

export type TipoDoAtributo =
  | "Cor"
  | "Tamanho"
  | "Voltagem"
  | "Capacidade"
  | "Material"
  | "Outro";

/** Minúscula, sem acento e sem as pontas: "Lilás " e "lilas" são a mesma coisa. */
export const dobrar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** O tipo que o nome gravado representa. Vazio = nenhum marcado. O painel
 *  (peças do seletor) e a loja (ordem das fileiras) leem o nome igual. */
export function tipoDoNome(nome: string): TipoDoAtributo | null {
  const chave = dobrar(nome);
  if (chave === "") return null;
  if (chave === "cor") return "Cor";
  if (chave === "tamanho") return "Tamanho";
  if (chave === "voltagem") return "Voltagem";
  // Os nomes que o lojista já grava para a mesma coisa ("Memória" no celular).
  if (/^(capacidade|armazenamento|memoria)$/.test(chave)) return "Capacidade";
  if (chave === "material") return "Material";
  return "Outro";
}
