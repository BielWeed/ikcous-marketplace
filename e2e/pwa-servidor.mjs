/* eslint-disable security/detect-non-literal-fs-filename -- Same as buildStore.mjs: every disk access goes through resolved paths confined to the current dist (caminhoDentroDoDist) or the fixed identity file in temp. */

// Servidor de teste da frente CI-PWA (14/09/2026).
//
// POR QUE ELE EXISTE: os specs desta frente provam o service worker DE
// VERDADE, e requisições feitas PELO service worker (install →
// /identidade.json; navegação respondida por `respondWith`) NÃO passam pelo
// `page.route` do Playwright. Este processo é o "porteiro sintético": serve
// um build de produção (dist) como a Vercel serviria, com a ficha da loja
// injetada no HTML, `/identidade.json` em JSON puro e `/version.json` do
// PRÓPRIO dist (gerado pelo buildStore — fonte única). O estado (qual dist
// está no ar, qual arquivo "sumiu") é controlado PELO TESTE via POST, para
// reproduzir deploys v1→v2 e chunks que sumiram (#565) sem tocar em
// componente nenhum de produção.
//
// Uso (é o webServer de e2e/pwa-playwright.config.ts):
//   node e2e/pwa-servidor.mjs
//   env: PWA_PORTA (4174), PWA_PASTA_DISTS (cwd), PWA_DIST_INICIAL (dist-v1),
//        PWA_FICHA_ARQ (caminho da ficha gravada por e2e/pwa-kit.ts).

import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const PORTA = Number(process.env.PWA_PORTA || 4174);
const HOST = "127.0.0.1";
const PASTA_DISTS = process.env.PWA_PASTA_DISTS || process.cwd();
const DIST_INICIAL = process.env.PWA_DIST_INICIAL || "dist-v1";
const FICHA_ARQ = process.env.PWC_FICHA_ARQ || process.env.PWA_FICHA_ARQ || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

// Estado controlado pelos specs.
let distAtual = DIST_INICIAL;
const escondidos = new Set();

function raizDoDist() {
  return path.resolve(PASTA_DISTS, distAtual);
}

async function existe(caminho) {
  try {
    const info = await stat(caminho);
    return info.isFile();
  } catch {
    return false;
  }
}

// Caminho seguro: só arquivos DENTRO da pasta do dist atual.
function caminhoDentroDoDist(urlPath) {
  const relativo = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const absoluto = path.resolve(raizDoDist(), relativo);
  if (
    absoluto !== raizDoDist() &&
    !absoluto.startsWith(raizDoDist() + path.sep)
  ) {
    return null;
  }
  return absoluto;
}

async function lerArquivoDoDist(urlPath) {
  const absoluto = caminhoDentroDoDist(urlPath);
  if (!absoluto || !(await existe(absoluto))) return null;
  return readFile(absoluto);
}

function fichaInjetada(html, ficha) {
  return html.replace(
    "<head>",
    `<head><script type="application/json" id="ikcous-loja">${ficha}</script>`,
  );
}

// A ficha em si, lida do arquivo único gravado pelo global-setup do
// Playwright. ORDEM IMPORTA: o webServer precisa estar NO AR para o
// Playwright seguir para o globalSetup, então o servidor escuta de cara e
// carrega a ficha LAZY, na primeira requisição que precisa dela (com prazo
// curto — se o arquivo não chegar, é falha clara do globalSetup).
let FICHA = "";
async function garantirFicha() {
  if (FICHA) return FICHA;
  if (!FICHA_ARQ) {
    throw new Error(
      "PWA_FICHA_ARQ não definido: o servidor não sabe quem é a loja.",
    );
  }
  const prazo = Date.now() + 30_000;
  for (;;) {
    try {
      FICHA = await readFile(FICHA_ARQ, "utf8");
      return FICHA;
    } catch {
      if (Date.now() > prazo) {
        throw new Error(
          `Ficha não chegou em 30s: ${FICHA_ARQ} (globalSetup falhou?)`,
        );
      }
      await new Promise((resolver) => setTimeout(resolver, 250));
    }
  }
}

async function servirDocumento(res) {
  const htmlBruto = await lerArquivoDoDist("/index.html");
  if (!htmlBruto) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      `dist "${distAtual}" não tem index.html (PASTA_DISTS=${PASTA_DISTS})`,
    );
    return;
  }
  const ficha = await garantirFicha();
  res.writeHead(200, {
    "content-type": MIME[".html"],
    "cache-control": "no-cache",
  });
  res.end(fichaInjetada(htmlBruto.toString("utf8"), ficha));
}

async function lerCorpo(req) {
  const pedacos = [];
  for await (const pedaco of req) pedacos.push(pedaco);
  const cru = Buffer.concat(pedacos).toString("utf8");
  return cru ? JSON.parse(cru) : {};
}

function json(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

async function listarDist(rel = "") {
  const nomes = [];
  const base = path.join(raizDoDist(), rel);
  for (const entrada of await readdir(base, { withFileTypes: true })) {
    const relativo = rel ? `${rel}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) {
      nomes.push(...(await listarDist(relativo)));
    } else {
      nomes.push(`/${relativo.replaceAll(path.sep, "/")}`);
    }
  }
  return nomes;
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORTA}`);
  const rota = url.pathname;

  try {
    // ── Controle do teste (POST) ─────────────────────────────────────────
    if (req.method === "POST") {
      const corpo = await lerCorpo(req);
      if (rota === "/__pwa__/resetar") {
        distAtual = corpo.dist || DIST_INICIAL;
        escondidos.clear();
        json(res, 200, { ok: true, dist: distAtual });
        return;
      }
      if (rota === "/__pwa__/trocar") {
        const raizNova = path.resolve(PASTA_DISTS, String(corpo.dist || ""));
        if (
          !raizNova.startsWith(path.resolve(PASTA_DISTS) + path.sep) ||
          !(await existe(path.join(raizNova, "index.html")))
        ) {
          json(res, 404, {
            ok: false,
            erro: `dist "${String(corpo.dist)}" não existe`,
          });
          return;
        }
        distAtual = String(corpo.dist);
        json(res, 200, { ok: true, dist: distAtual });
        return;
      }
      if (rota === "/__pwa__/esconder") {
        const arquivo = String(corpo.arquivo || "");
        escondidos.add(arquivo);
        json(res, 200, { ok: true, escondido: arquivo });
        return;
      }
      json(res, 404, { ok: false, erro: "comando desconhecido" });
      return;
    }

    // ── Painel do teste (GET) ────────────────────────────────────────────
    if (rota === "/__pwa__/estado") {
      json(res, 200, { dist: distAtual, escondidos: [...escondidos] });
      return;
    }
    if (rota === "/__pwa__/arquivos") {
      json(res, 200, { dist: distAtual, arquivos: await listarDist() });
      return;
    }

    // ── O porteiro sintético ─────────────────────────────────────────────
    // A mesma ficha em JSON puro que o sw.ts busca no install.
    if (rota === "/identidade.json") {
      const ficha = await garantirFicha();
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(ficha);
      return;
    }

    // Sonda de frescor: vem do PRÓPRIO dist (buildStore escreve) — fonte
    // única da versão no ar. O sw.ts NÃO intercepta este caminho.
    if (rota === "/version.json") {
      const corpo = await lerArquivoDoDist("/version.json");
      if (!corpo) {
        json(res, 404, { ok: false, erro: "version.json ausente no dist" });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(corpo);
      return;
    }

    // O SW precisa ser revalidado a cada update(): sem no-cache o navegador
    // pode ficar 24h sem baixar os bytes novos e o update nunca nasce.
    if (rota === "/sw.js") {
      const corpo = await lerArquivoDoDist("/sw.js");
      if (!corpo) {
        json(res, 404, { ok: false, erro: "sw.js ausente no dist" });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(corpo);
      return;
    }

    // Arquivo "sumido" do ar (#565): o spec escolhe e o servidor nega.
    if (escondidos.has(rota)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Não encontrado (simulação de deploy que sumiu com o chunk)");
      return;
    }

    // Estáticos com extensão.
    if (path.extname(rota)) {
      const corpo = await lerArquivoDoDist(rota);
      if (!corpo) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Não encontrado");
        return;
      }
      const tipo =
        MIME[path.extname(rota).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": tipo });
      res.end(corpo);
      return;
    }

    // Rota de aplicação (SPA): o porteiro real serve o HTML com a ficha em
    // qualquer caminho da loja — mesmo comportamento aqui.
    await servirDocumento(res);
  } catch (erro) {
    json(res, 500, { ok: false, erro: String(erro) });
  }
});

servidor.listen(PORTA, HOST, () => {
  console.log(
    `[pwa-servidor] dist "${distAtual}" no ar em http://${HOST}:${PORTA}`,
  );
});
