import type {
  ConfiguracaoDaLoja,
  FichaDaLoja,
} from "../config/fichaDaLojaContract";
import { CAMINHO_IDENTIDADE_JSON } from "../config/fichaDaLojaContract";
// O PORTEIRO — o `middleware.ts` estendido que monta o HTML de cada loja na
// borda, por HOST, a partir de um único build compartilhado (etapa 2 da
// escala, 11/09/2026). Desenho aprovado em
// `equipe/entregas/20260911-parecer-socio-rodada2-etapa2-site-por-dominio.md`
// (seção PARA A HUB) e no brief `20260911-brief-escala-etapa2-site-por-host.md`
// (tarefas T3/T3b). `resolverConexao` e `decidirConcordancia` são o ponto de
// revisão Opus obrigatório: é aqui que nasce (ou não) "loja A com dado de
// loja B".
import { escapeHtml, identityHtml } from "../config/identidadeNoHtml";
import { MANIFESTO_BASE } from "../config/manifestoBase";
import { cleanEnvVar } from "../lib/env-publico-valores";
import { resolverValoresPublicosSupabase } from "../lib/env-publico-valores";
import { readPublicStoreIdentity } from "../lib/publicStoreIdentity";
import { assertPublicSupabaseKey } from "../lib/publicSupabaseKey";
import type { PublicStoreIdentity } from "../lib/storeIdentity";
import { identityRevision } from "../lib/storeIdentity";
import { montarDataBlock } from "./ficha";

// ─── Matcher: só DOCUMENTOS invocam o porteiro ─────────────────────────────
//
// Prefixo reservado NUNCA casa o primeiro padrão — é o que barra os
// caminhos do build (assets/, store-identity/, icons/, images/, fonts/).
const PREFIXOS_RESERVADOS = "assets/|store-identity/|icons/|images/|fonts/";

// Rodada B (11/09/2026, achado do crítico e do revisor): a rodada A excluía
// por EXTENSÃO (`.*\.[A-Za-z0-9]+$`) — mas isso também excluiria qualquer
// rota de DOCUMENTO que um dia ganhasse ponto no nome (ex.: uma página
// `/v1.2/oferta`), e não tinha como uma extensão genérica saber que
// `/manifest.webmanifest` e `/identidade.json` deveriam continuar sendo
// documentos. A troca é por LISTA NOMEADA: só os arquivos de RAIZ que o
// build realmente produz (e o service worker/PWA sempre esperam encontrar)
// ficam de fora. Cada `$` ancora no fim da string testada — sem ele,
// `/sw.jsx` (hipotético) também cairia na exclusão por ser prefixo de
// `sw.js`.
//
// Conferido contra `ls dist-test/` de um build fixture (11/09/2026): HOJE
// existem `sw.js`, `version.json`, `favicon.svg`, `sitemap.xml`,
// `og-image.png`, `silent-guardian.js`, `loading.css`, `404.html`,
// `index.html`, `offline.html` e `google8e0e5366e254e024.html`. Os demais
// (`favicon.ico`, `logo.svg`, `apple-touch-icon.png`, `robots.txt`,
// `registerSW.js`, `workbox-*.js` FORA de `assets/`) não existem nesse build
// — entram por nome porque pertencem à mesma família (raiz do PWA) e
// excluir um caminho que não existe não custa nada. `workbox-*.js` hoje só
// aparece DENTRO de `assets/` (já cobertos pelo prefixo); a entrada de raiz
// é para o dia em que isso mudar.
//
// Rodada 2 (11/09/2026, achado 1 do revisor): a lista da rodada B (acima)
// NÃO cobria `offline.html` (asset estático de `public/offline.html`, cópia
// crua) nem `google8e0e5366e254e024.html` (verificação do Google Search
// Console, `public/google8e0e5366e254e024.html`, conteúdo contratual
// `google-site-verification: google8e0e5366e254e024.html`) — os dois
// existem em `dist-test/` e, sem entrar na lista, casavam o primeiro padrão
// como documento: o porteiro fazia self-fetch de `/index.html` e devolvia o
// app shell com a ficha injetada no lugar do arquivo pedido (o Google
// deixaria de ler a string de verificação; o precache do SW gravaria o app
// shell sob a chave `offline.html`). `offline.html` entra pelo NOME exato;
// o arquivo do Google entra por PREFIXO (`google[A-Za-z0-9]*\.html$`)
// porque o nome é gerado pelo console do Google a cada reverificação — o
// padrão sobrevive a uma reverificação futura com hash diferente.
const ARQUIVOS_RESERVADOS_DE_RAIZ =
  "sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|robots\\.txt$|sitemap\\.xml$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|google[A-Za-z0-9]*\\.html$";

// O array abaixo NÃO é o que a Vercel lê: `config.matcher` em `middleware.ts`
// precisa ser um LITERAL para ser lido por análise estática (ver o
// comentário lá). Esta constante é uma CÓPIA só para teste (
// `tests/front/porteiro-matcher.test.ts` confere o valor,
// `tests/front/porteiro-middleware-matcher.test.ts` confere que o literal em
// `middleware.ts` é byte a byte igual a ela) e para derivar
// `CAMINHO_DOCUMENTO_REGEX` abaixo — `middleware.ts` NUNCA a importa para
// montar `config`. `/identidade.json` e `/manifest.webmanifest` continuam
// como entradas SEPARADAS do matcher por clareza (mecânica antiga), embora
// a lista nomeada de exclusão não precise mais delas: nenhum dos dois nomes
// está em `ARQUIVOS_RESERVADOS_DE_RAIZ`, então o primeiro padrão TAMBÉM os
// casa agora — a duplicação é inofensiva (a Vercel não falha com matcher
// redundante) e as entradas separadas continuam documentando a intenção.
const PADRAO_INTERNO_DOCUMENTO = `(?!${PREFIXOS_RESERVADOS}|${ARQUIVOS_RESERVADOS_DE_RAIZ}).*`;

export const matcher = [
  `/(${PADRAO_INTERNO_DOCUMENTO})`,
  "/identidade.json",
  "/manifest.webmanifest",
];

// `path-to-regexp` não está no `package.json` (medido, brief T3) — o padrão
// acima já É escrito como regex nativa (não sintaxe path-to-regexp), então
// testamos com `new RegExp` a mesma regra, ancorada. Isto testa a REGRA que
// decide "é documento?", não o compilador de rota que a Vercel usa por
// baixo — se o comportamento de matching da Vercel um dia divergir deste
// `RegExp` nativo, é este comentário que primeiro fica desatualizado.
export const CAMINHO_DOCUMENTO_REGEX = new RegExp(
  `^/${PADRAO_INTERNO_DOCUMENTO}$`,
);

export function ehCaminhoDeDocumento(pathname: string): boolean {
  return (
    CAMINHO_DOCUMENTO_REGEX.test(pathname) ||
    pathname === CAMINHO_IDENTIDADE_JSON ||
    pathname === "/manifest.webmanifest"
  );
}

// ─── normalizarHost ─────────────────────────────────────────────────────────

/**
 * A forma ÚNICA de host que o resto do porteiro compara (chave de cache,
 * `decidirConcordancia`): minúsculo e sem porta — `url.hostname` já entrega
 * os dois assim, medido em 11/09/2026 (`new URL("https://LOJA-A.EXEMPLO:443/").hostname`
 * → `"loja-a.exemplo"`) — e sem o ponto final de FQDN, o único dos três que
 * `URL` NÃO normaliza por conta própria (`new URL("https://loja-a.exemplo./").hostname`
 * PRESERVA o ponto). `publicUrl` da ficha faz o oposto de propósito
 * (preserva protocolo e porta, via `url.protocol`/`url.host`) — nunca usa
 * este valor.
 */
export function normalizarHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.+$/, "");
}

// ─── resolverConexao ────────────────────────────────────────────────────────

export interface AmbientePorteiro {
  readonly IKCOUS_FROTA_URL?: string;
  /** Chave PÚBLICA (publishable ou anon) do projeto da PRINCIPAL — o
   * PostgREST exige um `apikey` válido para sequer alcançar `resolver_loja`,
   * mesmo com `GRANT EXECUTE TO anon` (rodada B, convenção da caderneta). */
  readonly IKCOUS_FROTA_APIKEY?: string;
  /** O segredo de 32 bytes cujo hash vive em `frota_segredo` — viaja SÓ no
   * corpo JSON da chamada à RPC, nunca em cabeçalho nem em URL. */
  readonly IKCOUS_FROTA_CHAVE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VERCEL_ENV?: string;
  /** A NOSSA variável (cadastrada no projeto Vercel da principal) — o
   * `dominio_publico` da loja PRINCIPAL, que é a loja que toda prévia de PR
   * mostra (em preview a caderneta está ausente, então o fallback é sempre
   * o banco da principal). Ver o comentário de `decidirConcordancia` para o
   * porquê de existir (troca de uma variável da própria Vercel que se
   * mostrou instável num projeto multi-loja). */
  readonly IKCOUS_DOMINIO_PRINCIPAL?: string;
}

export interface ConexaoResolvida {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly origem: "caderneta" | "projeto";
}

/**
 * Estado da caderneta central NESTA resolução — "cair em (b) nunca é
 * silencioso" (rodada B, adendo): `hit` = a caderneta respondeu a loja;
 * `miss` = zero linhas (host não cadastrado, ou `ativa = false`); `erro` =
 * HTTP não-2xx, resposta malformada, falha de rede da RPC, OU chave
 * anômala devolvida (papel que não é `publishable`/`anon`) — dois motivos
 * BEM diferentes que compartilham o rótulo (ver o comentário de
 * `resolverConexao` para a distinção); `ausente` = as três variáveis
 * (`IKCOUS_FROTA_URL`/`_APIKEY`/`_CHAVE`) não estão TODAS configuradas, ou
 * não há implementação injetada. SÓ `ausente` cai no caminho (b) — o
 * ambiente do próprio projeto. ETAPA 3 (ADENDO A.3 + ADENDO B.1, revisor
 * Opus de T3): com a caderneta configurada, `miss` e chave anômala fecham
 * a loja NA HORA (decisão); uma falha de VERDADE da RPC (rotulada `erro`
 * também) NÃO fecha — herda o stale-if-error, porque a caderneta É o
 * banco da principal e "erro" ali não pode derrubar a frota inteira em
 * 60 s. `atenderPorteiro` escreve este valor em `x-ikcous-caderneta` em
 * toda resposta que produz — inclusive quando a resposta final é a ficha
 * antiga servida por stale-if-error.
 */
export type EstadoCaderneta = "hit" | "miss" | "erro" | "ausente";

export interface ResolucaoConexao {
  readonly conexao: ConexaoResolvida | null;
  readonly caderneta: EstadoCaderneta;
}

/** O que a caderneta central devolveu para este host. `miss` e `erro` não
 * carregam conexão — não há nada para "quase confiar". */
export type ResultadoCaderneta =
  | { readonly tipo: "hit"; readonly conexao: ConexaoResolvida }
  | { readonly tipo: "miss" }
  | { readonly tipo: "erro" };

/**
 * Injeta a chamada real à RPC `resolver_loja` (T5) — nunca fetch direto
 * dentro deste arquivo, para o teste de unidade não precisar de rede.
 * Convenção de chamada (rodada B, decisão da hub): `apikey`/`Authorization`
 * levam a chave PÚBLICA do projeto da PRINCIPAL (`frotaApikey` — é o que o
 * PostgREST exige para sequer alcançar a RPC); o segredo (`frotaChave`)
 * viaja SÓ no corpo JSON, por `POST` — nunca em cabeçalho nem em URL.
 */
export type ResolverLojaNaCaderneta = (
  host: string,
  frotaUrl: string,
  frotaApikey: string,
  frotaChave: string,
) => Promise<ResultadoCaderneta>;

/**
 * A RPC `resolver_loja` FALHOU DE VERDADE (HTTP não-2xx, rede, resposta
 * malformada) — nunca uma decisão (`miss`, chave anômala). ADENDO B, item
 * 1 (11/09/2026, crítica do lote + revisor Opus de T3): isto NUNCA pode
 * virar `DecisaoPorteiro`, porque a caderneta É o banco da PRINCIPAL —
 * tratar `erro` de RPC como decisão fecharia TODAS as lojas (a principal
 * inclusive) 60 s depois de uma simples queda do Supabase dela
 * (`CACHE_FRESCO_MS`), invertendo "loja conhecida sobrevive à queda do
 * cadastro" sem ninguém ter decidido inverter. `resolverConexao` LANÇA
 * isto em vez de devolver `{conexao: null, caderneta: "erro"}` — é o que
 * distingue este caso, dentro do módulo, do caso (b) abaixo (chave
 * anômala), que devolve o mesmo `caderneta: "erro"` só que por um RETORNO
 * normal (decisão, fecha a loja na hora). `resolverFichaViaRede` captura
 * esta exceção e reembala em `FalhaResolucaoPorteiro` — o MESMO canal que
 * já existe para falha de rede ao ler identidade/configuração — para
 * herdar o stale-if-error (`CACHE_STALE_MAX_MS`, 1h): cache quente → 200
 * com a última ficha boa; sem cache quente → 503 `banco-indisponivel`.
 * Ambos os campos (`caderneta`, `motivo`) que `resolverFichaViaRede`
 * precisa vêm junto na exceção, para quem a captura não ter que adivinhar
 * o estado.
 */
export class FalhaRpcCaderneta extends Error {
  readonly caderneta = "erro" as const;
  constructor() {
    super(
      "PORTEIRO_CADERNETA: falha da RPC resolver_loja (HTTP não-2xx, rede ou resposta malformada)",
    );
  }
}

/**
 * Escolhe QUAL banco o porteiro vai perguntar. Caminho (a): a caderneta
 * central (`resolver_loja`), só se as TRÊS variáveis (`IKCOUS_FROTA_URL`,
 * `IKCOUS_FROTA_APIKEY`, `IKCOUS_FROTA_CHAVE`) estiverem no ambiente do
 * hospedeiro E uma implementação estiver injetada. Caminho (b): o ambiente
 * do próprio projeto Vercel (mesma limpeza e precedência de
 * `resolverValoresPublicosSupabase` — publishable primeiro, depois a `anon`
 * legada) — só quando a caderneta está AUSENTE (as três variáveis não
 * configuradas, ou nenhuma implementação injetada).
 *
 * MUDANÇA DA ETAPA 3 (ADENDO A.3 + ADENDO B.1, 11/09/2026, crítico
 * 3/socio a.1 + crítica do lote item 1/revisor Opus de T3): com a
 * caderneta CONFIGURADA, um host DESCONHECIDO nunca mais cai em (b) — a
 * versão anterior ("loja conhecida sobrevive à queda do cadastro", parecer
 * da etapa 2, item 7) fazia um host DESCONHECIDO da caderneta cair no
 * banco do PRÓPRIO PROJETO hospedeiro — que, com N lojas compartilhando o
 * mesmo build, é sempre a loja PRINCIPAL: um host sem cadastro serviria
 * silenciosamente a loja errada. Dois casos de "não consegui confirmar a
 * loja" continuam fechando a loja NA HORA (decisão, `conexao: null`):
 *
 *   (a) `miss` — host não cadastrado (zero linhas, ou `ativa = false`);
 *   (b) chave devolvida pela RPC que NÃO é `publishable`/`anon` —
 *       resposta ANÔMALA da caderneta (defesa em profundidade: NUNCA
 *       repassa uma chave que não seja pública — `assertPublicSupabaseKey`
 *       recusa `service_role` e qualquer coisa fora do papel esperado,
 *       mesmo vinda da fonte de confiança), rotulada `erro` mas tratada
 *       como decisão, não como falha de rede.
 *
 * `resolverFichaViaRede` trata os dois como `DecisaoPorteiro("sem-loja",
 * caderneta)`, virando 503 `sem-loja` com `x-ikcous-caderneta` dizendo
 * qual dos dois foi.
 *
 * O TERCEIRO caso — (c) a RPC falhou DE VERDADE (HTTP não-2xx, rede, ou
 * resposta malformada) — NÃO segue o mesmo caminho (ADENDO B, item 1): ver
 * `FalhaRpcCaderneta` acima para o porquê e o mecanismo (lança em vez de
 * devolver, para `resolverFichaViaRede` herdar o stale-if-error em vez de
 * fechar a loja na hora).
 */
export async function resolverConexao(
  host: string,
  ambiente: AmbientePorteiro,
  caderneta?: ResolverLojaNaCaderneta,
): Promise<ResolucaoConexao> {
  const doProjeto = (): ConexaoResolvida | null => {
    const { supabaseUrl, chave } = resolverValoresPublicosSupabase({
      VITE_SUPABASE_URL: ambiente.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: ambiente.VITE_SUPABASE_PUBLISHABLE_KEY,
      VITE_SUPABASE_ANON_KEY: ambiente.VITE_SUPABASE_ANON_KEY,
    });
    if (
      supabaseUrl === "" ||
      chave.valor === "" ||
      !chaveEhPublica(chave.valor)
    )
      return null;
    return { supabaseUrl, publishableKey: chave.valor, origem: "projeto" };
  };

  const frotaUrl = cleanEnvVar(ambiente.IKCOUS_FROTA_URL ?? "");
  const frotaApikey = cleanEnvVar(ambiente.IKCOUS_FROTA_APIKEY ?? "");
  const frotaChave = cleanEnvVar(ambiente.IKCOUS_FROTA_CHAVE ?? "");
  if (
    frotaUrl === "" ||
    frotaApikey === "" ||
    frotaChave === "" ||
    !caderneta
  ) {
    return { conexao: doProjeto(), caderneta: "ausente" };
  }

  const resultado = await caderneta(host, frotaUrl, frotaApikey, frotaChave);
  if (resultado.tipo === "miss") return { conexao: null, caderneta: "miss" };
  // (c) falha DE VERDADE da RPC — lança, nunca devolve: ver
  // `FalhaRpcCaderneta` e o comentário desta função.
  if (resultado.tipo === "erro") throw new FalhaRpcCaderneta();
  if (!chaveEhPublica(resultado.conexao.publishableKey))
    return { conexao: null, caderneta: "erro" };
  return { conexao: resultado.conexao, caderneta: "hit" };
}

function chaveEhPublica(chave: string): boolean {
  try {
    assertPublicSupabaseKey(chave);
    return true;
  } catch {
    return false;
  }
}

// ─── decidirConcordancia ────────────────────────────────────────────────────

export interface ParametrosConcordancia {
  readonly host: string;
  readonly dominioPublico: string | null;
  readonly vercelEnv: string | undefined;
  readonly dominioPrincipal: string | undefined;
}

/**
 * "loja A com dado de loja B" nasce aqui se este cruzamento falhar. O banco
 * da loja escolhida precisa concordar que É DONO do host atendido —
 * `dominio_publico` (falha fechada: `NULL` ou ausente conta como
 * "sem-loja", nunca "ok"). Fora de produção (preview de PR), a Vercel serve
 * em hosts do tipo `*-git-*.vercel.app` que NUNCA vão bater com
 * `dominio_publico`; a única concessão é aceitar quando o banco concorda
 * com `IKCOUS_DOMINIO_PRINCIPAL` — o `dominio_publico` da loja PRINCIPAL,
 * que é a loja que TODA prévia de PR mostra (em preview a caderneta central
 * está ausente, então o fallback cai sempre no banco da principal). Essa
 * concessão só vale quando `vercelEnv === "preview"` (rodada B, achado do
 * revisor: a rodada A relaxava para QUALQUER `vercelEnv` diferente de
 * `"production"`, inclusive `"development"` — um ambiente de teste local
 * não é preview de PR e não deveria ganhar o mesmo relaxamento) e
 * `dominioPrincipal` não vazio. `vercelEnv === "production"` ou `undefined`
 * NUNCA relaxam — falha fechada por padrão, nunca por omissão de env.
 *
 * POR QUE NÃO É MAIS `VERCEL_PROJECT_PRODUCTION_URL` (correção medida em
 * 12/09/2026, PR #545): a doc oficial da Vercel descreve essa variável como
 * "o domínio de produção MAIS CURTO do projeto" — não "o domínio DESTA
 * loja". Com o projeto principal passando a hospedar TODAS as lojas (cada
 * loja ganha um alias `.vercel.app` extra no MESMO projeto, etapa 2 da
 * escala), a variável passou a devolver o nome mais curto entre TODAS as
 * lojas, não necessariamente o da principal — medido na prévia do PR #545:
 * a variável valia `savycollection.vercel.app` (24 letras) em vez de
 * `ickous-marketplace.vercel.app` (29), o `sitemap.xml` da prévia foi
 * assado com o domínio errado, e a prévia respondia `/` 503 com
 * `x-ikcous-porteiro: discorda`. Qualquer regra que dependa dessa variável
 * quebra assim que o projeto vira multi-loja. A correção troca a fonte por
 * `IKCOUS_DOMINIO_PRINCIPAL`, uma variável NOSSA que sempre vale o
 * `dominio_publico` real da principal, cadastrada à mão no projeto — nunca
 * inferida pela Vercel.
 *
 * 4º resultado (11/09/2026, decisão do sócio aprovada pelo Gabriel — brief
 * `20260911-brief-aliases-vercel-encaminham.md`): em PRODUÇÃO, um alias
 * automático da própria Vercel (`*.vercel.app`, o host termina nesse
 * sufixo) que discorda do `dominio_publico` não é "loja A com dado de loja
 * B" — é um endereço antigo do MESMO deploy tentando abrir o site (nenhum
 * link comprido foi divulgado, só os aliases que a própria Vercel fabrica).
 * Em vez de 503, a resposta é `"encaminha"` — quem chama monta um 308 para
 * o `dominio_publico` desta MESMA loja. A concessão é estrita: só
 * `vercelEnv === "production"` (nunca preview — já tratado acima —, nunca
 * `development`, nunca `undefined`) e só quando o host bate o sufixo
 * `.vercel.app`; qualquer outro host que discorde (domínio próprio, ou
 * `.vercel.app` fora de produção) continua em `discorda`, byte a byte como
 * antes desta rodada. A regra 3 (dominio_publico não-nulo/não-vazio) já foi
 * checada acima e sempre vence — `sem-loja` nunca vira `encaminha`.
 * `dominioPrincipal` NUNCA entra nesta regra — produção decide só pelo
 * sufixo do host, mesmo que `dominioPrincipal` bata com o host ou com o
 * `dominio_publico`.
 */
export function decidirConcordancia(
  params: ParametrosConcordancia,
): "ok" | "sem-loja" | "discorda" | "encaminha" {
  const { host, dominioPublico, vercelEnv, dominioPrincipal } = params;
  if (dominioPublico === null || dominioPublico === "") return "sem-loja";
  const hostMinusculo = host.toLowerCase();
  const dominioMinusculo = dominioPublico.toLowerCase();
  if (hostMinusculo === dominioMinusculo) return "ok";
  const ehPreview = vercelEnv === "preview";
  if (
    ehPreview &&
    dominioPrincipal !== undefined &&
    // Redundante com a regra 3 (`dominioMinusculo !== ""`, checada acima):
    // vazio nunca bate um `dominio_publico` não vazio. Fica só por legibilidade.
    dominioPrincipal !== "" &&
    dominioPrincipal.toLowerCase() === dominioMinusculo
  ) {
    return "ok";
  }
  if (vercelEnv === "production" && hostMinusculo.endsWith(".vercel.app")) {
    return "encaminha";
  }
  return "discorda";
}

// ─── montarFicha ────────────────────────────────────────────────────────────

export interface EntradaMontarFicha {
  readonly host: string;
  readonly identity: PublicStoreIdentity;
  readonly publicUrl: string;
  readonly conexao: ConexaoResolvida;
  /** Os 4 valores públicos por loja (etapa 3 da escala, 11/09/2026) — lidos
   * na MESMA consulta que `dominio_publico` (`lerConfiguracaoPublica`,
   * abaixo). */
  readonly configuracao: ConfiguracaoDaLoja;
}

/** Compõe a `FichaDaLoja` a partir do que já foi lido/decidido. Assíncrona
 * só por causa de `identityRevision` (hash SHA-256, determinístico e sem
 * rede) — sem outro efeito colateral.
 *
 * `schemaVersion: 2` (ADENDO A.6): a ficha ganhou o bloco `configuracao` —
 * bump de versão, não campo opcional, porque `/identidade.json` sobrevive
 * no cache do service worker entre deploys e uma ficha v1 (sem
 * `configuracao`) TEM que ser rejeitada pelo leitor (`fichaDaLoja.ts`, T2),
 * nunca lida como `configuracao: undefined`. */
export async function montarFicha(
  entrada: EntradaMontarFicha,
): Promise<FichaDaLoja> {
  const { host, identity, publicUrl, conexao, configuracao } = entrada;
  return {
    schemaVersion: 2,
    host: host.toLowerCase(),
    identidade: {
      identity,
      localUrls: identity.urls,
      publicUrl,
      identityRevision: await identityRevision(identity),
    },
    conexao: {
      supabaseUrl: conexao.supabaseUrl,
      publishableKey: conexao.publishableKey,
    },
    configuracao,
  };
}

// ─── injetarFichaNoHtml ─────────────────────────────────────────────────────

const REGEX_STYLE_ASSADO =
  /<style id="dynamic-branding-style">[\s\S]*?<\/style>/;

/**
 * Injeta, logo depois de `<head>`: o data block da ficha, o
 * `<style id="dynamic-branding-style">` (substituindo o assado se existir —
 * por isso ele é removido ANTES de chamar `identityHtml`, que só sabe
 * INSERIR) e as metas/título/ícones da identidade, com a MESMA função pura
 * que o build usa (`src/config/identidadeNoHtml.ts`).
 */
export function injetarFichaNoHtml(html: string, ficha: FichaDaLoja): string {
  const semStyleAssado = html.replace(REGEX_STYLE_ASSADO, "");
  const comIdentidade = identityHtml(semStyleAssado, {
    identity: ficha.identidade.identity,
    localUrls: ficha.identidade.localUrls,
    publicUrl: ficha.identidade.publicUrl,
  });
  const dataBlock = montarDataBlock(ficha);
  return comIdentidade.replace("<head>", () => `<head>${dataBlock}`);
}

// ─── respostaManutencao ─────────────────────────────────────────────────────

export type MotivoManutencao =
  | "sem-loja"
  | "discorda"
  | "banco-indisponivel"
  | "html-indisponivel";

/**
 * Falha fechada: divergiu, faltou ou não deu para ler → 503, nunca uma
 * página de outra loja. `x-ikcous-porteiro` diz o motivo (só para
 * diagnóstico — nunca dado de banco); `x-ikcous-caderneta` (rodada B) diz o
 * que aconteceu com a caderneta central nesta tentativa, para "caiu em (b)"
 * nunca ficar silencioso mesmo quando a resposta final é um 503.
 */
export function respostaManutencao(
  motivo: MotivoManutencao,
  caderneta: EstadoCaderneta,
): Response {
  const corpo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml("Loja em manutenção")}</title></head><body><p>${escapeHtml("Esta loja está em manutenção. Volte em instantes.")}</p></body></html>`;
  return new Response(corpo, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
      "x-ikcous-porteiro": motivo,
      "x-ikcous-caderneta": caderneta,
    },
  });
}

// ─── respostaEncaminhamento ─────────────────────────────────────────────────

/**
 * O 4º resultado de `decidirConcordancia` (`"encaminha"`) vira um 308
 * Permanent Redirect para `destino` — SEMPRE `https://<dominio_publico>`
 * mais o `pathname`/`search` do pedido atendido, verbatim, nunca conteúdo:
 * corpo vazio, nunca a página de loja nenhuma (brief
 * `20260911-brief-aliases-vercel-encaminham.md`). `cache-control: no-store`
 * (instrução do sócio: "não guardar isto", para o redirect não grudar no
 * navegador se o `dominio_publico` mudar amanhã) — a MESMA disciplina de
 * `respostaManutencao`, que fica só para os 503.
 */
export function respostaEncaminhamento(
  destino: string,
  caderneta: EstadoCaderneta,
): Response {
  return new Response(null, {
    status: 308,
    headers: {
      location: destino,
      "cache-control": "no-store",
      "x-ikcous-porteiro": "encaminha",
      "x-ikcous-caderneta": caderneta,
    },
  });
}

// ─── lerConfiguracaoPublica ─────────────────────────────────────────────────
//
// SEPARADO de `readPublicStoreIdentity`: aquela função valida o `select`
// EXATO da identidade e recusa qualquer outro (`controlledFetch` em
// `src/lib/publicStoreIdentity.ts`), então a concordância e a configuração
// pública precisam da sua própria chamada a `v_store_config`. Banco sem
// alguma das 5 colunas (migration não aplicada ainda) → PostgREST 400 (ou
// linha sem o campo) → o porteiro trata como `banco-indisponivel` (falha
// fechada); os testes usam um `fetchImpl` dublê que já devolve as 5
// colunas, simulando o banco pós-migration.
//
// ETAPA 3 (11/09/2026, brief T3): esta consulta, que já lia só
// `dominio_publico` para a concordância (`decidirConcordancia`), passa a
// pedir NUMA SÓ CHAMADA `dominio_publico,mp_public_key,vapid_public_key,
// pagamento_online,manutencao` — os 4 valores por loja que a partir de
// agora viajam na ficha (`configuracao`, `fichaDaLojaContract.ts`, T2) em
// vez de serem ASSADOS no build. Uma consulta a mais por loja custaria uma
// chamada extra ao PostgREST por resolução de host; juntar os 5 campos na
// MESMA chamada que já existia mantém o número de consultas de rede igual
// ao de antes desta etapa (SUPOSIÇÃO: o brief diz "UMA consulta, como
// hoje" — "hoje" é lido como "quantas chamadas de rede o porteiro já fazia
// para dominio_publico", não como "não pode crescer o número de colunas").

/** O `select` exato desta chamada — exportado só para os testes (fixtures
 * de `fetchImpl`) não hardcoderem a string em 3 arquivos diferentes e
 * divergirem se a lista de colunas mudar aqui. */
export const SELECT_CONFIGURACAO_PUBLICA =
  "dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao";

// MESMO prazo padrão e MESMO teto de bytes que `readPublicStoreIdentity`
// aplica (`src/lib/publicStoreIdentity.ts`, `withDeadline`/`readBytes`) —
// não importados de lá porque aquele arquivo não expõe as duas peças
// internas e não está na lista de arquivos tocáveis desta tarefa; replicado
// aqui com o mesmo valor (rodada B, item 5 do brief).
const LER_CONFIGURACAO_PUBLICA_TIMEOUT_MS = 10_000;
const LER_CONFIGURACAO_PUBLICA_MAX_BYTES = 256 * 1024;

/** Lê o corpo da resposta sob um teto de bytes, cancelando o stream (nunca
 * materializando o corpo inteiro antes de checar) se o teto for excedido —
 * mesma defesa de `readBytes` em `publicStoreIdentity.ts`, sem o parâmetro
 * `exactBytes` (aqui não há tamanho esperado a priori). */
async function lerCorpoComTeto(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    const texto = await response.text();
    if (new TextEncoder().encode(texto).byteLength > maxBytes)
      throw new Error("PORTEIRO_CONFIGURACAO_PUBLICA: resposta grande demais");
    return texto;
  }
  const reader = response.body.getReader();
  const pedacos: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const parte = await reader.read();
      signal.throwIfAborted();
      if (parte.done) break;
      tamanho += parte.value.byteLength;
      if (tamanho > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error(
          "PORTEIRO_CONFIGURACAO_PUBLICA: resposta grande demais",
        );
      }
      pedacos.push(parte.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(tamanho);
  let deslocamento = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, deslocamento);
    deslocamento += pedaco.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export interface ConfiguracaoPublicaResolvida {
  readonly dominioPublico: string | null;
  readonly configuracao: ConfiguracaoDaLoja;
}

/** `string | null` que valida o tipo antes de aceitar — usado para
 * `dominio_publico`, `mp_public_key` e `vapid_public_key`: as 3 colunas
 * que podem ser `NULL` no banco (recurso desligado ou host sem loja). */
function lerColunaTextoOuNull(valor: unknown, coluna: string): string | null {
  if (valor === null) return null;
  if (typeof valor !== "string")
    throw new Error(
      `PORTEIRO_CONFIGURACAO_PUBLICA: tipo inesperado (${coluna})`,
    );
  return valor;
}

/** Mesma leitura de `lerColunaTextoOuNull`, mas string vazia ou só espaços
 * também vira `null` — usada SÓ para `mp_public_key`/`vapid_public_key`
 * (ADENDO A.5, "falha por campo, não por loja"). Defesa em profundidade:
 * a migration 20261150 não tem CHECK que recuse `''` nestas duas colunas
 * (conferido no arquivo da migration), então uma gravação manual ou um
 * script com bug pode deixar `''` no banco. Sem esta normalização, o
 * porteiro montaria a ficha com `mpPublicKey: ''`, e `configuracaoValida`
 * (`src/config/fichaDaLoja.ts`, exige `length > 0` para string não-nula)
 * reprovaria a ficha INTEIRA — derrubando a vitrine inteira por uma chave
 * vazia, quando o combinado é só desligar o pagamento/push daquele campo.
 * Não se aplica a `dominio_publico`: aquele já tem a própria regra de
 * "vazio = sem-loja" em `decidirConcordancia`, que não muda aqui. */
function lerColunaChavePublicaOuNull(
  valor: unknown,
  coluna: string,
): string | null {
  const bruto = lerColunaTextoOuNull(valor, coluna);
  if (bruto === null) return null;
  return bruto.trim() === "" ? null : bruto;
}

/** `boolean` estrito — `pagamento_online`/`manutencao` têm `NOT NULL
 * DEFAULT false` no banco (migration 20261150): nunca deveriam chegar como
 * `null`, mas um valor fora do tipo (linha corrompida, banco divergente)
 * fecha a loja pela mesma trava das outras colunas, nunca um `Boolean(x)`
 * complacente. */
function lerColunaBooleana(valor: unknown, coluna: string): boolean {
  if (typeof valor !== "boolean")
    throw new Error(
      `PORTEIRO_CONFIGURACAO_PUBLICA: tipo inesperado (${coluna})`,
    );
  return valor;
}

async function lerConfiguracaoPublicaComSinal(
  conexao: ConexaoResolvida,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<ConfiguracaoPublicaResolvida> {
  const url = `${conexao.supabaseUrl}/rest/v1/v_store_config?select=${SELECT_CONFIGURACAO_PUBLICA}&id=eq.1&limit=2`;
  const resposta = await fetchImpl(url, {
    headers: {
      apikey: conexao.publishableKey,
      Authorization: `Bearer ${conexao.publishableKey}`,
    },
    signal,
    redirect: "error",
    credentials: "omit",
  });
  if (!resposta.ok)
    throw new Error("PORTEIRO_CONFIGURACAO_PUBLICA: resposta não-ok");
  const texto = await lerCorpoComTeto(
    resposta,
    signal,
    LER_CONFIGURACAO_PUBLICA_MAX_BYTES,
  );
  const linhas: unknown = JSON.parse(texto);
  if (!Array.isArray(linhas) || linhas.length !== 1)
    throw new Error("PORTEIRO_CONFIGURACAO_PUBLICA: forma inesperada");
  const linha = linhas[0];
  if (linha === null || typeof linha !== "object")
    throw new Error("PORTEIRO_CONFIGURACAO_PUBLICA: linha inesperada");
  const registro = linha as Record<string, unknown>;
  // Banco sem a migration 20261150 (view antiga, sem as 4 colunas novas —
  // ou qualquer uma das 5 ausente por algum outro motivo) tem de falhar
  // fechado aqui, ANTES de tentar ler o valor: uma coluna simplesmente
  // ausente do objeto JSON (PostgREST omite, não manda `null`) passaria
  // pelos leitores de tipo abaixo como `undefined`, que `lerColunaTextoOuNull`
  // rejeitaria mesmo assim — mas o erro nomeado aqui é mais claro sobre a
  // causa real (migration pendente) do que "tipo inesperado".
  for (const coluna of [
    "dominio_publico",
    "mp_public_key",
    "vapid_public_key",
    "pagamento_online",
    "manutencao",
  ] as const) {
    if (!(coluna in registro))
      throw new Error(
        `PORTEIRO_CONFIGURACAO_PUBLICA: coluna ausente (${coluna})`,
      );
  }
  return {
    dominioPublico: lerColunaTextoOuNull(
      registro.dominio_publico,
      "dominio_publico",
    ),
    configuracao: {
      mpPublicKey: lerColunaChavePublicaOuNull(
        registro.mp_public_key,
        "mp_public_key",
      ),
      vapidPublicKey: lerColunaChavePublicaOuNull(
        registro.vapid_public_key,
        "vapid_public_key",
      ),
      pagamentoOnline: lerColunaBooleana(
        registro.pagamento_online,
        "pagamento_online",
      ),
      manutencao: lerColunaBooleana(registro.manutencao, "manutencao"),
    },
  };
}

/**
 * MESMO prazo, MESMO `AbortSignal`, MESMO `redirect: "error"`/
 * `credentials: "omit"` e MESMO teto de bytes que `readPublicStoreIdentity`
 * aplica (rodada B, item 5 do brief). `Promise.race` contra um temporizador
 * — nunca só `signal.abort()` sozinho — porque um `fetchImpl` que nunca
 * resolve (dublê de teste, ou um transporte real que ignore o sinal) faria
 * o `await fetchImpl(...)` pendurar para sempre; só a corrida com o
 * temporizador garante que esta função sempre resolve dentro do prazo,
 * mesmo que a promessa de rede nunca o faça (mesma forma de `withDeadline`
 * em `publicStoreIdentity.ts`).
 */
async function lerConfiguracaoPublica(
  conexao: ConexaoResolvida,
  fetchImpl: typeof fetch,
): Promise<ConfiguracaoPublicaResolvida> {
  const controller = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const prazoEsgotado = new Promise<never>((_resolve, reject) => {
    temporizador = setTimeout(() => {
      controller.abort();
      reject(new Error("PORTEIRO_CONFIGURACAO_PUBLICA: prazo esgotado"));
    }, LER_CONFIGURACAO_PUBLICA_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      lerConfiguracaoPublicaComSinal(conexao, fetchImpl, controller.signal),
      prazoEsgotado,
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

// ─── atenderPorteiro — o orquestrador (I/O; as peças acima são puras) ──────

export interface EntradaCachePorteiro {
  readonly ficha: FichaDaLoja;
  readonly quando: number;
  /** O estado da caderneta QUANDO esta ficha foi resolvida — usado no
   * cabeçalho de respostas servidas do cache (fresco ou stale-if-error),
   * já que recalcular a caderneta a cada resposta cacheada anularia o
   * propósito do cache. */
  readonly caderneta: EstadoCaderneta;
}

/** 60 s de cache fresco (não repete a consulta); serve o último bom por até
 * 1h em falha de rede (stale-if-error) — "loja conhecida sobrevive à queda
 * da caderneta, loja nova espera" (parecer, item 7). */
export const CACHE_FRESCO_MS = 60_000;
export const CACHE_STALE_MAX_MS = 3_600_000;

export interface DependenciasPorteiro {
  readonly fetchImpl: typeof fetch;
  readonly resolverNaCaderneta?: ResolverLojaNaCaderneta;
  /** Injetável só para teste; produção usa `readPublicStoreIdentity` real. */
  readonly lerIdentidade?: typeof readPublicStoreIdentity;
  /** `Map` de módulo — vive em `middleware.ts`, uma vez por isolate, e é
   * passada aqui para cada chamada (é o que torna a função testável sem
   * estado global escondido). */
  readonly cache: Map<string, EntradaCachePorteiro>;
  /** Relógio injetável — testes avançam o tempo sem `sleep`. */
  readonly agora?: () => number;
}

class DecisaoPorteiro extends Error {
  readonly motivo: MotivoManutencao;
  readonly caderneta: EstadoCaderneta;
  constructor(motivo: MotivoManutencao, caderneta: EstadoCaderneta) {
    super(motivo);
    this.motivo = motivo;
    this.caderneta = caderneta;
  }
}

/**
 * O resultado `"encaminha"` de `decidirConcordancia` — SEPARADO de
 * `DecisaoPorteiro` porque não é um motivo de 503 (`MotivoManutencao`): é
 * uma decisão de REDIRECIONAR, com o destino completo já montado
 * (`https://<dominio_publico><pathname><search>`, brief
 * `20260911-brief-aliases-vercel-encaminham.md`). `obterFichaValidada`
 * devolve a resposta de encaminhamento pelo MESMO canal (`tipo:
 * "manutencao"`) que hoje devolve a de manutenção — ver o comentário ali
 * sobre a escolha de reaproveitar o tipo em vez de criar um novo.
 */
class DecisaoEncaminhamento extends Error {
  readonly destino: string;
  readonly caderneta: EstadoCaderneta;
  constructor(destino: string, caderneta: EstadoCaderneta) {
    super("encaminha");
    this.destino = destino;
    this.caderneta = caderneta;
  }
}

/** Envolve qualquer falha de REDE/schema (isto é, algo que NÃO é uma
 * DECISÃO do porteiro) com o `EstadoCaderneta` que esta tentativa já tinha
 * resolvido ANTES de falhar — é o que permite ao 503 `banco-indisponivel`
 * (ou ao stale-if-error) continuar dizendo, em `x-ikcous-caderneta`, o que
 * aconteceu com a caderneta antes da falha de identidade/domínio. */
class FalhaResolucaoPorteiro extends Error {
  readonly caderneta: EstadoCaderneta;
  constructor(caderneta: EstadoCaderneta, causa: unknown) {
    super("PORTEIRO_FALHA_RESOLUCAO", { cause: causa });
    this.caderneta = caderneta;
  }
}

interface FichaResolvida {
  readonly ficha: FichaDaLoja;
  readonly caderneta: EstadoCaderneta;
}

async function resolverFichaViaRede(
  host: string,
  url: URL,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
): Promise<FichaResolvida> {
  // `caderneta` só é conhecida DEPOIS de `resolverConexao` resolver (ou
  // lançar) — por isso a chamada entrou para DENTRO do `try` (ADENDO B.1):
  // é o que permite ao `catch` capturar `FalhaRpcCaderneta` (RPC que falhou
  // de verdade) no MESMO lugar que já captura falha de rede ao ler
  // identidade/configuração, e reembalar as duas em `FalhaResolucaoPorteiro`
  // para herdar o stale-if-error. O valor inicial "ausente" só é usado se
  // `resolverConexao` lançar algo IMPREVISTO (nem `DecisaoPorteiro`/
  // `DecisaoEncaminhamento`, nem `FalhaRpcCaderneta`) — mesmo default do
  // fallback que já existia em `obterFichaValidada`.
  let caderneta: EstadoCaderneta = "ausente";
  try {
    const resolucao = await resolverConexao(
      host,
      ambiente,
      deps.resolverNaCaderneta,
    );
    caderneta = resolucao.caderneta;
    if (!resolucao.conexao) throw new DecisaoPorteiro("sem-loja", caderneta);
    const conexao = resolucao.conexao;
    const lerIdentidade = deps.lerIdentidade ?? readPublicStoreIdentity;
    const [identity, configuracaoPublica] = await Promise.all([
      lerIdentidade({
        supabaseUrl: conexao.supabaseUrl,
        publicKey: conexao.publishableKey,
        fetchImpl: deps.fetchImpl,
      }),
      lerConfiguracaoPublica(conexao, deps.fetchImpl),
    ]);
    const { dominioPublico, configuracao } = configuracaoPublica;
    const decisao = decidirConcordancia({
      host,
      dominioPublico,
      vercelEnv: ambiente.VERCEL_ENV,
      // Rodada de correção (revisor Opus, achado 1): `IKCOUS_DOMINIO_PRINCIPAL`
      // é digitada à mão no painel da Vercel — um `\n` ou espaço colado no
      // valor faria TODA prévia responder 503 `discorda`, porque a comparação
      // é byte a byte. `cleanEnvVar` é a MESMA limpeza que
      // `IKCOUS_FROTA_URL`/`_APIKEY`/`_CHAVE` já recebem, acima. Gatilho
      // conhecido (re-revisão Opus, 12/09/2026): `cleanEnvVar` apaga TODO
      // caractere fora de `!-~`, acento inclusive — se um dia a principal
      // tiver domínio próprio com acento, a comparação aqui nunca bate e toda
      // prévia vira 503; nesse dia a limpeza certa é `trim` + `normalize`.
      dominioPrincipal: cleanEnvVar(ambiente.IKCOUS_DOMINIO_PRINCIPAL ?? ""),
    });
    if (decisao === "encaminha") {
      // `decidirConcordancia` só devolve "encaminha" depois de já ter
      // validado `dominioPublico` não-nulo/não-vazio (regra 3, checada
      // primeiro na função) — o cast documenta essa invariante sem
      // duplicar a checagem aqui.
      const destino = `https://${dominioPublico as string}${url.pathname}${url.search}`;
      throw new DecisaoEncaminhamento(destino, caderneta);
    }
    if (decisao !== "ok") throw new DecisaoPorteiro(decisao, caderneta);
    // `publicUrl` preserva protocolo e porta do pedido atendido (rodada B,
    // item 4) — nunca `https://${host}` fixo, porque a prova ponta a ponta
    // (T6) roda em `http://loja-a.localhost:<porto>`.
    const ficha = await montarFicha({
      host,
      identity,
      publicUrl: `${url.protocol}//${url.host}`,
      conexao,
      configuracao,
    });
    return { ficha, caderneta };
  } catch (erro) {
    if (
      erro instanceof DecisaoPorteiro ||
      erro instanceof DecisaoEncaminhamento
    )
      throw erro;
    // A RPC da caderneta falhou DE VERDADE (ADENDO B.1) — o rótulo vem do
    // próprio erro (`"erro"`, sempre), não da variável `caderneta` do
    // escopo externo, porque `resolverConexao` pode ter lançado ANTES de
    // atribuí-la.
    if (erro instanceof FalhaRpcCaderneta)
      throw new FalhaResolucaoPorteiro(erro.caderneta, erro);
    throw new FalhaResolucaoPorteiro(caderneta, erro);
  }
}

function passthroughPorteiro(): Response {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

function iconesManifestParaUrls(
  localUrls: PublicStoreIdentity["urls"],
): Array<{ src: string; sizes: string; type: string; purpose?: string }> {
  return [
    { src: localUrls.icon_192, sizes: "192x192", type: "image/png" },
    { src: localUrls.icon_512, sizes: "512x512", type: "image/png" },
    {
      src: localUrls.maskable_512,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
}

/**
 * Monta o manifest inteiramente A PARTIR DA FICHA, sem self-fetch de
 * `/manifest.webmanifest` (correção do achado 4 da revisão: esse caminho
 * está DENTRO do matcher, então um `fetch` da própria origem para ele
 * re-invoca o porteiro — recursão sem fundo, e na Vercel Edge é invocação
 * cobrada em loop). Os campos que não vêm da identidade são fixos
 * (`MANIFESTO_BASE`, compartilhado com `vite.config.ts`).
 */
function atenderManifest(
  ficha: FichaDaLoja,
  caderneta: EstadoCaderneta,
): Response {
  const { identity, localUrls } = ficha.identidade;
  const manifest = {
    ...MANIFESTO_BASE,
    name: identity.storeName,
    short_name: identity.storeName,
    description: `Produtos e novidades de ${identity.storeName}`,
    theme_color: identity.theme.primary,
    background_color: identity.theme.primary,
    icons: iconesManifestParaUrls(localUrls),
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-store",
      "x-ikcous-porteiro": "ok",
      "x-ikcous-caderneta": caderneta,
    },
  });
}

// ─── obterFichaValidada — resolver + concordar + cachear (T3c, "UMA TRAVA,
// UM LUGAR") ─────────────────────────────────────────────────────────────
//
// Extraído de `atenderPorteiro` (achado do revisor Opus, rodada C): o ramo
// de robô do `middleware.ts` (`/product-detail` + user-agent de crawler)
// chamava `resolverConexao` POR FORA, pulando `decidirConcordancia` — com a
// caderneta apontando o host A para o banco de B, o robô servia o catálogo
// de B (200) enquanto o navegador no MESMO host recebia 503. Documento e
// robô agora chamam esta MESMA função: os dois herdam cache, concordância e
// "falha fechada" de um lugar só. Nunca resolver conexão por fora dela.
export type ResultadoObterFicha =
  | {
      readonly tipo: "ok";
      readonly ficha: FichaDaLoja;
      readonly caderneta: EstadoCaderneta;
    }
  | { readonly tipo: "manutencao"; readonly resposta: Response };

export async function obterFichaValidada(
  request: Request,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
): Promise<ResultadoObterFicha> {
  const url = new URL(request.url);
  const host = normalizarHost(url);
  const relogio = deps.agora ?? Date.now;
  const agora = relogio();

  // `publicUrl` NUNCA vem do cache (rodada C, item 4): a MESMA entrada de
  // cache (chaveada por `normalizarHost`, que descarta porta e protocolo)
  // atende requisições em portas/protocolos diferentes para o mesmo host
  // (ex.: T6 roda em `http://loja-a.localhost:<porto>`, um porto por
  // servidor de teste) — recalcular por REQUISIÇÃO, em vez de chavear o
  // cache por porta, evita multiplicar entradas de cache por porta que
  // ninguém pediu (a concordância continua sendo por HOST, não por porta).
  const comPublicUrlAtual = (ficha: FichaDaLoja): FichaDaLoja => ({
    ...ficha,
    identidade: {
      ...ficha.identidade,
      publicUrl: `${url.protocol}//${url.host}`,
    },
  });

  const doCache = deps.cache.get(host);
  if (doCache && agora - doCache.quando < CACHE_FRESCO_MS) {
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(doCache.ficha),
      caderneta: doCache.caderneta,
    };
  }
  try {
    const resolvida = await resolverFichaViaRede(host, url, ambiente, deps);
    deps.cache.set(host, {
      ficha: resolvida.ficha,
      quando: agora,
      caderneta: resolvida.caderneta,
    });
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(resolvida.ficha),
      caderneta: resolvida.caderneta,
    };
  } catch (erro) {
    // Escolha registrada no relatório da tarefa (brief
    // `20260911-brief-aliases-vercel-encaminham.md`, item 4): o 308 de
    // encaminhamento reaproveita o MESMO canal (`tipo: "manutencao"` com
    // `resposta: Response`) que a decisão `discorda`/`sem-loja` já usa, em
    // vez de um tipo próprio `"encaminha"`. Os dois consumidores
    // (`atenderPorteiro` e o ramo de robô em `middleware.ts`) já fazem
    // `if (resultado.tipo === "manutencao") return resultado.resposta` —
    // reaproveitar evita alargar `ResultadoObterFicha` e não exige tocar em
    // `middleware.ts` para este redirecionamento chegar aos dois.
    if (erro instanceof DecisaoEncaminhamento)
      return {
        tipo: "manutencao",
        resposta: respostaEncaminhamento(erro.destino, erro.caderneta),
      };
    if (erro instanceof DecisaoPorteiro)
      return {
        tipo: "manutencao",
        resposta: respostaManutencao(erro.motivo, erro.caderneta),
      };
    // Falha de rede/schema (não é uma DECISÃO): stale-if-error por até 1h.
    // O `x-ikcous-caderneta` reflete o que ESTA tentativa (a que falhou)
    // já sabia sobre a caderneta antes de falhar — informação mais atual
    // do que a caderneta que produziu a ficha em cache, ainda que a ficha
    // servida seja a antiga.
    const cadernetaDaFalha =
      erro instanceof FalhaResolucaoPorteiro ? erro.caderneta : "ausente";
    if (doCache && agora - doCache.quando < CACHE_STALE_MAX_MS) {
      return {
        tipo: "ok",
        ficha: comPublicUrlAtual(doCache.ficha),
        caderneta: cadernetaDaFalha,
      };
    }
    return {
      tipo: "manutencao",
      resposta: respostaManutencao("banco-indisponivel", cadernetaDaFalha),
    };
  }
}

/**
 * O handler que `middleware.ts` chama para qualquer caminho de DOCUMENTO
 * (o matcher já filtrou assets na entrada da Vercel; aqui só GET/HEAD são
 * atendidos — outro método é pass-through, já que o matcher só filtra por
 * caminho, nunca por verbo).
 */
export async function atenderPorteiro(
  request: Request,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return passthroughPorteiro();

  const resultado = await obterFichaValidada(request, ambiente, deps);
  if (resultado.tipo === "manutencao") return resultado.resposta;
  const { ficha, caderneta: estadoCaderneta } = resultado;

  const url = new URL(request.url);
  if (url.pathname === CAMINHO_IDENTIDADE_JSON) {
    return new Response(JSON.stringify(ficha), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-ikcous-porteiro": "ok",
        "x-ikcous-caderneta": estadoCaderneta,
      },
    });
  }
  if (url.pathname === "/manifest.webmanifest")
    return atenderManifest(ficha, estadoCaderneta);

  const respostaHtml = await deps.fetchImpl(
    new URL("/index.html", request.url),
    {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    },
  );
  if (respostaHtml.status !== 200)
    return respostaManutencao("html-indisponivel", estadoCaderneta);
  const html = await respostaHtml.text();
  const injetado = injetarFichaNoHtml(html, ficha);
  return new Response(injetado, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-ikcous-porteiro": "ok",
      "x-ikcous-caderneta": estadoCaderneta,
      "cache-control": "no-store",
      vary: "host",
    },
  });
}
