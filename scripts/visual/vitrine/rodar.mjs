#!/usr/bin/env node
// Harness visual da VITRINE (app do cliente) — prova, por print pixel a
// pixel, que um redesenho só-desktop não muda NADA no celular.
//
// Uso (caminhos relativos à raiz do repo, ou absolutos):
//   node scripts/visual/vitrine/rodar.mjs <raizDoRepo> [pastaDeSaida] \
//     [--larguras 360,375,390,414,1024,1280,1440,1920] [--telas a,b,c] [--pular-build]
//
// `pastaDeSaida` é opcional — sem ela, os prints vão para
// `<raizDoRepo>/.visual/vitrine` (a pasta `.visual/` é ignorada pelo git;
// nunca commite prints/baselines).
//
// Pipeline: `npm run build` (IKCOUS_IDENTITY_MODE=fixture, o MESMO comando
// de tests/e2e/playwright.jornadas.config.ts/.github/workflows/e2e-jornadas.yml)
// → um servidor estático PRÓPRIO (sem vite dev/preview) serve `dist-test/`
// com fallback de SPA → Chromium de verdade (Playwright), com TODO hostname
// remapeado para 127.0.0.1 (`--host-resolver-rules`) e toda requisição
// interceptada por `page.route` (rede.mjs) — nunca fala com o Supabase real,
// nunca sai para a internet. A "ficha da loja" que o porteiro injetaria em
// produção é injetada aqui, na resposta do próprio documento (mesma técnica
// de tests/e2e/kit-jornadas.ts). Pré-requisitos e mais detalhes: README.md
// nesta mesma pasta.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AGORA_MS,
  CHAVE_DA_SESSAO_FIXTURA,
  NOME_PRODUTO_COM_VARIACAO,
  PEDIDO_EM_PREPARO,
  PEDIDO_ENTREGUE,
  PRODUTO_COM_PROMOCAO,
  PRODUTO_COM_VARIACAO,
  PRODUTO_SIMPLES,
  enderecosFixtura,
  itensCarrinhoFixtura,
  linhasFavoritos,
  linhasNotificacoes,
  linhasPedidos,
  sessaoFixtura,
} from "./fixtures.mjs";
import { criarEstadoDoCliente, instalarRede } from "./rede.mjs";

const LARGURAS_PADRAO = [360, 375, 390, 414, 1024, 1280, 1440, 1920];

// ─── CLI ────────────────────────────────────────────────────────────────

function lerArgumentos() {
  const argv = process.argv.slice(2);
  const posicionais = [];
  let larguras = LARGURAS_PADRAO;
  let telasFiltro = null;
  let pularBuild = false;
  for (let i = 0; i < argv.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- `i` é o contador do próprio `for`, nunca entrada externa indexando um objeto.
    const item = argv[i];
    if (item === "--larguras") {
      larguras = argv[++i].split(",").map((n) => Number.parseInt(n.trim(), 10));
    } else if (item.startsWith("--larguras=")) {
      larguras = item
        .slice("--larguras=".length)
        .split(",")
        .map((n) => Number.parseInt(n.trim(), 10));
    } else if (item === "--telas") {
      telasFiltro = new Set(argv[++i].split(",").map((s) => s.trim()));
    } else if (item.startsWith("--telas=")) {
      telasFiltro = new Set(
        item
          .slice("--telas=".length)
          .split(",")
          .map((s) => s.trim()),
      );
    } else if (item === "--pular-build") {
      pularBuild = true;
    } else {
      posicionais.push(item);
    }
  }
  const [raizArg, saidaArg] = posicionais;
  if (!raizArg) {
    console.error(
      "uso: node scripts/visual/vitrine/rodar.mjs <raizDoRepo> [pastaDeSaida] " +
        "[--larguras 360,375,...] [--telas a,b,c] [--pular-build]",
    );
    process.exit(1);
  }
  const raiz = path.resolve(process.cwd(), raizArg);
  return {
    raiz,
    saida: saidaArg
      ? path.resolve(process.cwd(), saidaArg)
      : path.join(raiz, ".visual", "vitrine"),
    larguras,
    telasFiltro,
    pularBuild,
  };
}

// ─── Build: NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture npm run build ──
// MESMA receita de .github/workflows/e2e-jornadas.yml ("Build de teste com
// identidade fictícia") — env LIMPO de propósito: o plugin de identidade
// (scripts/identityBuildConfig.ts) RECUSA o build de fixture se qualquer
// VITE_SUPABASE_*/SUPABASE_*/VERCEL*/DATABASE_URL estiver presente no
// ambiente (falha fechada contra vazar configuração real para o harness).

function rodarBuild(repoRoot) {
  const envLimpo = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    npm_config_cache: process.env.npm_config_cache,
    NODE_ENV: "production",
    IKCOUS_IDENTITY_MODE: "fixture",
  };
  const inicio = Date.now();
  const resultado = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    env: envLimpo,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const duracaoMs = Date.now() - inicio;
  if (resultado.status !== 0) {
    console.error(resultado.stdout);
    console.error(resultado.stderr);
    throw new Error(
      `"npm run build" falhou (status ${resultado.status}) em ${repoRoot}`,
    );
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repoRoot vem de argv do operador, não de entrada web.
  if (!fs.existsSync(path.join(repoRoot, "dist-test", "index.html"))) {
    throw new Error(
      `Build terminou mas dist-test/index.html não existe em ${repoRoot} (outDir errado?).`,
    );
  }
  return { duracaoMs };
}

// ─── Servidor estático próprio (sem vite preview) ──────────────────────
// Serve `dist-test/` com fallback de SPA: qualquer caminho sem arquivo
// correspondente (e sem extensão de arquivo estático) devolve `index.html`
// — é o que faz `goto("/product-detail?id=...")` funcionar como link direto,
// exatamente como o Vercel serviria a build de verdade.

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function subirServidorEstatico(distDir) {
  const servidor = http.createServer((req, res) => {
    try {
      const urlObj = new URL(req.url, "http://127.0.0.1");
      let caminho = decodeURIComponent(urlObj.pathname);
      if (caminho === "/") caminho = "/index.html";
      let arquivo = path.join(distDir, caminho);
      // Nunca escapar de distDir.
      if (!arquivo.startsWith(distDir))
        arquivo = path.join(distDir, "index.html");

      const temExtensao = path.extname(caminho) !== "";
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- `arquivo` é sempre um filho de `distDir` (checado acima), servidor local só do harness.
      if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        if (temExtensao) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        // Fallback de SPA.
        arquivo = path.join(distDir, "index.html");
      }

      const ext = path.extname(arquivo);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesma garantia acima.
      const corpo = fs.readFileSync(arquivo);
      res.writeHead(200, {
        // eslint-disable-next-line security/detect-object-injection -- `ext` vem de `path.extname` de um arquivo já confinado a `distDir`; o mapa é fechado e o fallback cobre qualquer extensão fora dele.
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(corpo);
    } catch (erro) {
      res.writeHead(500);
      res.end(String(erro));
    }
  });
  return new Promise((resolve, reject) => {
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

// ─── Playwright + Chromium ──────────────────────────────────────────────
// Portátil de propósito (este harness roda em máquinas diferentes da que o
// escreveu): tenta o `playwright` do PRÓPRIO repositório alvo primeiro
// (`npm install --no-save playwright`, mesma receita do
// .github/workflows/e2e-jornadas.yml), depois um Chromium já instalado em
// `PLAYWRIGHT_BROWSERS_PATH`/`/opt/pw-browsers` (ambiente desta sessão) e,
// na falta dos dois, deixa o Playwright resolver o dele próprio — se nem
// isso existir, a mensagem de erro diz exatamente o comando que falta rodar.

async function importarPlaywright(repoRoot) {
  try {
    const requerer = createRequire(path.join(repoRoot, "package.json"));
    const resolvido = requerer.resolve("playwright");
    return await import(pathToFileURL(resolvido).href);
  } catch {
    try {
      return await import("playwright");
    } catch {
      throw new Error(
        `Playwright não encontrado. Rode "npm install --no-save playwright" em ${repoRoot} (ou em qualquer diretório visível pelo Node deste processo).`,
      );
    }
  }
}

/** `undefined` (deixa o Playwright escolher) quando não há um Chromium
 * conhecido de antemão — nesse caso, se o launch falhar, a mensagem de erro
 * já aponta o comando (`npx playwright install chromium`). */
function acharChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `base` vem de env/constante do harness, nunca de entrada web.
  if (!fs.existsSync(base)) return undefined;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesma garantia acima.
  const candidatos = fs
    .readdirSync(base)
    .filter((n) => /^chromium-\d+$/.test(n));
  if (candidatos.length === 0) return undefined;
  candidatos.sort();
  const executavel = path.join(
    base,
    candidatos.at(-1),
    "chrome-linux",
    "chrome",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesma garantia acima.
  return fs.existsSync(executavel) ? executavel : undefined;
}

// ─── Determinismo: data/hora e Math.random congelados no navegador ──────

function scriptDeDeterminismo(agoraFixo) {
  const OriginalDate = Date;
  class DataCongelada extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) super(agoraFixo);
      else super(...args);
    }
    static now() {
      return agoraFixo;
    }
  }
  globalThis.Date = DataCongelada;

  let semente = 42;
  Math.random = () => {
    semente = (semente * 9301 + 49297) % 233280;
    return semente / 233280;
  };

  // Animações/transições CSS desligadas (framer-motion usa JS, não CSS —
  // por isso o harness também espera "estabilizar" antes do print, e o
  // contexto nasce com `reducedMotion: "reduce"`, que o BannerCarousel já
  // obedece para nunca trocar de slide sozinho).
  const estilo = document.createElement("style");
  estilo.textContent = `
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }
  `;
  // `addInitScript` também roda numa página "about:blank" transitória (antes
  // da navegação real) — ali `documentElement` pode não existir ainda. Sem
  // dono para anexar, não há CSS para desligar mesmo (não é a página que o
  // print vai fotografar); a MESMA função roda de novo, normalmente, na
  // navegação real que se segue.
  if (document.documentElement) document.documentElement.appendChild(estilo);
}

// Ruído ESPERADO e EXPLICADO (nunca falha silenciosa): bloquear toda rede
// externa/WebSocket de propósito produz estes sinais em qualquer tela —
// nenhum indica defeito da vitrine. Documentado no README.
const RUIDO_ESPERADO = [
  "Failed to load resource: net::ERR_FAILED", // fonts.googleapis.com bloqueado
  "[PWA] Service Worker registration error", // serviceWorkers:"block" no contexto
  "Channel error: socket closed: 0", // realtime nunca conecta (WS bloqueado)
  "Order channel error: socket closed: 0",
  "Realtime-Questions", // idem, canal de Perguntas e Respostas
  "Error fetching questions: {message: TypeError: Failed to fetch", // eco de um fetch cancelado por navegação
  "[Notifications] Fetch error: {message: TypeError: Failed to fetch", // idem — NotificationProvider busca em toda tela; cancelado ao navegar rápido
];
function ehRuidoEsperado(texto) {
  return RUIDO_ESPERADO.some((trecho) => texto.includes(trecho));
}

/**
 * Print SÓ estabiliza (e só então é gravado) quando DUAS capturas seguidas
 * saem byte a byte iguais. Achado real desta prova de determinismo: numa
 * máquina COMPARTILHADA e ocupada, texto MINÚSCULO (badge de 9px)
 * ocasionalmente saía com anti-aliasing diferente de uma rodada para a
 * outra — não porque a vitrine mudou, mas porque o compositor do Chromium
 * foi preemptado no meio da rasterização. Comparar contra o PRÓPRIO estado
 * anterior (em vez de só esperar um tempo fixo e torcer) prova que a
 * página JÁ está no repouso final antes de gravar.
 */
async function screenshotEstavel(page, tentativasMax = 6) {
  let anterior = null;
  for (let tentativa = 0; tentativa < tentativasMax; tentativa++) {
    const atual = await page.screenshot({
      fullPage: true,
      animations: "disabled",
    });
    if (anterior && Buffer.compare(anterior, atual) === 0) return atual;
    anterior = atual;
    await page.waitForTimeout(250);
  }
  return anterior;
}

async function esperarBootEEstabilizar(page) {
  await page.waitForFunction(
    () => document.querySelector("#root")?.children.length > 0,
    {
      timeout: 30_000,
    },
  );
  await page
    .waitForFunction(() => !document.getElementById("silent-guardian-loader"), {
      timeout: 30_000,
    })
    .catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Skeletons/spinners de carregamento (classes usadas neste app — ver
  // App.tsx ViewLoadingFallback/AdminRouteLoading): espera sumirem, com teto.
  const prazo = Date.now() + 8000;
  while (Date.now() < prazo) {
    const pendentes = await page
      .locator(".animate-spin, .animate-pulse")
      .count();
    if (pendentes === 0) break;
    await page.waitForTimeout(100);
  }
  // AboutStoreView carrega o mapa num `<iframe loading="lazy">` — o
  // navegador decide QUANDO disparar esse fetch (bloqueado por nós) por
  // conta própria, e o timing exato varia de processo para processo do
  // Chromium. Sem esperar a rede assentar, o print às vezes pegava o
  // instante ENTRE o disparo lazy e o efeito colateral dele assentar.
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// ─── Definição dos cenários e telas ─────────────────────────────────────

function montarTelas() {
  const estadoCliente = criarEstadoDoCliente({
    enderecos: enderecosFixtura(),
    favoritos: linhasFavoritos(),
    cartItems: itensCarrinhoFixtura(),
    notificacoes: linhasNotificacoes(),
    pedidos: linhasPedidos(),
  });
  const estadoVazio = criarEstadoDoCliente({
    enderecos: [],
    favoritos: [],
    cartItems: [],
    notificacoes: [],
    pedidos: [],
  });

  const cenarios = {
    convidado: { sessao: null, estado: estadoVazio, seed: null },
    cliente: { sessao: "cliente", estado: estadoCliente, seed: null },
    admin: { sessao: "admin", estado: estadoVazio, seed: null },
  };

  const telas = [
    {
      id: "inicio",
      cenario: "convidado",
      path: "/",
      esperar: async (page) => {
        await page
          .waitForSelector("text=Empório Aurora", { timeout: 30_000 })
          .catch(() => {});
      },
    },
    {
      id: "busca-resultados",
      cenario: "convidado",
      path: "/search",
      acao: async (page) => {
        await page.locator("#search-input").fill("Vestido");
        await page.waitForTimeout(500);
      },
    },
    {
      id: "busca-vazia",
      cenario: "convidado",
      path: "/search",
      acao: async (page) => {
        await page.locator("#search-input").fill("produtoinexistentezzz");
        await page.waitForTimeout(500);
      },
    },
    {
      id: "produto-simples",
      cenario: "convidado",
      path: `/product-detail?id=${PRODUTO_SIMPLES}`,
    },
    {
      id: "produto-variacao",
      cenario: "convidado",
      path: `/product-detail?id=${PRODUTO_COM_VARIACAO}`,
    },
    {
      id: "produto-promocao",
      cenario: "convidado",
      path: `/product-detail?id=${PRODUTO_COM_PROMOCAO}`,
    },
    {
      id: "folha-adicionar-carrinho",
      cenario: "convidado",
      path: "/",
      acao: async (page) => {
        const card = page
          .locator("div.group")
          .filter({
            has: page.getByRole("button", {
              name: NOME_PRODUTO_COM_VARIACAO,
              exact: true,
            }),
          })
          .first();
        await card.getByTestId("product-card-action").click();
        const folha = page.getByTestId("product-card-options-sheet");
        await folha.waitFor({ state: "visible", timeout: 15_000 });
        const chipM = folha.getByRole("button", { name: "M", exact: true });
        if (await chipM.count()) await chipM.click();
      },
    },
    { id: "favoritos-vazio", cenario: "convidado", path: "/favorites" },
    { id: "carrinho-vazio", cenario: "convidado", path: "/cart" },
    { id: "sobre-loja", cenario: "convidado", path: "/about-store" },
    { id: "login-cadastro", cenario: "convidado", path: "/auth" },

    { id: "favoritos-com-itens", cenario: "cliente", path: "/favorites" },
    { id: "carrinho-com-itens", cenario: "cliente", path: "/cart" },
    {
      id: "checkout-endereco-pagamento",
      cenario: "cliente",
      path: "/checkout",
    },
    { id: "pedido-sucesso", cenario: "cliente", path: "/order-success" },
    { id: "perfil-cliente", cenario: "cliente", path: "/profile" },
    {
      id: "configuracoes-conta",
      cenario: "cliente",
      path: "/account-settings",
    },
    { id: "endereco-formulario", cenario: "cliente", path: "/address-form" },
    {
      id: "pedido-detalhe",
      cenario: "cliente",
      path: `/order-details?id=${PEDIDO_EM_PREPARO}`,
    },
    {
      id: "pedido-detalhe-entregue",
      cenario: "cliente",
      path: `/order-details?id=${PEDIDO_ENTREGUE}`,
    },
    { id: "notificacoes", cenario: "cliente", path: "/notifications" },

    { id: "perfil-admin", cenario: "admin", path: "/profile" },
  ];

  return { telas, cenarios };
}

// ─── Main ────────────────────────────────────────────────────────────────

export async function rodarHarness(argsCli = process.argv.slice(2)) {
  const { raiz, saida, larguras, telasFiltro, pularBuild } =
    lerArgumentos(argsCli);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `raiz` vem de argv do operador.
  if (!fs.existsSync(path.join(raiz, "package.json"))) {
    console.error(`Não parece um repositório: sem package.json em ${raiz}`);
    process.exit(1);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `saida` vem de argv do operador (ou default sob `raiz`).
  fs.mkdirSync(saida, { recursive: true });

  const log = { bloqueados: [], avisos: [], consoleErros: [] };
  const tempos = {};

  console.log(`[harness] repositório: ${raiz}`);
  console.log(`[harness] saída: ${saida}`);
  console.log(`[harness] larguras: ${larguras.join(", ")}`);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `raiz` vem de argv do operador.
  if (!fs.existsSync(path.join(raiz, "node_modules"))) {
    throw new Error(
      `Sem node_modules em ${raiz} — rode "npm ci" nesse worktree antes de usar o harness.`,
    );
  }

  if (!pularBuild) {
    console.log(
      "[harness] build (NODE_ENV=production IKCOUS_IDENTITY_MODE=fixture npm run build)...",
    );
    const { duracaoMs } = rodarBuild(raiz);
    tempos.buildMs = duracaoMs;
    console.log(`[harness] build ok em ${(duracaoMs / 1000).toFixed(1)}s`);
  } else {
    console.log("[harness] --pular-build: reaproveitando dist-test/ existente");
  }

  const distDir = path.join(raiz, "dist-test");
  const servidor = await subirServidorEstatico(distDir);
  const porta = servidor.address().port;
  const origemDoPreview = `http://127.0.0.1:${porta}`;
  console.log(`[harness] servidor estático em ${origemDoPreview}`);

  const { chromium } = await importarPlaywright(raiz);
  const executablePath = acharChromium();
  // ACHADO REAL (não hipótese) rodando a prova de determinismo: o Chromium
  // sozinho — sem nenhuma página aberta — tenta falar com
  // `www.google.com`/`redirector.gvt1.com`/`android.clients.google.com`
  // (Safe Browsing, component updater, GCM) por conta própria, e
  // `--host-resolver-rules` NÃO cobre isso quando o ambiente tem
  // `HTTPS_PROXY`/`HTTP_PROXY` configurada — o Chromium detecta o proxy do
  // sistema e manda essas checagens de fundo PARA O PROXY em vez de
  // resolver o host localmente. Apaga toda variável de ambiente com "proxy"
  // no nome antes de lançar o Chromium (para ele nunca aprender que existe
  // um proxy) — as flags `--disable-*` abaixo desligam essas checagens na
  // raiz, como segunda camada.
  const envSemProxy = Object.fromEntries(
    Object.entries(process.env).filter(([chave]) => !/proxy/i.test(chave)),
  );
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      env: envSemProxy,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        // Remapeia QUALQUER hostname para 127.0.0.1 — defesa em profundidade
        // além do page.route: mesmo um WebSocket (que page.route sozinho não
        // intercepta em toda versão do Playwright) jamais resolve DNS de
        // verdade.
        "--host-resolver-rules=MAP * 127.0.0.1",
        // Desliga toda checagem/telemetria de fundo do PRÓPRIO Chromium —
        // nenhuma delas tem a ver com a vitrine, e cada uma é uma requisição
        // que "nunca sai request nenhuma para a internet" proíbe.
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-sync",
        "--disable-client-side-phishing-detection",
        "--safebrowsing-disable-auto-update",
        "--disable-features=OptimizationHints,MediaRouter,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,AutofillServerCommunication,InterestFeedContentSuggestions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-breakpad",
        // Texto pequeno (badges de 9-10px) renderizava com anti-aliasing
        // ligeiramente diferente entre duas cargas de PROCESSO do Chromium
        // — caminho de rasterização de fonte sempre pelo mesmo modo
        // (software, sem LCD/hinting) reduz essa variação; `screenshotEstavel`
        // (abaixo) é quem prova que ela de fato sumiu.
        "--disable-lcd-text",
        "--font-render-hinting=none",
      ],
    });
  } catch (erro) {
    await servidor.close();
    throw new Error(
      `Não consegui abrir o Chromium (${erro?.message ?? erro}). Rode "npx playwright install chromium" e tente de novo.`,
    );
  }

  const { telas, cenarios } = montarTelas();
  cenarios.cliente.seed = async (page) => {
    const sessao = sessaoFixtura(false);
    await page.addInitScript(
      ([chave, valor]) => localStorage.setItem(chave, valor),
      [CHAVE_DA_SESSAO_FIXTURA, JSON.stringify(sessao)],
    );
  };
  cenarios.admin.seed = async (page) => {
    const sessao = sessaoFixtura(true);
    await page.addInitScript(
      ([chave, valor]) => localStorage.setItem(chave, valor),
      [CHAVE_DA_SESSAO_FIXTURA, JSON.stringify(sessao)],
    );
  };

  const telasParaRodar = telasFiltro
    ? telas.filter((t) => telasFiltro.has(t.id))
    : telas;
  if (telasFiltro) {
    const idsConhecidos = new Set(telas.map((t) => t.id));
    for (const id of telasFiltro) {
      if (!idsConhecidos.has(id))
        log.avisos.push(`[harness] --telas pediu id desconhecido: ${id}`);
    }
  }

  const contextosPorCenario = new Map();
  async function contextoDoCenario(nomeCenario) {
    if (contextosPorCenario.has(nomeCenario))
      return contextosPorCenario.get(nomeCenario);
    // eslint-disable-next-line security/detect-object-injection -- `nomeCenario` só vem de `tela.cenario`, um dos três literais fechados definidos em `montarTelas` acima, nunca de entrada externa.
    const cfg = cenarios[nomeCenario];
    const contexto = await browser.newContext({
      viewport: { width: larguras[0] || 390, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
      serviceWorkers: "block",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    await contexto.addInitScript(scriptDeDeterminismo, AGORA_MS);
    if (cfg.seed) await cfg.seed(contexto);
    contextosPorCenario.set(nomeCenario, contexto);
    return contexto;
  }

  const inicioPrints = Date.now();
  const paginasPorCenario = new Map();
  // Os listeners de console/pageerror/requestfailed são registrados UMA vez
  // por página (uma página é reaproveitada por VÁRIAS telas do mesmo
  // cenário) — capturar `tela` direto os prenderia para sempre na PRIMEIRA
  // tela daquele cenário. Esta referência mutável é o que cada listener lê
  // NA HORA do evento, sempre a tela que está rodando naquele instante.
  const telaAtualPorCenario = new Map();
  try {
    for (const tela of telasParaRodar) {
      const cfg = cenarios[tela.cenario];
      const contexto = await contextoDoCenario(tela.cenario);
      telaAtualPorCenario.set(tela.cenario, tela.id);

      let page = paginasPorCenario.get(tela.cenario);
      if (!page) {
        page = await contexto.newPage();
        const idAtual = () => telaAtualPorCenario.get(tela.cenario);
        page.on("console", (msg) => {
          if (msg.type() === "error" && !ehRuidoEsperado(msg.text())) {
            log.consoleErros.push(`[${idAtual()}] ${msg.text()}`);
          }
        });
        page.on("pageerror", (erro) => {
          if (!ehRuidoEsperado(erro.message)) {
            log.consoleErros.push(`[${idAtual()}] pageerror: ${erro.message}`);
          }
        });
        page.on("requestfailed", (req) => {
          if (req.url().includes("fonts.googleapis.com")) return; // bloqueado de propósito, ver README
          // ERR_ABORTED é o Chromium cancelando um fetch de fundo (prefetch de
          // chunk, Q&A/reviews em segundo plano) porque NAVEGAMOS para a
          // próxima tela antes dele terminar — não é falha de rede real. O
          // que a tela MOSTRA já tinha os dados de que precisava antes desta
          // navegação.
          if (req.failure()?.errorText === "net::ERR_ABORTED") return;
          log.avisos.push(
            `[${idAtual()}] requestfailed: ${req.url()} — ${req.failure()?.errorText}`,
          );
        });
        await instalarRede(page, {
          origemDoPreview,
          host: "127.0.0.1",
          estado: cfg.estado,
          sessao: cfg.sessao,
          log,
        });
        paginasPorCenario.set(tela.cenario, page);
      }

      for (const largura of larguras) {
        await page.setViewportSize({ width: largura, height: 1000 });
        const resposta = await page.goto(`${origemDoPreview}${tela.path}`, {
          waitUntil: "load",
        });
        if (!resposta || resposta.status() >= 400) {
          log.avisos.push(
            `[${tela.id}@${largura}] HTTP ${resposta?.status()} em ${tela.path}`,
          );
        }
        await esperarBootEEstabilizar(page);
        if (tela.esperar) await tela.esperar(page);
        if (tela.acao) await tela.acao(page);
        await page.waitForTimeout(200);

        // App-743/TabWrapper: quem rola é `.active-scroll-container`
        // (`mainRef` em App.tsx), NÃO o `<html>/<body>` — `html,body{height:
        // 100vh;overflow:hidden}` é o padrão de app-shell deste projeto.
        // `page.screenshot({fullPage:true})` mede `document.documentElement.
        // scrollHeight`, que aqui é sempre a altura da JANELA: sem isto, TODO
        // print sairia cortado na viewport. A altura real é medida no DOM e
        // a viewport é redimensionada para ela ANTES do print — a mesma
        // varredura de `rolarAteOFim`/`medirFolha` em
        // tests/e2e/jornada-trocar-endereco-carrinho.spec.ts, só que para
        // MEDIR a altura em vez de rolar.
        let alturaFinal = 1000;
        for (let tentativa = 0; tentativa < 3; tentativa++) {
          const medida = await page.evaluate(() => {
            let maior = document.documentElement.scrollHeight;
            for (const el of document.querySelectorAll("body *")) {
              const estilo = getComputedStyle(el);
              if (
                /(auto|scroll)/.test(estilo.overflowY) &&
                el.scrollHeight > el.clientHeight
              ) {
                maior = Math.max(maior, el.scrollHeight);
              }
            }
            return maior;
          });
          // +32px de folga: o rodapé fixo (nav/CTA) fica POR CIMA do fim do
          // conteúdo, não empurra `scrollHeight` — sem a folga, a última
          // linha de texto saía cortada bem na borda.
          const alvo = Math.max(1000, medida + 32);
          if (alvo === alturaFinal && tentativa > 0) break;
          alturaFinal = alvo;
          await page.setViewportSize({ width: largura, height: alturaFinal });
          await page.waitForTimeout(150);
        }

        const arquivo = path.join(saida, `${tela.id}__${largura}.png`);
        const png = await screenshotEstavel(page);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- `arquivo` é montado a partir de `saida` (argv do operador) e do id/largura fechados da própria tela.
        fs.writeFileSync(arquivo, png);
        console.log(
          `[harness] ${tela.id}@${largura} -> ${path.basename(arquivo)} (${largura}x${alturaFinal})`,
        );
      }
    }
  } finally {
    tempos.printsMs = Date.now() - inicioPrints;
    const relatorio = [
      `Requisições externas bloqueadas (${log.bloqueados.length}):`,
      ...log.bloqueados.map((u) => `  - ${u}`),
      "",
      `Avisos (${log.avisos.length}):`,
      ...log.avisos.map((a) => `  - ${a}`),
      "",
      `Erros de console/página (${log.consoleErros.length}):`,
      ...log.consoleErros.map((e) => `  - ${e}`),
      "",
      `Tempos: build=${tempos.buildMs ?? "pulado"}ms prints=${tempos.printsMs}ms`,
      "",
    ].join("\n");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `saida` vem de argv do operador.
    fs.writeFileSync(path.join(saida, "harness-log.txt"), relatorio, "utf8");
    console.log(relatorio);
    for (const contexto of contextosPorCenario.values()) {
      await contexto.close();
    }
    await browser.close();
    await new Promise((resolve) => servidor.close(resolve));
  }

  gerarIndice(saida, telasParaRodar, larguras);
  console.log(`[harness] pronto — prints em ${saida}`);
}

function gerarIndice(saida, telas, larguras) {
  const linhas = [];
  linhas.push(
    "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>",
    "<title>Harness visual — vitrine IKCOUS</title>",
    "<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#111;color:#eee}",
    "h2{margin-top:40px;border-bottom:1px solid #444;padding-bottom:8px}",
    ".linha{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}",
    ".item{background:#1c1c1c;border:1px solid #333;border-radius:8px;padding:8px;max-width:340px}",
    ".item img{max-width:320px;display:block;border:1px solid #333}",
    ".item p{font-size:12px;color:#aaa;margin:6px 0 0}</style></head><body>",
    "<h1>Harness visual — vitrine IKCOUS</h1>",
  );
  for (const tela of telas) {
    linhas.push(
      `<h2>${tela.id} <small>(${tela.cenario})</small></h2><div class="linha">`,
    );
    for (const largura of larguras) {
      const nome = `${tela.id}__${largura}.png`;
      linhas.push(
        `<div class="item"><img src="${nome}" loading="lazy"><p>${largura}px</p></div>`,
      );
    }
    linhas.push("</div>");
  }
  linhas.push("</body></html>");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `saida` vem de argv do operador.
  fs.writeFileSync(path.join(saida, "indice.html"), linhas.join("\n"), "utf8");
}

// Só executa ao rodar como CLI (`node rodar.mjs ...`) — importar este módulo
// (o teste leve em tests/front faz isso) nunca sobe build nem navegador.
const ehCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehCli) {
  rodarHarness().catch((erro) => {
    console.error("[harness] falhou:", erro);
    process.exit(1);
  });
}
