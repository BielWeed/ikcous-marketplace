import {
  classificarEntrada,
  registrarEntrada,
} from "./src/hospedagem/contador";
import type { CanalDeEntrada } from "./src/hospedagem/contador";
import type {
  AmbientePorteiro,
  EntradaCacheCartaz,
  EntradaCacheForaDoAr,
  EntradaCacheIndexHtml,
  EntradaCacheMapa,
  EntradaCachePorteiro,
  EntradaCacheSemLoja,
  IndexHtmlBaixado,
  ResolucaoEmVoo,
  ResolverLojaNaCaderneta,
} from "./src/hospedagem/porteiro";
import {
  atenderPorteiro,
  documentoDaLoja,
  marcarVersaoDaCaderneta,
  obterFichaValidada,
  respostaManutencao,
} from "./src/hospedagem/porteiro";
import {
  montarConsultaDeVariacoes,
  precoDaPrevia,
} from "./src/hospedagem/precoDaPrevia";
import { VARY_DA_PREVIA, ehRoboDaPrevia } from "./src/hospedagem/roboDaPrevia";
import { resumoParaPrevia } from "./src/lib/resumo-para-previa";

// O `matcher` PRECISA ser um array-LITERAL bem aqui — a Vercel/Next lê
// `config.matcher` por ANÁLISE ESTÁTICA em tempo de build; qualquer valor
// que não seja um literal (import, variável, chamada de função) É IGNORADO
// e a rota vira `/(.*)` (doc oficial Next.js `proxy.mdx`, seção
// "Matcher > Good to know": "The matcher values need to be constants so
// they can be statically analyzed at build-time. Dynamic values such as
// variables will be ignored" — conferido via context7, `/vercel/next.js`,
// 11/09/2026). Matcher ignorado = o porteiro passaria a rodar em TODA
// requisição, inclusive `/assets/*.js` (que receberia o HTML injetado com
// content-type errado — app quebrado) e `/index.html` (recursão no
// self-fetch de `atenderPorteiro`, `src/hospedagem/porteiro.ts:497-498`).
//
// Por isso NUNCA se importa este array de `src/hospedagem/porteiro.ts` —
// ele exporta uma CÓPIA (`matcher`) só para o teste comparar
// (`tests/front/porteiro-middleware-matcher.test.ts`, que lê ESTE arquivo
// do disco e confere igualdade byte a byte com essa cópia). Rodada B
// (11/09/2026, brief T3b item 6): o primeiro padrão trocou a exclusão por
// EXTENSÃO por uma LISTA NOMEADA de prefixos (`assets/`, `store-identity/`,
// `icons/`, `images/`, `fonts/`; `logos/` e `branding/` desde 23/09/2026 —
// toda pasta de `public/`) e arquivos de raiz que o build sempre
// produz (`sw.js`, `version.json`, `favicon.ico`/`.svg`, `logo.svg`,
// `apple-touch-icon.png`, `og-image.png`,
// `silent-guardian.js`, `loading.css`, `404.html`, `index.html`,
// `registerSW.js`, `workbox-*.js`) — qualquer OUTRO documento sem extensão
// reservada agora casa o primeiro padrão (ex.: `/qualquer.txt` passa a
// CASAR, `/assets/x.js` continua NÃO casando). Rodada 2 (achado 1 do
// revisor): a lista também precisa de `offline.html` (asset estático de
// `public/offline.html`) e do arquivo de verificação do Google Search
// Console (`google<hash>.html`, por PREFIXO — o nome muda a cada
// reverificação) — os dois EXISTEM em `dist-test/` e, sem entrar na lista,
// eram tratados como documento (self-fetch de `/index.html` no lugar do
// arquivo pedido). `/index.html` continua fora
// da lista de documentos (o self-fetch de `atenderPorteiro`,
// `src/hospedagem/porteiro.ts`, depende disso). `/identidade.json` e
// `/manifest.webmanifest` continuam como entradas SEPARADAS por clareza,
// ainda que a lista nomeada já não precise excluí-los para o primeiro
// padrão também os casar (nenhum dos dois nomes está na lista de raiz).
// `/product-detail` casa o primeiro padrão (sem nome reservado), então o
// caminho de robô abaixo continua funcionando sem entrada própria no
// matcher.
//
// `/robots.txt` e `/sitemap.xml` ficaram FORA da lista de exclusão em
// 23/10/2026 (defeito multiloja-frota-3): o par estático do build tinha o
// endereço e os produtos da loja principal e era servido a todo host — o
// Google abria a Savy e recebia o mapa da IKCOUS. Os dois caminhos agora casam
// o primeiro padrão e o porteiro os responde POR HOST
// (`atenderPorteiro` -> `atenderMapaDoSite`, `src/hospedagem/porteiro.ts`).
export const config = {
  matcher: [
    "/((?!assets/|store-identity/|icons/|images/|fonts/|logos/|branding/|sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|THIRD_PARTY_NOTICES\\.txt$|google[A-Za-z0-9]*\\.html$).*)",
    "/identidade.json",
    "/manifest.webmanifest",
  ],
};

// `Map` de módulo: vive uma vez por instância da função (o `middleware.ts` roda
// em Node.js por padrão na Vercel; este projeto não declara `runtime` nem em
// `config` nem em `vercel.json`) e sobrevive entre invocações da mesma
// instância — é o que faz o cache de 60s/1h do porteiro valer a pena
// (`src/hospedagem/porteiro.ts`, `CACHE_FRESCO_MS`/`CACHE_STALE_MAX_MS`).
const cachePorteiro = new Map<string, EntradaCachePorteiro>();

// L8: a decisão "loja adormecida/encerrada" por host, 60 s (sem stale): ver
// `CACHE_FORA_DO_AR_MS` no porteiro. A loja ativa nunca escreve aqui.
const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();

// O host SEM ficha: o "não achei" da caderneta, 60 s (só `miss`), e o recuo
// de 10 s depois de uma falha sem ficha (nunca guardada como "não achei"): ver
// `EntradaCacheSemLoja` no porteiro. Host desconhecido não vira uma pergunta
// cara à caderneta a cada pedido de robô, e a instância nova não martela a
// caderneta que oscila.
const cacheSemLoja = new Map<string, EntradaCacheSemLoja>();

// Resoluções em andamento por host: pedidos simultâneos do mesmo host esperam
// a MESMA pergunta à caderneta (ver `resolucoesEmVoo` no porteiro).
const resolucoesEmVoo = new Map<string, ResolucaoEmVoo>();

// Ids públicos do sitemap por loja (10 min frescos, 1h de stale-if-error,
// chave = `host|supabaseUrl` da ficha): ver `CACHE_MAPA_FRESCO_MS` no porteiro.
const cacheMapaDoSite = new Map<string, EntradaCacheMapa>();

// Banners do topo por loja (15 s; falha 10 s), para o cartaz pré-impresso da
// 1ª visita: ver `CACHE_CARTAZ_FRESCO_MS` no porteiro. Chave `host|supabaseUrl`.
const cacheCartazDaLoja = new Map<string, EntradaCacheCartaz>();

// O `/index.html` CRU por endereço (5 min, só 200) e as buscas dele em voo:
// um self-fetch à CDN a cada 5 min por host, não um por página aberta. A ficha
// e o cartaz continuam injetados a cada pedido: ver `CACHE_INDEX_HTML_MS` no
// porteiro.
const cacheIndexHtml = new Map<string, EntradaCacheIndexHtml>();
const indexHtmlEmVoo = new Map<string, Promise<IndexHtmlBaixado>>();

// Contador de visitas da loja (spec "visitas da loja", 02/11/2026): lojas cujo
// banco ainda nao tem `contar_entrada` (404) ficam 10 min caladas, por
// `supabaseUrl` -- ver `registrarEntrada` em `src/hospedagem/contador.ts`.
const silencioDoContador = new Map<string, number>();

// O segundo argumento que a Vercel entrega ao `middleware` em qualquer
// framework que nao seja o Next (doc oficial "Routing Middleware", `context`
// com `waitUntil`, conferido via context7 em 02/11/2026). Tipo LOCAL de
// proposito: `@vercel/functions` nao e' dependencia daqui e a borda nao ganha
// pacote novo (`porteiro-grafo-da-borda-so-modulos-puros`).
interface ContextoDaBorda {
  waitUntil(promessa: Promise<unknown>): void;
}

type GravarEntrada = (
  conexao: { readonly supabaseUrl: string; readonly publishableKey: string },
  canal: CanalDeEntrada,
) => void;

// SO a producao conta: a previa de desenvolvimento fala com o banco da IKCOUS e
// nao pode sujar o numero dela. Devolve `undefined` fora dela (nada a chamar).
// A gravacao NUNCA e' aguardada aqui: a promessa (que nunca rejeita) vai para
// `context.waitUntil`, que mantem a funcao viva depois da resposta. Sem
// `context`, ou com um `waitUntil` que lanca, a gravacao segue solta -- a pagina
// nao depende dela.
function criarGravadorDeEntrada(
  env: AmbientePorteiro,
  context: ContextoDaBorda | undefined,
): GravarEntrada | undefined {
  if (env.VERCEL_ENV !== "production") return undefined;
  return (conexao, canal) => {
    const gravacao = registrarEntrada(conexao, canal, {
      fetchImpl: fetch,
      silencio: silencioDoContador,
    });
    try {
      context?.waitUntil(gravacao);
    } catch {
      // Sem waitUntil a gravacao so pode ser cortada; a pagina segue.
    }
  };
}

// Caminho (a) do porteiro — a caderneta central (`resolver_loja`, T5,
// `supabase/migrations/20261141000000_caderneta_da_frota.sql`). Convenção de
// chamada (rodada B, decisão da hub, 11/09/2026): TRÊS variáveis no
// hospedeiro — `IKCOUS_FROTA_URL` (a origem do projeto da PRINCIPAL),
// `IKCOUS_FROTA_APIKEY` (a chave PÚBLICA publishable/anon do projeto da
// PRINCIPAL — é o que o PostgREST exige em `apikey` para sequer alcançar
// QUALQUER RPC, mesmo com `GRANT EXECUTE TO anon`) e `IKCOUS_FROTA_CHAVE`
// (o segredo cujo hash vive em `frota_segredo`; viaja SÓ no corpo JSON como
// `p_chave`, por `POST`, NUNCA em cabeçalho nem em URL). `resolver_loja` é
// quem recusa de verdade se `p_chave` não bater — sem oráculo, devolve zero
// linhas. `AbortController` com prazo de 5s: uma RPC pendurada não pode
// atrasar o porteiro além disso — o `catch` cobre tanto o aborto quanto
// qualquer outra falha de rede, sempre caindo em `"erro"` (nunca lança).
const PRAZO_CADERNETA_MS = 5_000;

// L8 (26/11/2026): a pergunta é feita PRIMEIRO à `resolver_loja_com_estado`
// (as 6 colunas da v1 + `estado`; URL e chave NULL quando a loja não está
// `ativa`). A função antiga é RESERVA ESTREITA, só para o intervalo em que o
// banco da caderneta ainda não recebeu a migration nova: SÓ um 404 cujo corpo
// é `{ code: "PGRST202" }` (o PostgREST não achou a função) repete a MESMA
// pergunta em `resolver_loja`, e o resultado leva `versao: 1` (vira o
// cabeçalho `x-ikcous-caderneta-versao: 1`). Qualquer outra falha — 500,
// 401, 404 sem esse código, corpo que não é JSON, rede — é `erro`, como
// sempre foi: cair na reserva por um 500 esconderia uma caderneta doente e
// trocaria o estado de vida pela regra antiga sem ninguém decidir isso.
// O prazo de 5 s vale para as DUAS chamadas juntas (mesmo `AbortController`).
const RPC_COM_ESTADO = "resolver_loja_com_estado";
const RPC_ANTIGA = "resolver_loja";
// O mesmo formato que a identidade da loja aceita (`parseStoreIdentity`):
// o `project_ref` vai num cabeçalho da página de loja fora do ar.
const REF_DO_PROJETO = /^[a-z0-9]{20}$/;

type LinhaDaCaderneta = Record<string, unknown>;

/** Zero linhas = `miss`; exatamente UMA linha-objeto segue; o resto é erro. */
function umaLinhaDaCaderneta(
  linhas: unknown,
): LinhaDaCaderneta | "miss" | "erro" {
  if (!Array.isArray(linhas)) return "erro";
  if (linhas.length === 0) return "miss";
  if (linhas.length !== 1) return "erro";
  const linha: unknown = linhas[0];
  if (linha === null || typeof linha !== "object" || Array.isArray(linha))
    return "erro";
  return linha as LinhaDaCaderneta;
}

function conexaoDaLinha(linha: LinhaDaCaderneta) {
  if (
    typeof linha.supabase_url !== "string" ||
    typeof linha.publishable_key !== "string"
  )
    return null;
  return {
    supabaseUrl: linha.supabase_url,
    publishableKey: linha.publishable_key,
    origem: "caderneta" as const,
  };
}

/** A resposta da função NOVA: o `estado` decide; estado que não seja um dos
 * três (ou ausente) é `erro` — nunca "assume ativa". */
function lerRespostaComEstado(
  linhas: unknown,
): Awaited<ReturnType<ResolverLojaNaCaderneta>> {
  const linha = umaLinhaDaCaderneta(linhas);
  if (linha === "miss" || linha === "erro") return { tipo: linha };
  if (linha.estado === "ativa") {
    const conexao = conexaoDaLinha(linha);
    return conexao === null ? { tipo: "erro" } : { tipo: "hit", conexao };
  }
  if (linha.estado === "adormecida" || linha.estado === "encerrada") {
    // URL e chave são ignoradas de propósito (vêm NULL): a loja fora do ar
    // nunca tem o banco procurado.
    if (
      typeof linha.project_ref !== "string" ||
      !REF_DO_PROJETO.test(linha.project_ref) ||
      typeof linha.nome !== "string"
    )
      return { tipo: "erro" };
    return {
      tipo: "fora-do-ar",
      estado: linha.estado,
      ref: linha.project_ref,
      nome: linha.nome,
    };
  }
  return { tipo: "erro" };
}

/** A resposta da função ANTIGA (reserva): exatamente a leitura de antes de
 * L8 — ela só conhece loja ativa. */
function lerRespostaAntiga(
  linhas: unknown,
): Awaited<ReturnType<ResolverLojaNaCaderneta>> {
  const linha = umaLinhaDaCaderneta(linhas);
  if (linha === "miss" || linha === "erro") return { tipo: linha, versao: 1 };
  const conexao = conexaoDaLinha(linha);
  return conexao === null
    ? { tipo: "erro", versao: 1 }
    : { tipo: "hit", conexao, versao: 1 };
}

/** O único sinal que abre a reserva: 404 + `{ code: "PGRST202" }`. */
async function funcaoNovaAusente(resposta: Response): Promise<boolean> {
  if (resposta.status !== 404) return false;
  try {
    const corpo: unknown = await resposta.json();
    return (
      corpo !== null &&
      typeof corpo === "object" &&
      !Array.isArray(corpo) &&
      (corpo as { code?: unknown }).code === "PGRST202"
    );
  } catch {
    return false;
  }
}

export const resolverNaCaderneta: ResolverLojaNaCaderneta = async (
  host,
  frotaUrl,
  frotaApikey,
  frotaChave,
) => {
  const controller = new AbortController();
  const temporizador = setTimeout(() => controller.abort(), PRAZO_CADERNETA_MS);
  const perguntar = (funcao: string) =>
    fetch(`${frotaUrl}/rest/v1/rpc/${funcao}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: frotaApikey,
        Authorization: `Bearer ${frotaApikey}`,
      },
      body: JSON.stringify({ p_host: host, p_chave: frotaChave }),
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
  let pelaReserva = false;
  try {
    const resposta = await perguntar(RPC_COM_ESTADO);
    if (resposta.ok) return lerRespostaComEstado(await resposta.json());
    if (!(await funcaoNovaAusente(resposta))) return { tipo: "erro" };
    pelaReserva = true;
    const antiga = await perguntar(RPC_ANTIGA);
    if (!antiga.ok) return { tipo: "erro", versao: 1 };
    return lerRespostaAntiga(await antiga.json());
  } catch {
    return pelaReserva ? { tipo: "erro", versao: 1 } : { tipo: "erro" };
  } finally {
    clearTimeout(temporizador);
  }
};

// Endereço público de CADA loja — nunca o host do deploy (`VERCEL_URL` muda a
// cada publicação e, em preview/produção protegida, exige login da Vercel:
// o robô do WhatsApp recebe 302 e não baixa a foto). Ordem de precedência,
// parando no primeiro valor não-vazio: `VITE_APP_URL` (configurado por loja)
// > `VERCEL_PROJECT_PRODUCTION_URL` (variável oficial da Vercel para "domínio
// público de produção", existe até em preview) > `VERCEL_URL` (o próprio
// deploy, último recurso) > o literal fixo da IKCOUS. As duas variáveis da
// Vercel chegam SEM protocolo.
type AmbienteEnderecoPublico = {
  VITE_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
};

const ENDERECO_PUBLICO_PADRAO = "https://ickous-marketplace.vercel.app";

export function resolverEnderecoPublico(env: AmbienteEnderecoPublico): string {
  const candidatos = [
    env.VITE_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];

  for (const candidato of candidatos) {
    const valor = (candidato ?? "").trim();
    if (valor === "") continue;
    const comProtocolo = /^https?:\/\//.test(valor)
      ? valor
      : `https://${valor}`;
    return comProtocolo.replace(/\/+$/, "");
  }

  return ENDERECO_PUBLICO_PADRAO;
}

// Escape mínimo para não quebrar o HTML servido ao robô: nome/descrição vêm
// do banco (o lojista escreve), e um `"` ou `<` cru fecha o atributo da meta
// tag no meio da string, vazando o resto como HTML solto.
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function middleware(
  request: Request,
  context?: ContextoDaBorda,
) {
  const url = new URL(request.url);
  const gravarEntrada = criarGravadorDeEntrada(
    process.env as AmbientePorteiro,
    context,
  );
  // A revalidação da ficha em segundo plano (stale-while-revalidate do
  // porteiro) vive no MESMO `waitUntil` do contador. Sem `context`, o porteiro
  // espera a caderneta na hora, como antes.
  const waitUntil =
    typeof context?.waitUntil === "function"
      ? (promessa: Promise<unknown>) => context.waitUntil(promessa)
      : undefined;
  const caminhoDaPrevia = url.pathname.replace(/\/$/, "");
  if (
    caminhoDaPrevia === "/product-detail" &&
    ehRoboDaPrevia(request.headers)
  ) {
    // Rodada C (11/09/2026, achado do revisor Opus): o ramo de robô
    // chamava `resolverConexao` POR FORA do porteiro, pulando
    // `decidirConcordancia` — com a caderneta apontando o host A para o
    // banco de B, o robô servia o catálogo de B enquanto o navegador no
    // MESMO host recebia 503 ("loja A com dado de loja B" pelo caminho que
    // ninguém tinha revisado). `obterFichaValidada` é a MESMA trava que o
    // documento usa (resolver + concordar + cachear, "uma trava, um
    // lugar") — a conexão do robô é SEMPRE `ficha.conexao`, nunca
    // `resolverConexao` isolado.
    const resultado = await obterFichaValidada(
      request,
      process.env as AmbientePorteiro,
      {
        fetchImpl: fetch,
        resolverNaCaderneta,
        cache: cachePorteiro,
        cacheForaDoAr,
        cacheSemLoja,
        resolucoesEmVoo,
        waitUntil,
      },
    );
    // Ficha ausente (sem-loja/discorda/banco-indisponivel) -> a MESMA 503
    // de manutenção do documento. Nunca passthrough para o HTML assado
    // aqui: no build compartilhado o assado é "a loja de ninguém", e
    // servi-lo ao robô sem ficha validada é o MESMO vazamento que a
    // concordância existe para impedir no documento. (O caso "produto não
    // encontrado", mais abaixo, segue a mesma regra: `semProduto`.)
    if (resultado.tipo === "manutencao") return resultado.resposta;
    const { ficha, caderneta: estadoCaderneta } = resultado;
    // L8: resolução pela reserva (função antiga) -> `x-ikcous-caderneta-versao`.
    const marcar = (resposta: Response): Response =>
      marcarVersaoDaCaderneta(resposta, resultado.versaoCaderneta);
    // Contador de visitas, pelo MESMO classificador do documento. O robô do
    // WhatsApp (sem Sec-Fetch) conta como `previa`; o navegador embutido segue
    // pelo documento normal abaixo. Loja em manutenção não conta.
    if (gravarEntrada !== undefined && !ficha.configuracao.manutencao) {
      const entrada = classificarEntrada({
        metodo: request.method,
        url,
        cabecalhos: request.headers,
      });
      if (entrada !== null)
        gravarEntrada(
          ficha.conexao,
          entrada.tipo === "pessoa" ? entrada.canal : "previa",
        );
    }
    const { supabaseUrl, publishableKey: supabaseKey } = ficha.conexao;
    // Nome da marca no HTML servido a crawlers: T5 (11/09/2026) tira o
    // último valor ASSADO do ramo de robô (antes: `process.env.VITE_APP_NAME`
    // ou o literal "IKCOUS Marketplace" — o mesmo problema que a ficha por
    // host já resolve para o resto da página). A MESMA ficha validada que o
    // documento usa ("uma trava, um lugar") também é a fonte do nome aqui.
    const storeName = ficha.identidade.identity.storeName;
    // Versão para entrar em HTML: o nome é escrito pelo lojista (mesmo risco
    // de `name`/`description`). `storeName` cru segue só nos fallbacks que
    // já passam inteiros por `escaparHtml` (evita escape duplo).
    const storeNameHtml = escaparHtml(storeName);
    const productId = url.searchParams.get("id");

    // `x-ikcous-og` diz QUEM respondeu: sem ele, "o middleware não rodou" e
    // "rodou e caiu no pass-through" produzem respostas byte a byte iguais
    // — foi exatamente essa ambiguidade que escondeu a Causa 2 (permission
    // denied na tabela `produtos`) atrás do sintoma de "middleware
    // ausente". `x-ikcous-caderneta` (rodada B/C): "cair em (b)" nunca é
    // silencioso em NENHUMA resposta do ramo de robô, nem no sucesso, nem
    // no sem-produto (item 2 do brief T3c) — o 503 acima já leva o header
    // por dentro de `resultado.resposta` (`respostaManutencao`).
    //
    // Produto não encontrado (pausado, apagado, inexistente, sem `id` ou
    // consulta que falhou): ANTES era `x-middleware-next: 1`, e a Vercel
    // entregava o `/index.html` ASSADO no build — a identidade da loja
    // PRINCIPAL no quadrinho de prévia de qualquer outra loja (medido
    // 14/10/2026), e a pessoa que tocava no link caía na página inicial
    // sem aviso. Agora o robô recebe o documento da PRÓPRIA loja do
    // endereço (a ficha validada acima, a mesma do navegador): título/og da
    // loja, sem produto nem preço. Falha ao montá-lo = a mesma 503 de
    // manutenção do resto do porteiro, NUNCA o HTML assado. Custo: a ficha
    // já foi obtida (cache por host de 60s) — só se baixa o documento
    // estático, igual ao navegador.
    const semProduto = async (): Promise<Response> => {
      try {
        return await documentoDaLoja(
          request,
          ficha,
          estadoCaderneta,
          { fetchImpl: fetch },
          { "x-ikcous-og": "sem-produto" },
        );
      } catch (error) {
        console.error("[Middleware] Error serving store document:", error);
        return respostaManutencao("html-indisponivel", estadoCaderneta);
      }
    };

    if (productId) {
      try {
        // Causa 2 (medida): o papel anônimo NÃO tem SELECT na tabela
        // `produtos` (42501 permission denied) — o caminho público de
        // verdade é a VIEW `vw_produtos_public`, a mesma que
        // src/lib/realtimeSyncEngine.ts usa para quem não é admin.
        const cabecalhosDaLeitura = {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        };
        // As variações saem JUNTO com o produto: o preço da prévia é o de
        // vitrine (menor preço das opções à venda, o do card e da página), e
        // não o `preco_venda` base. Falha aqui (rede, permissão, formato) vira
        // `null` e a prévia cai no preço-base — nunca derruba a prévia, nem
        // vira "produto sem prévia".
        const lerVariacoes = async (): Promise<unknown> => {
          try {
            const respostaVariacoes = await fetch(
              montarConsultaDeVariacoes(supabaseUrl, productId),
              { headers: cabecalhosDaLeitura },
            );
            return respostaVariacoes.ok ? await respostaVariacoes.json() : null;
          } catch (error) {
            console.error("[Middleware] Error fetching variants:", error);
            return null;
          }
        };
        const [response, variacoes] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/vw_produtos_public?id=eq.${encodeURIComponent(productId)}&select=*`,
            { headers: cabecalhosDaLeitura },
          ),
          lerVariacoes(),
        ]);

        if (response.ok) {
          const products = await response.json();
          if (Array.isArray(products) && products.length > 0) {
            const product = products[0];

            // Resolve values (escapados: nome/descrição vêm do banco, o
            // lojista escreve, e um `"` ou `<` cru quebraria a meta tag).
            const name = escaparHtml(product.nome || `Produto - ${storeName}`);
            // Texto puro e curto (sem ** nem #, sem quebra, teto de ~200):
            // o MESMO resumo do Worker (`compartilhamento.ts`).
            const description = escaparHtml(
              (typeof product.descricao === "string"
                ? resumoParaPrevia(product.descricao)
                : "") || `Confira os detalhes do produto no ${storeName}.`,
            );
            // Só número > 0 aparece: 0, negativo ou não numérico ficam sem
            // preço na prévia (decisão do dono, 11/09/2026).
            // O número é o preço de VITRINE (menor preço das opções à venda);
            // sem variações utilizáveis é o `preco_venda` base.
            const precoNumerico = precoDaPrevia(
              Number(product.preco_venda),
              variacoes,
            );
            const price =
              Number.isFinite(precoNumerico) && precoNumerico > 0
                ? escaparHtml(
                    `R$ ${precoNumerico.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`,
                  )
                : "";
            // `imagem_urls` é o DEFAULT `[]` da coluna com frequência — um
            // array vazio é truthy e não pode apagar `imagem_url` (decisão do
            // dono, 11/09/2026). Ordem: cada item de `imagem_urls`, DEPOIS
            // `imagem_url`.
            const rawImages = [
              ...(Array.isArray(product.imagem_urls)
                ? product.imagem_urls
                : []),
              product.imagem_url,
            ];
            const images = rawImages.filter(
              (img: any) => typeof img === "string" && img.trim() !== "",
            );
            // Só o fallback (a arte de compartilhamento da identidade, vinda
            // de `ficha.identidade.localUrls.og` — Storage da PRÓPRIA loja,
            // nunca mais um `${publicUrl}/og-image.png` do build assado) tem
            // dimensão fixa: sempre PNG 1200x630. A foto do produto não tem
            // tamanho conhecido — declarar 600x400 pra qualquer imagem
            // distorcia a prévia; sem as duas metas, o robô mede a imagem
            // sozinho.
            const ehFallback = images.length === 0;
            const imageUrl = escaparHtml(
              images[0] || ficha.identidade.localUrls.og,
            );

            const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${name} | ${storeNameHtml}</title>
  <meta name="description" content="${description}">

  <!-- Open Graph -->
  <meta property="og:title" content="${name} ${price ? `- ${price}` : ""} | ${storeNameHtml}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${escaparHtml(request.url)}" />
  <meta property="og:image" content="${imageUrl}" />${
    ehFallback
      ? `
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />`
      : ""
  }

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${name} | ${storeNameHtml}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
</head>
<body>
  <h1>${name}</h1>
  <p>${description}</p>
  <img src="${imageUrl}" alt="${name}">
</body>
</html>`;

            return marcar(
              new Response(html, {
                headers: {
                  "content-type": "text/html; charset=utf-8",
                  vary: VARY_DA_PREVIA,
                  "x-ikcous-og": "produto",
                  "x-ikcous-caderneta": estadoCaderneta,
                },
              }),
            );
          }
        }
      } catch (error) {
        console.error("[Middleware] Error fetching product:", error);
      }
    }

    // É robô, é /product-detail, mas a consulta não devolveu produto
    // (fetch falhou, resposta não-ok — ex.: a Causa 2 acima — ou lista
    // vazia). Regressão do defeito original: isto NÃO pode virar "produto".
    return marcar(await semProduto());
  }

  // Todo o resto (não é robô no caminho de produto) é um DOCUMENTO — o
  // porteiro monta a página na borda, por host, com a ficha da loja
  // (etapa 2 da escala). `passthrough`/`x-ikcous-og` seguem existindo só
  // no ramo de robô acima; o porteiro tem o próprio cabeçalho de motivo
  // (`x-ikcous-porteiro`) para quando recusa (503).
  return atenderPorteiro(request, process.env as AmbientePorteiro, {
    fetchImpl: fetch,
    resolverNaCaderneta,
    cache: cachePorteiro,
    cacheForaDoAr,
    cacheSemLoja,
    resolucoesEmVoo,
    waitUntil,
    cacheMapa: cacheMapaDoSite,
    cacheCartaz: cacheCartazDaLoja,
    cacheIndexHtml,
    indexHtmlEmVoo,
    // Pessoa abrindo a loja (ou previa de link) -> uma entrada no banco DESTA
    // loja. Quem decide se o pedido conta e' `classificarEntrada`.
    contarEntrada:
      gravarEntrada === undefined
        ? undefined
        : (conexao, pedido) => {
            const entrada = classificarEntrada({
              metodo: pedido.method,
              url: new URL(pedido.url),
              cabecalhos: pedido.headers,
            });
            if (entrada === null) return;
            gravarEntrada(
              conexao,
              entrada.tipo === "pessoa" ? entrada.canal : "previa",
            );
          },
  });
}
