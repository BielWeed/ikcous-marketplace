/**
 * A inicial de um nome para avatar/crachá: corta por CARACTERE inteiro, não por
 * unidade de texto. `charAt(0)`/`substring(0, 2)` racham o emoji ao meio (um
 * emoji ocupa duas unidades) e o que sobra aparece como "�" — ou, passado a
 * `encodeURIComponent`, lança `URIError`.
 *
 * `reserva` é o que sai quando o nome está vazio (cada tela tem a sua: "CX",
 * "L", "?").
 */
export function primeiraLetra(
  nome: string | null | undefined,
  quantidade = 1,
  reserva = "",
): string {
  const letras = Array.from((nome ?? "").trim())
    .slice(0, quantidade)
    .join("")
    .toUpperCase();
  return letras || reserva;
}
