const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Espelha public.nome_publico_de(text), inclusive para cópias antigas da vitrine. */
export function nomePublicoDe(nome: string | null | undefined): string {
  const [primeiro, ...sobrenomes] = nome?.trim().split(/\s+/) ?? [];
  if (!primeiro) return "Cliente";

  for (const palavra of sobrenomes.reverse()) {
    if (PARTICULAS.has(palavra.toLowerCase())) continue;
    const [letra] = palavra.normalize("NFC");
    const [inicial] = letra.toUpperCase();
    return `${primeiro} ${inicial}.`;
  }
  return primeiro;
}
