import type { LocalIdentityUrls } from "../config/buildIdentityContract";
import type {
  ConexaoDaLoja,
  ConfiguracaoDaLoja,
  FichaDaLoja,
} from "../config/fichaDaLojaContract";
import { CAMINHO_IDENTIDADE_JSON } from "../config/fichaDaLojaContract";
import { BADGE_NEUTRO } from "../config/fichaDaLojaContract";
// O PORTEIRO — o `middleware.ts` estendido que monta o HTML de cada loja na
// borda, por HOST, a partir de um único build compartilhado (etapa 2 da
// escala, 11/09/2026). Desenho aprovado em
// `equipe/entregas/20260911-parecer-socio-rodada2-etapa2-site-por-dominio.md`
// (seção PARA A HUB) e no brief `20260911-brief-escala-etapa2-site-por-host.md`
// (tarefas T3/T3b). `resolverConexao` e `decidirConcordancia` são o ponto de
// revisão Opus obrigatório: é aqui que nasce (ou não) "loja A com dado de
// loja B". O ciclo do cache da ficha por host (fresco, reserva com
// revalidação em segundo plano, recuos depois de falha, log) está descrito
// junto de `CACHE_FRESCO_MS`.
import { escapeHtml, identityHtml } from "../config/identidadeNoHtml";
import { MANIFESTO_BASE } from "../config/manifestoBase";
import { nomeCurtoDaLoja } from "../config/nomeCurtoDaLoja";
import { cleanEnvVar } from "../lib/env-publico-valores";
import { resolverValoresPublicosSupabase } from "../lib/env-publico-valores";
import { readPublicStoreIdentity } from "../lib/publicStoreIdentity";
import { assertPublicSupabaseKey } from "../lib/publicSupabaseKey";
import type { PublicStoreIdentity } from "../lib/storeIdentity";
import { identityRevision } from "../lib/storeIdentity";
import type { Cartaz } from "./cartaz";
import {
  escolherBannerDoTopo,
  injetarCartazNoHtml,
  lojaRedimensionaFoto,
  montarCartaz,
  pedidoPodeTerCartaz,
} from "./cartaz";
import { ehPaginaContavel } from "./contador";
import { montarDataBlock } from "./ficha";
import { buscarIdsDosProdutos, robotsTxt, sitemapXml } from "./mapaDoSite";
import { deployDoHtml, idDoDeploy } from "./marcaDoDeploy";
import { entradaDaReserva } from "./reservaDaCaderneta";

// ─── Matcher: só DOCUMENTOS invocam o porteiro ─────────────────────────────
//
// Prefixo reservado NUNCA casa o primeiro padrão — é o que barra os
// caminhos do build (assets/, store-identity/, icons/, images/, fonts/).
// 23/09/2026: `logos/` e `branding/` (pastas de `public/`) entraram depois
// que os logos do frete saíram como app shell em produção — toda pasta de
// `public/` tem de estar aqui (`tests/front/porteiro-pastas-publicas.test.ts`).
const PREFIXOS_RESERVADOS =
  "assets/|store-identity/|icons/|images/|fonts/|logos/|branding/";

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
// existem `sw.js`, `version.json`, `favicon.svg`, `og-image.png`,
// `silent-guardian.js`, `loading.css`, `404.html`, `index.html`,
// `offline.html` e `google8e0e5366e254e024.html`. Os demais
// (`favicon.ico`, `logo.svg`, `apple-touch-icon.png`,
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
//
// `robots.txt` e `sitemap.xml` NÃO estão nesta lista (defeito multiloja-frota-3,
// 23/10/2026): eram arquivos estáticos assados com o endereço e os produtos da
// loja principal, e a Vercel os servia a TODO host — o Google abria o endereço
// da Savy e recebia o mapa da IKCOUS. Agora são DOCUMENTOS do porteiro, que
// responde os dois por host (`atenderMapaDoSite`). O arquivo do build continua
// existindo em `dist/` (e serve o `vite dev`), mas na Vercel a borda atende
// antes dele.
const ARQUIVOS_RESERVADOS_DE_RAIZ =
  "sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|THIRD_PARTY_NOTICES\\.txt$|google[A-Za-z0-9]*\\.html$";

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
  /** Interruptor do cartaz pre-impresso (lote B): "1" desliga, sem novo
   * deploy de codigo -- so a variavel e um redeploy. Qualquer outro valor (ou
   * ausente) deixa ligado. */
  readonly IKCOUS_CARTAZ_DESLIGADO?: string;
  /** L8: o endereço do "Fale com a IKCOUS para reabrir" das páginas de loja
   * adormecida/encerrada. Só vira link se for uma URL `https:` válida;
   * ausente ou qualquer outra coisa = a frase sai sem link. */
  readonly IKCOUS_LINK_ACORDAR?: string;
  /** Variável de sistema da Vercel (build E runtime): o id deste deploy. O
   * porteiro só guarda em memória o `/index.html` marcado com ele (ver
   * `src/hospedagem/marcaDoDeploy.ts`). Ausente = nunca guarda. */
  readonly VERCEL_DEPLOYMENT_ID?: string;
}

export interface ConexaoResolvida {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  /** `reserva` = veio da reserva da caderneta (T3/T4 do plano da reserva),
   * nunca sem a conferência de domínio no banco da própria loja. */
  readonly origem: "caderneta" | "projeto" | "reserva";
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
 * a loja NA HORA (decisão) — exceto o `miss` para host com ficha boa de até
 * 1 h, que usa a reserva (`obterFichaValidada`); uma falha de VERDADE da RPC
 * (rotulada `erro` também) NÃO fecha — herda o stale-if-error, porque a
 * caderneta É o banco da principal e "erro" ali não pode derrubar a frota
 * inteira em 60 s. `atenderPorteiro` escreve este valor em `x-ikcous-caderneta` em
 * toda resposta que produz — inclusive quando a resposta final é a ficha
 * antiga servida por stale-if-error.
 *
 * `reserva` (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T3/T4): a caderneta
 * falhou (ou disse `miss` para um host que a reserva conhece), não havia ficha
 * de até 1 h, e a conexão veio da RESERVA (`lerReserva`) — sempre conferida
 * no banco da própria loja como qualquer outra. Vale também para a decisão
 * tomada depois dela (`discorda`, `encaminha`, banco da loja fora do ar):
 * diz que a conexão daquela tentativa veio da reserva. Reserva que não dá
 * conexão deixa o estado da caderneta como estava (`erro` ou `miss`).
 */
export type EstadoCaderneta = "hit" | "miss" | "erro" | "ausente" | "reserva";

/** L8 (estado de vida da loja): os dois estados em que a caderneta CONHECE a
 * loja mas ela não abre — `adormecida` (parou de pagar; volta quando acordar)
 * e `encerrada` (saiu da frota). Nos dois a caderneta NÃO devolve URL nem
 * chave do banco da loja, e o porteiro nunca o procura. */
export type EstadoForaDoAr = "adormecida" | "encerrada";

/** O que a página de loja fora do ar precisa — e nada mais: o nome (vem da
 * caderneta, é escapado na página) e o `project_ref` (diagnóstico, em
 * cabeçalho; já validado com 20 letras/dígitos minúsculos). */
export interface LojaForaDoAr {
  readonly estado: EstadoForaDoAr;
  readonly nome: string;
  readonly ref: string;
}

/** `1` = esta resolução veio da RESERVA `resolver_loja` (a função nova
 * `resolver_loja_com_estado` ainda não existe no banco da caderneta). Vira o
 * cabeçalho `x-ikcous-caderneta-versao: 1`. Ausente = a função nova respondeu. */
export type VersaoCaderneta = 1;

export interface ResolucaoConexao {
  readonly conexao: ConexaoResolvida | null;
  readonly caderneta: EstadoCaderneta;
  /** Presente só quando a caderneta disse que a loja está adormecida ou
   * encerrada (`conexao` é `null` nesse caso — quem não conhecer este campo
   * cai no `sem-loja`, que também é falha fechada). */
  readonly foraDoAr?: LojaForaDoAr;
  readonly versaoCaderneta?: VersaoCaderneta;
}

/** O que a caderneta central devolveu para este host. `miss` e `erro` não
 * carregam conexão — não há nada para "quase confiar". `fora-do-ar` (L8)
 * também não: só o que a página própria precisa. `versao: 1` marca o que veio
 * da reserva (função antiga), que nunca sabe de estado. */
export type ResultadoCaderneta =
  | {
      readonly tipo: "hit";
      readonly conexao: ConexaoResolvida;
      readonly versao?: VersaoCaderneta;
    }
  | ({ readonly tipo: "fora-do-ar" } & LojaForaDoAr)
  | { readonly tipo: "miss"; readonly versao?: VersaoCaderneta }
  | { readonly tipo: "erro"; readonly versao?: VersaoCaderneta };

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
  readonly versaoCaderneta: VersaoCaderneta | undefined;
  constructor(versaoCaderneta?: VersaoCaderneta) {
    super(
      "PORTEIRO_CADERNETA: falha da RPC resolver_loja (HTTP não-2xx, rede ou resposta malformada)",
    );
    this.versaoCaderneta = versaoCaderneta;
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
  // L8: a caderneta CONHECE a loja e diz que ela está fora do ar. É uma
  // decisão (como `miss`), nunca uma conexão: `conexao` fica `null` e o
  // porteiro não procura o banco da loja. `caderneta: "hit"` porque a
  // caderneta respondeu a loja de verdade.
  if (resultado.tipo === "fora-do-ar")
    return {
      conexao: null,
      caderneta: "hit",
      foraDoAr: {
        estado: resultado.estado,
        nome: resultado.nome,
        ref: resultado.ref,
      },
    };
  // A marca só entra quando existe (os testes antigos comparam o objeto
  // inteiro; a função nova nunca a põe).
  const versao =
    resultado.versao === undefined ? {} : { versaoCaderneta: resultado.versao };
  if (resultado.tipo === "miss")
    return { conexao: null, caderneta: "miss", ...versao };
  // (c) falha DE VERDADE da RPC — lança, nunca devolve: ver
  // `FalhaRpcCaderneta` e o comentário desta função.
  if (resultado.tipo === "erro") throw new FalhaRpcCaderneta(resultado.versao);
  if (!chaveEhPublica(resultado.conexao.publishableKey))
    return { conexao: null, caderneta: "erro", ...versao };
  return { conexao: resultado.conexao, caderneta: "hit", ...versao };
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

/** Todo valor que o porteiro escreve em `x-ikcous-porteiro` numa RECUSA. Os
 * dois de L8 (`adormecida`, `encerrada`) têm página própria
 * (`respostaForaDoAr`), nunca a de manutenção — por isso `respostaManutencao`
 * só aceita os outros quatro. O service worker lê este cabeçalho
 * (`src/sw/sw.ts`, `ehRecusaDoPorteiro`) e o teste dele cobre TODOS. */
export type MotivoManutencao =
  | "sem-loja"
  | "discorda"
  | "banco-indisponivel"
  | "html-indisponivel"
  | EstadoForaDoAr;

/**
 * Falha fechada: divergiu, faltou ou não deu para ler → 503, nunca uma
 * página de outra loja. `x-ikcous-porteiro` diz o motivo (só para
 * diagnóstico — nunca dado de banco); `x-ikcous-caderneta` (rodada B) diz o
 * que aconteceu com a caderneta central nesta tentativa, para "caiu em (b)"
 * nunca ficar silencioso mesmo quando a resposta final é um 503.
 */
export function respostaManutencao(
  motivo: Exclude<MotivoManutencao, EstadoForaDoAr>,
  caderneta: EstadoCaderneta,
): Response {
  // Mesmo padrão de public/offline.html: ajuste ao celular, recarga sozinha a
  // cada 30 s e um link para a própria página como botão. SEM script e sem
  // atributo de evento de propósito: a CSP de produção só libera 1 hash em
  // script-src. O texto é o mesmo para todo motivo e para toda loja (nada de
  // marca nem de dado do banco: falha fechada).
  const corpo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="30"><title>${escapeHtml("Loja em manutenção")}</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;box-sizing:border-box;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#fafafa;color:#18181b}p{margin:0;max-width:320px;font-size:16px;line-height:1.5}a{padding:14px 28px;border-radius:14px;background:#18181b;color:#fafafa;font-size:15px;font-weight:700;text-decoration:none}</style></head><body><p>${escapeHtml("Esta loja está em manutenção. Volte em instantes.")}</p><a href="">${escapeHtml("Tentar novamente")}</a></body></html>`;
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

// ─── respostaForaDoAr (L8: loja adormecida ou encerrada) ───────────────────
//
// SUPOSIÇÕES DE ESTADO, ditas em voz alta:
//   - Só chega aqui o que a CADERNETA disse (`resolver_loja_com_estado`): ela
//     conhece a loja e devolveu estado `adormecida`/`encerrada`, sem URL nem
//     chave. Nenhum pedido ao banco da loja acontece antes nem depois desta
//     página — não há conexão para usar.
//   - O texto fala com a CLIENTE da loja (decisão do sócio D2). O único dado
//     da loja é o NOME, que vem da caderneta (escrito pela IKCOUS, não pela
//     lojista) e é escapado mesmo assim. Sem logo, sem cor, sem script.
//   - Sem estado próprio: pura, idempotente. O que se guarda por 60 s é a
//     DECISÃO (`obterFichaValidada`), nunca esta resposta.

/** Só `https:` vira link. `javascript:`, `data:`, `http:` e o que nem é URL
 * ficam de fora: a frase sai sem `<a>`. */
function linkParaAcordar(bruto: string | undefined): string | null {
  const valor = cleanEnvVar(bruto ?? "");
  if (valor === "") return null;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A página da loja ADORMECIDA (503 + `retry-after: 3600`: volta quando a
 * conta acertar) ou ENCERRADA (410: não volta; o Google pode tirar do
 * índice). `cache-control: no-store` nas duas — a loja que acorda não pode
 * ficar presa num cache. `x-ikcous-estado`/`x-ikcous-ref` são diagnóstico
 * (o ref já foi validado: 20 letras/dígitos minúsculos).
 */
export function respostaForaDoAr(
  loja: LojaForaDoAr,
  caderneta: EstadoCaderneta,
  linkAcordarBruto: string | undefined,
): Response {
  const nome = loja.nome.trim() === "" ? "Esta loja" : loja.nome.trim();
  const frase =
    loja.estado === "adormecida"
      ? `${nome} está fechada no momento.`
      : `${nome} não está mais no ar.`;
  const link = linkParaAcordar(linkAcordarBruto);
  const chamada = "Fale com a IKCOUS para reabrir";
  const linhaDaDona = `${escapeHtml("É a dona desta loja?")} ${
    link === null
      ? escapeHtml(chamada)
      : `<a href="${escapeHtml(link)}">${escapeHtml(chamada)}</a>`
  }`;
  // Mesmo molde visual da página de manutenção (sem marca de ninguém), sem
  // recarga automática: a loja não volta em instantes.
  const corpo = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(frase)}</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;box-sizing:border-box;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#fafafa;color:#18181b}p{margin:0;max-width:320px;font-size:16px;line-height:1.5}small{max-width:320px;font-size:13px;line-height:1.5;color:#52525b}a{color:#18181b;font-weight:700}</style></head><body><p>${escapeHtml(frase)}</p><small>${linhaDaDona}</small></body></html>`;
  return new Response(corpo, {
    status: loja.estado === "adormecida" ? 503 : 410,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...(loja.estado === "adormecida" ? { "retry-after": "3600" } : {}),
      "x-ikcous-porteiro": loja.estado,
      "x-ikcous-caderneta": caderneta,
      "x-ikcous-estado": loja.estado,
      "x-ikcous-ref": loja.ref,
    },
  });
}

/** Acrescenta `x-ikcous-caderneta-versao: 1` quando a resolução veio da
 * reserva (função antiga). Sem versão, devolve a MESMA resposta, intacta —
 * a loja ativa pela função nova sai byte a byte como antes de L8. */
export function marcarVersaoDaCaderneta(
  resposta: Response,
  versao: VersaoCaderneta | undefined,
): Response {
  if (versao === undefined) return resposta;
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set("x-ikcous-caderneta-versao", String(versao));
  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: cabecalhos,
  });
}

/** T4 da reserva: o "não achei" (`sem-loja` com `miss`) diz se havia reserva
 * para tentar — `ligada` com leitor injetado, `desligada` sem. É o sinal que o
 * portão da publicação confere no candidato (a reserva configurada). */
function marcarReservaNoNaoAchei(
  resposta: Response,
  reservaLigada: boolean,
): Response {
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set("x-ikcous-reserva", reservaLigada ? "ligada" : "desligada");
  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: cabecalhos,
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
  /** Mesma ideia, para `x-ikcous-caderneta-versao` (L8). */
  readonly versaoCaderneta?: VersaoCaderneta;
  /** Presente só depois de uma FALHA servida com esta ficha (stale-if-error):
   * até `ate`, o host não pergunta de novo e recebe esta ficha com o estado
   * da falha (`caderneta`/`versaoCaderneta`). Nunca mexe em `quando`, então
   * o teto de 1 h da ficha velha continua contando da última resolução boa. */
  readonly recuo?: RecuoAposFalha;
}

export interface RecuoAposFalha {
  readonly ate: number;
  readonly caderneta: EstadoCaderneta;
  readonly versaoCaderneta?: VersaoCaderneta;
}

/** 60 s de cache fresco (não repete a consulta); serve o último bom por até
 * 1h em falha de rede (stale-if-error) — "loja conhecida sobrevive à queda
 * da caderneta, loja nova espera" (parecer, item 7).
 *
 * O ciclo inteiro da ficha de um host, por instância (26/11/2026):
 *   - até 60 s: servida sem perguntar;
 *   - de 60 s a 1 h, com `waitUntil`: servida NA HORA e revalidada em segundo
 *     plano (uma revalidação por host); o desfecho vale para a PRÓXIMA visita.
 *     Sem `waitUntil`, a visita espera a caderneta, como antes;
 *   - falha com ficha de até 1 h: a ficha velha, e 30 s de recuo sem perguntar
 *     (`RECUO_APOS_FALHA_MS`). O "não achei" (`miss`) com ficha de até 1 h
 *     segue o MESMO caminho (26/11/2026): zero linhas para a frota inteira
 *     não pode fechar todas as lojas; sem ficha que valha, ele fecha;
 *   - falha (ou `miss`) sem ficha que valha, com a reserva conhecendo o host
 *     (`lerReserva`): a loja abre pela conexão da reserva, conferida no banco
 *     dela, e a ficha nasce com `caderneta: "reserva"`;
 *   - falha sem ficha que valha nem reserva: 503 `banco-indisponivel`, e 10 s
 *     de recuo sem perguntar (`RECUO_SEM_FICHA_MS`), no mapa do host sem ficha;
 *   - cada recuo aberto escreve UMA linha `[porteiro]` no log (host, etapa,
 *     nome da causa, estado da caderneta, duração; nunca chave nem URL). */
export const CACHE_FRESCO_MS = 60_000;
export const CACHE_STALE_MAX_MS = 3_600_000;

/** L8, 2.3: a DECISÃO "esta loja está fora do ar", guardada por host, por
 * 60 s — sem stale-if-error (passado o prazo, a caderneta é perguntada de
 * novo; se ela falhar, o porteiro responde `banco-indisponivel`, nunca a
 * vitrine velha). A loja ativa nunca escreve aqui. */
export interface EntradaCacheForaDoAr {
  readonly loja: LojaForaDoAr;
  readonly quando: number;
}
export const CACHE_FORA_DO_AR_MS = 60_000;

/** O mapa do host SEM ficha. Duas espécies de entrada, e nunca uma pela outra:
 *
 * - sem `recuo`: o "não achei" DEFINITIVO da caderneta (`miss`: host não
 *   cadastrado, alias antigo, `www.` sem cadastro, Host inventado por robô),
 *   guardado por host normalizado por 60 s — cada pergunta custa CPU no banco
 *   da principal (bcrypt na conferência da chave). Preço aceito: uma loja
 *   recém-cadastrada pode esperar até 60 s para abrir naquela instância.
 * - com `recuo`: uma FALHA (erro/timeout/resposta malformada/imprevisto) sem
 *   ficha que valha, guardada só até `recuo.ate` (`RECUO_SEM_FICHA_MS`):
 *   o host recebe o mesmo 503 `banco-indisponivel`, nunca `sem-loja`.
 *
 * A chave anômala não entra aqui de jeito nenhum (é resposta estranha, não
 * "não achei" nem falha de rede: pergunta de novo). Mesmo mapa e mesmo teto
 * de propósito: uma enxurrada de hosts inventados com a caderneta caída nunca
 * empurra para fora a ficha de uma loja de verdade, que é justamente o que a
 * mantém no ar durante a queda. */
export interface EntradaCacheSemLoja {
  readonly quando: number;
  readonly versaoCaderneta?: VersaoCaderneta;
  readonly recuo?: RecuoAposFalha;
}
export const CACHE_SEM_LOJA_MS = 60_000;

/** Depois de uma falha servida com a ficha velha, o host espera este tanto
 * antes de perguntar de novo à caderneta (doente ou lenta: sem o recuo, cada
 * visita esperava o prazo inteiro e batia de novo no banco). */
export const RECUO_APOS_FALHA_MS = 30_000;

/** Falha SEM ficha que valha (instância nova, recém-publicada, ou ficha
 * passada de 1 h): o host recebe o mesmo 503 `banco-indisponivel` por este
 * tanto, sem perguntar de novo à caderneta. Curto de propósito: aqui a loja já
 * está fora para quem chega, e cada segundo de recuo é um segundo a mais de
 * 503 depois que a caderneta volta. */
export const RECUO_SEM_FICHA_MS = 10_000;

/** Teto de entradas de TODO cache em memória do porteiro: Host aleatório
 * (ataque ou robô) não enche a memória da instância. No teto, sai a entrada
 * gravada há mais tempo. O "não achei" vive num mapa próprio, então uma
 * enxurrada de hosts desconhecidos nunca empurra para fora a ficha de uma
 * loja de verdade. */
export const TETO_ENTRADAS_CACHE = 1000;

function guardarComTeto<V>(
  mapa: Map<string, V> | undefined,
  chave: string,
  valor: V,
): void {
  if (!mapa) return;
  // Apagar antes de gravar põe a chave no FIM da ordem de inserção do `Map`:
  // o primeiro da iteração é sempre o gravado há mais tempo.
  mapa.delete(chave);
  mapa.set(chave, valor);
  while (mapa.size > TETO_ENTRADAS_CACHE) {
    const maisAntiga = mapa.keys().next();
    if (maisAntiga.done) break;
    mapa.delete(maisAntiga.value);
  }
}

/** O sitemap lê o catálogo inteiro da loja (uma consulta por 1000 produtos):
 * 10 min frescos entre robôs, e o último bom por até 1h se o banco cair —
 * o mesmo teto do stale-if-error da ficha. Produto novo entra no mapa em até
 * 10 min; o Google relê o sitemap em horas ou dias, então não há ganho em
 * consultar mais que isso. */
export const CACHE_MAPA_FRESCO_MS = 600_000;
export const CACHE_MAPA_STALE_MAX_MS = 3_600_000;

/** Os ids públicos de UMA loja, guardados por `host|supabaseUrl` (o domínio
 * normalizado MAIS o banco da ficha que o provou): o mapa de uma loja nunca é
 * servido por outra, e um domínio que muda de banco nunca serve os ids do
 * banco antigo. Porta e protocolo ficam FORA da chave de propósito. Guarda os
 * ids, não o XML — o XML é barato de remontar com o endereço de quem pediu
 * (porta/protocolo variam no ensaio local). */
export interface EntradaCacheMapa {
  readonly ids: readonly string[];
  readonly quando: number;
}

/** O que o banco da loja disse sobre os banners do topo (ou `null` = a leitura
 * falhou), guardado por `host|supabaseUrl`. Guarda as LINHAS, nao o cartaz: a
 * janela de datas se reavalia a cada pedido. */
export interface EntradaCacheCartaz {
  readonly linhas: readonly unknown[] | null;
  readonly quando: number;
}

export interface DependenciasPorteiro {
  readonly fetchImpl: typeof fetch;
  /** `Map` de modulo em `middleware.ts` (um por isolate). Opcional: sem ele
   * (teste, chamada avulsa) cada primeira visita le o banco. */
  readonly cacheCartaz?: Map<string, EntradaCacheCartaz>;
  /** O `/index.html` CRU por endereço, 5 min (`Map` de modulo em
   * `middleware.ts`). Opcional: sem ele, cada documento busca o arquivo. */
  readonly cacheIndexHtml?: Map<string, EntradaCacheIndexHtml>;
  /** Buscas do `/index.html` em andamento por endereço: pedidos simultâneos
   * esperam a MESMA busca. Opcional: sem ele, cada pedido busca sozinho. */
  readonly indexHtmlEmVoo?: Map<string, Promise<IndexHtmlBaixado>>;
  readonly resolverNaCaderneta?: ResolverLojaNaCaderneta;
  /** A RESERVA da caderneta (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`): lê
   * o documento `reserva_v1` CRU — este arquivo o confere com
   * `entradaDaReserva`, nunca confia no formato. Só é chamado quando a
   * caderneta falhou (ou disse `miss`) e o host não tem ficha de até 1 h, uma
   * vez por resolução compartilhada. Quem injeta garante que ele termina
   * (prazo próprio): uma leitura pendurada segura a resolução do host. Lançar
   * ou devolver nada = sem reserva. Ausente = reserva desligada. */
  readonly lerReserva?: () => Promise<unknown>;
  /** Injetável só para teste; produção usa `readPublicStoreIdentity` real. */
  readonly lerIdentidade?: typeof readPublicStoreIdentity;
  /** `Map` de módulo — vive em `middleware.ts`, uma vez por isolate, e é
   * passada aqui para cada chamada (é o que torna a função testável sem
   * estado global escondido). */
  readonly cache: Map<string, EntradaCachePorteiro>;
  /** L8: decisões "loja fora do ar", 60 s por host (`Map` de módulo de
   * `middleware.ts`). Opcional: sem ele, cada pedido pergunta à caderneta. */
  readonly cacheForaDoAr?: Map<string, EntradaCacheForaDoAr>;
  /** O "não achei" da caderneta, 60 s por host (`Map` de módulo de
   * `middleware.ts`). Opcional: sem ele, cada pedido pergunta à caderneta. */
  readonly cacheSemLoja?: Map<string, EntradaCacheSemLoja>;
  /** Resoluções em andamento por host (`Map` de módulo de `middleware.ts`):
   * pedidos simultâneos do mesmo host esperam a MESMA resolução. A entrada
   * sai quando ela termina, com sucesso ou erro. Opcional: sem ele, cada
   * pedido resolve sozinho. */
  readonly resolucoesEmVoo?: Map<string, ResolucaoEmVoo>;
  /** Cache dos ids do sitemap, também um `Map` de módulo de `middleware.ts`.
   * Opcional: sem ele (teste, chamada avulsa) cada pedido lê o banco. */
  readonly cacheMapa?: Map<string, EntradaCacheMapa>;
  /** Relógio injetável — testes avançam o tempo sem `sleep`. */
  readonly agora?: () => number;
  /** O `context.waitUntil` da borda: mantém a função viva depois da resposta.
   * Com ele, a ficha passada dos 60 s (dentro da reserva de 1 h) sai NA HORA
   * e a caderneta é perguntada em segundo plano (stale-while-revalidate). Sem
   * ele (teste, chamada avulsa), a visita espera a resposta, como antes. */
  readonly waitUntil?: (promessa: Promise<unknown>) => void;
  /** O contador de visitas (spec "visitas da loja", 02/11/2026). Chamado por
   * `atenderPorteiro` DEPOIS que o documento da loja saiu com 200 e só para
   * GET de página da loja com a loja fora de manutenção, com a conexão da
   * ficha JÁ VALIDADA (a única que existe aqui: o banco que provou o domínio).
   * Fire-and-forget: devolve `void`, o porteiro nunca espera nem lê o
   * resultado, e uma exceção dele é engolida (a página não pode mudar por
   * causa da conta). Quem classifica pessoa/robô e grava é `middleware.ts`. */
  readonly contarEntrada?: (conexao: ConexaoDaLoja, request: Request) => void;
}

class DecisaoPorteiro extends Error {
  readonly motivo: Exclude<MotivoManutencao, EstadoForaDoAr>;
  readonly caderneta: EstadoCaderneta;
  readonly versaoCaderneta: VersaoCaderneta | undefined;
  constructor(
    motivo: Exclude<MotivoManutencao, EstadoForaDoAr>,
    caderneta: EstadoCaderneta,
    versaoCaderneta?: VersaoCaderneta,
  ) {
    super(motivo);
    this.motivo = motivo;
    this.caderneta = caderneta;
    this.versaoCaderneta = versaoCaderneta;
  }
}

/** L8: a caderneta disse "adormecida"/"encerrada". Decisão (não falha): vira
 * a página própria e é guardada por 60 s em `obterFichaValidada`. */
class DecisaoForaDoAr extends Error {
  readonly loja: LojaForaDoAr;
  readonly caderneta: EstadoCaderneta;
  constructor(loja: LojaForaDoAr, caderneta: EstadoCaderneta) {
    super(loja.estado);
    this.loja = loja;
    this.caderneta = caderneta;
  }
}

/**
 * O resultado `"encaminha"` de `decidirConcordancia` — SEPARADO de
 * `DecisaoPorteiro` porque não é um motivo de 503 (`MotivoManutencao`): é
 * uma decisão de REDIRECIONAR para o `dominio_publico` da loja (brief
 * `20260911-brief-aliases-vercel-encaminham.md`). Carrega só o DOMÍNIO: o
 * destino completo (`https://<dominio_publico><pathname><search>`) é montado
 * em `obterFichaValidada` com o caminho de CADA pedido, porque a resolução é
 * compartilhada entre pedidos simultâneos do mesmo host (`resolucoesEmVoo`)
 * e o caminho do primeiro nunca pode ir para os outros. `obterFichaValidada`
 * devolve a resposta de encaminhamento pelo MESMO canal (`tipo:
 * "manutencao"`) que hoje devolve a de manutenção — ver o comentário ali
 * sobre a escolha de reaproveitar o tipo em vez de criar um novo.
 */
class DecisaoEncaminhamento extends Error {
  readonly dominioPublico: string;
  readonly caderneta: EstadoCaderneta;
  readonly versaoCaderneta: VersaoCaderneta | undefined;
  constructor(
    dominioPublico: string,
    caderneta: EstadoCaderneta,
    versaoCaderneta?: VersaoCaderneta,
  ) {
    super("encaminha");
    this.dominioPublico = dominioPublico;
    this.caderneta = caderneta;
    this.versaoCaderneta = versaoCaderneta;
  }
}

/** Envolve qualquer falha de REDE/schema (isto é, algo que NÃO é uma
 * DECISÃO do porteiro) com o `EstadoCaderneta` que esta tentativa já tinha
 * resolvido ANTES de falhar — é o que permite ao 503 `banco-indisponivel`
 * (ou ao stale-if-error) continuar dizendo, em `x-ikcous-caderneta`, o que
 * aconteceu com a caderneta antes da falha de identidade/domínio. */
class FalhaResolucaoPorteiro extends Error {
  readonly caderneta: EstadoCaderneta;
  readonly versaoCaderneta: VersaoCaderneta | undefined;
  /** Onde caiu (só para o log): perguntando à caderneta, ou já lendo o banco
   * da loja que ela apontou. */
  readonly etapa: EtapaDaFalha;
  /** Quanto a tentativa durou até falhar, pelo relógio do porteiro. */
  readonly duracaoMs: number;
  constructor(
    caderneta: EstadoCaderneta,
    causa: unknown,
    versaoCaderneta: VersaoCaderneta | undefined,
    etapa: EtapaDaFalha,
    duracaoMs: number,
  ) {
    super("PORTEIRO_FALHA_RESOLUCAO", { cause: causa });
    this.caderneta = caderneta;
    this.versaoCaderneta = versaoCaderneta;
    this.etapa = etapa;
    this.duracaoMs = duracaoMs;
  }
}

type EtapaDaFalha = "caderneta" | "banco-da-loja";

export interface FichaResolvida {
  readonly ficha: FichaDaLoja;
  readonly caderneta: EstadoCaderneta;
  readonly versaoCaderneta?: VersaoCaderneta;
}

/** Uma resolução em andamento (ver `DependenciasPorteiro.resolucoesEmVoo`).
 * Rejeita com as decisões (`sem-loja`, fora do ar, encaminha...) e com as
 * falhas, igual a `resolverFichaViaRede`. */
export type ResolucaoEmVoo = Promise<FichaResolvida>;

/** A conexão que a reserva guarda para ESTE host, ou `null` (sem leitor, leitor
 * que lança, documento ou entrada fora do formato, host ausente). Nunca lança:
 * reserva que não responde é só "sem reserva". */
async function conexaoDaReserva(
  host: string,
  deps: DependenciasPorteiro,
): Promise<ConexaoResolvida | null> {
  if (!deps.lerReserva) return null;
  let documento: unknown;
  try {
    documento = await deps.lerReserva();
  } catch {
    return null;
  }
  const entrada = entradaDaReserva(documento, host);
  if (!entrada) return null;
  return { ...entrada, origem: "reserva" };
}

/**
 * A caderneta não deu a loja — falhou de verdade (`FalhaRpcCaderneta`: rede,
 * prazo, HTTP fora de 2xx, corpo malformado) ou disse `miss` — e o host não
 * tem ficha de até 1 h (`permitirReserva`). Se a reserva conhece o host, a
 * resolução segue com a conexão dela e `caderneta: "reserva"`, pelo MESMO
 * caminho de qualquer conexão: identidade e `dominio_publico` lidos no banco
 * da própria loja, `decidirConcordancia` decide. Se não conhece, `null`, e
 * quem chama segue como antes (a falha relança; o `miss` fecha). A marca de
 * versão da caderneta não viaja: quem deu a conexão foi a reserva.
 *
 * NUNCA chega aqui: loja adormecida/encerrada (decisão explícita, antes),
 * chave anômala (retorno `erro` sem conexão, não falha), caderneta `ausente`
 * (preview), falha no banco da loja que a caderneta apontou.
 */
async function resolucaoPelaReserva(
  host: string,
  deps: DependenciasPorteiro,
  permitirReserva: boolean,
): Promise<ResolucaoConexao | null> {
  if (!permitirReserva) return null;
  const conexao = await conexaoDaReserva(host, deps);
  if (!conexao) return null;
  return { conexao, caderneta: "reserva" };
}

/** A caderneta respondeu "não achei" — e só isso: sem conexão, sem estado de
 * vida, rótulo `miss` (a chave anômala sai `erro` e nunca entra). */
function ehMissDaCaderneta(resolucao: ResolucaoConexao): boolean {
  return (
    resolucao.caderneta === "miss" &&
    resolucao.conexao === null &&
    resolucao.foraDoAr === undefined
  );
}

async function resolverFichaViaRede(
  host: string,
  url: URL,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
  permitirReserva: boolean,
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
  let versao: VersaoCaderneta | undefined;
  let etapa: EtapaDaFalha = "caderneta";
  const relogio = deps.agora ?? Date.now;
  const inicio = relogio();
  try {
    let resolucao: ResolucaoConexao;
    try {
      resolucao = await resolverConexao(
        host,
        ambiente,
        deps.resolverNaCaderneta,
      );
    } catch (falha) {
      // A RPC falhou de verdade: a reserva, se valer e conhecer o host; senão
      // a mesma falha segue para o `catch` de baixo (stale-if-error).
      if (!(falha instanceof FalhaRpcCaderneta)) throw falha;
      const pelaReserva = await resolucaoPelaReserva(
        host,
        deps,
        permitirReserva,
      );
      if (!pelaReserva) throw falha;
      resolucao = pelaReserva;
    }
    // "Não achei" sem ficha: a reserva, se conhecer o host; senão o `miss`
    // fecha a loja como sempre (e é guardado 60 s).
    if (ehMissDaCaderneta(resolucao)) {
      const pelaReserva = await resolucaoPelaReserva(
        host,
        deps,
        permitirReserva,
      );
      if (pelaReserva) resolucao = pelaReserva;
    }
    caderneta = resolucao.caderneta;
    versao = resolucao.versaoCaderneta;
    etapa = "banco-da-loja";
    // L8: ANTES de qualquer leitura do banco da loja (não há conexão).
    if (resolucao.foraDoAr)
      throw new DecisaoForaDoAr(resolucao.foraDoAr, caderneta);
    if (!resolucao.conexao)
      throw new DecisaoPorteiro("sem-loja", caderneta, versao);
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
      throw new DecisaoEncaminhamento(
        dominioPublico as string,
        caderneta,
        versao,
      );
    }
    if (decisao !== "ok") throw new DecisaoPorteiro(decisao, caderneta, versao);
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
    return versao === undefined
      ? { ficha, caderneta }
      : { ficha, caderneta, versaoCaderneta: versao };
  } catch (erro) {
    if (
      erro instanceof DecisaoPorteiro ||
      erro instanceof DecisaoEncaminhamento ||
      erro instanceof DecisaoForaDoAr
    )
      throw erro;
    // A RPC da caderneta falhou DE VERDADE (ADENDO B.1) — o rótulo vem do
    // próprio erro (`"erro"`, sempre), não da variável `caderneta` do
    // escopo externo, porque `resolverConexao` pode ter lançado ANTES de
    // atribuí-la.
    const duracaoMs = relogio() - inicio;
    if (erro instanceof FalhaRpcCaderneta)
      throw new FalhaResolucaoPorteiro(
        erro.caderneta,
        erro,
        erro.versaoCaderneta,
        etapa,
        duracaoMs,
      );
    throw new FalhaResolucaoPorteiro(caderneta, erro, versao, etapa, duracaoMs);
  }
}

/** Pedidos do mesmo host esperam a MESMA resolução (na hora ou em segundo
 * plano). Ela não depende do caminho do pedido (o encaminhamento monta o
 * destino por pedido) e a `publicUrl` é refeita por pedido. A entrada sai do
 * mapa quando a resolução termina, com sucesso ou erro.
 *
 * `permitirReserva` é o de QUEM ABRIU a resolução; quem chega depois herda.
 * Sem perigo nos dois sentidos: uma resolução aberta SEM ficha só é
 * encontrada por pedidos também sem ficha (a ficha deste host só nasce do fim
 * dela); uma aberta COM ficha (revalidação, ou ficha prestes a passar de 1 h)
 * pode ser herdada por um pedido que já ficou sem — esse recebe, no máximo
 * uma vez, o 503 de antes da reserva, e a próxima resolução já a permite. */
function resolucaoCompartilhada(
  host: string,
  url: URL,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
  permitirReserva: boolean,
): ResolucaoEmVoo {
  const emVoo = deps.resolucoesEmVoo?.get(host);
  if (emVoo) return emVoo;
  const nova = resolverFichaViaRede(host, url, ambiente, deps, permitirReserva);
  const mapa = deps.resolucoesEmVoo;
  if (mapa) {
    mapa.set(host, nova);
    const liberar = () => {
      if (mapa.get(host) === nova) mapa.delete(host);
    };
    nova.then(liberar, liberar);
  }
  return nova;
}

/** O "não achei" da caderneta (zero linhas): `sem-loja` com `miss`. A chave
 * anômala também é `sem-loja`, mas com `erro`, e nunca entra aqui. */
function ehNaoAchei(erro: unknown): erro is DecisaoPorteiro {
  return (
    erro instanceof DecisaoPorteiro &&
    erro.motivo === "sem-loja" &&
    erro.caderneta === "miss"
  );
}

/** A falha que abriu um recuo, numa linha só. Só o host (já normalizado: sem
 * porta, sem caminho, sem query), onde caiu, o NOME da causa (nunca a
 * mensagem: ela pode trazer URL), o estado da caderneta e a duração. Nunca
 * chave, nunca URL. Quem chama garante no máximo uma por host por recuo.
 * O "não achei" segurado pela reserva sai com `causa=nao-achei`. */
function avisarFalha(host: string, erro: unknown, recuoMs: number): void {
  if (ehNaoAchei(erro)) {
    console.error(
      `[porteiro] a caderneta nao achou a loja; servindo a ficha da reserva host=${host} causa=nao-achei caderneta=miss versao=${erro.versaoCaderneta ?? "nova"} recuo=${recuoMs / 1000}s`,
    );
    return;
  }
  const falha = erro instanceof FalhaResolucaoPorteiro ? erro : undefined;
  const causa: unknown = falha ? falha.cause : erro;
  const nomeDaCausa = causa instanceof Error ? causa.name : typeof causa;
  console.error(
    `[porteiro] falha ao resolver a loja host=${host} etapa=${falha?.etapa ?? "desconhecida"} causa=${nomeDaCausa} caderneta=${falha?.caderneta ?? "ausente"} ms=${falha?.duracaoMs ?? "?"} recuo=${recuoMs / 1000}s`,
  );
}

/** O estado da caderneta que a falha carrega (vai para `x-ikcous-caderneta`
 * e para a marca de versão das respostas servidas no recuo). O "não achei"
 * segurado pela reserva carrega o dele (`miss`). */
function estadoDaFalha(erro: unknown): EstadoCaderneta {
  return erro instanceof FalhaResolucaoPorteiro || ehNaoAchei(erro)
    ? erro.caderneta
    : "ausente";
}
function versaoDaFalhaDe(erro: unknown): VersaoCaderneta | undefined {
  return erro instanceof FalhaResolucaoPorteiro || ehNaoAchei(erro)
    ? erro.versaoCaderneta
    : undefined;
}

/** Falha (ou "não achei") com ficha velha guardada: abre o recuo de 30 s DESTE
 * host. Só grava (e só avisa no log) se a entrada ainda é a que o pedido leu:
 * outro pedido da mesma resolução compartilhada, ou uma resolução boa que
 * terminou antes, já pode tê-la trocado. */
function abrirRecuoComFicha(
  deps: DependenciasPorteiro,
  host: string,
  doCache: EntradaCachePorteiro,
  momento: number,
  erro: unknown,
): void {
  if (deps.cache.get(host) !== doCache) return;
  const versao = versaoDaFalhaDe(erro);
  guardarComTeto(deps.cache, host, {
    ...doCache,
    recuo: {
      ate: momento + RECUO_APOS_FALHA_MS,
      caderneta: estadoDaFalha(erro),
      ...(versao === undefined ? {} : { versaoCaderneta: versao }),
    },
  });
  avisarFalha(host, erro, RECUO_APOS_FALHA_MS);
}

/** Falha SEM ficha que valha: abre o recuo de 10 s no mapa do host sem ficha
 * (NUNCA como "não achei": a entrada leva `recuo`). Vários pedidos da mesma
 * resolução compartilhada chegam aqui com a mesma falha: só o primeiro grava
 * e avisa. O relógio é o do MOMENTO da falha (não o do começo do pedido): um
 * pedido que entrou na fila tarde não reabre o recuo que o primeiro abriu. */
function abrirRecuoSemFicha(
  deps: DependenciasPorteiro,
  host: string,
  erro: unknown,
): void {
  const mapa = deps.cacheSemLoja;
  if (!mapa) {
    // Sem o mapa (teste, chamada avulsa) não há recuo: só o aviso.
    avisarFalha(host, erro, 0);
    return;
  }
  const momento = (deps.agora ?? Date.now)();
  const atual = mapa.get(host);
  if (atual?.recuo && momento < atual.recuo.ate) return;
  const versao = versaoDaFalhaDe(erro);
  guardarComTeto(mapa, host, {
    quando: momento,
    recuo: {
      ate: momento + RECUO_SEM_FICHA_MS,
      caderneta: estadoDaFalha(erro),
      ...(versao === undefined ? {} : { versaoCaderneta: versao }),
    },
  });
  avisarFalha(host, erro, RECUO_SEM_FICHA_MS);
}

/**
 * Stale-while-revalidate: a visita já saiu com a ficha guardada (passada dos
 * 60 s, dentro da reserva de 1 h) e a caderneta é perguntada AQUI, entregue ao
 * `waitUntil`. A promessa entregue nunca rejeita. O desfecho vale para a
 * PRÓXIMA visita — inclusive loja que adormeceu ou encerrou: a visita que
 * disparou a revalidação, e as que chegarem enquanto a pergunta está em voo
 * (no máximo o prazo dela), já receberam a vitrine. Preço aceito: a mesma
 * vitrine era servida até ontem por até 60 s depois da mudança de estado.
 *
 *   - ficha nova: substitui a velha (fresca a partir de AGORA) e apaga as
 *     decisões guardadas deste host, igual à resolução na hora;
 *   - adormecida/encerrada: a ficha velha sai e a decisão fica 60 s;
 *   - "não achei" com a ficha ainda dentro de 1 h: tratado como falha (ver
 *     `obterFichaValidada`), abre o recuo de 30 s e a ficha fica;
 *   - qualquer outra DECISÃO (não achei com ficha passada de 1 h, discorda,
 *     chave anômala, encaminha): a ficha velha sai, para nunca mais ser
 *     servida em segundo plano — a próxima visita pergunta na hora e recebe a
 *     decisão; o "não achei" fica guardado 60 s como sempre;
 *   - falha: abre o recuo de 30 s da ficha velha, como a falha na hora.
 */
function revalidarEmSegundoPlano(
  host: string,
  url: URL,
  ambiente: AmbientePorteiro,
  deps: DependenciasPorteiro,
  doCache: EntradaCachePorteiro,
  waitUntil: (promessa: Promise<unknown>) => void,
): void {
  const relogio = deps.agora ?? Date.now;
  // Só revalida quem TEM ficha de até 1 h: a reserva nunca é lida aqui.
  const revalidacao = resolucaoCompartilhada(
    host,
    url,
    ambiente,
    deps,
    false,
  ).then(
    (resolvida) => {
      guardarComTeto(deps.cache, host, {
        ficha: resolvida.ficha,
        quando: relogio(),
        caderneta: resolvida.caderneta,
        ...(resolvida.versaoCaderneta === undefined
          ? {}
          : { versaoCaderneta: resolvida.versaoCaderneta }),
      });
      deps.cacheForaDoAr?.delete(host);
      deps.cacheSemLoja?.delete(host);
    },
    (erro: unknown) => {
      const momento = relogio();
      if (erro instanceof DecisaoForaDoAr) {
        deps.cache.delete(host);
        deps.cacheSemLoja?.delete(host);
        guardarComTeto(deps.cacheForaDoAr, host, {
          loja: erro.loja,
          quando: momento,
        });
        return;
      }
      // "Não achei" com a ficha ainda na reserva: a mesma saída da falha.
      if (ehNaoAchei(erro) && momento - doCache.quando < CACHE_STALE_MAX_MS) {
        abrirRecuoComFicha(deps, host, doCache, momento, erro);
        return;
      }
      if (
        erro instanceof DecisaoPorteiro ||
        erro instanceof DecisaoEncaminhamento
      ) {
        if (deps.cache.get(host) === doCache) deps.cache.delete(host);
        if (ehNaoAchei(erro))
          guardarComTeto(deps.cacheSemLoja, host, {
            quando: momento,
            ...(erro.versaoCaderneta === undefined
              ? {}
              : { versaoCaderneta: erro.versaoCaderneta }),
          });
        return;
      }
      abrirRecuoComFicha(deps, host, doCache, momento, erro);
    },
  );
  try {
    waitUntil(revalidacao);
  } catch {
    // Sem `waitUntil` que funcione a revalidação segue solta (pode ser
    // cortada quando a função dormir); a visita já tem a sua resposta.
  }
}

function passthroughPorteiro(): Response {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

function iconesManifestParaUrls(
  localUrls: LocalIdentityUrls,
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
    {
      // Ficha antiga/remota sem derivado: só marca neutra, nunca a do build.
      src: localUrls.badge_96 ?? BADGE_NEUTRO,
      sizes: "96x96",
      type: "image/png",
      purpose: "monochrome",
    },
  ];
}

/** O navegador pede o manifesto a cada página aberta; cada pedido é uma
 * invocação do porteiro e um pedido na CDN (lote C do plano "primeira visita
 * leve", 26/11/2026). 5 min no cache do PRÓPRIO navegador (`private`: nunca
 * numa cache compartilhada, o manifesto muda por host): a marca nova da loja
 * chega em até 5 min. Loja em manutenção segue `no-store`, para a volta dela
 * aparecer no próximo pedido. */
export const CACHE_CONTROL_DO_MANIFESTO = "private, max-age=300";

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
    short_name: nomeCurtoDaLoja(identity.storeName),
    description: `Produtos e novidades de ${identity.storeName}`,
    theme_color: identity.theme.primary,
    background_color: identity.theme.primary,
    icons: iconesManifestParaUrls(localUrls),
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": ficha.configuracao.manutencao
        ? "no-store"
        : CACHE_CONTROL_DO_MANIFESTO,
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
      /** L8: quem monta a resposta final aplica `marcarVersaoDaCaderneta`. */
      readonly versaoCaderneta?: VersaoCaderneta;
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

  // A marca de versão só entra quando existe: a loja ativa pela função nova
  // devolve EXATAMENTE os mesmos objetos de antes de L8.
  const comVersao = (versao: VersaoCaderneta | undefined) =>
    versao === undefined ? {} : { versaoCaderneta: versao };

  const doCache = deps.cache.get(host);
  if (doCache && agora - doCache.quando < CACHE_FRESCO_MS) {
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(doCache.ficha),
      caderneta: doCache.caderneta,
      ...comVersao(doCache.versaoCaderneta),
    };
  }
  // L8, 2.3: loja fora do ar decidida há menos de 60 s -> a mesma página,
  // sem perguntar de novo à caderneta. Nunca coexiste com uma ficha FRESCA
  // do mesmo host: a ficha só nasce de uma resolução, e enquanto esta
  // decisão está fresca não há resolução para este host.
  const foraDoArGuardada = deps.cacheForaDoAr?.get(host);
  if (
    foraDoArGuardada &&
    agora - foraDoArGuardada.quando < CACHE_FORA_DO_AR_MS
  ) {
    return {
      tipo: "manutencao",
      resposta: respostaForaDoAr(
        foraDoArGuardada.loja,
        "hit",
        ambiente.IKCOUS_LINK_ACORDAR,
      ),
    };
  }
  // O "não achei" guardado. Vem DEPOIS da ficha fresca: uma loja ativa com
  // ficha fresca nunca recebe 503 por causa deste cache (e uma resolução boa
  // apaga a entrada, abaixo). Entrada com `recuo` é FALHA, não "não achei":
  // é tratada mais abaixo, depois da ficha velha.
  const semLojaGuardada = deps.cacheSemLoja?.get(host);
  if (
    semLojaGuardada &&
    !semLojaGuardada.recuo &&
    agora - semLojaGuardada.quando < CACHE_SEM_LOJA_MS
  ) {
    return {
      tipo: "manutencao",
      resposta: marcarReservaNoNaoAchei(
        marcarVersaoDaCaderneta(
          respostaManutencao("sem-loja", "miss"),
          semLojaGuardada.versaoCaderneta,
        ),
        deps.lerReserva !== undefined,
      ),
    };
  }
  // Recuo depois de uma falha: a ficha velha direto, sem perguntar — sempre
  // dentro do teto de 1 h da ficha velha.
  if (
    doCache?.recuo &&
    agora < doCache.recuo.ate &&
    agora - doCache.quando < CACHE_STALE_MAX_MS
  ) {
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(doCache.ficha),
      caderneta: doCache.recuo.caderneta,
      ...comVersao(doCache.recuo.versaoCaderneta),
    };
  }
  const fichaNaReserva =
    doCache !== undefined && agora - doCache.quando < CACHE_STALE_MAX_MS;
  // Recuo depois de uma falha SEM ficha que valha (instância nova, ou ficha
  // passada de 1 h): o MESMO 503 de falha, sem perguntar.
  if (
    !fichaNaReserva &&
    semLojaGuardada?.recuo &&
    agora < semLojaGuardada.recuo.ate
  ) {
    return {
      tipo: "manutencao",
      resposta: marcarVersaoDaCaderneta(
        respostaManutencao(
          "banco-indisponivel",
          semLojaGuardada.recuo.caderneta,
        ),
        semLojaGuardada.recuo.versaoCaderneta,
      ),
    };
  }
  // Stale-while-revalidate: ficha passada dos 60 s, dentro da reserva de 1 h,
  // com `waitUntil` -> a visita sai AGORA com ela e a caderneta é perguntada
  // em segundo plano (uma só por host: se já há resolução em voo para este
  // host, ela é que vai renovar a ficha). O estado servido é o último
  // conhecido: o da falha, se a ficha já passou por um recuo (vencido).
  if (doCache && fichaNaReserva && deps.waitUntil) {
    if (!deps.resolucoesEmVoo?.has(host))
      revalidarEmSegundoPlano(
        host,
        url,
        ambiente,
        deps,
        doCache,
        deps.waitUntil,
      );
    const conhecido = doCache.recuo ?? doCache;
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(doCache.ficha),
      caderneta: conhecido.caderneta,
      ...comVersao(conhecido.versaoCaderneta),
    };
  }
  try {
    // A reserva só vale para quem não tem ficha de até 1 h: com ela, a ficha
    // velha (stale-if-error, abaixo) é a resposta à falha, e a reserva nem é
    // lida.
    const resolvida = await resolucaoCompartilhada(
      host,
      url,
      ambiente,
      deps,
      !fichaNaReserva,
    );
    guardarComTeto(deps.cache, host, {
      ficha: resolvida.ficha,
      quando: agora,
      caderneta: resolvida.caderneta,
      ...comVersao(resolvida.versaoCaderneta),
    });
    deps.cacheForaDoAr?.delete(host);
    deps.cacheSemLoja?.delete(host);
    return {
      tipo: "ok",
      ficha: comPublicUrlAtual(resolvida.ficha),
      caderneta: resolvida.caderneta,
      ...comVersao(resolvida.versaoCaderneta),
    };
  } catch (erro) {
    // L8: loja adormecida/encerrada. A ficha ANTIGA deste host (de quando a
    // loja estava ativa) sai do cache AGORA: sem isso, uma falha da caderneta
    // daqui a pouco cairia no stale-if-error abaixo e serviria a vitrine
    // velha, com a conexão do banco de uma loja que não está mais no ar.
    if (erro instanceof DecisaoForaDoAr) {
      deps.cache.delete(host);
      deps.cacheSemLoja?.delete(host);
      guardarComTeto(deps.cacheForaDoAr, host, {
        loja: erro.loja,
        quando: agora,
      });
      return {
        tipo: "manutencao",
        resposta: respostaForaDoAr(
          erro.loja,
          erro.caderneta,
          ambiente.IKCOUS_LINK_ACORDAR,
        ),
      };
    }
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
        resposta: marcarVersaoDaCaderneta(
          respostaEncaminhamento(
            `https://${erro.dominioPublico}${url.pathname}${url.search}`,
            erro.caderneta,
          ),
          erro.versaoCaderneta,
        ),
      };
    // "Não achei" para um host com ficha boa de menos de 1 h: a MESMA reserva
    // da falha (abaixo), nunca o host guardado como desconhecido. A caderneta
    // é um ponto único: zero linhas para TODA a frota (chave trocada de um
    // lado só, tabela restaurada errada) fecharia todas as lojas em 60 s, e o
    // 503 `sem-loja` ainda faria o service worker apagar a página guardada.
    // Loja que dorme ou encerra sai do ar pelo estado EXPLÍCITO (acima), não
    // por zero linhas. A reserva não se renova: passada 1 h da última
    // resolução boa, o "não achei" volta a valer.
    if (
      ehNaoAchei(erro) &&
      doCache &&
      agora - doCache.quando < CACHE_STALE_MAX_MS
    ) {
      abrirRecuoComFicha(deps, host, doCache, agora, erro);
      return {
        tipo: "ok",
        ficha: comPublicUrlAtual(doCache.ficha),
        caderneta: erro.caderneta,
        ...comVersao(erro.versaoCaderneta),
      };
    }
    if (erro instanceof DecisaoPorteiro) {
      // Só o "não achei" DEFINITIVO da caderneta (`miss`) é guardado. A
      // chave anômala também vira `sem-loja`, mas com `caderneta: "erro"`:
      // é resposta estranha, não "não achei", e pergunta de novo.
      const naoAchei = ehNaoAchei(erro);
      if (naoAchei)
        guardarComTeto(deps.cacheSemLoja, host, {
          quando: agora,
          ...comVersao(erro.versaoCaderneta),
        });
      const resposta = marcarVersaoDaCaderneta(
        respostaManutencao(erro.motivo, erro.caderneta),
        erro.versaoCaderneta,
      );
      return {
        tipo: "manutencao",
        resposta: naoAchei
          ? marcarReservaNoNaoAchei(resposta, deps.lerReserva !== undefined)
          : resposta,
      };
    }
    // Falha de rede/schema (não é uma DECISÃO): stale-if-error por até 1h.
    // O `x-ikcous-caderneta` reflete o que ESTA tentativa (a que falhou)
    // já sabia sobre a caderneta antes de falhar — informação mais atual
    // do que a caderneta que produziu a ficha em cache, ainda que a ficha
    // servida seja a antiga. A marca de versão segue a mesma regra.
    const cadernetaDaFalha = estadoDaFalha(erro);
    const versaoDaFalha = versaoDaFalhaDe(erro);
    if (doCache && agora - doCache.quando < CACHE_STALE_MAX_MS) {
      // Abre o recuo de 30 s deste host (e o aviso no log, uma vez).
      abrirRecuoComFicha(deps, host, doCache, agora, erro);
      return {
        tipo: "ok",
        ficha: comPublicUrlAtual(doCache.ficha),
        caderneta: cadernetaDaFalha,
        ...comVersao(versaoDaFalha),
      };
    }
    // Sem ficha que valha: o recuo de 10 s (e o aviso no log, uma vez).
    abrirRecuoSemFicha(deps, host, erro);
    return {
      tipo: "manutencao",
      resposta: marcarVersaoDaCaderneta(
        respostaManutencao("banco-indisponivel", cadernetaDaFalha),
        versaoDaFalha,
      ),
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
  // L8: `x-ikcous-caderneta-versao: 1` em toda resposta montada a partir de
  // uma resolução pela reserva; sem a marca, a resposta sai intacta.
  const marcar = (resposta: Response): Response =>
    marcarVersaoDaCaderneta(resposta, resultado.versaoCaderneta);

  const url = new URL(request.url);
  if (url.pathname === CAMINHO_IDENTIDADE_JSON) {
    return marcar(
      new Response(JSON.stringify(ficha), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-ikcous-porteiro": "ok",
          "x-ikcous-caderneta": estadoCaderneta,
        },
      }),
    );
  }
  if (url.pathname === "/manifest.webmanifest")
    return marcar(atenderManifest(ficha, estadoCaderneta));
  if (url.pathname === "/robots.txt")
    return marcar(atenderRobots(request, ficha, estadoCaderneta));
  if (url.pathname === "/sitemap.xml")
    return marcar(
      await atenderMapaDoSite(request, ficha, estadoCaderneta, deps),
    );

  // A DECISÃO de pôr o cartaz mora AQUI (não em `documentoDaLoja`, que o robô
  // de prévia também usa): só GET, só navegador abrindo a vitrine pela 1ª vez
  // (`pedidoPodeTerCartaz`), loja fora de manutenção, interruptor ligado e
  // foto redimensionada (decidido pela origem, ANTES de ler qualquer banner).
  const cartaz =
    request.method === "GET" &&
    cleanEnvVar(ambiente.IKCOUS_CARTAZ_DESLIGADO ?? "") !== "1" &&
    !ficha.configuracao.manutencao &&
    pedidoPodeTerCartaz(url, request.headers) &&
    lojaRedimensionaFoto(ficha.conexao.supabaseUrl);
  const resposta = await documentoDaLoja(
    request,
    ficha,
    estadoCaderneta,
    deps,
    {},
    { cartaz, deploy: ambiente.VERCEL_DEPLOYMENT_ID },
  );
  // Só conta o que a pessoa de fato recebeu: documento 200 (503 de manutenção
  // do porteiro e `html-indisponivel` ficam de fora), de uma página da loja
  // (GET; nada de arquivo, `/api/`, HEAD) e com a loja aberta (em manutenção a
  // vitrine não abre, então não houve visita).
  if (
    deps.contarEntrada !== undefined &&
    resposta.status === 200 &&
    !ficha.configuracao.manutencao &&
    ehPaginaContavel(request.method, url)
  ) {
    try {
      deps.contarEntrada(ficha.conexao, request);
    } catch (erro) {
      console.error("[Porteiro] contador: falha inesperada:", erro);
    }
  }
  return marcar(resposta);
}

// ─── robots.txt e sitemap.xml POR LOJA (multiloja-frota-3) ─────────────────
//
// SUPOSIÇÕES DE ESTADO, ditas em voz alta:
//   - Só chegam aqui hosts que `obterFichaValidada` confirmou (banco da loja
//     concorda que é dono do host). Host desconhecido/discordante/alias já
//     saiu antes como 503/308, IGUAL ao documento — nunca o mapa de outra loja.
//   - O endereço do mapa é `<protocolo>//<ficha.host><:porta>`: `ficha.host` é
//     o host NORMALIZADO (minúsculo, sem ponto de FQDN), o mesmo que a
//     concordância comparou com `dominio_publico`. Nunca o endereço do build.
//   - O catálogo vem do banco DA FICHA (`ficha.conexao`), a mesma conexão que
//     provou o domínio. Ler produto de outra conexão não é possível por
//     construção: não existe outra conexão nesta função.
//   - Idempotente e sem efeito colateral além do cache em memória do isolate.

function enderecoDoMapa(request: Request, ficha: FichaDaLoja): string {
  const url = new URL(request.url);
  return `${url.protocol}//${ficha.host}${url.port ? `:${url.port}` : ""}`;
}

const CABECALHOS_DO_MAPA = {
  "x-ikcous-porteiro": "ok",
  vary: "host",
} as const;

function atenderRobots(
  request: Request,
  ficha: FichaDaLoja,
  caderneta: EstadoCaderneta,
): Response {
  return new Response(robotsTxt(enderecoDoMapa(request, ficha)), {
    headers: {
      ...CABECALHOS_DO_MAPA,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=600",
      "x-ikcous-caderneta": caderneta,
    },
  });
}

async function atenderMapaDoSite(
  request: Request,
  ficha: FichaDaLoja,
  caderneta: EstadoCaderneta,
  deps: DependenciasPorteiro,
): Promise<Response> {
  const origem = enderecoDoMapa(request, ficha);
  const chaveDoCache = `${ficha.host}|${ficha.conexao.supabaseUrl}`;
  const agora = (deps.agora ?? Date.now)();
  const guardado = deps.cacheMapa?.get(chaveDoCache);

  const responder = (
    ids: readonly string[],
    modo: "completo" | "stale" | "estatico",
  ): Response =>
    new Response(sitemapXml(origem, ids), {
      headers: {
        ...CABECALHOS_DO_MAPA,
        "content-type": "application/xml; charset=utf-8",
        // O mapa DEGRADADO (só estáticas) nunca pode ficar na borda: o próximo
        // robô tem de tentar o catálogo de novo.
        "cache-control":
          modo === "estatico"
            ? "no-store"
            : "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
        "x-ikcous-caderneta": caderneta,
        "x-ikcous-mapa": modo,
      },
    });

  if (guardado && agora - guardado.quando < CACHE_MAPA_FRESCO_MS)
    return responder(guardado.ids, "completo");

  try {
    const ids = await buscarIdsDosProdutos(
      {
        supabaseUrl: ficha.conexao.supabaseUrl,
        publishableKey: ficha.conexao.publishableKey,
      },
      { fetchImpl: deps.fetchImpl },
    );
    guardarComTeto(deps.cacheMapa, chaveDoCache, { ids, quando: agora });
    return responder(ids, "completo");
  } catch (erro) {
    // Falha de leitura NUNCA vira erro para o robô: o último mapa bom DESTA
    // loja (até 1h) ou, sem ele, só as URLs estáticas DELA. Fica no log para
    // "mapa pequeno" nunca ser silencioso (`x-ikcous-mapa` também diz).
    console.error("[Porteiro] sitemap sem produtos:", erro);
    if (guardado && agora - guardado.quando < CACHE_MAPA_STALE_MAX_MS)
      return responder(guardado.ids, "stale");
    return responder([], "estatico");
  }
}

// ─── Cartaz pré-impresso (lote B, 31/10/2026) ──────────────────────────────
//
// Na 1ª visita o porteiro imprime no splash do HTML a foto do banner do topo
// (a regra de escolha, a defesa da URL e o trecho moram em `cartaz.ts`) para o
// navegador baixá-la junto com o documento. SUPOSIÇÕES DE ESTADO, em voz alta:
//   - LEITURA SEPARADA DA FICHA: o banner NÃO entra em `resolverFichaViaRede`
//     (falha ali vira ficha antiga por 1 h e depois 503 "em manutenção"), nem
//     no `SELECT_CONFIGURACAO_PUBLICA`, nem no cache da ficha, nem no
//     `/identidade.json`. É uma função à parte que NUNCA lança.
//   - FALHA SEGURA: qualquer erro, atraso, dado estranho ou dúvida = o HTML é
//     BYTE A BYTE o de hoje (só o `Vary` do caminho do navegador cresce). O
//     cartaz é um acréscimo; nunca pode derrubar nem atrasar a loja além do
//     prazo.
//   - A leitura corre EM PARALELO com o `/index.html` (não soma) e tem prazo
//     curto (`PRAZO_BANNERS_MS`); passou do prazo, segue sem cartaz.
//   - SÓ 1ª VISITA, pelos cabeçalhos `Sec-Fetch-*` (ver `pedidoPodeTerCartaz`):
//     o porteiro não enxerga o service worker, mas distingue o pedido dele do
//     do navegador. Quem volta é atendido pelo SW com o HTML do cache, e o
//     pedido de revalidação/instalação do SW nunca recebe cartaz.
//   - Idempotente e sem estado além do cache de 15 s por loja: repetir o
//     pedido repete o resultado; nenhum cookie, nenhuma escrita.
//   - O caminho do robô de prévia (`documentoDaLoja` sem a opção) nunca recebe.

/** Banners do topo lidos do banco da loja: frescos por 15 s (a lojista troca
 * o banner e confere em aba anônima); leitura que falhou, 10 s. */
export const CACHE_CARTAZ_FRESCO_MS = 15_000;
export const CACHE_CARTAZ_FALHA_MS = 10_000;
/** Prazo da leitura: o cartaz não pode atrasar a página além disto. */
export const PRAZO_BANNERS_MS = 250;
const MAX_BYTES_BANNERS = 64 * 1024;
/** Mais que 2 de propósito: banner vencido/agendado de menor `order` ocuparia
 * uma das duas vagas e esconderia um empate real entre os vigentes. */
const LIMITE_DE_BANNERS = 10;

async function lerBannersDoTopoComSinal(
  conexao: Pick<ConexaoResolvida, "supabaseUrl" | "publishableKey">,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<readonly unknown[]> {
  // Leitura anônima de `home_top` ativos, por `order` e depois `id` (os mesmos
  // filtros do app, `pedirBanners`): a escolha do primeiro banner do topo tem
  // de dar o mesmo resultado nos dois lugares. As datas se filtram na hora de
  // servir, em `escolherBannerDoTopo`.
  const url = `${conexao.supabaseUrl}/rest/v1/banners?select=*&position=eq.home_top&active=eq.true&order=order.asc,id.asc&limit=${LIMITE_DE_BANNERS}`;
  const resposta = await fetchImpl(url, {
    headers: {
      apikey: conexao.publishableKey,
      Authorization: `Bearer ${conexao.publishableKey}`,
    },
    signal,
    redirect: "error",
    credentials: "omit",
  });
  if (!resposta.ok) throw new Error("PORTEIRO_BANNERS: resposta não-ok");
  const texto = await lerCorpoComTeto(resposta, signal, MAX_BYTES_BANNERS);
  const linhas: unknown = JSON.parse(texto);
  if (!Array.isArray(linhas))
    throw new Error("PORTEIRO_BANNERS: forma inesperada");
  return linhas;
}

/** Mesma corrida contra o temporizador de `lerConfiguracaoPublica`: um
 * `fetchImpl` que ignora o sinal e nunca resolve não pode prender a página. */
async function lerBannersDoTopo(
  conexao: Pick<ConexaoResolvida, "supabaseUrl" | "publishableKey">,
  fetchImpl: typeof fetch,
): Promise<readonly unknown[]> {
  const controller = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const prazoEsgotado = new Promise<never>((_resolve, reject) => {
    temporizador = setTimeout(() => {
      controller.abort();
      reject(new Error("PORTEIRO_BANNERS: prazo esgotado"));
    }, PRAZO_BANNERS_MS);
  });
  try {
    return await Promise.race([
      lerBannersDoTopoComSinal(conexao, fetchImpl, controller.signal),
      prazoEsgotado,
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** O cartaz desta loja agora, ou `null`. NUNCA rejeita. */
async function cartazDaLoja(
  ficha: FichaDaLoja,
  deps: Pick<DependenciasPorteiro, "fetchImpl" | "cacheCartaz" | "agora">,
): Promise<Cartaz | null> {
  try {
    const agora = (deps.agora ?? Date.now)();
    const chave = `${ficha.host}|${ficha.conexao.supabaseUrl}`;
    const guardado = deps.cacheCartaz?.get(chave);
    let linhas: readonly unknown[] | null;
    if (
      guardado &&
      agora - guardado.quando <
        (guardado.linhas === null
          ? CACHE_CARTAZ_FALHA_MS
          : CACHE_CARTAZ_FRESCO_MS)
    ) {
      linhas = guardado.linhas;
    } else {
      try {
        linhas = await lerBannersDoTopo(ficha.conexao, deps.fetchImpl);
      } catch (erro) {
        console.error("[Porteiro] cartaz: banners não lidos:", erro);
        linhas = null;
      }
      guardarComTeto(deps.cacheCartaz, chave, { linhas, quando: agora });
    }
    if (linhas === null) return null;
    const linha = escolherBannerDoTopo(linhas, agora);
    return linha === null
      ? null
      : montarCartaz(linha, ficha.conexao.supabaseUrl);
  } catch (erro) {
    console.error("[Porteiro] cartaz: falha inesperada:", erro);
    return null;
  }
}

// ─── O /index.html em memória (lote C do plano "primeira visita leve",
// 26/11/2026) ───────────────────────────────────────────────────────────────
//
// Todo documento fazia um self-fetch do `/index.html` estático (`no-store` no
// `vercel.json`): um pedido a mais na CDN da Vercel por página aberta. Agora
// a instância guarda o arquivo por 5 min. SUPOSIÇÕES DE ESTADO, em voz alta:
//   - Guarda o HTML CRU, ANTES de qualquer injeção. A ficha
//     (`injetarFichaNoHtml`) e o cartaz continuam montados a CADA pedido, com
//     a ficha validada daquele host: o que muda entre lojas nunca entra no
//     cache.
//   - Chave = o endereço EXATO do self-fetch (`origin` do pedido +
//     `/index.html`: protocolo, host e porta). Dois hosts nunca dividem uma
//     entrada, nem quando o arquivo de um deploy é o mesmo para todos. O
//     `cookie` repassado fica FORA da chave: o arquivo estático não varia por
//     ele, e o porteiro só roda depois da Deployment Protection da Vercel.
//   - Só entra o HTML DESTE deploy (ressalva do revisor, PR #1910): a marca
//     `<meta name="ikcous-deploy">` gravada pelo build tem de ser igual ao
//     `VERCEL_DEPLOYMENT_ID` do runtime. O self-fetch vai ao domínio público,
//     que numa troca de domínio ou rollback pode servir o HTML de OUTRO deploy
//     (com `/assets/` que este não serve); esse HTML sai como antes, só não é
//     guardado. Sem variável, sem marca ou marca diferente = não guarda.
//   - Só 200 entra. 404/5xx/rede caindo nunca ficam guardados: o próximo
//     pedido busca de novo (e o de agora recebe a 503 `html-indisponivel`,
//     também quando a rede cai ou o prazo estoura).
//   - Pedidos simultâneos do mesmo endereço esperam a MESMA busca
//     (`indexHtmlEmVoo`); a entrada sai quando ela termina, com ou sem erro.
//   - Deploy novo: a instância nova nasce com o `Map` vazio, e a antiga deixa
//     de receber o host quando o domínio passa para o deploy novo. O relógio
//     da entrada é o INÍCIO da busca, então nenhum HTML é servido mais de
//     5 min depois de ter sido pedido à CDN.
//   - Idempotente: repetir o pedido repete o resultado; nenhuma escrita além
//     do `Map` da instância (teto `TETO_ENTRADAS_CACHE`).

/** O `/index.html` guardado por até 5 min (ver acima). */
export const CACHE_INDEX_HTML_MS = 300_000;

/** Prazo da busca do `/index.html` (caça 26/11/2026): é um arquivo estático
 * servido pela própria CDN da Vercel, que responde em milissegundos; 5 s é o
 * MESMO prazo da caderneta (`PRAZO_CADERNETA_MS`, `middleware.ts`). Sem ele,
 * uma CDN lenta prendia a 1ª visita (e todos os pedidos juntos em
 * `indexHtmlEmVoo`) sem limite. Estourou = o caminho da rede caindo. */
export const PRAZO_INDEX_HTML_MS = 5_000;

/** O `/index.html` CRU de um endereço, guardado por `origin` + caminho. */
export interface EntradaCacheIndexHtml {
  readonly html: string;
  readonly quando: number;
}

/** O que a busca do `/index.html` deu: `html` só existe com 200. */
export interface IndexHtmlBaixado {
  readonly status: number;
  readonly html: string | null;
}

/** O `/index.html` do endereço deste pedido: do cache, da busca em voo, ou
 * da CDN. Rejeita só se a própria busca rejeitar (como antes). */
async function baixarIndexHtml(
  request: Request,
  deps: Pick<
    DependenciasPorteiro,
    "fetchImpl" | "agora" | "cacheIndexHtml" | "indexHtmlEmVoo"
  >,
  deployDoRuntime: string | undefined,
): Promise<IndexHtmlBaixado> {
  const endereco = new URL("/index.html", request.url);
  const chave = endereco.href;
  const agora = (deps.agora ?? Date.now)();
  const guardado = deps.cacheIndexHtml?.get(chave);
  if (guardado && agora - guardado.quando < CACHE_INDEX_HTML_MS)
    return { status: 200, html: guardado.html };
  const emVoo = deps.indexHtmlEmVoo?.get(chave);
  if (emVoo) return emVoo;

  const busca = (async (): Promise<IndexHtmlBaixado> => {
    // Mesma corrida contra o temporizador de `lerConfiguracaoPublica`: um
    // transporte que ignora o sinal e nunca resolve não prende o pedido. O
    // cache só é gravado DEPOIS da corrida, então resposta atrasada não entra.
    const controller = new AbortController();
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const prazoEsgotado = new Promise<never>((_resolve, reject) => {
      temporizador = setTimeout(() => {
        controller.abort();
        reject(new Error("PORTEIRO_INDEX_HTML: prazo esgotado"));
      }, PRAZO_INDEX_HTML_MS);
    });
    let baixado: IndexHtmlBaixado;
    try {
      baixado = await Promise.race([
        (async (): Promise<IndexHtmlBaixado> => {
          const resposta = await deps.fetchImpl(endereco, {
            headers: { cookie: request.headers.get("cookie") ?? "" },
            signal: controller.signal,
          });
          if (resposta.status !== 200)
            return { status: resposta.status, html: null };
          return { status: 200, html: await resposta.text() };
        })(),
        prazoEsgotado,
      ]);
    } finally {
      clearTimeout(temporizador);
    }
    if (baixado.html === null) return baixado;
    const html = baixado.html;
    const deste = idDoDeploy(deployDoRuntime);
    if (deste !== null && deployDoHtml(html) === deste)
      guardarComTeto(deps.cacheIndexHtml, chave, { html, quando: agora });
    return { status: 200, html };
  })();
  const emAndamento = deps.indexHtmlEmVoo;
  if (emAndamento) {
    emAndamento.set(chave, busca);
    const sair = () => {
      if (emAndamento.get(chave) === busca) emAndamento.delete(chave);
    };
    busca.then(sair, sair);
  }
  return busca;
}

/**
 * O documento da loja daquele endereço: baixa o `/index.html` estático do
 * build, injeta a ficha JÁ VALIDADA (`injetarFichaNoHtml`) e responde. É o
 * caminho do navegador em `atenderPorteiro` e, desde 14/10/2026, também o do
 * robô de prévia quando o produto não existe (pausado, apagado, inexistente
 * ou sem `id`) — o robô recebe a página inicial DA LOJA do endereço, nunca o
 * HTML assado do build (que é a identidade da loja principal: "a loja de
 * ninguém" no build compartilhado).
 *
 * Falha FECHADA: documento estático fora do ar (não-200) ou rede caindo ao
 * baixá-lo -> a MESMA 503 de manutenção (`html-indisponivel`); nunca
 * passthrough para o HTML assado. `extras` acrescenta cabeçalhos de
 * diagnóstico (ex.: `x-ikcous-og`) sem alterar os do porteiro.
 */
export async function documentoDaLoja(
  request: Request,
  ficha: FichaDaLoja,
  estadoCaderneta: EstadoCaderneta,
  deps: Pick<
    DependenciasPorteiro,
    "fetchImpl" | "cacheCartaz" | "agora" | "cacheIndexHtml" | "indexHtmlEmVoo"
  >,
  extras: Readonly<Record<string, string>> = {},
  opcoes: {
    readonly cartaz?: boolean;
    /** O `VERCEL_DEPLOYMENT_ID` do runtime: só com ele o HTML é guardado. */
    readonly deploy?: string;
  } = {},
): Promise<Response> {
  // `opcoes.cartaz` só EXECUTA a decisão de `atenderPorteiro` (o robô de prévia
  // não passa `opcoes`). A leitura corre junto com o documento e nunca rejeita.
  // Rede caindo ou prazo esgotado no `/index.html` = a MESMA 503 do não-200
  // (antes só o robô a recebia, pelo `catch` do middleware; o navegador
  // recebia o erro da Vercel). `cartazDaLoja` nunca rejeita.
  let indexHtml: IndexHtmlBaixado;
  let cartaz: Cartaz | null;
  try {
    [indexHtml, cartaz] = await Promise.all([
      baixarIndexHtml(request, deps, opcoes.deploy),
      opcoes.cartaz === true
        ? cartazDaLoja(ficha, deps)
        : Promise.resolve(null),
    ]);
  } catch (erro) {
    console.error("[Porteiro] /index.html não baixado:", erro);
    return respostaManutencao("html-indisponivel", estadoCaderneta);
  }
  if (indexHtml.html === null)
    return respostaManutencao("html-indisponivel", estadoCaderneta);
  const injetado = injetarFichaNoHtml(indexHtml.html, ficha);
  const comCartaz =
    cartaz === null ? null : injetarCartazNoHtml(injetado, cartaz);
  const cabecalhos = {
    "content-type": "text/html; charset=utf-8",
    "x-ikcous-porteiro": "ok",
    "x-ikcous-caderneta": estadoCaderneta,
    "cache-control": "no-store",
    // O caminho do navegador depende do pedido (cabeçalhos `Sec-Fetch-*` e
    // `Save-Data` decidem o cartaz); o do robô, não.
    vary:
      opcoes.cartaz === undefined
        ? "host"
        : "host, sec-fetch-dest, sec-fetch-mode, save-data",
    ...(comCartaz === null ? {} : { "x-ikcous-cartaz": "ok" }),
  };
  return new Response(comCartaz ?? injetado, {
    headers: { ...cabecalhos, ...extras },
  });
}
