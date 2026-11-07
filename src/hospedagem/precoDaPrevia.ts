// O preço que a PRÉVIA do link anuncia (og:title) tem de ser o mesmo que o card
// e a página do produto mostram: o menor preço entre as opções à venda
// (`precoDeVitrine`), e não o `preco_venda` base. Este módulo é a parte comum
// das duas hospedagens (`middleware.ts`, na Vercel, e `compartilhamento.ts`, no
// Worker da Cloudflare) para as duas prévias saírem idênticas.
//
// Roda na BORDA: só importa por caminho relativo, sem API de navegador
// (`tests/front/porteiro-grafo-da-borda-so-modulos-puros.test.ts`).
import { precoDeVitrine } from "../lib/preco-de-vitrine";

// As quatro colunas que a regra de preço lê — a mesma leitura pública (chave
// anônima) que a página do produto faz em `product_variants`.
const COLUNAS_DA_VARIACAO = "name,active,stock_increment,price_override";

export function montarConsultaDeVariacoes(origin: string, id: string): string {
  return `${origin}/rest/v1/product_variants?product_id=eq.${encodeURIComponent(id)}&select=${COLUNAS_DA_VARIACAO}`;
}

const ehRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null;

// Mesma tradução de linha para variação que `mapVariantFromDB` faz no app
// (nome padrão, estoque `Number(...) || 0`, `active` ausente = ativa, preço
// próprio ausente/nulo = vale o preço do produto; ZERO é preço próprio válido).
function variacaoDaLinha(linha: Record<string, unknown>) {
  return {
    name:
      typeof linha.name === "string" && linha.name !== ""
        ? linha.name
        : "Padrão",
    active: Boolean(linha.active ?? true),
    stockIncrement: Number(linha.stock_increment) || 0,
    priceOverride:
      linha.price_override == null ? undefined : Number(linha.price_override),
  };
}

/**
 * O preço da prévia: o de vitrine do produto, dado o preço base e as linhas
 * de `product_variants` que vieram do banco. Sem linhas utilizáveis (consulta
 * que falhou, lista vazia, formato inesperado) devolve o próprio preço base —
 * a prévia NUNCA piora por causa das variações. O chamador decide se o número
 * é exibível (só > 0 aparece).
 */
export function precoDaPrevia(precoBase: number, linhas: unknown): number {
  if (!Array.isArray(linhas)) return precoBase;
  const variants = linhas.filter(ehRegistro).map(variacaoDaLinha);
  if (variants.length === 0) return precoBase;
  return precoDeVitrine({ price: precoBase, originalPrice: null, variants })
    .preco;
}
