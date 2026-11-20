const SEM_LARGURA = [
  "\u{200b}",
  "\u{200c}",
  "\u{200d}",
  "\u{2060}",
  "\u{feff}",
];

export function semInvisiveis(texto: string): string {
  let limpo = texto;
  for (const caractere of SEM_LARGURA) {
    limpo = limpo.replaceAll(caractere, "");
  }
  return limpo.replaceAll("\u{00a0}", " ").trim().replace(/\s+/g, " ");
}
