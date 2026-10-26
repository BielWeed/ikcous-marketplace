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

export type TipoDoAtributo = "Cor" | "Tamanho" | "Voltagem" | "Outro";

/** Minúscula, sem acento e sem as pontas: "Lilás " e "lilas" são a mesma coisa. */
export const dobrar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** O tipo que o nome gravado representa. Vazio = nenhum marcado. O painel
 *  (peças do seletor) e a loja (ordem das fileiras) leem o nome igual. */
/** Quem escolhe o tamanho vê as cores que existem nele: Tamanho (e Voltagem)
 *  vêm antes, a Cor depois e qualquer outro atributo por último. A ordem em que
 *  o produto foi gravado ("Cor / Tamanho") não decide nada na tela do cliente;
 *  entre iguais vale a gravação (o sort do JS é estável). A página do produto e
 *  o card da vitrine usam esta MESMA régua. */
export function posicaoDoAtributo(nome: string): number {
  const tipo = tipoDoNome(nome);
  if (tipo === "Tamanho" || tipo === "Voltagem") return 0;
  if (tipo === "Cor" || /^(cores|color)$/.test(dobrar(nome))) return 1;
  return 2;
}

export function tipoDoNome(nome: string): TipoDoAtributo | null {
  const chave = dobrar(nome);
  if (chave === "") return null;
  if (chave === "cor") return "Cor";
  if (chave === "tamanho") return "Tamanho";
  if (chave === "voltagem") return "Voltagem";
  return "Outro";
}
