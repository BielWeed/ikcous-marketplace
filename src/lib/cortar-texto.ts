/**
 * Corta `texto` para caber em `max` unidades de texto do JavaScript (as mesmas
 * que o `maxLength` do campo conta), sem partir uma letra ao meio.
 *
 * `texto.slice(0, max)` corta em unidades UTF-16: o corte podia cair no meio de
 * uma palavra e no meio de um emoji (metade de um par substituto vira "�" na
 * vitrine). Aqui o corte anda de letra inteira em letra inteira (emoji com
 * modificador conta como uma letra só), volta até o último espaço quando há
 * um, e termina com "…" para avisar que o texto foi cortado.
 *
 * Texto que já cabe volta igual, sem reticências.
 */
export function cortarTexto(texto: string, max: number): string {
  if (texto.length <= max) return texto;

  const letras =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(
          new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(
            texto,
          ),
          (parte) => parte.segment,
        )
      : Array.from(texto);

  // Uma unidade fica reservada para o "…".
  const limite = Math.max(max - 1, 0);
  let usadas = 0;
  let quantas = 0;
  for (const letra of letras) {
    if (usadas + letra.length > limite) break;
    usadas += letra.length;
    quantas += 1;
  }

  // Se o corte cai no meio de uma palavra e existe um espaço antes, recua até
  // ele; palavra sem espaço nenhum é cortada na letra.
  const cabe = letras.slice(0, quantas);
  const proxima = letras.at(quantas);
  if (proxima !== undefined && !/\s/.test(proxima)) {
    let ultimoEspaco = cabe.length - 1;
    while (ultimoEspaco > 0 && !/\s/.test(cabe.at(ultimoEspaco) ?? "")) {
      ultimoEspaco -= 1;
    }
    if (ultimoEspaco > 0) cabe.length = ultimoEspaco;
  }

  return `${cabe.join("").trimEnd()}…`;
}
