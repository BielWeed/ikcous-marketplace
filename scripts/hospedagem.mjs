// Gera, no outDir e antes do version.json, os arquivos que a Cloudflare Pages
// precisa para servir a MESMA entrega: entradas estáticas, roteamento da
// função, cabeçalhos, 404 com o documento da loja e o worker do
// compartilhamento. Decisões: central/hospedagem-decisao-adaptador-local.md
// e hospedagem-decisao-rotas-preservadas.md; ensaio aprovado: A7a3.

import { readFileSync } from "node:fs";
// Default (não nomeado): vi.spyOn(fs, "writeFile") do teste de finalização só
// intercepta se este módulo e buildStore.mjs importarem o MESMO objeto default.
import fs from "node:fs/promises";
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

const ENTRADA_DO_WORKER = fileURLToPath(
  new URL("../src/hospedagem/worker.ts", import.meta.url),
);

export function configDoWorker(delivery, vercel) {
  const { snapshot, connection } = delivery;
  const conexao =
    connection.kind === "database"
      ? {
          kind: "database",
          origin: connection.origin,
          key: connection.key,
          keyClass: connection.keyClass,
        }
      : { kind: "none" }; // fixture-none E fixture-synthetic: nunca sair para a rede
  return Object.freeze({
    versao: 1,
    publicUrl: snapshot.publicUrl,
    storeName: snapshot.identity.storeName,
    conexao,
    hostsDeImagem: hostsDeImagem(vercel),
    cabecalhos: cabecalhosDeFuncao(vercel),
    deliveryVersion: snapshot.deliveryVersion,
  });
}

// esbuild já vem com o Vite; compila TS e embute a config como constante JSON.
// `define` foi tentado primeiro (Step 4 do brief), mas o esbuild reformata o
// valor como literal JS ao reimprimir (chaves sem aspas, espaço após ":"),
// e os testes de finalização confrontam o JSON exato (`"kind":"none"`,
// `"origin":"..."`) — por isso `banner` com o JSON textual intacto.
export async function compilarWorker(config) {
  const { build } = await import("esbuild");
  const resultado = await build({
    entryPoints: [ENTRADA_DO_WORKER],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    banner: {
      js: `// IKCOUS hospedagem ${config.deliveryVersion}\nconst __IKCOUS_HOSPEDAGEM__ = ${JSON.stringify(config)};`,
    },
  });
  if (resultado.errors.length > 0 || resultado.outputFiles?.length !== 1)
    throw new Error("HOSTING_WORKER_BUILD");
  return resultado.outputFiles[0].text;
}

// Depois do precache (closeBundle do PWA já fechou) e ANTES do version.json:
// qualquer falha aqui deixa a saída sem marcador. Só escreve no outDir.
export async function gerarHospedagem(outDir, delivery) {
  const vercel = lerVercel();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir já validado por localDirectory() (buildStore.mjs:305); "index.html" é literal fixo.
  const indice = await fs.readFile(path.join(outDir, "index.html"));
  const config = configDoWorker(delivery, vercel);
  const arquivos = [
    ["_routes.json", routes()],
    ["_redirects", redirects()],
    ["_headers", headers(vercel)],
    ["404.html", indice],
    ["_worker.js", await compilarWorker(config)],
  ];
  for (const [nome, conteudo] of arquivos) {
    const destino = path.join(outDir, nome);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir já validado por localDirectory() (buildStore.mjs:305); "nome" vem dos cinco literais fechados acima.
    await fs.writeFile(destino, conteudo, { flag: "wx" });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesmo destino recém-gravado nesta linha; releitura de conferência, não entrada externa.
    const relido = await fs.readFile(destino);
    if (!relido.equals(Buffer.from(conteudo)))
      throw new Error(`HOSTING_WRITE_MISMATCH ${nome}`);
  }
  return Object.freeze(arquivos.map(([nome]) => nome));
}
