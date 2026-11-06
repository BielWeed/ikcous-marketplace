// Resumo de uma descrição para a PRÉVIA do link (og:description, twitter:description,
// description) e para a aba do navegador. A descrição do produto é escrita em
// Markdown simples e desenhada na tela por `MarkdownRenderer`; a prévia do
// WhatsApp/Google mostra texto puro, então os marcadores precisam sair, as
// quebras viram espaço e o tamanho tem teto.
//
// Função PURA e sem imports: roda no Worker da Cloudflare
// (`src/hospedagem/compartilhamento.ts`), na borda da Vercel (`middleware.ts`)
// e no navegador (`ProductView`) com o MESMO resultado nas três rotas.
// Importa só por caminho relativo na borda (o bundler dela não resolve `@/`).

export const TAMANHO_DA_PREVIA = 200;

// Mesmo vocabulário que o MarkdownRenderer entende: linha só de traços,
// "#" a "######" seguido de espaço, "* " ou "- " de lista e **negrito**.
const SEPARADOR = /^(?:-{3,}|_{3,}|\*{3,})$/;
const TITULO = /^#{1,6}\s+/;
const ITEM_DE_LISTA = /^[*-]\s+/;
// Sobras de emoji composto (conector e seletor de variação) que um corte por
// ponto de código deixaria pendurado antes das reticências.
const SOBRA_DE_EMOJI = /(?:\u200d|\ufe0f)+$/;
const PONTUACAO_FINAL = /[\s,;:\-–—(]+$/;

function limparLinha(linha: string): string {
  const aparada = linha.trim();
  if (aparada === "" || SEPARADOR.test(aparada)) return "";
  return aparada
    .replace(TITULO, "")
    .replace(ITEM_DE_LISTA, "")
    .replaceAll("**", "")
    .trim();
}

export function resumoParaPrevia(
  texto: string,
  max: number = TAMANHO_DA_PREVIA,
): string {
  if (max < 1) return "";
  const limpo = texto
    .split(/\r?\n/)
    .map(limparLinha)
    .filter((linha) => linha !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Por pontos de código: `.length` conta metades de emoji e partiria um ao meio.
  const pontos = Array.from(limpo);
  if (pontos.length <= max) return limpo;
  if (max === 1) return "…";
  const cabe = pontos.slice(0, max - 1);
  // Prefere cortar numa fronteira de palavra, desde que não jogue fora mais
  // da metade do que cabia (uma palavra gigante é cortada seca).
  const ultimoEspaco = cabe.lastIndexOf(" ");
  const corte =
    ultimoEspaco > cabe.length / 2 ? cabe.slice(0, ultimoEspaco) : cabe;
  const final = corte
    .join("")
    .replace(SOBRA_DE_EMOJI, "")
    .replace(PONTUACAO_FINAL, "");
  return `${final}…`;
}
