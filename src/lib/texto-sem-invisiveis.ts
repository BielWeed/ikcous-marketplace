const SEM_LARGURA = ["\u{200b}", "\u{200c}", "\u{2060}", "\u{feff}"];
const JOINER = "\u{200d}";
const VARIANTE_EMOJI = "\u{fe0f}";
const PICTOGRAFICO = /\p{Extended_Pictographic}/u;
const MODIFICADOR_DE_TOM = /\p{Emoji_Modifier}/u;

function removerJoinersSoltos(texto: string): string {
  if (!texto.includes(JOINER)) return texto;
  // O spread separa por ponto de código sem partir os pares dos emojis.
  return [...texto]
    .filter((caractere, i, caracteres) => {
      if (caractere !== JOINER) return true;
      const anterior = caracteres[i - 1] ?? "";
      const base =
        anterior === VARIANTE_EMOJI || MODIFICADOR_DE_TOM.test(anterior)
          ? caracteres[i - 2]
          : anterior;
      return (
        PICTOGRAFICO.test(base ?? "") &&
        PICTOGRAFICO.test(caracteres[i + 1] ?? "")
      );
    })
    .join("");
}

export function semInvisiveis(texto: string): string {
  let limpo = removerJoinersSoltos(texto);
  for (const caractere of SEM_LARGURA) {
    limpo = limpo.replaceAll(caractere, "");
  }
  return limpo
    .replaceAll("\u{00a0}", " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/^ | $/g, "");
}
