// Gera, no outDir e antes do version.json, os arquivos que a Cloudflare Pages
// precisa para servir a MESMA entrega: entradas estáticas, roteamento da
// função, cabeçalhos, 404 com o documento da loja e o worker do
// compartilhamento. Decisões: central/hospedagem-decisao-adaptador-local.md
// e hospedagem-decisao-rotas-preservadas.md; ensaio aprovado: A7a3.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Espelho literal de src/config/rotas.ts. Este arquivo é JS nativo sem
// loader; tests/front/hospedagem-rotas.test.ts confronta os dois lados.
export const telasDeEntrada = Object.freeze([
  "home",
  "cart",
  "product-detail",
  "checkout",
  "profile",
  "admin",
  "search",
  "auth",
  "login",
  "favorites",
  "notifications",
  "order-success",
  "orders",
  "order-details",
  "recently-viewed",
  "account-settings",
  "admin-dashboard",
  "admin-products",
  "admin-product-form",
  "admin-orders",
  "admin-coupons",
  "admin-coupon-form",
  "admin-banners",
  "admin-carousels",
  "admin-shipping",
  "admin-settings",
  "admin-reviews",
  "admin-qa",
  "admin-customers",
  "admin-user-detail",
  "admin-push",
  "admin-notifications",
  "admin-whatsapp-config",
  "address-form",
  "admin-login",
  "user-profile",
]);

const PREFIXO_ADMIN = "admin-";

// O leitor do App.tsx aceita `/admin/<x>` como alias de `/admin-<x>` e uma
// barra final em qualquer forma; a raiz não precisa de regra.
export function formasDeEntrada(telas = telasDeEntrada) {
  const formas = new Set();
  for (const tela of telas) {
    formas.add(`/${tela}`);
    if (tela.startsWith(PREFIXO_ADMIN))
      formas.add(`/admin/${tela.slice(PREFIXO_ADMIN.length)}`);
  }
  return [...formas].sort();
}

export function redirects(telas = telasDeEntrada) {
  const linhas = [];
  for (const forma of formasDeEntrada(telas))
    linhas.push(`${forma} / 200`, `${forma}/ / 200`);
  return `${linhas.join("\n")}\n`;
}

// Só o compartilhamento de produto invoca a função; tudo o mais é estático.
export function routes() {
  const rotas = { version: 1, include: ["/product-detail"], exclude: [] };
  return `${JSON.stringify(rotas)}\n`;
}

const RAIZ_DO_REPOSITORIO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const LIMITE_DA_LINHA = 2000; // limite documentado do _headers do Pages

// As regras de hospedagem são do APP, não da loja: lidas do repositório, nunca
// do root do build (os testes constroem em mkdtemp sem vercel.json).
export function lerVercel() {
  return JSON.parse(
    readFileSync(path.join(RAIZ_DO_REPOSITORIO, "vercel.json"), "utf8"),
  );
}

const ehCacheControl = ({ key }) => key.toLowerCase() === "cache-control";

const regra = (caminho, cabecalhos) =>
  [caminho, ...cabecalhos.map(({ key, value }) => `  ${key}: ${value}`)].join(
    "\n",
  );

const FONTE_GLOBAL = "/(.*)";

// Tradução FECHADA: só as três fontes que o vercel.json tem hoje. Uma fonte
// nova reprova o build em vez de virar um glob aproximado em silêncio.
const TRADUCOES = new Map([
  [
    "/(sw\\.js|service-worker\\.js|sw\\.ts|version\\.json|index\\.html)",
    (cabecalhos) =>
      [
        "/sw.js",
        "/service-worker.js",
        "/sw.ts",
        "/version.json",
        "/index.html",
      ].map((caminho) => regra(caminho, cabecalhos)),
  ],
  ["/assets/(.*)", (cabecalhos) => [regra("/assets/*", cabecalhos)]],
  [
    FONTE_GLOBAL,
    (cabecalhos) => {
      // Regras coincidentes se combinam e cabeçalhos repetidos concatenam
      // valores no Pages: um Cache-Control global misturaria com o de /assets/*.
      if (cabecalhos.some(ehCacheControl))
        throw new Error("HOSTING_HEADERS_GLOBAL_CACHE");
      return [regra("/*", cabecalhos)];
    },
  ],
]);

export function headers(vercel) {
  const blocos = [];
  for (const { source, headers: lista } of vercel.headers ?? []) {
    const traduzir = TRADUCOES.get(source);
    if (!traduzir) throw new Error(`HOSTING_HEADERS_UNKNOWN_SOURCE ${source}`);
    if (!Array.isArray(lista) || lista.length === 0)
      throw new Error(`HOSTING_HEADERS_EMPTY ${source}`);
    blocos.push(...traduzir(lista));
  }
  const texto = `${blocos.join("\n\n")}\n`;
  for (const linha of texto.split("\n"))
    if (linha.length > LIMITE_DA_LINHA)
      throw new Error("HOSTING_HEADERS_LINE_TOO_LONG");
  return texto;
}

// _headers só rege respostas estáticas; a função precisa repetir os mesmos
// cabeçalhos de segurança nas respostas que ela mesma gera.
export function cabecalhosDeFuncao(vercel) {
  const global = (vercel.headers ?? []).find((b) => b.source === FONTE_GLOBAL);
  if (!global) throw new Error("HOSTING_HEADERS_NO_GLOBAL");
  if (global.headers.some(ehCacheControl))
    throw new Error("HOSTING_HEADERS_GLOBAL_CACHE");
  return Object.freeze(
    Object.fromEntries(global.headers.map(({ key, value }) => [key, value])),
  );
}

// A prévia de produto só embute imagem de host que o CSP do app já permite.
export function hostsDeImagem(vercel) {
  const csp = cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
  const diretiva = (csp ?? "")
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith("img-src "));
  if (!diretiva) throw new Error("HOSTING_CSP_NO_IMG_SRC");
  return Object.freeze(
    diretiva
      .split(/\s+/)
      .slice(1)
      .filter((fonte) => fonte.startsWith("https://"))
      .map((fonte) => fonte.slice("https://".length)),
  );
}
