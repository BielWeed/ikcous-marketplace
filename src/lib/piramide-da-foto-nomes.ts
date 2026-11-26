// Os NOMES da pirâmide de cópias da foto (plano das miniaturas, 26/11/2026).
//
// A loja em projeto Supabase gratuito não tem a transformação de imagem
// (`imageUrl.ts`): o card de 168 px baixava a foto inteira. A foto nova de
// produto e de banner passa a subir com 3 cópias reduzidas (maior lado 240,
// 480 e 960 px), geradas no navegador da lojista (`gerar-piramide.ts`, só no
// painel), e a ORIGINAL é gravada POR ÚLTIMO com um nome MARCADO:
//
//   <base>-vw.<ext>   cópias em WebP      <base>-240.webp, -480.webp, -960.webp
//   <base>-vj.<ext>   cópias em JPEG      <base>-240.jpg,  -480.jpg,  -960.jpg
//                     (navegador que não grava WebP: Safari antigo)
//
// A marca é a PROVA de que as 3 cópias existem (é o registro de commit escrito
// por último): falhou uma cópia, a original sobe sem marca, como hoje. Por
// isso quem LÊ a marca falha FECHADO: qualquer nome que o envio não gera
// exatamente assim (sem marca, `backup/`, a cópia antiga `_copia_` no lugar da
// extensão, consulta `?`, fragmento `#`, outro host, outro bucket) vale como
// foto sem marca -- o original, comportamento de hoje.
//
// Separador é `-`, nunca `~` (o til vira `%7E` em parte dos clientes e o nome
// deixaria de bater com ele mesmo).
//
// PURO e sem import nenhum: `imageUrl.ts` o importa por caminho relativo, e
// o porteiro (borda) importa `imageUrl.ts`.

/** Maior lado de cada cópia, em pixels de imagem, do menor para o maior. */
export const LADOS = [240, 480, 960] as const;
export type LadoDaCopia = (typeof LADOS)[number];

/** `w` = cópias WebP; `j` = cópias JPEG. */
export type MarcaDaPiramide = "w" | "j";

/** Uma cópia pronta para subir (só o navegador do painel as cria). */
export interface CopiaDaPiramide {
  readonly lado: LadoDaCopia;
  readonly arquivo: Blob;
}

/** As 3 cópias, na ordem de `LADOS`, todas no formato da marca. */
export interface Piramide {
  readonly marca: MarcaDaPiramide;
  readonly copias: readonly CopiaDaPiramide[];
}

/** O gerador que a tela do painel entrega ao envio (`gerar-piramide.ts`). */
export type GerarPiramide = (arquivo: File) => Promise<Piramide | null>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Produto: `<uuid>` (useProducts.uploadProductImages), e a cópia de
// duplicação que preserva a marca: `<uuid>_copia_<uuid>` (quantas vezes for).
const BASE_DO_PRODUTO = `${UUID}(?:_copia_${UUID})*`;
// Banner: `<Date.now()>-<Math.random() em base 36>` (useBanners.uploadBannerImage).
const BASE_DO_BANNER = "[0-9]{10,}-[0-9a-z]+";
const EXTENSAO = "[A-Za-z0-9]{2,5}";
const NOME_MARCADO = new RegExp(
  `^(${BASE_DO_PRODUTO}|${BASE_DO_BANNER})-v([wj])\\.(${EXTENSAO})$`,
);
const SO_EXTENSAO = new RegExp(`^${EXTENSAO}$`);

const CAMINHO_PUBLICO = "/storage/v1/object/public/";
const BUCKETS_COM_PIRAMIDE = new Set(["products", "banners"]);
const HOST_DO_SUPABASE = /^[a-z0-9-]+\.supabase\.co$/;

/** Extensão que, posta no nome marcado, o leitor da marca reconhece. */
export function extensaoMarcavel(ext: string): boolean {
  return SO_EXTENSAO.test(ext);
}

/** Nome da ORIGINAL marcada: `<base>-v<marca>.<ext>`. */
export function nomeMarcado(
  base: string,
  marca: MarcaDaPiramide,
  ext: string,
): string {
  return `${base}-v${marca}.${ext}`;
}

/** Nome de uma cópia: `<base>-<lado>.webp` ou `.jpg`, conforme a marca. */
export function nomeDaCopia(
  base: string,
  lado: LadoDaCopia,
  marca: MarcaDaPiramide,
): string {
  return `${base}-${lado}.${marca === "w" ? "webp" : "jpg"}`;
}

/** Lê a marca de um NOME de arquivo (sem pasta). `null` = sem marca. */
export function marcaDoNome(
  nome: string,
): { base: string; marca: MarcaDaPiramide; ext: string } | null {
  const partes = NOME_MARCADO.exec(nome);
  if (!partes) return null;
  return {
    base: partes[1],
    marca: partes[2] as MarcaDaPiramide,
    ext: partes[3],
  };
}

/** Os nomes das 3 cópias de um nome marcado, na ordem de `LADOS`. */
export function nomesDasCopias(nome: string): string[] | null {
  const lido = marcaDoNome(nome);
  if (!lido) return null;
  return LADOS.map((lado) => nomeDaCopia(lido.base, lado, lido.marca));
}

/**
 * A URL pública de uma foto marcada, partida em pasta (tudo até o bucket,
 * inclusive) e nome -- ou `null` se houver QUALQUER dúvida.
 */
function lerUrlMarcada(
  url: string | null | undefined,
): { pasta: string; nome: string; marca: MarcaDaPiramide } | null {
  if (typeof url !== "string" || url === "") return null;
  if (url.includes("?") || url.includes("#")) return null;
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return null;
  }
  if (alvo.protocol !== "https:" || !HOST_DO_SUPABASE.test(alvo.hostname))
    return null;
  if (alvo.port !== "" || alvo.username !== "" || alvo.password !== "")
    return null;
  // A string tem de ser exatamente o que o navegador vai pedir: `..`,
  // caixa do host, barra dupla -- qualquer reescrita e não é nossa.
  if (alvo.href !== url) return null;
  if (!alvo.pathname.startsWith(CAMINHO_PUBLICO)) return null;
  const resto = alvo.pathname.slice(CAMINHO_PUBLICO.length).split("/");
  if (resto.length !== 2) return null;
  const [bucket, nome] = resto;
  if (!BUCKETS_COM_PIRAMIDE.has(bucket)) return null;
  const lido = marcaDoNome(nome);
  if (!lido) return null;
  return {
    pasta: `${alvo.origin}${CAMINHO_PUBLICO}${bucket}/`,
    nome,
    marca: lido.marca,
  };
}

/** A marca da URL pública da foto, ou `null` (foto sem marca: o original). */
export function marcaDe(
  url: string | null | undefined,
): MarcaDaPiramide | null {
  return lerUrlMarcada(url)?.marca ?? null;
}

/** As URLs das 3 cópias de uma foto marcada, com o lado de cada uma, na
 * ordem de `LADOS` -- ou `null` (foto sem marca). */
export function copiasDe(
  url: string | null | undefined,
): { lado: LadoDaCopia; url: string }[] | null {
  const lida = lerUrlMarcada(url);
  if (!lida) return null;
  const base = marcaDoNome(lida.nome)?.base ?? "";
  return LADOS.map((lado) => ({
    lado,
    url: `${lida.pasta}${nomeDaCopia(base, lado, lida.marca)}`,
  }));
}

/** As URLs das 3 cópias de uma foto marcada, na ordem de `LADOS`, ou `null`. */
export function variantesDe(url: string | null | undefined): string[] | null {
  return copiasDe(url)?.map((copia) => copia.url) ?? null;
}
