/** Duas letras maiúsculas do nome da loja: "Savy" → "SA", "Savy Collection" → "SC". */
export function iniciaisDaLoja(nome: string): string {
  const palavras = nome.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letras =
    palavras.length > 1
      ? palavras.slice(0, 2).map((p) => [...p][0])
      : [...(palavras[0] ?? "")].slice(0, 2);
  return letras.join("").toUpperCase();
}
