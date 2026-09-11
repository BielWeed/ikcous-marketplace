import { readFile } from "node:fs/promises";
// servidor.ts — o "hospedeiro de brinquedo" da prova ponta a ponta com dois
// (na verdade cinco) hosts (T6, etapa 2 da escala, 11/09/2026, ADENDO C).
// Sobe um `http.createServer` local que, para cada requisição, monta um
// `Request` NATIVO e chama o `middleware()` REAL de `middleware.ts` — a
// MESMA função que a Vercel Edge invoca em produção. Nada aqui reimplementa
// o porteiro; este arquivo só finge ser o hospedeiro em volta dele.
//
// Duas peças de infraestrutura ficam FORA do que a Vercel oferece de
// verdade, e são o motivo de existir este arquivo:
//
// 1. `globalThis.fetch` é substituído, durante toda a vida do servidor (ver
//    a nota abaixo), por um dublê: chamadas para as origens dos "bancos de brinquedo"
//    (`https://<ref>.supabase.co/rest/v1/...`) e para a RPC da caderneta
//    (`.../rest/v1/rpc/resolver_loja`) respondem da tabela em memória abaixo;
//    o self-fetch de `/index.html` (que `atenderPorteiro` faz para buscar o
//    HTML assado) lê `dist-test/index.html` do disco.
//
// 2. `middleware.ts` lê a conexão de `process.env` — nunca recebe um
//    parâmetro de ambiente — e cada host de teste precisa de um banco
//    DIFERENTE. Este servidor MUTA `process.env` a cada requisição, pelo
//    `Host` recebido, ANTES de chamar `middleware()`. Dois hosts usam o
//    caminho (b) do porteiro (o ambiente do "próprio projeto", com um banco
//    de brinquedo diferente por host); dois usam o caminho (a), a caderneta
//    central, com a RPC dublada devolvendo bancos diferentes por host (um
//    deles de propósito ERRADO — o cenário "ficha trocada").
//
// SUPOSIÇÃO DE ESTADO (documentar em voz alta, não escrever por cima da
// dúvida): a mutação de `process.env` por HOST NÃO É segura para
// requisições de HOSTS DIFERENTES em voo ao mesmo tempo — cada requisição
// muta o `process.env` do processo inteiro antes de chamar `middleware()`,
// então duas requisições concorrentes para hosts DIFERENTES poderiam ver uma
// pegar o ambiente da outra. Isto imita o desenho real (cada isolate da
// Vercel Edge tem o SEU PRÓPRIO `process.env`, fixo por projeto) só o
// suficiente para provar a composição por host; não é um servidor de
// produção. REGRA: um HOST por vez; requisições concorrentes do MESMO host
// SÃO seguras (ver a nota sobre `globalThis.fetch` abaixo — achado do
// revisor, rodada D, item 5).
//
// `globalThis.fetch` é diferente: o dublê (`fetchDeBrinquedo`) é instalado
// UMA VEZ, na vida inteira do servidor (`iniciarServidorDoisHosts`), e só é
// restaurado quando o servidor fecha (`fechar()`) — NUNCA por requisição.
// Antes desta correção (rodada D, achado 5), cada requisição trocava
// `globalThis.fetch` no início e restaurava no `finally`; com duas
// requisições em voo para o MESMO host (o Chrome de verdade dispara isso:
// `/`, `/sw.js`, `/identidade.json`, `/manifest.webmanifest` e os assets, ao
// mesmo tempo), a primeira a terminar restaurava o `fetch` REAL enquanto a
// segunda ainda estava dentro de `middleware()` — o porteiro saía para
// `https://<hash>.supabase.co` de verdade e caía em 503
// `banco-indisponivel`. Instalar uma vez e nunca trocar durante a vida do
// servidor resolve isso sem abrir mão da mutação por `process.env`.
//
// SUPOSIÇÃO 2: `fetch()` do Node recusa `Host` como cabeçalho (é um dos
// "forbidden header names" do Fetch spec — medido em 11/09/2026: um
// `fetch(url, { headers: { Host: "..." } })` chega ao servidor com o `Host`
// real da conexão, nunca o que foi passado). Por isso o TESTE (não este
// arquivo) precisa falar `node:http` diretamente para simular hosts
// virtuais — documentado de novo em `README.md`.
//
// Imports RELATIVOS (regra do ambiente): nunca `@/`.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import middleware from "../../middleware.ts";
import {
  ehCaminhoDeDocumento,
  normalizarHost,
} from "../../src/hospedagem/porteiro.ts";

// ─── Onde fica o build fixture ("a loja de ninguém") ───────────────────────
//
// Baseado em `process.cwd()`, NUNCA em `import.meta.url` (rodada D, achado
// 7): este arquivo roda em DOIS contextos — Vitest (transforma cada módulo
// no lugar, `import.meta.url` aponta para o arquivo de verdade) e um bundle
// ÚNICO do esbuild para `dist-test/servir.mjs` (`servir.ts`, a prova no
// navegador) — e um bundle de arquivo único COLAPSA todo módulo para a URL
// do PRÓPRIO bundle; `import.meta.url` de QUALQUER módulo empacotado passa a
// apontar para `dist-test/servir.mjs`, não para onde o módulo vivia antes de
// empacotar. Medido em 11/09/2026: com a conta antiga
// (`path.dirname(fileURLToPath(import.meta.url)) + "../../dist-test"`), o
// bundle calculava `dist-test` DUAS pastas acima de `dist-test/`, fora do
// repositório inteiro. `process.cwd()` funciona nos dois contextos porque os
// DOIS são sempre invocados da RAIZ do repositório (`npx vitest run
// --config vitest.porteiro.config.ts` e `node dist-test/servir.mjs` —
// documentado em `README.md` e no cabeçalho de `servir.ts`).
export const DIST_TEST_DIR = path.resolve(process.cwd(), "dist-test");

// ─── Os "bancos de brinquedo" ───────────────────────────────────────────────

function criarAssets(hash: string) {
  const asset = (
    papel: string,
    extensao: string,
    mediaType: string,
    largura?: number,
    altura?: number,
  ) => ({
    path: `v1/${hash}/${papel}.${extensao}`,
    sha256: hash,
    media_type: mediaType,
    bytes: 100,
    ...(largura !== undefined ? { width: largura, height: altura } : {}),
  });
  const header = asset("header", "png", "image/png", 64, 64);
  return {
    version: 1 as const,
    originals: [header],
    header,
    loader: asset("loader", "png", "image/png", 64, 64),
    favicon: asset("favicon", "svg", "image/svg+xml"),
    apple_touch: asset("apple-touch", "png", "image/png", 180, 180),
    icon_192: asset("icon-192", "png", "image/png", 192, 192),
    icon_512: asset("icon-512", "png", "image/png", 512, 512),
    maskable_512: asset("maskable-512", "png", "image/png", 512, 512),
    og: asset("og", "png", "image/png", 1200, 630),
  };
}

/** A LINHA CRUA que o dublê de `fetch` devolve para `v_store_config` — o
 * mesmo formato que `readPublicStoreIdentity` valida com `parseStoreIdentity`
 * (nunca um `PublicStoreIdentity` já pronto: é o parser real quem monta
 * isso, e é ele que este ensaio quer exercitar). Molde de
 * `tests/front/porteiro-fluxo.test.ts` (`linhaFixture`). */
function criarLinha(nome: string, cor: string, hash: string, origem: string) {
  const assets = criarAssets(hash);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origem}/storage/v1/object/public/branding/${assets.header.path}`,
    primary_color: cor,
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
    branding_assets: assets,
  };
}

export const ORIGEM_A = `https://${"a".repeat(20)}.supabase.co`;
export const ORIGEM_B = `https://${"b".repeat(20)}.supabase.co`;
export const ORIGEM_C = `https://${"c".repeat(20)}.supabase.co`;
export const ORIGEM_D = `https://${"d".repeat(20)}.supabase.co`;

export const HOSTS = {
  A: "loja-a.localhost",
  B: "loja-b.localhost",
  C: "loja-c.localhost",
  /** DEDICADO ao teste do FQDN com ponto final (rodada D, achado 1 do
   * revisor): NENHUM outro teste desta suíte pede este host, nem na forma
   * com ponto nem sem — o cache de módulo do porteiro (`normalizarHost`,
   * 60 s) começa SEMPRE vazio para ele. A versão anterior deste teste usava
   * `HOSTS.A`, que o PRIMEIRO teste do arquivo já tinha aquecido: a resposta
   * vinha do cache, então o teste passava mesmo com uma normalização de
   * host QUEBRADA no servidor de ensaio (`aplicarAmbientePorHost` nunca era
   * exercitada com o valor errado, porque o cache já tinha a ficha certa).
   * Só um host que NINGUÉM mais toca discrimina isso. */
  D: "loja-d.localhost",
  /** "ficha trocada": a caderneta dublada devolve, para ESTE host, o banco
   * de B — cujo `dominio_publico` é `loja-b.localhost`, não este. É o
   * negativo central (T3/T3b/T3c): `decidirConcordancia` tem de recusar. */
  TROCADA: "loja-trocada.localhost",
  /** Nenhum caminho (a) nem (b) tem banco para este host — `sem-loja`. */
  DESCONHECIDA: "loja-desconhecida.localhost",
} as const;

interface BancoDeBrinquedo {
  readonly linha: ReturnType<typeof criarLinha>;
  readonly dominioPublico: string;
  readonly chavePublica: string;
}

const BANCOS_POR_ORIGEM: Record<string, BancoDeBrinquedo> = {
  [ORIGEM_A]: {
    linha: criarLinha("Loja A", "#111111", "a1".repeat(32), ORIGEM_A),
    dominioPublico: HOSTS.A,
    chavePublica: "sb_publishable_loja_a",
  },
  [ORIGEM_B]: {
    linha: criarLinha("Loja B", "#222222", "b2".repeat(32), ORIGEM_B),
    dominioPublico: HOSTS.B,
    chavePublica: "sb_publishable_loja_b",
  },
  [ORIGEM_C]: {
    linha: criarLinha("Loja C", "#333333", "c3".repeat(32), ORIGEM_C),
    dominioPublico: HOSTS.C,
    chavePublica: "sb_publishable_loja_c",
  },
  [ORIGEM_D]: {
    linha: criarLinha("Loja D", "#444444", "d4".repeat(32), ORIGEM_D),
    dominioPublico: HOSTS.D,
    chavePublica: "sb_publishable_loja_d",
  },
};

/** Para as asserções do teste — nunca reconstruir estes valores lá. */
export const IDENTIDADES_ESPERADAS: Record<
  string,
  { readonly storeName: string; readonly cor: string; readonly origem: string }
> = {
  [HOSTS.A]: { storeName: "Loja A", cor: "#111111", origem: ORIGEM_A },
  [HOSTS.B]: { storeName: "Loja B", cor: "#222222", origem: ORIGEM_B },
  [HOSTS.C]: { storeName: "Loja C", cor: "#333333", origem: ORIGEM_C },
  [HOSTS.D]: { storeName: "Loja D", cor: "#444444", origem: ORIGEM_D },
};

// ─── A caderneta central dublada (caminho "a") ─────────────────────────────

const FROTA_URL = "https://frota-principal-de-brinquedo.supabase.co";
const FROTA_APIKEY = "sb_publishable_frota_principal";
const FROTA_CHAVE = "segredo-de-32-bytes-so-para-este-ensaio";

/** Host pedido -> ORIGEM do banco que a RPC dublada devolve. `HOSTS.C` é o
 * caminho feliz (a caderneta concorda com o próprio host); `HOSTS.TROCADA`
 * é o cenário "ficha trocada": a caderneta devolve o banco de OUTRA loja. */
const CADERNETA_MAPEAMENTO: Record<string, string> = {
  [HOSTS.C]: ORIGEM_C,
  [HOSTS.TROCADA]: ORIGEM_B,
};

// ─── process.env por host ───────────────────────────────────────────────────

const CHAVES_DE_AMBIENTE_DO_PORTEIRO = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "IKCOUS_FROTA_URL",
  "IKCOUS_FROTA_APIKEY",
  "IKCOUS_FROTA_CHAVE",
  "VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

/** Regra estrita (ADENDO B/T6, item do servidor): `VERCEL_ENV` e
 * `VERCEL_PROJECT_PRODUCTION_URL` ficam SEMPRE ausentes aqui — nenhum destes
 * cenários é um preview de PR, e o relaxamento de `decidirConcordancia` só
 * vale para `vercelEnv === "preview"` (rodada B, achado do revisor). */
function aplicarAmbientePorHost(hostname: string): void {
  // eslint-disable-next-line security/detect-object-injection -- `chave` percorre SÓ o array literal fixo `CHAVES_DE_AMBIENTE_DO_PORTEIRO` declarado acima, nunca entrada externa.
  for (const chave of CHAVES_DE_AMBIENTE_DO_PORTEIRO) delete process.env[chave];

  if (hostname === HOSTS.A) {
    process.env.VITE_SUPABASE_URL = ORIGEM_A;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
      // eslint-disable-next-line security/detect-object-injection -- `ORIGEM_A` é a constante do módulo declarada acima, não entrada externa.
      BANCOS_POR_ORIGEM[ORIGEM_A]!.chavePublica;
    return;
  }
  if (hostname === HOSTS.B) {
    process.env.VITE_SUPABASE_URL = ORIGEM_B;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
      // eslint-disable-next-line security/detect-object-injection -- `ORIGEM_B` é a constante do módulo declarada acima, não entrada externa.
      BANCOS_POR_ORIGEM[ORIGEM_B]!.chavePublica;
    return;
  }
  if (hostname === HOSTS.C || hostname === HOSTS.TROCADA) {
    process.env.IKCOUS_FROTA_URL = FROTA_URL;
    process.env.IKCOUS_FROTA_APIKEY = FROTA_APIKEY;
    process.env.IKCOUS_FROTA_CHAVE = FROTA_CHAVE;
    return;
  }
  if (hostname === HOSTS.D) {
    process.env.VITE_SUPABASE_URL = ORIGEM_D;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
      // eslint-disable-next-line security/detect-object-injection -- `ORIGEM_D` é a constante do módulo declarada acima, não entrada externa.
      BANCOS_POR_ORIGEM[ORIGEM_D]!.chavePublica;
    return;
  }
  // HOSTS.DESCONHECIDA (e qualquer outro host): nenhuma variável — os dois
  // caminhos do porteiro ficam sem banco, e `resolverConexao` devolve
  // `conexao: null` -> "sem-loja".
}

// ─── O dublê de fetch ───────────────────────────────────────────────────────

async function lerCorpoDoInit(init: RequestInit | undefined): Promise<string> {
  if (typeof init?.body === "string") return init.body;
  return "";
}

async function fetchDeBrinquedo(
  entrada: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(
    entrada instanceof Request ? entrada.url : String(entrada),
  );

  // Self-fetch do HTML assado (o único self-fetch que `atenderPorteiro`
  // ainda faz — o manifest é montado inteiramente a partir da ficha).
  if (url.pathname === "/index.html") {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo dentro de DIST_TEST_DIR (constante do ensaio), nunca entrada externa; a catraca de lint conta warnings globais.
    const bytes = await readFile(path.join(DIST_TEST_DIR, "index.html"));
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // A RPC da caderneta central (`resolverNaCaderneta`, exportada por
  // `middleware.ts`, chama `fetch` de verdade — este dublê responde por ela).
  if (url.pathname === "/rest/v1/rpc/resolver_loja") {
    const corpo = await lerCorpoDoInit(init);
    const { p_host, p_chave } = corpo
      ? (JSON.parse(corpo) as { p_host?: unknown; p_chave?: unknown })
      : {};
    if (p_chave !== FROTA_CHAVE || typeof p_host !== "string") {
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // eslint-disable-next-line security/detect-object-injection -- `p_host` vem do corpo da RPC dublada de um servidor de ENSAIO local (nunca rede pública); o pior caso é um `undefined` tratado abaixo.
    const origemMapeada = CADERNETA_MAPEAMENTO[p_host];
    // eslint-disable-next-line security/detect-object-injection -- `origemMapeada`, quando presente, é sempre uma das ORIGEM_* fixas atribuídas acima em `CADERNETA_MAPEAMENTO`, nunca entrada externa.
    const banco = origemMapeada ? BANCOS_POR_ORIGEM[origemMapeada] : undefined;
    if (!origemMapeada || !banco) {
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const linha = {
      id: origemMapeada,
      nome: banco.linha.store_name,
      dominio_publico: banco.dominioPublico,
      project_ref: new URL(origemMapeada).hostname.split(".")[0],
      supabase_url: origemMapeada,
      publishable_key: banco.chavePublica,
    };
    return new Response(JSON.stringify([linha]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // `readPublicStoreIdentity` (a identidade completa) e `lerDominioPublico`
  // (só a coluna de concordância) — as duas leituras de `v_store_config`.
  if (url.pathname === "/rest/v1/v_store_config") {
    const banco = BANCOS_POR_ORIGEM[url.origin];
    if (!banco)
      return new Response("banco nao mapeado no servidor de ensaio", {
        status: 500,
      });
    if (url.searchParams.get("select") === "dominio_publico") {
      return new Response(
        JSON.stringify([{ dominio_publico: banco.dominioPublico }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify([banco.linha]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  throw new Error(
    `servidor de ensaio dos dois (cinco) hosts: URL não mapeada: ${url.toString()}`,
  );
}

// ─── Servir o disco (dist-test/) ────────────────────────────────────────────

const TIPOS_DE_CONTEUDO: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

async function servirEstatico(
  pathname: string,
  res: ServerResponse,
): Promise<void> {
  const relativo = pathname === "/" ? "/index.html" : pathname;
  const destino = path.normalize(path.join(DIST_TEST_DIR, relativo));
  if (
    destino !== DIST_TEST_DIR &&
    !destino.startsWith(DIST_TEST_DIR + path.sep)
  ) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("caminho fora de dist-test/");
    return;
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- destino é sempre dentro de DIST_TEST_DIR, checado acima; a entrada vem do path da requisição de teste, nunca de rede pública.
    const bytes = await readFile(destino);
    const extensao = path.extname(destino).toLowerCase();
    res.writeHead(200, {
      // eslint-disable-next-line security/detect-object-injection -- `extensao` vem de `path.extname` sobre um caminho já validado como interno a `DIST_TEST_DIR`; o mapa é fixo, e uma chave ausente cai no `??` seguro.
      "content-type": TIPOS_DE_CONTEUDO[extensao] ?? "application/octet-stream",
      // `Content-Length` explícito (em vez de deixar o Node cair em
      // `Transfer-Encoding: chunked`): diagnóstico do registro do Service
      // Worker no navegador (rodada D, item 2) — testar a hipótese antes de
      // descartá-la.
      "content-length": String(bytes.byteLength),
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`não encontrado em dist-test/: ${pathname}`);
  }
}

// ─── O handler HTTP ─────────────────────────────────────────────────────────

async function tratarRequisicao(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cabecalhoHost = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${cabecalhoHost}`);
  // A MESMA regra do produto (`normalizarHost`, src/hospedagem/porteiro.ts) —
  // nunca uma cópia própria (achado do revisor, rodada C): ela tira minúsculo,
  // porta E o ponto final de FQDN, que `new URL(...).hostname` sozinho NÃO
  // remove. Reimplementar aqui divergiria justamente nessa classe de entrada.
  const hostname = normalizarHost(url);

  // O `config.matcher` de `middleware.ts` (análise estática da Vercel, fora
  // do alcance deste processo) decide QUAIS caminhos chegam a invocar a
  // função de borda. Reproduzido aqui com a MESMA regra pura que
  // `middleware.ts` copia byte a byte (`ehCaminhoDeDocumento`, de
  // `src/hospedagem/porteiro.ts`) — nunca uma cópia própria da regra. Fora
  // dela, a Vercel nem chamaria `middleware()`; este servidor também não.
  if (!ehCaminhoDeDocumento(url.pathname)) {
    await servirEstatico(url.pathname, res);
    return;
  }

  aplicarAmbientePorHost(hostname);

  const cabecalhos = new Headers();
  for (const [chave, valor] of Object.entries(req.headers)) {
    if (typeof valor === "string") cabecalhos.set(chave, valor);
  }
  const requisicao = new Request(url.toString(), {
    method: req.method ?? "GET",
    headers: cabecalhos,
  });

  // `globalThis.fetch` já é o dublê desde `iniciarServidorDoisHosts` — NÃO
  // se troca por requisição (rodada D, achado 5: ver o comentário no topo
  // deste arquivo, "SUPOSIÇÃO DE ESTADO").
  const resposta = await middleware(requisicao);

  if (resposta.headers.get("x-middleware-next") === "1") {
    await servirEstatico(url.pathname, res);
    return;
  }

  const corpo = new Uint8Array(await resposta.arrayBuffer());
  const cabecalhosDeSaida: Record<string, string> = {};
  for (const [chave, valor] of resposta.headers.entries()) {
    // eslint-disable-next-line security/detect-object-injection -- `chave` percorre os nomes de cabeçalho da PRÓPRIA resposta que `middleware()` acabou de montar, nunca entrada externa.
    cabecalhosDeSaida[chave] = valor;
  }
  res.writeHead(resposta.status, cabecalhosDeSaida);
  res.end(corpo);
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────

export interface ServidorDoisHosts {
  readonly porta: number;
  fechar(): Promise<void>;
}

export interface OpcoesServidorDoisHosts {
  /** Porta FIXA (ex.: para a prova no navegador — `PORTA=4310`, ver
   * `servir.ts`). Ausente ou `undefined` → `listen(0)`, o próprio SO escolhe
   * uma porta livre. Nunca mais um socket de sondagem separado (rodada D,
   * achado 3): abrir-fechar-reabrir tinha uma janela de corrida em que outro
   * processo podia tomar a porta entre o `close()` da sondagem e o `listen()`
   * de verdade — o SERVIDOR REAL agora faz `listen()` uma vez só e lê a
   * porta atribuída em `address()`. */
  readonly porta?: number;
}

export async function iniciarServidorDoisHosts(
  opcoes: OpcoesServidorDoisHosts = {},
): Promise<ServidorDoisHosts> {
  // O dublê de `fetch` é instalado UMA VEZ, na vida inteira do servidor —
  // nunca por requisição (rodada D, achado 5; ver "SUPOSIÇÃO DE ESTADO" no
  // topo do arquivo). `iniciarServidorDoisHosts`/`fechar` são o par que
  // define essa vida.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchDeBrinquedo as typeof fetch;

  const servidor = createServer((req, res) => {
    tratarRequisicao(req, res).catch((erro: unknown) => {
      if (!res.headersSent)
        res.writeHead(500, { "content-type": "text/plain" });
      res.end(`erro no servidor de ensaio dos dois hosts: ${String(erro)}`);
    });
  });

  const porta = await new Promise<number>((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(opcoes.porta ?? 0, "127.0.0.1", () => {
      const endereco = servidor.address();
      resolve(
        endereco !== null && typeof endereco === "object"
          ? endereco.port
          : (opcoes.porta ?? 0),
      );
    });
  });

  return {
    porta,
    fechar: () =>
      new Promise<void>((resolve, reject) =>
        servidor.close((erro) => {
          globalThis.fetch = fetchOriginal;
          if (erro) reject(erro);
          else resolve();
        }),
      ),
  };
}
