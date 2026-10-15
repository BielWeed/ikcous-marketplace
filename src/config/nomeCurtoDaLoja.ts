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
 * Conta caractere de verdade (não unidade UTF-16), para nunca partir emoji.
 */
export const LIMITE_DO_NOME_CURTO = 12;

const SEPARADOR = /\s*\|\s*|\s+[-–—]\s+/;
const LIGACAO_NO_FIM = new Set(["de", "da", "do", "das", "dos", "e", "&"]);

const tamanho = (texto: string): number => Array.from(texto).length;

export function nomeCurtoDaLoja(nome: string): string {
  const limpo = nome.trim().replaceAll(/\s+/g, " ");
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
    return Array.from(palavras[0]).slice(0, LIMITE_DO_NOME_CURTO).join("");
  }
  while (
    cabem.length > 1 &&
    LIGACAO_NO_FIM.has(cabem[cabem.length - 1].toLowerCase())
  ) {
    cabem.pop();
  }
  return cabem.join(" ");
}
