export const OBJETIVOS = [
  "promocao",
  "lancamento",
  "frete_gratis",
  "colecao",
] as const;

export type ObjetivoDoBanner = (typeof OBJETIVOS)[number];

export const ROTULOS_DOS_OBJETIVOS = new Map<ObjetivoDoBanner, string>([
  ["promocao", "Promoção"],
  ["lancamento", "Lançamento"],
  ["frete_gratis", "Frete grátis"],
  ["colecao", "Coleção"],
]);

export interface EntradaDoPrompt {
  objetivo: ObjetivoDoBanner;
  nomeDoProduto?: string;
  nomeDaLoja?: string;
  estilo?: "escuro" | "claro";
}

export const PASSOS_DA_IA: readonly string[] = [
  "Abra o ChatGPT ou o Gemini.",
  "Cole o texto e anexe a foto do produto. Peça para criar a imagem.",
  "Baixe a imagem criada e envie aqui.",
];

const CENAS: Record<ObjetivoDoBanner, string> = {
  promocao: "Crie uma cena com energia e destaque para o produto em promoção.",
  lancamento: "Apresente o produto novo em uma cena elegante de lançamento.",
  frete_gratis:
    "Transmita a sensação de entrega rápida, sem desenhar caminhão com texto.",
  colecao: "Mostre vários itens harmonizados, formando uma coleção.",
};

const MAX_DO_NOME = 100;

/**
 * Corta em `MAX_DO_NOME` unidades de texto sem partir uma letra: `slice` corta em
 * unidades UTF-16 e deixava metade de um emoji (ou de uma familia de emojis) no
 * fim do nome. O corte anda de letra inteira em letra inteira.
 */
function cortarSemPartirLetra(texto: string): string {
  if (texto.length <= MAX_DO_NOME) return texto;
  const letras =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(
          new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(
            texto,
          ),
          (parte) => parte.segment,
        )
      : Array.from(texto);
  let corte = "";
  for (const letra of letras) {
    if (corte.length + letra.length > MAX_DO_NOME) break;
    corte += letra;
  }
  return corte;
}

function limparNome(nome?: string): string {
  return cortarSemPartirLetra(
    (nome ?? "")
      // O conector invisivel (U+200D) que cola um emoji no outro e o unico
      // "controle" que fica; solto, entre letras, vira espaco como os demais.
      .replace(
        /(\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)\u200D(?=\p{Extended_Pictographic})|\p{C}/gu,
        (achado, emoji?: string) => (emoji === undefined ? " " : achado),
      )
      .replace(/\s+/g, " ")
      .trim(),
  ).trim();
}

export function gerarPromptDeBanner(entrada: EntradaDoPrompt): string {
  const produto = limparNome(entrada.nomeDoProduto);
  const loja = limparNome(entrada.nomeDaLoja);
  return [
    "Crie uma imagem de banner para loja online, horizontal 2:1 (1200 × 600 px).",
    entrada.estilo === "claro"
      ? "Use fundo claro e elegante."
      : "Use fundo escuro elegante.",
    "Use iluminação de estúdio e o produto em destaque à direita, conforme a foto anexada.",
    "Deixe o lado esquerdo livre para o app colocar título e botão depois.",
    CENAS[entrada.objetivo],
    "Estilo minimalista e profissional. Não escreva nenhum texto, letra, preço ou logotipo dentro da imagem.",
    produto ? `Produto: ${produto}.` : "",
    loja ? `Loja: ${loja}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
