function duasLetras(nome: string): string {
  const palavras = nome.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letras =
    palavras.length > 1
      ? palavras.slice(0, 2).map((p) => [...p][0])
      : [...(palavras[0] ?? "")].slice(0, 2);
  return letras.join("").toUpperCase();
}

/**
 * Duas letras maiúsculas do nome da loja: "Savy" → "SA", "Savy Collection" → "SC".
 * Nome sem letra nem dígito ("★★") cai na 1ª letra da reserva (marca do build) e,
 * por último, num ponto neutro: o avatar nunca fica em branco.
 */
export function iniciaisDaLoja(nome: string, reserva = ""): string {
  return duasLetras(nome) || duasLetras(reserva).slice(0, 1) || "•";
}
