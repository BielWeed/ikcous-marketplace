// A foto "Sem Imagem" que a camada de EXIBIÇÃO inventa quando o produto não
// tem foto (`mapProductFromDB`, em `mappers.ts`) NÃO é foto do produto.
//
// O defeito que isto fecha: o formulário abria um produto sem foto com esse
// marcador já dentro da lista de fotos. A foto de verdade entrava DEPOIS dele
// ("fica por último"), o salvar gravava as duas, e a vitrine, que mostra
// `images[0]`, ficava com o cartão cinza "Sem Imagem" para sempre. O marcador
// ainda contava no limite de 10 fotos e vive no site de um terceiro.
//
// O formulário, portanto, só lida com fotos reais: tira o marcador ao abrir (do
// produto, do rascunho) e nunca o grava. A substituição por marcador segue só
// na exibição — produto sem foto continua chegando à vitrine com a imagem
// "Sem Imagem" porque o mapper a devolve, não porque o banco a guarda.

/** Hospedagem do marcador: nenhuma foto de produto vive aqui. */
const HOSPEDAGEM_DO_MARCADOR = "placehold.co";

/** A URL é de marcador de imagem (não é foto que a lojista enviou)? */
export function ehMarcadorDeFoto(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    // A base só existe para o endereço sem protocolo (`//placehold.co/...`)
    // ser lido como endereço; caminho relativo cai na base e não casa.
    const { hostname } = new URL(url.trim(), "https://x.invalid");
    return hostname.toLowerCase() === HOSPEDAGEM_DO_MARCADOR;
  } catch {
    return false;
  }
}

/** A lista só com fotos de verdade (marcadores e entradas vazias saem). */
export function soFotosReais(urls: readonly unknown[] | null | undefined) {
  if (!Array.isArray(urls)) return [] as string[];
  return urls.filter(
    (url): url is string =>
      typeof url === "string" && url.trim() !== "" && !ehMarcadorDeFoto(url),
  );
}
