/**
 * Redimensionamento de imagens do Supabase Storage.
 *
 * O app servia todas as imagens no tamanho original: o card de produto baixava
 * 1200x1200 para exibir em 168px, e um banner chegava a 1340 kB de PNG para
 * ocupar 375x200 na tela. Medido no bucket real, com o Accept do navegador:
 *
 *   card de produto   116 kB  ->  20 kB  (width=340, webp)
 *   banner            1340 kB ->  27 kB  (width=750, webp)
 *
 * O endpoint `/render/image/public/` negocia o formato pelo Accept do cliente,
 * então navegador moderno recebe WebP e o antigo recebe JPEG, sem esforço extra.
 */

const CAMINHO_ORIGINAL = "/storage/v1/object/public/";
const CAMINHO_TRANSFORMADO = "/storage/v1/render/image/public/";

export interface OpcoesImagem {
  /** Largura desejada em pixels de imagem (não em CSS pixels). */
  readonly width: number;
  /** 20–100. Padrão 75, que já é indistinguível do original nestes tamanhos. */
  readonly quality?: number;
}

/** true para URLs de arquivo público do Supabase Storage, que é o que dá para transformar. */
function ehImagemSupabase(url: string): boolean {
  return typeof url === "string" && url.includes(CAMINHO_ORIGINAL);
}

/**
 * Devolve a URL redimensionada. Qualquer coisa que não seja imagem pública do
 * Supabase (URL externa, data:, string vazia) volta intacta — assim dá para usar
 * em qualquer `src` sem precisar checar antes.
 */
export function imagemRedimensionada(
  url: string | undefined | null,
  { width, quality = 75 }: OpcoesImagem,
): string {
  if (!url || !ehImagemSupabase(url)) return url || "";
  const [base] = url.split("?");
  // `resize=contain` é obrigatório: passando só `width`, o Supabase mantém a
  // ALTURA original e distorce a imagem (medido: width=200 devolvia 200x768 de
  // um original 1376x768). Com contain, a altura acompanha e a proporção fica
  // intacta (960x536 para o mesmo original).
  return `${base.replace(CAMINHO_ORIGINAL, CAMINHO_TRANSFORMADO)}?width=${Math.round(width)}&resize=contain&quality=${quality}`;
}

/**
 * Monta o `srcSet` para o navegador escolher a densidade certa.
 * Em URL não transformável devolve string vazia — `srcSet=""` é ignorado com
 * segurança e o `src` continua valendo.
 */
export function conjuntoDeImagens(
  url: string | undefined | null,
  larguras: readonly number[],
  quality = 75,
): string {
  if (!url || !ehImagemSupabase(url)) return "";
  return larguras
    .map((w) => `${imagemRedimensionada(url, { width: w, quality })} ${w}w`)
    .join(", ");
}
