// robots.txt e sitemap.xml de CADA loja, montados na borda pelo porteiro
// (defeito multiloja-frota-3). Desde o PR #545 todas as lojas rodam no MESMO
// projeto da Vercel, com UM build — e o build assava um único par de arquivos
// (`scripts/sitemap.mjs`) com o endereço e os produtos da loja principal, que
// a Vercel servia como arquivo estático a qualquer host. O Google abria o
// endereço da Savy e recebia o mapa do site da IKCOUS.
//
// Este módulo é o espelho de borda desse gerador: mesma saída byte a byte
// (`tests/front/mapa-do-site.test.ts` roda os dois lados e confronta), mas
//   - sem `node:fs` (a borda da Vercel só tem `fetch`);
//   - a origem vem da loja que RESPONDEU (a ficha validada), nunca do build;
//   - falha de leitura NÃO reprova nada aqui: quem chama (`atenderMapaDoSite`,
//     em porteiro.ts) cai no sitemap só com as URLs estáticas DA MESMA loja.
//     O `throw` do build existe porque lá "sitemap velho em silêncio" é pior
//     que build vermelho; na borda o robô precisa de uma resposta, e a certa é
//     a menor verdadeira, nunca a de outra loja.
//
// Não são o MESMO arquivo porque o gerador do build é `.mjs` (Node puro, sem
// TypeScript) e o `middleware.ts` da Vercel compila sem `allowImportingTsExtensions`.
import { classifyPublicSupabaseKey } from "../lib/publicSupabaseKey";

export const PRAZO_MAPA_MS = 8_000; // total da leitura; o robô não espera mais que isso
export const PAGINA_MAPA = 1000; // teto de linhas por página do PostgREST
export const MAX_PRODUTOS_MAPA = 10_000; // acima disso falha em vez de truncar
const CORPO_MAXIMO = 512 * 1024; // select=id + limit=PAGINA bornam o corpo por construção

/** A origem da loja: exatamente `scheme://host[:porta]`, nada mais. Em produção
 * é sempre `https://<dominio_publico>`; http com porta existe só no ensaio
 * local dos hosts (`http://loja-a.localhost:<porta>`). */
export function origemValida(origem: string): string {
  const reprovada = () => new Error(`MAPA_ORIGEM (${String(origem)})`);
  if (typeof origem !== "string") throw reprovada();
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    throw reprovada();
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    origem !== url.origin
  )
    throw reprovada();
  return origem;
}

// Espelho da URL canônica de produto (og:url de compartilhamento.ts e
// `urlDeProduto` do build): o sitemap e a prévia social anunciam a mesma página.
export function urlDeProduto(origem: string, id: string): string {
  return `${origem}/product-detail?id=${encodeURIComponent(id)}`;
}

export function robotsTxt(origem: string): string {
  const base = origemValida(origem);
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

const entradaEstatica = (loc: string, prioridade: string) =>
  `  <url>\n    <loc>${loc}</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${prioridade}</priority>\n  </url>\n`;

export function sitemapXml(origem: string, ids: Iterable<string>): string {
  const base = origemValida(origem);
  let xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += entradaEstatica(`${base}/`, "1.0");
  xml += entradaEstatica(`${base}/?view=cart`, "0.8");
  xml += entradaEstatica(`${base}/?view=favorites`, "0.8");
  xml += entradaEstatica(`${base}/?view=orders`, "0.8");
  const vistos = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) continue; // a vista é a fonte, mas o arquivo sai deduplicado
    vistos.add(id);
    xml += `  <url>\n    <loc>${urlDeProduto(base, id)}</loc>\n  </url>\n`;
  }
  xml += "</urlset>\n";
  return xml;
}

// Espelho de `cabecalhosDaConsulta` do build: publishable vai só em `apikey`
// (não é JWT); o JWT anon legado precisa do Bearer. Chave que não é pública
// (service_role, qualquer outra coisa) LANÇA — nunca vira cabeçalho.
export function cabecalhosDaConsulta(chave: string): Record<string, string> {
  const classe = classifyPublicSupabaseKey(chave);
  const cabecalhos: Record<string, string> = {
    apikey: chave,
    Accept: "application/json",
  };
  if (classe === "anon-jwt") cabecalhos.Authorization = `Bearer ${chave}`;
  return cabecalhos;
}

// Keyset (id=gt.) e nunca offset: com offset, página virada durante a leitura
// duplica ou engole produto; com keyset, cada página continua da última vista.
export function montarConsulta(
  origem: string,
  depoisDe: string | null,
  limite: number = PAGINA_MAPA,
): string {
  const partes = ["select=id", "order=id.asc", `limit=${limite}`];
  if (depoisDe !== null) partes.push(`id=gt.${encodeURIComponent(depoisDe)}`);
  return `${origem}/rest/v1/vw_produtos_public?${partes.join("&")}`;
}

export interface ConexaoDoMapa {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

export interface OpcoesBuscaDoMapa {
  readonly fetchImpl?: typeof fetch;
  readonly prazoMs?: number;
  readonly pagina?: number;
  readonly maxProdutos?: number;
}

async function lerPaginas(
  conexao: ConexaoDoMapa,
  fetchImpl: typeof fetch,
  limite: number,
  maxProdutos: number,
  signal: AbortSignal,
): Promise<string[]> {
  const cabecalhos = cabecalhosDaConsulta(conexao.publishableKey);
  const ids: string[] = [];
  let depoisDe: string | null = null;
  for (;;) {
    // Prazo esgotado: a corrida em `buscarIdsDosProdutos` já devolveu a falha,
    // mas esta função segue viva até o próximo ponto de espera — sem isto um
    // fetch que ignora o sinal a deixaria paginando o catálogo em segundo plano.
    signal.throwIfAborted();
    const resposta = await fetchImpl(
      montarConsulta(conexao.supabaseUrl, depoisDe, limite),
      { headers: cabecalhos, redirect: "error", credentials: "omit", signal },
    );
    if (!resposta.ok) throw new Error(`MAPA_HTTP_${resposta.status}`);
    const texto = await resposta.text();
    signal.throwIfAborted();
    if (texto.length > CORPO_MAXIMO) throw new Error("MAPA_CORPO");
    let lista: unknown;
    try {
      lista = JSON.parse(texto);
    } catch {
      throw new Error("MAPA_SHAPE");
    }
    if (!Array.isArray(lista)) throw new Error("MAPA_SHAPE");
    for (const item of lista as unknown[]) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as { id?: unknown }).id !== "string" ||
        (item as { id: string }).id === ""
      )
        throw new Error("MAPA_SHAPE");
      ids.push((item as { id: string }).id);
    }
    // O teto é conferido a cada página, ANTES do break da última: página final
    // curta acima do teto também falha (mesma borda achada no PR #572).
    if (ids.length > maxProdutos) throw new Error("MAPA_LIMITE");
    if (lista.length < limite) break; // última página
    depoisDe = (lista[lista.length - 1] as { id: string }).id;
  }
  return ids;
}

/** Os ids dos produtos públicos da loja dona de `conexao`, em ordem de id.
 * Falha (lança) em HTTP de erro, corpo torto, teto estourado ou prazo total
 * esgotado — o chamador decide o fallback. `Promise.race` contra um
 * temporizador (e não só `signal`) porque um `fetch` que ignora o sinal, ou um
 * dublê que nunca resolve, pendurariam a resposta ao robô para sempre. */
export async function buscarIdsDosProdutos(
  conexao: ConexaoDoMapa,
  opcoes: OpcoesBuscaDoMapa = {},
): Promise<string[]> {
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const prazoMs = opcoes.prazoMs ?? PRAZO_MAPA_MS;
  const limite = opcoes.pagina ?? PAGINA_MAPA;
  const maxProdutos = opcoes.maxProdutos ?? MAX_PRODUTOS_MAPA;
  if (!Number.isInteger(limite) || limite < 1)
    throw new Error(`MAPA_PAGINA (${limite})`);
  if (!Number.isInteger(maxProdutos) || maxProdutos < 1)
    throw new Error(`MAPA_MAX_PRODUTOS (${maxProdutos})`);
  const controller = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const prazoEsgotado = new Promise<never>((_resolve, reject) => {
    temporizador = setTimeout(() => {
      controller.abort();
      reject(new Error("MAPA_PRAZO"));
    }, prazoMs);
  });
  try {
    return await Promise.race([
      lerPaginas(conexao, fetchImpl, limite, maxProdutos, controller.signal),
      prazoEsgotado,
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}
