// O link do banner do lado do PAINEL: o que a dona digita e o que o painel grava.
//
// Mora num arquivo à parte de `destino-do-banner.ts` de propósito: aquele é
// importado pela vitrine (BannerCarousel) e tudo que ele exporta e o painel usa
// vai junto no pacote da loja. Aqui fica só o que a vitrine nunca chama; quem
// importa este arquivo é o painel (AdminBannersView). A regra de caminho e
// http/https continua UMA só, em `destino-do-banner.ts`.
import { caminhoOuHttp, comoONavegadorLe } from "@/lib/destino-do-banner";

/** Link de categoria com o nome codificado (&, +, # e espaço seguros). */
export function linkDaCategoria(nome: string): string {
  return `/?category=${encodeURIComponent(nome)}`;
}

// `wa.me`, `www.loja.com.br`, `loja.com:8080`: ao menos dois trechos separados
// por ponto, o último só com letras (a terminação), porta opcional. Sem regex
// aninhada de propósito (backtracking caro, e o eslint a recusa).
function pareceEnderecoDeSite(trecho: string): boolean {
  const [host, porta, ...sobra] = trecho.split(":");
  if (sobra.length > 0) return false;
  if (porta !== undefined && !/^\d{1,5}$/.test(porta)) return false;
  const partes = host.split(".");
  if (partes.length < 2) return false;
  const terminacao = partes[partes.length - 1];
  return (
    /^[a-z]{2,}$/i.test(terminacao) &&
    partes.every((parte) => /^[a-z0-9-]+$/i.test(parte))
  );
}

/** O que a dona vê quando o link do banner é recusado ao salvar. */
export const AVISO_DE_LINK_RECUSADO =
  "Use um endereço que comece com https:// ou um caminho do app como /categoria";

/**
 * O que o painel grava quando a dona digita o link: a MESMA regra de caminho
 * ou http/https da loja (sem barra no começo, ganha uma) — sem os esquemas
 * `tel:`/`mailto:`…, que o painel não grava (decisão de produto do dono; a
 * loja só os preserva em banner já gravado). `""` quando ela deixou o campo
 * vazio; `null` quando o link deve ser recusado (mostrar
 * `AVISO_DE_LINK_RECUSADO`).
 *
 * Endereço de site digitado sem esquema (`wa.me/55...`, `instagram.com/loja`,
 * `www.loja.com`: sem espaço, começa por um domínio) ganha `https://` — antes
 * disso ele virava `/wa.me/55...`, uma página que a loja não tem. Esquema
 * perigoso nunca é endereço de site: segue para a regra acima e é recusado.
 */
export function linkDoBannerParaSalvar(digitado: string | null | undefined) {
  const lido = comoONavegadorLe((digitado ?? "").trim());
  if (lido === "") return "";
  if (
    !lido.startsWith("/") &&
    !/\s/.test(lido) &&
    pareceEnderecoDeSite(lido.split(/[/?#]/, 1)[0])
  ) {
    return `https://${lido}`;
  }
  return caminhoOuHttp(lido);
}

/** Aviso ao vivo no campo do painel: `null` quando o link pode ser salvo. */
export function avisoDoLinkDigitado(digitado: string): string | null {
  return linkDoBannerParaSalvar(digitado) === null
    ? AVISO_DE_LINK_RECUSADO
    : null;
}
