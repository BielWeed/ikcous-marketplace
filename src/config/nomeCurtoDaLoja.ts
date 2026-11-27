/**
 * O rótulo que fica EMBAIXO do ícone do app instalado no celular
 * (`short_name` do manifest e `apple-mobile-web-app-title` do iPhone).
 *
 * O celular corta esse rótulo perto dos 12 caracteres. Com o nome inteiro da
 * loja ("Savy Collection", 15), o ícone saía como "Savy Collec…", cortado no
 * meio da palavra. Esta função entrega a versão que cabe.
 *
 * Função PURA e sem imports de propósito: é usada no porteiro (Edge), no
 * build (`scripts/identityBuildConfig.ts`) e no HTML (`identidadeNoHtml.ts`),
 * e os três têm de chegar ao MESMO rótulo para a mesma loja.
 *
 * Regra, em ordem:
 *  1. Nome que já cabe em 12 caracteres fica como está.
 *  2. Senão, vale só a parte antes de um separador ` | ` / ` - ` / ` — `
 *     (mesma convenção do cabeçalho do app: "IKCOUS | Marketplace" → "IKCOUS").
 *  3. Senão, as primeiras palavras inteiras que cabem, sem deixar "de", "da",
 *     "e", "&"… pendurado no fim.
 *  4. Se nem a primeira palavra cabe, corta nela mesma em 12 caracteres.
 *
 * Conta o que a pessoa vê como UM caractere (grafema, via `Intl.Segmenter`):
 * emoji composto ("👩‍🍳" = 3 pontos de código) vale 1 e nunca é partido. O nome
 * vira NFC antes de contar, para "Ateliê Café" com acento separado (NFD) contar
 * e sair igual ao mesmo nome em NFC. Sem `Intl.Segmenter` no runtime, cai na
 * contagem por ponto de código (a de antes), que ainda não parte par substituto.
 */
export const LIMITE_DO_NOME_CURTO = 12;

const SEPARADOR = /\s*\|\s*|\s+[-–—]\s+/;
const LIGACAO_NO_FIM = new Set(["de", "da", "do", "das", "dos", "e", "&"]);

const SEGMENTADOR =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" })
    : null;

const grafemas = (texto: string): string[] =>
  SEGMENTADOR
    ? Array.from(SEGMENTADOR.segment(texto), (parte) => parte.segment)
    : Array.from(texto);

const tamanho = (texto: string): number => grafemas(texto).length;

export function nomeCurtoDaLoja(nome: string): string {
  const limpo = nome.normalize("NFC").trim().replaceAll(/\s+/g, " ");
  if (tamanho(limpo) <= LIMITE_DO_NOME_CURTO) return limpo;

  const base = limpo.split(SEPARADOR).find((parte) => parte.trim() !== "");
  const inicio = (base ?? limpo).trim();
  if (tamanho(inicio) <= LIMITE_DO_NOME_CURTO) return inicio;

  const palavras = inicio.split(" ");
  const cabem: string[] = [];
  for (const palavra of palavras) {
    const tentativa = [...cabem, palavra].join(" ");
    if (tamanho(tentativa) > LIMITE_DO_NOME_CURTO) break;
    cabem.push(palavra);
  }
  if (cabem.length === 0) {
    return grafemas(palavras[0]).slice(0, LIMITE_DO_NOME_CURTO).join("");
  }
  while (
    cabem.length > 1 &&
    LIGACAO_NO_FIM.has(cabem[cabem.length - 1].toLowerCase())
  ) {
    cabem.pop();
  }
  return cabem.join(" ");
}
