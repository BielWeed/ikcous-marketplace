// Lote C do plano "primeira visita leve" (26/11/2026): menos pedidos na CDN da
// Vercel (no Hobby, 1 milhão por mês estourado pausa TODAS as lojas).
//
// T10: o manifesto do PWA sai com `private, max-age=300` (o navegador guarda
// por 5 min e não volta a pedir a cada página); loja em manutenção continua
// `no-store`.
//
// T11: o porteiro guarda o `/index.html` CRU em memória por 5 min, por
// endereço (`origin` do pedido), só resposta 200, e pedidos simultâneos se
// juntam numa busca só. A ficha e o cartaz continuam injetados a CADA pedido,
// depois do cache: uma loja nunca recebe o HTML (nem a ficha) de outra.
//
// Ressalva do revisor (PR #1910): só entra no cache o HTML cuja marca
// `<meta name="ikcous-deploy">` é a do PRÓPRIO deploy (`VERCEL_DEPLOYMENT_ID`
// do runtime). HTML de outro deploy (corrida na troca de domínio, rollback) é
// servido como antes, mas nunca guardado.
//
// Tudo com `fetch` dublê — nunca rede de verdade.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_INDEX_HTML_MS,
  PRAZO_INDEX_HTML_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCacheIndexHtml,
  EntradaCachePorteiro,
  IndexHtmlBaixado,
} from "@/hospedagem/porteiro";

const ORIGEM_A = "https://projetoaaaaaaaaaaaaa.supabase.co";
const ORIGEM_B = "https://projetobbbbbbbbbbbbb.supabase.co";
const HOST_A = "loja-a.exemplo";
const HOST_B = "loja-b.exemplo";
/** O deploy desta "instância" (o `VERCEL_DEPLOYMENT_ID` do runtime). */
const DEPLOY_DESTE = "dpl_DesteDeploy111";
const DEPLOY_OUTRO = "dpl_OutroDeploy222";

/** O HTML assado do build, com um marcador por HOST: num deploy real o
 * arquivo é o mesmo para todos os hosts do projeto, mas aqui ele DIFERE de
 * propósito — é o que prova que a chave do cache separa os endereços. */
function htmlAssado(
  marcador: string,
  deploy: string | null = DEPLOY_DESTE,
): string {
  const marca =
    deploy === null
      ? ""
      : `<meta name="ikcous-deploy" content="${deploy}">
`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
${marca}<meta charset="UTF-8" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<meta name="theme-color" content="#000000" />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<div class="cinematic-text">Loja Fixture</div>
<!-- ${marcador} -->
</body>
</html>`;
}

function linhaFixture(nome: string, primary: string, origin: string) {
  const hash = "a".repeat(64);
  const asset = (arquivo: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${arquivo}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: primary,
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: asset("loader", 64, 64),
      favicon: asset("favicon", 32, 32),
      apple_touch: asset("apple", 180, 180),
      icon_192: asset("icon192", 192, 192),
      icon_512: asset("icon512", 512, 512),
      maskable_512: asset("maskable", 512, 512),
      og: asset("og", 1200, 630),
    },
  };
}

interface Banco {
  nome: string;
  cor: string;
  host: string;
  manutencao: boolean;
}

/** O `/index.html` do dublê: um comportamento por pedido. */
type RespostaDoIndex = (url: URL) => Response | Promise<Response>;

interface Duble {
  readonly fetchImpl: typeof fetch;
  /** Cada self-fetch de `/index.html`, em ordem (URL inteira). */
  readonly buscasDoIndex: string[];
  readonly bancos: Map<string, Banco>;
  responderIndex: RespostaDoIndex;
}

const index200: RespostaDoIndex = (url) =>
  new Response(htmlAssado(`CRU DE ${url.host}`), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

function criarDuble(): Duble {
  const bancos = new Map<string, Banco>([
    [
      ORIGEM_A,
      { nome: "Loja A", cor: "#111111", host: HOST_A, manutencao: false },
    ],
    [
      ORIGEM_B,
      { nome: "Loja B", cor: "#222222", host: HOST_B, manutencao: false },
    ],
  ]);
  const duble: Duble = {
    buscasDoIndex: [],
    bancos,
    responderIndex: index200,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/index.html") {
        duble.buscasDoIndex.push(url.href);
        return duble.responderIndex(url);
      }
      if (url.pathname === "/rest/v1/v_store_config") {
        const banco = bancos.get(url.origin);
        if (!banco) return new Response("erro", { status: 500 });
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
          return new Response(
            JSON.stringify([
              {
                dominio_publico: banco.host,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: banco.manutencao,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        return new Response(
          JSON.stringify([linhaFixture(banco.nome, banco.cor, url.origin)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    }) as typeof fetch,
  };
  return duble;
}

function ambiente(
  origem: string,
  /** `null` = o runtime SEM a variável. */
  deploy: string | null = DEPLOY_DESTE,
): AmbientePorteiro {
  return {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
    ...(deploy === null ? {} : { VERCEL_DEPLOYMENT_ID: deploy }),
  };
}

/** O `/index.html` de um deploy escolhido (ou sem marca, `null`). */
const indexDoDeploy =
  (deploy: string | null): RespostaDoIndex =>
  (url) =>
    new Response(htmlAssado(`CRU DE ${url.host}`, deploy), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

function pedido(host: string, caminho = "/"): Request {
  return new Request(`https://${host}${caminho}`);
}

interface Relogio {
  t: number;
}

/** Os `Map`s de módulo de `middleware.ts`, um por "instância" do teste. */
function criarDeps(
  duble: Duble,
  relogio: Relogio,
): DependenciasPorteiro & {
  readonly cacheIndexHtml: Map<string, EntradaCacheIndexHtml>;
  readonly indexHtmlEmVoo: Map<string, Promise<IndexHtmlBaixado>>;
} {
  return {
    fetchImpl: duble.fetchImpl,
    cache: new Map<string, EntradaCachePorteiro>(),
    cacheIndexHtml: new Map(),
    indexHtmlEmVoo: new Map(),
    agora: () => relogio.t,
  };
}

function fichaDoHtml(html: string): {
  host: string;
  identidade: { identity: { storeName: string } };
} {
  const casado = html.match(
    /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
  );
  expect(casado).not.toBeNull();
  return JSON.parse(casado![1]!);
}

describe("T10 — manifesto com cache curto no navegador", () => {
  it("loja aberta: `private, max-age=300` (nada de no-store)", async () => {
    const duble = criarDuble();
    const resp = await atenderPorteiro(
      pedido(HOST_A, "/manifest.webmanifest"),
      ambiente(ORIGEM_A),
      criarDeps(duble, { t: 0 }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("cache-control")).toBe("private, max-age=300");
    expect((await resp.json()).name).toBe("Loja A");
  });

  it("loja em manutenção: continua `no-store`", async () => {
    const duble = criarDuble();
    duble.bancos.get(ORIGEM_A)!.manutencao = true;
    const resp = await atenderPorteiro(
      pedido(HOST_A, "/manifest.webmanifest"),
      ambiente(ORIGEM_A),
      criarDeps(duble, { t: 0 }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("cache-control")).toBe("no-store");
  });

  it("o documento e a ficha continuam `no-store` (só o manifesto mudou)", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    const doc = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    const ficha = await atenderPorteiro(
      pedido(HOST_A, "/identidade.json"),
      ambiente(ORIGEM_A),
      deps,
    );
    expect(doc.headers.get("cache-control")).toBe("no-store");
    expect(ficha.headers.get("cache-control")).toBe("no-store");
  });
});

describe("T11 — o porteiro guarda o /index.html em memória por 5 min", () => {
  it("o 2º pedido do mesmo endereço não busca o /index.html de novo", async () => {
    const duble = criarDuble();
    const relogio = { t: 1_000 };
    const deps = criarDeps(duble, relogio);

    const r1 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    relogio.t += 60_000;
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(duble.buscasDoIndex).toEqual([`https://${HOST_A}/index.html`]);
    const html2 = await r2.text();
    expect(html2).toContain(`CRU DE ${HOST_A}`);
    expect(fichaDoHtml(html2).host).toBe(HOST_A);
  });

  it("vale por MENOS de 5 min: em 299.999 ms ainda guardado, em 300.000 ms busca de novo", async () => {
    expect(CACHE_INDEX_HTML_MS).toBe(300_000);
    const duble = criarDuble();
    const relogio = { t: 0 };
    const deps = criarDeps(duble, relogio);

    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    relogio.t = CACHE_INDEX_HTML_MS - 1;
    // A ficha (60 s) também venceu: some com ela para o pedido não esperar
    // revalidação; só o `/index.html` está em jogo aqui.
    deps.cache.clear();
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(duble.buscasDoIndex).toHaveLength(1);

    relogio.t = CACHE_INDEX_HTML_MS;
    deps.cache.clear();
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(duble.buscasDoIndex).toHaveLength(2);
  });

  it("guarda o HTML CRU: a ficha é injetada a cada pedido (a loja que muda de nome aparece na hora)", async () => {
    const duble = criarDuble();
    const relogio = { t: 0 };
    const deps = criarDeps(duble, relogio);

    const r1 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(await r1.text()).toContain("<title>Loja A");

    duble.bancos.get(ORIGEM_A)!.nome = "Loja A Renomeada";
    deps.cache.clear(); // a ficha nova (o cache da ficha é outro, de 60 s)
    relogio.t += 1_000;
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    const html2 = await r2.text();

    expect(duble.buscasDoIndex).toHaveLength(1);
    expect(html2).toContain("<title>Loja A Renomeada");
    expect(fichaDoHtml(html2).identidade.identity.storeName).toBe(
      "Loja A Renomeada",
    );
  });

  it("DUAS LOJAS: com o cache quente de A, B recebe o HTML e a ficha DELA, nunca os de A", async () => {
    const duble = criarDuble();
    const relogio = { t: 0 };
    // Os MESMOS mapas para as duas lojas: é a mesma instância da função.
    const deps = criarDeps(duble, relogio);

    const a1 = await (
      await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps)
    ).text();
    relogio.t += 1_000;
    const b1 = await (
      await atenderPorteiro(pedido(HOST_B), ambiente(ORIGEM_B), deps)
    ).text();
    relogio.t += 1_000;
    const a2 = await (
      await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps)
    ).text();
    relogio.t += 1_000;
    const b2 = await (
      await atenderPorteiro(pedido(HOST_B), ambiente(ORIGEM_B), deps)
    ).text();

    // Uma busca por endereço, nenhuma a mais.
    expect(duble.buscasDoIndex).toEqual([
      `https://${HOST_A}/index.html`,
      `https://${HOST_B}/index.html`,
    ]);
    for (const htmlA of [a1, a2]) {
      expect(htmlA).toContain(`CRU DE ${HOST_A}`);
      expect(htmlA).not.toContain(`CRU DE ${HOST_B}`);
      expect(htmlA).toContain("<title>Loja A");
      expect(htmlA).not.toContain("Loja B");
      expect(htmlA).not.toContain(ORIGEM_B);
      expect(fichaDoHtml(htmlA).host).toBe(HOST_A);
    }
    for (const htmlB of [b1, b2]) {
      expect(htmlB).toContain(`CRU DE ${HOST_B}`);
      expect(htmlB).not.toContain(`CRU DE ${HOST_A}`);
      expect(htmlB).toContain("<title>Loja B");
      expect(htmlB).not.toContain("Loja A");
      expect(htmlB).not.toContain(ORIGEM_A);
      expect(fichaDoHtml(htmlB).host).toBe(HOST_B);
    }
  });

  it("DUAS LOJAS ao mesmo tempo: as buscas em voo de A e B nunca se juntam", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    // Aquece as fichas primeiro: aqui só o `/index.html` fica em voo.
    await atenderPorteiro(
      pedido(HOST_A, "/identidade.json"),
      ambiente(ORIGEM_A),
      deps,
    );
    await atenderPorteiro(
      pedido(HOST_B, "/identidade.json"),
      ambiente(ORIGEM_B),
      deps,
    );
    const liberar: Array<() => void> = [];
    duble.responderIndex = (url) =>
      new Promise<Response>((resolve) => {
        liberar.push(() => resolve(index200(url) as Response));
      });

    const emA = atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    const emB = atenderPorteiro(pedido(HOST_B), ambiente(ORIGEM_B), deps);
    await esperarAte(() => liberar.length === 2);
    for (const solta of liberar) solta();
    const [htmlA, htmlB] = await Promise.all([
      emA.then((r) => r.text()),
      emB.then((r) => r.text()),
    ]);

    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(htmlA).toContain(`CRU DE ${HOST_A}`);
    expect(fichaDoHtml(htmlA).host).toBe(HOST_A);
    expect(htmlB).toContain(`CRU DE ${HOST_B}`);
    expect(fichaDoHtml(htmlB).host).toBe(HOST_B);
  });

  it("pedidos simultâneos do MESMO endereço se juntam numa busca só", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    await atenderPorteiro(
      pedido(HOST_A, "/identidade.json"),
      ambiente(ORIGEM_A),
      deps,
    );
    let soltar: (() => void) | undefined;
    duble.responderIndex = (url) =>
      new Promise<Response>((resolve) => {
        soltar = () => resolve(index200(url) as Response);
      });

    const emVoo = Array.from({ length: 5 }, () =>
      atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps),
    );
    await esperarAte(() => soltar !== undefined);
    expect(deps.indexHtmlEmVoo.size).toBe(1);
    soltar!();
    const respostas = await Promise.all(emVoo);

    expect(duble.buscasDoIndex).toHaveLength(1);
    for (const r of respostas) {
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain(`CRU DE ${HOST_A}`);
      expect(fichaDoHtml(html).host).toBe(HOST_A);
    }
    // A busca terminou: nada fica em voo, e o resultado ficou guardado.
    expect(deps.indexHtmlEmVoo.size).toBe(0);
    expect(deps.cacheIndexHtml.size).toBe(1);
  });

  it("só guarda 200: um 404/503 do /index.html vira manutenção e o pedido seguinte busca de novo", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    duble.responderIndex = () => new Response("fora", { status: 503 });

    const r1 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r1.status).toBe(503);
    expect(r1.headers.get("x-ikcous-porteiro")).toBe("html-indisponivel");
    expect(deps.cacheIndexHtml.size).toBe(0);

    duble.responderIndex = () => new Response("sumiu", { status: 404 });
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r2.status).toBe(503);
    expect(deps.cacheIndexHtml.size).toBe(0);

    duble.responderIndex = index200;
    const r3 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r3.status).toBe(200);
    expect(duble.buscasDoIndex).toHaveLength(3);
    expect(deps.indexHtmlEmVoo.size).toBe(0);
  });

  it("rede caindo na busca: nada é guardado, nada fica preso em voo, e o próximo pedido tenta de novo", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    duble.responderIndex = () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps),
    ).rejects.toThrow("fetch failed");
    expect(deps.cacheIndexHtml.size).toBe(0);
    expect(deps.indexHtmlEmVoo.size).toBe(0);

    duble.responderIndex = index200;
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r2.status).toBe(200);
    expect(duble.buscasDoIndex).toHaveLength(2);
  });

  it("sem os mapas (teste antigo, chamada avulsa): cada pedido busca, como antes", async () => {
    const duble = criarDuble();
    const deps: DependenciasPorteiro = {
      fetchImpl: duble.fetchImpl,
      cache: new Map<string, EntradaCachePorteiro>(),
    };
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(duble.buscasDoIndex).toHaveLength(2);
  });
});

describe("T11 — só guarda o HTML que é DESTE deploy (ressalva do PR #1910)", () => {
  it("HTML de OUTRO deploy é servido, mas não entra no cache: o pedido seguinte busca de novo", async () => {
    const duble = criarDuble();
    duble.responderIndex = indexDoDeploy(DEPLOY_OUTRO);
    const relogio = { t: 0 };
    const deps = criarDeps(duble, relogio);

    const r1 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r1.status).toBe(200);
    const html1 = await r1.text();
    expect(html1).toContain(`CRU DE ${HOST_A}`);
    expect(fichaDoHtml(html1).host).toBe(HOST_A);
    expect(deps.cacheIndexHtml.size).toBe(0);

    relogio.t += 1_000;
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r2.status).toBe(200);
    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(deps.cacheIndexHtml.size).toBe(0);
    expect(deps.indexHtmlEmVoo.size).toBe(0);
  });

  it("depois do HTML de outro deploy, o HTML DESTE deploy volta a ser guardado", async () => {
    const duble = criarDuble();
    duble.responderIndex = indexDoDeploy(DEPLOY_OUTRO);
    const deps = criarDeps(duble, { t: 0 });
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    duble.responderIndex = indexDoDeploy(DEPLOY_DESTE);
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(deps.cacheIndexHtml.size).toBe(1);
  });

  it("marca igual à do runtime entra no cache", async () => {
    const duble = criarDuble();
    duble.responderIndex = indexDoDeploy(DEPLOY_DESTE);
    const deps = criarDeps(duble, { t: 0 });
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(duble.buscasDoIndex).toHaveLength(1);
    expect(deps.cacheIndexHtml.size).toBe(1);
  });

  it("runtime SEM `VERCEL_DEPLOYMENT_ID`: serve sempre, nunca guarda, nunca quebra", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    for (let i = 0; i < 2; i += 1) {
      const r = await atenderPorteiro(
        pedido(HOST_A),
        ambiente(ORIGEM_A, null),
        deps,
      );
      expect(r.status).toBe(200);
      expect(fichaDoHtml(await r.text()).host).toBe(HOST_A);
    }
    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(deps.cacheIndexHtml.size).toBe(0);
  });

  it("runtime com `VERCEL_DEPLOYMENT_ID` vazio ou inválido: não guarda", async () => {
    for (const valor of ["", "   ", 'dpl_"x']) {
      const duble = criarDuble();
      duble.responderIndex = indexDoDeploy(valor.trim() === "" ? null : valor);
      const deps = criarDeps(duble, { t: 0 });
      await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A, valor), deps);
      const r = await atenderPorteiro(
        pedido(HOST_A),
        ambiente(ORIGEM_A, valor),
        deps,
      );
      expect(r.status, valor).toBe(200);
      expect(duble.buscasDoIndex, valor).toHaveLength(2);
      expect(deps.cacheIndexHtml.size, valor).toBe(0);
    }
  });

  it("HTML SEM marca (build fora da Vercel): serve sempre, nunca guarda, nunca quebra", async () => {
    const duble = criarDuble();
    duble.responderIndex = indexDoDeploy(null);
    const deps = criarDeps(duble, { t: 0 });
    for (let i = 0; i < 2; i += 1) {
      const r = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain(`CRU DE ${HOST_A}`);
    }
    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(deps.cacheIndexHtml.size).toBe(0);
  });

  it("pedidos simultâneos com HTML de outro deploy ainda se juntam, e nada fica guardado", async () => {
    const duble = criarDuble();
    const deps = criarDeps(duble, { t: 0 });
    await atenderPorteiro(
      pedido(HOST_A, "/identidade.json"),
      ambiente(ORIGEM_A),
      deps,
    );
    let soltar: (() => void) | undefined;
    duble.responderIndex = (url) =>
      new Promise<Response>((resolve) => {
        soltar = () => resolve(indexDoDeploy(DEPLOY_OUTRO)(url) as Response);
      });
    const emVoo = Array.from({ length: 3 }, () =>
      atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps),
    );
    await esperarAte(() => soltar !== undefined);
    soltar!();
    for (const r of await Promise.all(emVoo)) expect(r.status).toBe(200);
    expect(duble.buscasDoIndex).toHaveLength(1);
    expect(deps.cacheIndexHtml.size).toBe(0);
    expect(deps.indexHtmlEmVoo.size).toBe(0);
  });
});

describe("T11 — a busca do /index.html tem prazo (caça 26/11/2026)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Aquece a ficha de A (o `/index.html` é o único em jogo) e devolve os
   * deps; o relógio do porteiro é o injetado, só os temporizadores são falsos. */
  async function prepararComTimersFalsos(duble: Duble) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const deps = criarDeps(duble, { t: 0 });
    await atenderPorteiro(
      pedido(HOST_A, "/identidade.json"),
      ambiente(ORIGEM_A),
      deps,
    );
    return deps;
  }

  /** Acompanha uma promessa sem pendurar o teste: `terminou` vira verdade
   * quando ela resolve OU rejeita. */
  function acompanhar<T>(promessa: Promise<T>) {
    const estado: { terminou: boolean; erro?: unknown; valor?: T } = {
      terminou: false,
    };
    promessa.then(
      (valor) => {
        estado.terminou = true;
        estado.valor = valor;
      },
      (erro: unknown) => {
        estado.terminou = true;
        estado.erro = erro;
      },
    );
    return estado;
  }

  it("o prazo é de 5 s (arquivo estático da própria Vercel; mesmo prazo da caderneta)", () => {
    expect(PRAZO_INDEX_HTML_MS).toBe(5_000);
  });

  it("`/index.html` que nunca responde: os pedidos juntos soltam NO prazo, pelo caminho da rede caindo, e nada fica em voo nem guardado", async () => {
    const duble = criarDuble();
    const deps = await prepararComTimersFalsos(duble);
    let sinal: AbortSignal | undefined;
    const fetchOriginal = duble.fetchImpl;
    const deps2 = {
      ...deps,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/index.html") {
          duble.buscasDoIndex.push(url.href);
          sinal = init?.signal ?? undefined;
          // Transporte que nunca resolve nem observa o sinal: só o
          // temporizador do porteiro pode desatar isto.
          return new Promise<Response>(() => undefined);
        }
        return fetchOriginal(input, init);
      }) as typeof fetch,
    };

    const juntos = Array.from({ length: 3 }, () =>
      acompanhar(atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps2)),
    );
    await vi.advanceTimersByTimeAsync(PRAZO_INDEX_HTML_MS - 1);
    expect(juntos.some((j) => j.terminou)).toBe(false);
    expect(deps.indexHtmlEmVoo.size).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    for (const j of juntos) {
      expect(j.terminou).toBe(true);
      expect(j.erro).toBeInstanceOf(Error);
      expect((j.erro as Error).message).toContain("prazo esgotado");
    }
    expect(duble.buscasDoIndex).toHaveLength(1);
    expect(sinal?.aborted).toBe(true);
    expect(deps.indexHtmlEmVoo.size).toBe(0);
    expect(deps.cacheIndexHtml.size).toBe(0);
  });

  it("`/index.html` que responde DEPOIS do prazo: nada é guardado, e o pedido seguinte busca de novo e guarda", async () => {
    const duble = criarDuble();
    const deps = await prepararComTimersFalsos(duble);
    duble.responderIndex = (url) =>
      new Promise<Response>((resolve) => {
        setTimeout(
          () => resolve(index200(url) as Response),
          PRAZO_INDEX_HTML_MS + 1_000,
        );
      });

    const atrasado = acompanhar(
      atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps),
    );
    await vi.advanceTimersByTimeAsync(PRAZO_INDEX_HTML_MS);
    expect(atrasado.terminou).toBe(true);
    expect((atrasado.erro as Error).message).toContain("prazo esgotado");

    // A resposta atrasada chega: não pode entrar no cache.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deps.cacheIndexHtml.size).toBe(0);
    expect(deps.indexHtmlEmVoo.size).toBe(0);

    duble.responderIndex = index200;
    const r2 = await atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps);
    expect(r2.status).toBe(200);
    expect(duble.buscasDoIndex).toHaveLength(2);
    expect(deps.cacheIndexHtml.size).toBe(1);
  });

  it("`/index.html` que responde 1 ms ANTES do prazo: servido e guardado, como sempre", async () => {
    const duble = criarDuble();
    const deps = await prepararComTimersFalsos(duble);
    duble.responderIndex = (url) =>
      new Promise<Response>((resolve) => {
        setTimeout(
          () => resolve(index200(url) as Response),
          PRAZO_INDEX_HTML_MS - 1,
        );
      });

    const emVoo = acompanhar(
      atenderPorteiro(pedido(HOST_A), ambiente(ORIGEM_A), deps),
    );
    await vi.advanceTimersByTimeAsync(PRAZO_INDEX_HTML_MS + 1_000);
    expect(emVoo.terminou).toBe(true);
    expect(emVoo.erro).toBeUndefined();
    const resp = emVoo.valor as Response;
    expect(resp.status).toBe(200);
    expect(fichaDoHtml(await resp.text()).host).toBe(HOST_A);
    expect(deps.cacheIndexHtml.size).toBe(1);
    expect(deps.indexHtmlEmVoo.size).toBe(0);
  });
});

/** Espera uma condição virar verdade, girando microtarefas e o laço de eventos
 * (sem relógio falso: o porteiro só usa o relógio injetado). */
async function esperarAte(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condição não ficou verdadeira a tempo");
}
