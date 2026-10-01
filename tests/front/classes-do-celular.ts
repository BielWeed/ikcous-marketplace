// Helper de TESTE (não é fonte do app) para o padrão A da spec do
// app-cliente-desktop (§4.4, contrato C13, Onda 0 F1.3): devolve "como o
// className seria no celular", removendo todo token cujo PRIMEIRO variante é
// `lg`, `xl` ou `2xl` -- o token pode empilhar mais variantes depois (ex.
// `lg:hover:bg-x`), e só o primeiro decide, porque é ele quem liga a media
// query no Tailwind.
//
// Usado assim nos testes das frentes: `classesDoCelular(el.className)` tem
// de bater byte a byte com o literal de hoje, provando que a classe de
// computador foi ACRESCENTADA a um literal separado (R2, `cn("<literal de
// hoje>", "lg:…")`), nunca editada dentro dele.
//
// Elemento SVG (`<svg>`, `<path>`...) tem `.className` do tipo
// `SVGAnimatedString`, não `string` (o DOM sempre foi assim; só o Elemento
// HTML devolve string direto) -- `sheet-fica-acima-da-navegacao-fixa.test.tsx`
// e as receitas de ícone (`src/components/icons/*`) chamam `el.className`
// sem checar o tipo, e F3 (galeria/setas) e F1.16 (overlays) mexem com
// ícones SVG. Aceitar os dois tipos aqui evita que cada teste de frente
// precise lembrar de usar `el.getAttribute("class")` como alternativa.
const PREFIXOS_DE_COMPUTADOR = new Set(["lg", "xl", "2xl"]);

export function classesDoCelular(
  className: string | SVGAnimatedString,
): string {
  const bruto = typeof className === "string" ? className : className.baseVal;
  return bruto
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PREFIXOS_DE_COMPUTADOR.has(token.split(":")[0]))
    .join(" ");
}
