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
 * de `/api/`, `/.well-known/` e `/admin*` (painel), e fora dos documentos de maquina que o porteiro
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
  // A lojista e a equipe abrem o painel (`/admin`, `/admin-orders`...) e o app
  // instalado dela: nao e' cliente abrindo a loja.
  if (caminho.startsWith("/admin")) return false;
  const ultimoTrecho = caminho.replace(/\/+$/, "").split("/").pop() ?? "";
  if (/\.[A-Za-z0-9]+$/.test(ultimoTrecho)) return false;
  return true;
}

// ─── Robo ou pessoa? (cabecalhos) ───────────────────────────────────────────

// UAs que SAO robo, sem discussao -- previa SEMPRE, ate com Sec-Fetch. "Instagram"
// NAO esta aqui de proposito: o navegador de dentro do Instagram e' uma pessoa;
// a previa da Meta chega como `facebookexternalhit`.
const UA_DE_ROBO =
  /crawler|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|iframely|preview|lighthouse|headless/i;

// "bot" PRECISA de caixa: robo escreve `Googlebot`, `TelegramBot`, `Slackbot`
// (`Bot`/`bot`), mas o celular CUBOT se apresenta como "Android 11; CUBOT P50"
// -- com a bandeira `i` ele viraria robo e a lojista perderia essas pessoas.
const UA_DE_ROBO_COM_BOT = /[Bb]ot/;

function ehUserAgentDeRobo(userAgent: string): boolean {
  return UA_DE_ROBO.test(userAgent) || UA_DE_ROBO_COM_BOT.test(userAgent);
}

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
  if (ehUserAgentDeRobo(userAgent)) return { tipo: "previa" };
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

// ─── Gravar a entrada no banco da loja (sem nunca atrasar a pagina) ─────────
//
// SUPOSICOES DE ESTADO, ditas em voz alta:
//   - O porteiro so tem a chave PUBLICA da loja (nao ha credencial de escrita
//     por loja). Por isso a escrita e' a RPC `contar_entrada`, chamavel por
//     `anon` e com teto no banco; esta funcao nao le nada nem escolhe data.
//   - `registrarEntrada` NUNCA rejeita e NAO e' aguardada no caminho critico
//     (o `middleware` a entrega a `context.waitUntil`). Pior caso de uma falha:
//     uma entrada a menos contada. Nunca uma pagina mais lenta ou quebrada.
//   - Nao ha retentativa: gravar duas vezes seria contar duas vezes.
//   - Toda falha cala AQUELE banco (chave = `supabaseUrl`, nunca o host) e deixa
//     uma linha anonima de log por janela: 10 min para a permanente (404/401/403 =
//     migration ausente ou sem `EXECUTE` ao papel publico; 400 e demais 4xx) e
//     60 s para a transitoria (5xx, 429, prazo, rede). O Map e' do isolate e
//     o CHAMADOR o guarda, como os demais caches do porteiro.

/** O pedaco da conexao validada da ficha que a gravacao precisa. */
export interface ConexaoDeContagem {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

export interface DependenciasDoRegistro {
  readonly fetchImpl: typeof fetch;
  /** `supabaseUrl` -> instante (ms) ate o qual nao se tenta de novo. */
  readonly silencio: Map<string, number>;
  /** Relogio injetavel -- testes avancam o tempo sem `sleep`. */
  readonly agora?: () => number;
}

export const PRAZO_DA_GRAVACAO_MS = 1_500;

/** Falha PERMANENTE (404 = a loja nao tem a funcao, a migration nao chegou;
 * 401/403 = o banco nao deu `EXECUTE` ao papel publico; 400 = canal recusado;
 * qualquer outro 4xx): insistir a cada visita nao adianta. */
export const SILENCIO_LONGO_MS = 600_000;
/** Falha TRANSITORIA (5xx, 429, prazo estourado, erro de rede): banco doente nao
 * recebe um POST por visita, mas volta a ser tentado logo. */
export const SILENCIO_CURTO_MS = 60_000;

/** O rotulo que vai para o log: o status HTTP, ou `timeout`/`rede`. Fixo e
 * anonimo -- nunca URL, chave, referer nem user-agent. */
type RotuloDaFalha = number | "timeout" | "rede";

/** `null` = nao e' falha (2xx e o que o `fetch` nao entrega com `redirect:"error"`). */
function duracaoDoSilencio(status: number): number | null {
  if (status >= 500 || status === 429) return SILENCIO_CURTO_MS;
  if (status >= 400) return SILENCIO_LONGO_MS;
  return null;
}

function calarOBanco(
  deps: DependenciasDoRegistro,
  supabaseUrl: string,
  agora: number,
  duracao: number,
  rotulo: RotuloDaFalha,
): void {
  const calado = deps.silencio.get(supabaseUrl) ?? 0;
  // Nunca encurta: uma falha curta que chega depois de uma longa (gravacoes em
  // voo ao mesmo tempo) nao pode reabrir a porta antes da hora.
  deps.silencio.set(supabaseUrl, Math.max(calado, agora + duracao));
  // Uma linha de log por JANELA de silencio: as gravacoes em voo ao mesmo tempo
  // voltam todas com o mesmo problema e so a primeira conta.
  if (calado <= agora)
    console.warn(`contador-de-visitas: silenciado status=${rotulo}`);
}

export async function registrarEntrada(
  conexao: ConexaoDeContagem,
  canal: CanalDeEntrada,
  deps: DependenciasDoRegistro,
): Promise<void> {
  const controller = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const relogio = deps.agora ?? Date.now;
    const silenciadoAte = deps.silencio.get(conexao.supabaseUrl);
    if (silenciadoAte !== undefined) {
      if (relogio() < silenciadoAte) return;
      deps.silencio.delete(conexao.supabaseUrl);
    }
    // A corrida (e nao so o `signal`) garante o prazo mesmo se o `fetch` ignorar
    // o aborto: a promessa devolvida resolve em 1,5 s de qualquer jeito.
    const prazo = new Promise<null>((resolver) => {
      temporizador = setTimeout(() => {
        controller.abort();
        resolver(null);
      }, PRAZO_DA_GRAVACAO_MS);
    });
    let resposta: Response | null;
    try {
      resposta = await Promise.race([
        deps.fetchImpl(`${conexao.supabaseUrl}/rest/v1/rpc/contar_entrada`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: conexao.publishableKey,
            Authorization: `Bearer ${conexao.publishableKey}`,
          },
          body: JSON.stringify({ p_canal: canal }),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        }),
        prazo,
      ]);
    } catch {
      // Rejeicao de rede (inclui o redirecionamento recusado) ou `fetch` que lanca.
      calarOBanco(
        deps,
        conexao.supabaseUrl,
        relogio(),
        SILENCIO_CURTO_MS,
        "rede",
      );
      return;
    }
    if (resposta === null) {
      calarOBanco(
        deps,
        conexao.supabaseUrl,
        relogio(),
        SILENCIO_CURTO_MS,
        "timeout",
      );
      return;
    }
    const duracao = duracaoDoSilencio(resposta.status);
    if (duracao !== null)
      calarOBanco(
        deps,
        conexao.supabaseUrl,
        relogio(),
        duracao,
        resposta.status,
      );
  } catch {
    // Contar e' o que menos importa neste caminho: engolir e seguir.
  } finally {
    clearTimeout(temporizador);
  }
}
