import { FICHA_DA_LOJA_ID } from "../config/fichaDaLojaContract";
import type { FichaDaLoja } from "../config/fichaDaLojaContract";

// LINE SEPARATOR (U+2028) e PARAGRAPH SEPARATOR (U+2029) — via
// String.fromCharCode em vez do caractere literal no código-fonte: os dois
// são invisíveis no editor e fáceis de corromper ao copiar/colar (e o eslint
// recusa caractere de espaço irregular no fonte).
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Serializa a ficha para viver dentro de um
 * `<script type="application/json" id="ikcous-loja">` no `<head>` do HTML
 * que o porteiro serve (etapa 2 da escala, 11/09/2026). Quem lê faz
 * `JSON.parse(el.textContent)` (`src/config/fichaDaLoja.ts`, T1) — NUNCA
 * `eval`, nunca `innerHTML` — e é essa promessa que decide os escapes:
 *
 * - `</` -> `<\/`: impede que um `</script>` dentro de um valor da ficha
 *   (ex.: nome da loja) feche a tag cedo e abra o resto como HTML solto.
 *   `\/` é um escape JSON válido (RFC 8259) e `JSON.parse` devolve `/`.
 * - `<!--` -> o `<` trocado pelo escape unicode do próprio `<`: impede
 *   que o texto contenha `<!--` cru (alguns navegadores tratam isso como
 *   início de comentário dentro de `<script>` legado). DIVERGE do que
 *   `src/config/fichaDaLojaContract.ts:16` descreve (`<\!--`, um backslash
 *   antes do `!`): `\!` NÃO é um escape JSON válido (RFC 8259) e
 *   `JSON.parse('"<\\!--"')` LANÇA `SyntaxError: Bad escaped character`
 *   (medido com `node`, 11/09/2026) — inviável para quem lê com
 *   `JSON.parse`. O escape unicode do `<` é válido em JSON, tem a MESMA
 *   propriedade de segurança (o caractere `<` nunca aparece cru antes de
 *   `!--` no texto produzido) e faz round-trip exato de volta para `<!--`.
 * - LINE SEPARATOR / PARAGRAPH SEPARATOR (U+2028/U+2029) -> os escapes
 *   unicode correspondentes: os mesmos dois pontos que quebram `eval`/JS
 *   de motores antigos quando o texto é tratado como código; aqui é
 *   defesa em profundidade, já que o consumo é sempre `JSON.parse`.
 */
export function serializarFichaParaDataBlock(ficha: FichaDaLoja): string {
  return JSON.stringify(ficha)
    .replaceAll("</", "<\\/")
    .replaceAll("<!--", "\\u003c!--")
    .replaceAll(LINE_SEPARATOR, "\\u2028")
    .replaceAll(PARAGRAPH_SEPARATOR, "\\u2029");
}

/** A tag completa, pronta para ser injetada logo depois de `<head>`. */
export function montarDataBlock(ficha: FichaDaLoja): string {
  return `<script type="application/json" id="${FICHA_DA_LOJA_ID}">${serializarFichaParaDataBlock(ficha)}</script>`;
}
