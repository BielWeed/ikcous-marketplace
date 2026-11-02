// O CONTADOR DE VISITAS DA LOJA -- a parte PURA (classificar quem entrou).
// Spec "visitas da loja" (aprovada pelo dono em 02/11/2026), decisoes 1 a 3.
//
// Roda na BORDA da Vercel (importado por `porteiro.ts` e `middleware.ts`), entao
// vale a regra do grafo da borda (`porteiro-grafo-da-borda-so-modulos-puros`):
// so imports relativos, nenhum pacote novo, nenhuma API de navegador. Nada aqui
// le o relogio nem a rede; entra cabecalho e URL, sai uma CLASSE.
//
// O que conta como "entrada": uma NAVEGACAO de documento (a pessoa abriu a
// loja, ou recarregou, ou abriu o app instalado em `/?source=pwa`). Passar de
// uma pagina para outra DENTRO do app nao passa pelo porteiro e nao conta.
//
// PRIVACIDADE: a saida e' so o canal (uma de 4 classes de pessoa, ou `previa`).
// Nunca o hostname do referer, nunca o user-agent, nunca a URL.

export type CanalDePessoa =
  | "direto"
  | "instagram"
  | "whatsapp"
  | "outros_sites";

/** Os 5 valores que o banco aceita em `visitas_por_dia.canal`. */
export type CanalDeEntrada = CanalDePessoa | "previa";

export type Entrada =
  | { readonly tipo: "pessoa"; readonly canal: CanalDePessoa }
  | { readonly tipo: "previa" }
  | null;

// ─── A pagina e' da loja? (caminho + metodo) ────────────────────────────────

const CAMINHOS_QUE_NAO_SAO_PAGINA = new Set([
  "/identidade.json",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
]);

/**
 * So GET de uma PAGINA da loja: sem extensao de arquivo no ultimo trecho do
 * caminho (o ponto de uma pasta, como em `/v1.2/oferta`, nao faz arquivo), fora
 * de `/api/` e `/.well-known/`, e fora dos documentos de maquina que o porteiro
 * responde (`identidade.json`, manifesto, `robots.txt`, `sitemap.xml`). HEAD
 * nunca conta: o porteiro o atende como GET (`atenderPorteiro`), mas quem manda
 * HEAD e' monitor e verificador de link, nao uma pessoa abrindo a loja.
 */
export function ehPaginaContavel(metodo: string, url: URL): boolean {
  if (metodo !== "GET") return false;
  const caminho = url.pathname;
  if (CAMINHOS_QUE_NAO_SAO_PAGINA.has(caminho)) return false;
  if (caminho === "/api" || caminho.startsWith("/api/")) return false;
  if (caminho.startsWith("/.well-known/")) return false;
  const ultimoTrecho = caminho.replace(/\/+$/, "").split("/").pop() ?? "";
  if (/\.[A-Za-z0-9]+$/.test(ultimoTrecho)) return false;
  return true;
}

// ─── Robo ou pessoa? (cabecalhos) ───────────────────────────────────────────

// UAs que SAO robo, sem discussao -- previa SEMPRE, ate com Sec-Fetch. "Instagram"
// NAO esta aqui de proposito: o navegador de dentro do Instagram e' uma pessoa;
// a previa da Meta chega como `facebookexternalhit`.
const UA_DE_ROBO =
  /bot|crawler|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|iframely|preview|lighthouse|headless/i;

function pedeCarregamentoAntecipado(cabecalhos: Headers): boolean {
  for (const nome of ["sec-purpose", "purpose", "x-purpose"]) {
    const valor = (cabecalhos.get(nome) ?? "").toLowerCase();
    if (valor.includes("prefetch") || valor.includes("preview")) return true;
  }
  return false;
}

function ehNavegacaoDePessoa(cabecalhos: Headers, userAgent: string): boolean {
  const modo = (cabecalhos.get("sec-fetch-mode") ?? "").toLowerCase();
  const destino = (cabecalhos.get("sec-fetch-dest") ?? "").toLowerCase();
  if (modo !== "" || destino !== "") {
    // `dest=empty` com `navigate` e' a revalidacao do service worker em segundo
    // plano (`src/sw/sw.ts`); a INSTALACAO dele e' `mode=cors` e fica de fora.
    return (
      modo === "navigate" && (destino === "document" || destino === "empty")
    );
  }
  // Navegador antigo, sem Sec-Fetch: so o que se apresenta como navegador e
  // pede HTML. curl, monitores e bibliotecas HTTP ficam de fora.
  return (
    userAgent.startsWith("Mozilla/") &&
    (cabecalhos.get("accept") ?? "").toLowerCase().includes("text/html")
  );
}

// ─── De onde a pessoa veio? ─────────────────────────────────────────────────

function canalPorParametro(valor: string | null): CanalDePessoa | null {
  switch ((valor ?? "").trim().toLowerCase()) {
    case "instagram":
    case "ig":
      return "instagram";
    case "whatsapp":
    case "wa":
    case "wpp":
    case "zap":
      return "whatsapp";
    case "pwa":
      return "direto";
    default:
      return null;
  }
}

function terminaEm(host: string, dominio: string): boolean {
  return host === dominio || host.endsWith(`.${dominio}`);
}

function canalPorReferer(referer: string | null, url: URL): CanalDePessoa {
  if (!referer) return "direto";
  let origem: URL;
  try {
    origem = new URL(referer);
  } catch {
    return "direto";
  }
  if (origem.protocol !== "https:" && origem.protocol !== "http:")
    return "direto";
  const host = origem.hostname.toLowerCase().replace(/\.+$/, "");
  if (host === url.hostname.toLowerCase().replace(/\.+$/, "")) return "direto";
  if (terminaEm(host, "instagram.com")) return "instagram";
  if (
    host === "wa.me" ||
    terminaEm(host, "whatsapp.com") ||
    terminaEm(host, "whatsapp.net")
  )
    return "whatsapp";
  return "outros_sites";
}

function canalDaPessoa(
  url: URL,
  cabecalhos: Headers,
  userAgent: string,
): CanalDePessoa {
  const doParametro =
    canalPorParametro(url.searchParams.get("utm_source")) ??
    canalPorParametro(url.searchParams.get("source"));
  if (doParametro !== null) return doParametro;
  const ua = userAgent.toLowerCase();
  if (ua.includes("instagram")) return "instagram";
  if (ua.includes("whatsapp")) return "whatsapp";
  return canalPorReferer(cabecalhos.get("referer"), url);
}

// ─── A classificacao ────────────────────────────────────────────────────────

export interface PedidoParaClassificar {
  readonly metodo: string;
  readonly url: URL;
  readonly cabecalhos: Headers;
}

/**
 * `{tipo:"pessoa", canal}` = soma em "visitas"; `{tipo:"previa"}` = robo ou
 * previa de link (nunca soma em "visitas"); `null` = nao e' entrada nenhuma.
 */
export function classificarEntrada(pedido: PedidoParaClassificar): Entrada {
  const { metodo, url, cabecalhos } = pedido;
  if (!ehPaginaContavel(metodo, url)) return null;
  const userAgent = cabecalhos.get("user-agent") ?? "";
  if (UA_DE_ROBO.test(userAgent)) return { tipo: "previa" };
  if (pedeCarregamentoAntecipado(cabecalhos)) return { tipo: "previa" };
  // O robo de previa do WhatsApp se apresenta como `WhatsApp/...` e NAO manda
  // Sec-Fetch-Mode; o navegador embutido do app manda (e e' pessoa).
  if (
    userAgent.toLowerCase().includes("whatsapp") &&
    cabecalhos.get("sec-fetch-mode") === null
  )
    return { tipo: "previa" };
  if (!ehNavegacaoDePessoa(cabecalhos, userAgent)) return null;
  return { tipo: "pessoa", canal: canalDaPessoa(url, cabecalhos, userAgent) };
}
