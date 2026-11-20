// Mantém ZWNJ (U+200C) e ZWJ (U+200D), usados na escrita e em emojis.
const CONTROLES =
  /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

export function textoSemControlesDeDirecao(texto: string): string {
  return texto.replace(CONTROLES, "");
}
