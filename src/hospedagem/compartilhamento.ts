// Porta do middleware.ts (Vercel Edge) para uma Function do Pages, com o que a
// decisão do sócio exigiu a mais: id validado, seleção explícita e limit=1,
// prazo e corpo limitados, sem redirecionamento, origem vinda do contrato,
// chave publishable sem virar JWT, e imagem só de host permitido.
import type {
  AmbienteDaHospedagem,
  ConexaoDaHospedagem,
  HospedagemConfig,
  MotivoOg,
} from "./contrato";

export const PRAZO_MS = 2500;
export const CORPO_MAXIMO = 64 * 1024;

const ROBOS =
  /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMINHOS_DE_PRODUTO = new Set(["/product-detail", "/product-detail/"]);
const COLUNAS = "id,nome,descricao,preco_venda,imagem_url,imagem_urls";

type ConexaoComBanco = Extract<ConexaoDaHospedagem, { kind: "database" }>;

export interface ProdutoPublico {
  readonly nome?: unknown;
  readonly descricao?: unknown;
  readonly preco_venda?: unknown;
  readonly imagem_url?: unknown;
  readonly imagem_urls?: unknown;
}

export interface OpcoesDoWorker {
  readonly fetchImpl?: typeof fetch;
  readonly prazoMs?: number;
}

export function ehRobo(userAgent: string | null): boolean {
  return ROBOS.test(userAgent ?? "");
}

export function idValido(id: string | null): id is string {
  return id !== null && UUID.test(id);
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function hostPermitido(
  host: string,
  permitidos: readonly string[],
): boolean {
  return permitidos.some((permitido) =>
    permitido.startsWith("*.")
      ? host.endsWith(permitido.slice(1)) && host.length > permitido.length - 1
      : host === permitido,
  );
}

export function imagemPermitida(
  url: string,
  config: HospedagemConfig,
): boolean {
  // scripts/buildStore.mjs valida publicUrl antes de gerar o worker; o try
  // aqui é só defesa contra um publicUrl inválido chegar mesmo assim.
  try {
    const candidata = new URL(url);
    if (candidata.protocol !== "https:") return false;
    return (
      candidata.host === new URL(config.publicUrl).host ||
      hostPermitido(candidata.host, config.hostsDeImagem)
    );
  } catch {
    return false;
  }
}

export function montarConsulta(origin: string, id: string): string {
  return `${origin}/rest/v1/vw_produtos_public?id=eq.${encodeURIComponent(id)}&select=${COLUNAS}&limit=1`;
}

// Publishable vai só em apikey (não é JWT); o JWT anon legado ainda precisa
// do Bearer. Fonte: doc de chaves de API do Supabase citada na decisão.
export function cabecalhosDaConsulta(conexao: ConexaoComBanco): Headers {
  const cabecalhos = new Headers({
    apikey: conexao.key,
    Accept: "application/json",
  });
  if (conexao.keyClass === "anon-jwt")
    cabecalhos.set("Authorization", `Bearer ${conexao.key}`);
  return cabecalhos;
}

async function lerCorpoLimitado(
  resposta: Response,
  maximo: number,
): Promise<string | null> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return null;
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const junto = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    junto.set(parte, posicao);
    posicao += parte.byteLength;
  }
  return new TextDecoder().decode(junto);
}

export async function consultarProduto(
  config: HospedagemConfig,
  id: string,
  opcoes: OpcoesDoWorker = {},
): Promise<ProdutoPublico | null> {
  if (config.conexao.kind !== "database") return null;
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  try {
    const resposta = await fetchImpl(
      montarConsulta(config.conexao.origin, id),
      {
        headers: cabecalhosDaConsulta(config.conexao),
        redirect: "manual",
        signal: AbortSignal.timeout(opcoes.prazoMs ?? PRAZO_MS),
      },
    );
    if (!resposta.ok) return null;
    const texto = await lerCorpoLimitado(resposta, CORPO_MAXIMO);
    if (texto === null) return null;
    const lista: unknown = JSON.parse(texto);
    if (!Array.isArray(lista) || lista.length === 0) return null;
    const primeiro: unknown = lista[0];
    if (typeof primeiro !== "object" || primeiro === null) return null;
    return primeiro as ProdutoPublico;
  } catch {
    // Regressão do defeito original do middleware: falha NUNCA vira "produto".
    return null;
  }
}

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

export function montarHtml(
  produto: ProdutoPublico,
  id: string,
  config: HospedagemConfig,
): string {
  const loja = escaparHtml(config.storeName);
  const nome = escaparHtml(
    textoOuNulo(produto.nome) ?? `Produto - ${config.storeName}`,
  );
  const descricao = escaparHtml(
    textoOuNulo(produto.descricao) ??
      `Confira os detalhes do produto no ${config.storeName}.`,
  );
  // Só número > 0 aparece: 0, negativo ou não numérico ficam sem preço na
  // prévia (decisão do dono, 11/09/2026).
  const preco =
    typeof produto.preco_venda === "number" && produto.preco_venda > 0
      ? escaparHtml(`R$ ${produto.preco_venda.toFixed(2).replace(".", ",")}`)
      : "";
  // `imagem_urls` é o DEFAULT `[]` da coluna com frequência — um array vazio
  // não pode apagar `imagem_url` (decisão do dono, 11/09/2026). Ordem: cada
  // item de `imagem_urls`, DEPOIS `imagem_url`.
  const candidatas: unknown[] = [
    ...(Array.isArray(produto.imagem_urls) ? produto.imagem_urls : []),
    produto.imagem_url,
  ];
  const imagemValida = candidatas.find(
    (item): item is string =>
      typeof item === "string" &&
      item.trim() !== "" &&
      imagemPermitida(item.trim(), config),
  );
  const imagem = escaparHtml(
    imagemValida?.trim() ?? `${config.publicUrl}/og-image.png`,
  );
  const url = escaparHtml(
    `${config.publicUrl}/product-detail?id=${encodeURIComponent(id)}`,
  );
  return [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${nome} | ${loja}</title>`,
    `<meta name="description" content="${descricao}">`,
    `<meta property="og:title" content="${nome} ${preco ? `- ${preco}` : ""} | ${loja}">`,
    `<meta property="og:description" content="${descricao}">`,
    '<meta property="og:type" content="product">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${imagem}">`,
    '<meta property="og:image:width" content="600">',
    '<meta property="og:image:height" content="400">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${nome} | ${loja}">`,
    `<meta name="twitter:description" content="${descricao}">`,
    `<meta name="twitter:image" content="${imagem}">`,
    "</head>",
    "<body>",
    `<h1>${nome}</h1>`,
    `<p>${descricao}</p>`,
    `<img src="${imagem}" alt="${nome}">`,
    "</body>",
    "</html>",
  ].join("\n");
}

function comCarimbo(
  cabecalhos: Headers,
  config: HospedagemConfig,
  motivo: MotivoOg,
): Headers {
  cabecalhos.set("x-ikcous-og", motivo);
  cabecalhos.set("x-ikcous-delivery", config.deliveryVersion);
  return cabecalhos;
}

// O documento da loja é pedido explicitamente na raiz ao serviço de arquivos;
// a URL que o navegador vê não muda (o A7a3 provou: sem Location, query e
// fragmento preservados). _redirects não rege pedidos que passam pela função.
async function documentoDaLoja(
  request: Request,
  env: AmbienteDaHospedagem,
  config: HospedagemConfig,
  motivo: MotivoOg,
): Promise<Response> {
  const raiz = new URL("/", new URL(request.url).origin);
  const origem = await env.ASSETS.fetch(
    new Request(raiz, { method: request.method, headers: request.headers }),
  );
  // Pages não aplica o `_headers` a respostas geradas por Function (doc da
  // Cloudflare); a semente é config.cabecalhos, e o que o ASSETS mandar
  // (content-type, etag) sobrepõe por cima, igual a `previa` já fazia.
  const cabecalhos = new Headers(config.cabecalhos);
  for (const [nome, valor] of origem.headers) cabecalhos.set(nome, valor);
  comCarimbo(cabecalhos, config, motivo);
  return new Response(request.method === "HEAD" ? null : origem.body, {
    status: origem.status,
    headers: cabecalhos,
  });
}

function previa(
  html: string,
  request: Request,
  config: HospedagemConfig,
): Response {
  const cabecalhos = comCarimbo(
    new Headers(config.cabecalhos),
    config,
    "produto",
  );
  cabecalhos.set("content-type", "text/html; charset=utf-8");
  cabecalhos.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: cabecalhos,
  });
}

export function criarWorker(
  config: HospedagemConfig,
  opcoes: OpcoesDoWorker = {},
) {
  return {
    async fetch(
      request: Request,
      env: AmbienteDaHospedagem,
    ): Promise<Response> {
      const url = new URL(request.url);
      // _routes.json já restringe a função; conferir de novo custa nada e
      // protege contra uma regra de rota mais larga no futuro.
      if (!CAMINHOS_DE_PRODUTO.has(url.pathname)) {
        const origem = await env.ASSETS.fetch(request);
        // origem.headers pode ser imutável (Response de fetch): reconstrói a
        // resposta para poder carimbar, igual ao pass-through de navegador.
        const cabecalhos = comCarimbo(
          new Headers(origem.headers),
          config,
          "passa",
        );
        return new Response(origem.body, {
          status: origem.status,
          headers: cabecalhos,
        });
      }
      const robo = ehRobo(request.headers.get("user-agent"));
      if (!robo) return documentoDaLoja(request, env, config, "passa");
      const id = url.searchParams.get("id");
      if (!idValido(id) || config.conexao.kind !== "database")
        return documentoDaLoja(request, env, config, "sem-produto");
      const produto = await consultarProduto(config, id, opcoes);
      if (!produto) return documentoDaLoja(request, env, config, "sem-produto");
      return previa(montarHtml(produto, id, config), request, config);
    },
  };
}
