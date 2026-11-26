// A primeira visita guarda só o NÚCLEO do app (plano "a primeira visita deixa
// de baixar o app inteiro", 26/11/2026). Exigência do sócio para aceitar a
// troca, provada em navegador de verdade (Chrome do puppeteer), com o build de
// produção (`dist-test/`) e o service worker real, servido pelo porteiro
// sintético do CI-PWA (`e2e/pwa-servidor.mjs`, ficha da loja no HTML) e o
// banco de brinquedo de `e2e/pwa-kit.ts`:
//
//  - quem visitou UMA vez e perdeu a internet toca em tudo da vitrine e do
//    produto, sem recarregar, e funciona;
//  - ao abrir o carrinho (tela fora do núcleo) vê o aviso de que está sem
//    internet, nunca "Algo deu errado";
//  - nos dois jeitos de perder a rede: de verdade (o navegador sabe:
//    `navigator.onLine` false) e "acha que tem rede" (onLine true, mas nada
//    responde — wi-fi sem saída);
//  - e na VOLTA (2ª visita, atendida pelo service worker) o resto entra em
//    segundo plano e o carrinho passa a abrir sem rede.
//
// "Sem rede" aqui é o servidor DESLIGADO (todo pedido, da página e do service
// worker, falha de verdade) e, no caso "de verdade", também
// `page.setOfflineMode(true)`.
//
// Roda à mão (leva minutos), ver vitest.config.ts desta pasta.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer, {
  type Browser,
  type ElementHandle,
  KnownDevices,
  type Page,
} from "puppeteer";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PRODUTO_ACESSORIOS,
  PRODUTO_ROUPAS,
  URL_DO_SERVIDOR,
  caminhoDaFichaNoTemp,
  escreverFichaNoTemp,
  instalarBancoFixtura,
} from "../../e2e/pwa-kit";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const SAIDA = "dist-test";
const ALGO_DEU_ERRADO = "Algo deu errado";
const AVISO_SEM_INTERNET = [
  "Você está sem internet",
  "Verifique sua conexão",
  "Feche e abra o app de novo",
];

let servidor: ChildProcess | null = null;
let navegador: Browser | null = null;

async function ligarServidor(): Promise<void> {
  servidor = spawn(process.execPath, ["e2e/pwa-servidor.mjs"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PWA_FICHA_ARQ: caminhoDaFichaNoTemp(),
      PWA_PASTA_DISTS: RAIZ,
      PWA_DIST_INICIAL: SAIDA,
      PWA_PORTA: "4174",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${URL_DO_SERVIDOR}/__pwa__/estado`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("o servidor de teste não subiu em 10 s");
}

/** Desliga o servidor (pelo processo que ESTA prova abriu). */
async function desligarServidor(): Promise<void> {
  const processo = servidor;
  servidor = null;
  if (!processo || processo.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    processo.once("exit", () => resolve());
    processo.kill();
  });
}

/** O banco de brinquedo do kit do CI-PWA, ligado ao puppeteer pelo domínio
 * Fetch do DevTools: só os pedidos ao Supabase param aqui; o resto (a loja, o
 * service worker) segue sem interceptação nenhuma. */
async function ligarBancoDeBrinquedo(pagina: Page): Promise<void> {
  type Rota = {
    request: () => { url: () => string };
    fallback: () => Promise<unknown>;
    fulfill: (r: {
      status: number;
      headers?: Record<string, string>;
      body?: string | Buffer;
    }) => Promise<unknown>;
  };
  let tratar: ((rota: Rota) => Promise<void>) | null = null;
  await instalarBancoFixtura({
    route: async (_padrao: string, fn: (rota: Rota) => Promise<void>) => {
      tratar = fn;
    },
  } as unknown as Parameters<typeof instalarBancoFixtura>[0]);
  const cdp = await pagina.createCDPSession();
  const cors = [
    { name: "access-control-allow-origin", value: URL_DO_SERVIDOR },
    { name: "access-control-allow-headers", value: "*" },
    { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    { name: "access-control-allow-credentials", value: "true" },
  ];
  cdp.on("Fetch.requestPaused", (ev) => {
    const requestId = ev.requestId;
    if (ev.request.method === "OPTIONS") {
      void cdp
        .send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 204,
          responseHeaders: cors,
        })
        .catch(() => {});
      return;
    }
    const rota: Rota = {
      request: () => ({ url: () => ev.request.url }),
      fallback: () =>
        cdp.send("Fetch.continueRequest", { requestId }).catch(() => {}),
      fulfill: ({ status, headers, body }) =>
        cdp
          .send("Fetch.fulfillRequest", {
            requestId,
            responseCode: status,
            responseHeaders: [
              ...Object.entries(headers ?? {}).map(([name, value]) => ({
                name,
                value,
              })),
              ...cors,
            ],
            body: Buffer.from(body ?? "").toString("base64"),
          })
          .catch(() => {}),
    };
    void tratar?.(rota).catch(() => {});
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "https://*.supabase.co/*" }],
  });
}

async function textoDaTela(pagina: Page): Promise<string> {
  // O `innerText` do body às vezes só traz o "Pular para o conteúdo"; o do
  // #root traz a tela (e as telas de erro também moram nele).
  return pagina.evaluate(
    () =>
      `${document.body.innerText}
${document.getElementById("root")?.innerText ?? ""}`,
  );
}

async function esperarTexto(
  pagina: Page,
  algum: string[],
  prazoMs = 30_000,
): Promise<string> {
  const fim = Date.now() + prazoMs;
  let texto = "";
  while (Date.now() < fim) {
    texto = await textoDaTela(pagina);
    const achado = algum.find((t) => texto.includes(t));
    if (achado) return achado;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `nenhum de ${JSON.stringify(algum)} apareceu em ${prazoMs} ms. Tela: ${texto.slice(0, 400)}`,
  );
}

async function semErroGenerico(pagina: Page): Promise<void> {
  expect(await textoDaTela(pagina)).not.toContain(ALGO_DEU_ERRADO);
}

/** Acha um botão VISÍVEL pelo nome acessível (o `aria-label`, ou o texto),
 * sem diferenciar maiúsculas, e toca nele. Sem ele em 30 s, a falha traz o
 * que a tela mostrava. */
async function tocarNoBotao(pagina: Page, nome: string): Promise<void> {
  // O ÚLTIMO que casa: o card do catálogo, não o do carrossel de lançamentos
  // (que leva o toque ao slide da vez, não ao card tocado).
  const acharBotao = (alvo: string) =>
    [...document.querySelectorAll("button")].findLast(
      (b) =>
        (b.getAttribute("aria-label") ?? b.textContent ?? "")
          .trim()
          .toLowerCase() === alvo.toLowerCase() &&
        b.getClientRects().length > 0 &&
        !b.disabled,
    ) ?? null;
  try {
    await pagina.waitForFunction(acharBotao, { timeout: 30_000 }, nome);
  } catch {
    throw new Error(
      `o botão "${nome}" não apareceu em 30 s. Tela: ${(await textoDaTela(pagina)).replace(/\s+/g, " ").slice(0, 600)}`,
    );
  }
  const alvo = await pagina.evaluateHandle(acharBotao, nome);
  const elemento = alvo.asElement() as ElementHandle<Element> | null;
  if (!elemento) throw new Error(`o botão "${nome}" sumiu antes do toque`);
  // Clique do DOM (o mesmo `onClick` do toque): a prova é sobre o que o toque
  // CARREGA, não sobre qual peça está por cima na tela do carrossel.
  await elemento.evaluate((b) => (b as HTMLElement).click());
}

async function chavesDoCache(pagina: Page): Promise<string[]> {
  return pagina.evaluate(async () => {
    const nomes = (await caches.keys()).filter((n) =>
      n.startsWith("app-cache-"),
    );
    if (nomes.length !== 1) return [];
    const cache = await caches.open(nomes[0]);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
}

/** Os caminhos que o manifesto do `sw.js` do build lista. */
function caminhosDoManifesto(): string[] {
  const sw = readFileSync(path.join(RAIZ, SAIDA, "sw.js"), "utf8");
  return [...sw.matchAll(/"url":"([^"]+)"/g)].map((m) => `/${m[1]}`);
}

/** 1ª visita: perfil limpo, vitrine na tela, service worker no controle e o
 * núcleo guardado (a `/` com a ficha é a última coisa do install). */
async function primeiraVisita(): Promise<Page> {
  await ligarServidor();
  navegador = await puppeteer.launch({
    headless: true,
    userDataDir: mkdtempSync(path.join(tmpdir(), "primeira-visita-")),
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const pagina = await navegador.newPage();
  // Agente de celular (como o medidor): o app desliga o service worker quando
  // o agente diz "HeadlessChrome" (src/main.tsx, "[Sandbox]").
  await pagina.emulate(KnownDevices["Pixel 5"]);
  await ligarBancoDeBrinquedo(pagina);
  const resposta = await pagina.goto(`${URL_DO_SERVIDOR}/`, {
    waitUntil: "load",
  });
  expect(resposta?.status()).toBe(200);
  await esperarTexto(pagina, [PRODUTO_ROUPAS], 45_000);
  await pagina.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    { timeout: 30_000 },
  );
  await pagina.waitForFunction(
    async () => {
      const nomes = (await caches.keys()).filter((n) =>
        n.startsWith("app-cache-"),
      );
      if (nomes.length !== 1) return false;
      const cache = await caches.open(nomes[0]);
      return Boolean(await cache.match("/"));
    },
    { timeout: 30_000, polling: 250 },
  );
  // A prova só vale se a 1ª visita NÃO guardou o app inteiro.
  const chaves = await chavesDoCache(pagina);
  const faltando = caminhosDoManifesto().filter((c) => !chaves.includes(c));
  expect(faltando.length).toBeGreaterThan(0);
  return pagina;
}

/** Toca em tudo da vitrine e do produto, sem recarregar a página. */
async function tocarNaVitrineENoProduto(pagina: Page): Promise<void> {
  await pagina.evaluate(() => {
    (window as unknown as { __mesmoDocumento: string }).__mesmoDocumento =
      "sim";
  });
  for (const produto of [PRODUTO_ROUPAS, PRODUTO_ACESSORIOS]) {
    // O card pode ser redesenhado no instante do toque (a vitrine termina de
    // montar): toca de novo, até 3 vezes, se a página do produto não abriu.
    for (let tentativa = 1; ; tentativa++) {
      await tocarNoBotao(pagina, produto);
      try {
        await esperarTexto(pagina, ["Adicionar ao Carrinho"], 10_000);
        break;
      } catch (erro) {
        if (tentativa === 3) throw erro;
      }
    }
    expect(
      await pagina.evaluate(() =>
        [...document.querySelectorAll("h1, h2")].map((h) => h.textContent),
      ),
      "abriu a página do produto tocado",
    ).toContain(produto);
    await tocarNoBotao(pagina, "Adicionar ao carrinho");
    await new Promise((r) => setTimeout(r, 800));
    await semErroGenerico(pagina);
    const depoisDeAdicionar = await textoDaTela(pagina);
    for (const aviso of AVISO_SEM_INTERNET)
      expect(depoisDeAdicionar).not.toContain(aviso);
    await tocarNoBotao(pagina, "Ir para o Início");
    await esperarTexto(pagina, [PRODUTO_ROUPAS]);
    await semErroGenerico(pagina);
  }
  // Rola a vitrine até o fim (faixas e rodapé carregam por partes).
  await pagina.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 800));
  await semErroGenerico(pagina);
  const vitrine = await textoDaTela(pagina);
  for (const aviso of AVISO_SEM_INTERNET) expect(vitrine).not.toContain(aviso);
  expect(
    await pagina.evaluate(
      () =>
        (window as unknown as { __mesmoDocumento?: string }).__mesmoDocumento,
    ),
    "a vitrine e o produto não recarregaram a página",
  ).toBe("sim");
}

async function abrirCarrinho(pagina: Page): Promise<void> {
  await pagina.waitForSelector("#bottom-nav-cart", { timeout: 30_000 });
  await pagina.$eval("#bottom-nav-cart", (b) => (b as HTMLElement).click());
}

beforeAll(async () => {
  if (!existsSync(path.join(RAIZ, SAIDA, "sw.js")))
    throw new Error(
      `Falta ${SAIDA}/sw.js. Gere o build primeiro: IKCOUS_IDENTITY_MODE=fixture npm run build`,
    );
  await escreverFichaNoTemp();
});

afterEach(async () => {
  const pid = navegador?.process()?.pid;
  await Promise.race([
    navegador?.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  if (pid && navegador?.process()?.exitCode === null) {
    try {
      process.kill(pid);
    } catch {
      // já saiu
    }
  }
  navegador = null;
  await desligarServidor();
});

describe("primeira visita leve, em navegador de verdade", () => {
  it("controle: COM rede, o mesmo roteiro da vitrine e do produto funciona", async () => {
    const pagina = await primeiraVisita();
    await tocarNaVitrineENoProduto(pagina);
  });

  it("1 visita e sem rede DE VERDADE: vitrine e produto funcionam; o carrinho avisa que está sem internet", async () => {
    const pagina = await primeiraVisita();
    const carrinhoGuardado = (await chavesDoCache(pagina)).some((c) =>
      c.startsWith("/assets/CartView-"),
    );
    expect(carrinhoGuardado, "o carrinho NÃO é do núcleo").toBe(false);

    await desligarServidor();
    await pagina.setOfflineMode(true);
    expect(await pagina.evaluate(() => navigator.onLine)).toBe(false);

    await tocarNaVitrineENoProduto(pagina);
    await abrirCarrinho(pagina);
    const aviso = await esperarTexto(pagina, AVISO_SEM_INTERNET);
    console.log(`[prova] carrinho sem rede de verdade mostrou: "${aviso}"`);
    await semErroGenerico(pagina);
  });

  /** 1ª visita e a rede some sem o navegador saber (onLine continua true). */
  async function primeiraVisitaComRedeMuda(): Promise<Page> {
    const pagina = await primeiraVisita();
    await desligarServidor();
    expect(await pagina.evaluate(() => navigator.onLine)).toBe(true);
    const sonda = await pagina.evaluate(() =>
      fetch(`/version.json?sonda=${Date.now()}`).then(
        () => "respondeu",
        () => "falhou",
      ),
    );
    expect(sonda).toBe("falhou");
    return pagina;
  }

  it("1 visita e a rede some SEM avisar (onLine=true): vitrine e produto funcionam; o carrinho não diz 'Algo deu errado'", async () => {
    const pagina = await primeiraVisitaComRedeMuda();
    await tocarNaVitrineENoProduto(pagina);
    await abrirCarrinho(pagina);
    await esperarTexto(pagina, ["Não conseguimos carregar esta tela"], 60_000);
    await semErroGenerico(pagina);
  });

  // LACUNA CONHECIDA (26/11/2026), registrada para decisão: com a rede muda
  // (onLine true), o app não sabe que está sem internet, e a tela do carrinho
  // diz "Não conseguimos carregar esta tela. Use o botão Tentar de novo." (o
  // `LocalErrorBoundary`, que só fala de conexão com onLine false). O sócio
  // pediu "Você está sem internet" nos dois jeitos. `it.fails`: fica verde
  // enquanto a lacuna existir e vira vermelho no dia em que ela fechar.
  it.fails(
    "LACUNA: com a rede muda, o carrinho diz que está sem internet",
    async () => {
      const pagina = await primeiraVisitaComRedeMuda();
      await abrirCarrinho(pagina);
      await esperarTexto(pagina, AVISO_SEM_INTERNET, 45_000);
    },
  );

  it("1 visita e REABRIR sem rede: a vitrine abre do cache", async () => {
    const pagina = await primeiraVisita();
    await desligarServidor();
    await pagina.setOfflineMode(true);
    const falhas: string[] = [];
    pagina.on("requestfailed", (pedido) => {
      const url = new URL(pedido.url());
      if (url.origin === URL_DO_SERVIDOR) falhas.push(url.pathname);
    });

    const resposta = await pagina.reload({ waitUntil: "load" });
    expect(resposta?.status()).toBe(200);
    await pagina.waitForSelector(
      '::-p-aria([name="Navegação principal"][role="navigation"])',
      { timeout: 45_000 },
    );
    await semErroGenerico(pagina);
    console.log(
      `[prova] reabrir sem rede: arquivos da loja que falharam: ${JSON.stringify(falhas)}`,
    );
    // Ficam de fora: o `manifest.webmanifest` (o sw.ts o manda sempre à rede)
    // e a marca do build de ensaio (`/store-identity/`): em produção o
    // porteiro troca esses endereços pelos da loja (src/config/
    // identidadeNoHtml.ts), que nunca estiveram no precache. O resto que a
    // página inicial pede e está no manifesto tem de vir do cache já na 1ª
    // visita.
    const doManifesto = new Set(caminhosDoManifesto());
    expect(
      falhas.filter(
        (c) =>
          doManifesto.has(c) &&
          c !== "/manifest.webmanifest" &&
          !c.startsWith("/store-identity/"),
      ),
    ).toEqual([]);
  });

  it("na VOLTA o resto entra em segundo plano e o carrinho abre sem rede", async () => {
    const pagina = await primeiraVisita();
    const manifesto = caminhosDoManifesto();

    // A volta: navegação atendida pelo service worker ativo.
    await pagina.reload({ waitUntil: "load" });
    await esperarTexto(pagina, [PRODUTO_ROUPAS], 45_000);
    const fim = Date.now() + 90_000;
    let faltando = manifesto;
    while (Date.now() < fim) {
      const chaves = await chavesDoCache(pagina);
      faltando = manifesto.filter((c) => !chaves.includes(c));
      if (faltando.length === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(
      `[prova] na volta: faltam ${faltando.length} de ${manifesto.length}`,
    );
    expect(faltando).toEqual([]);

    await desligarServidor();
    await pagina.setOfflineMode(true);
    await abrirCarrinho(pagina);
    await new Promise((r) => setTimeout(r, 2000));
    const tela = await textoDaTela(pagina);
    for (const aviso of AVISO_SEM_INTERNET) expect(tela).not.toContain(aviso);
    await semErroGenerico(pagina);
  });
});
