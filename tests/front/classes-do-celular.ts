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
const PREFIXOS_DE_COMPUTADOR = new Set(["lg", "xl", "2xl"]);

export function classesDoCelular(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PREFIXOS_DE_COMPUTADOR.has(token.split(":")[0]))
    .join(" ");
}

// P35 (tablet, 768–1023 px): `md:grid-cols-3` foi ACRESCENTADO de propósito às
// grades de produtos da Busca e dos Favoritos (defeito medido: 2 colunas
// deixavam o cartão com ~482x602). Os testes que congelam "tudo que vale abaixo
// de 1024 px" por assinatura continuam valendo com as assinaturas antigas se
// esse único token deliberado sair da conta; qualquer outra classe que mude,
// em qualquer largura abaixo do computador, ainda quebra a assinatura. Quem
// cobre o token novo é `tablet-grades-da-busca-e-favoritos.test.tsx`.
const GRADE_DE_TABLET_ACRESCENTADA = "md:grid-cols-3";

export function classesDoCelularSemGradeDeTablet(className: string): string {
  return classesDoCelular(className)
    .split(/\s+/)
    .filter((token) => token !== GRADE_DE_TABLET_ACRESCENTADA)
    .join(" ");
}
