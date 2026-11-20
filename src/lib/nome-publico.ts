const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Espelha public.nome_publico_de(text), inclusive para cópias antigas da vitrine. */
export function nomePublicoDe(nome: string | null | undefined): string {
  const palavras = nome?.trim().split(/\s+/) ?? [];
  const primeiro = palavras[0];
  if (!primeiro) return "Cliente";

  for (let i = palavras.length - 1; i > 0; i--) {
    const palavra = palavras[i];
    if (PARTICULAS.has(palavra.toLowerCase())) continue;
    const [letra] = palavra.normalize("NFC");
    const [inicial] = letra.toUpperCase();
    return `${primeiro} ${inicial}.`;
  }
  return primeiro;
}
