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

function limparNome(nome?: string): string {
  return (nome ?? "")
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
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
