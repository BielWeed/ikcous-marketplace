// cartaz-pre-impresso.test.ts -- a prova ponta a ponta do CARTAZ (lote B,
// 31/10/2026) com o `middleware()` REAL e o `dist-test/index.html` REAL (o
// splash de verdade), por host de verdade -- o mesmo servidor de ensaio dos
// dois hosts (`servidor.ts`). O que prova:
//   - loja com banner valido + cabecalhos de 1a abertura => cartaz, como
//     primeiro filho do splash;
//   - foto no storage de OUTRA loja => nada;
//   - loja em manutencao => nada;
//   - a MESMA loja com `Sec-Fetch-Dest: empty` (service worker) => nada;
//   - leitura do banner com erro, JSON quebrado ou travada => HTML 200 byte a
//     byte igual ao de hoje.
// Pre-requisito e como rodar: README.md desta pasta (precisa do `dist-test/`).
import { existsSync } from "node:fs";
import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DIST_TEST_DIR,
  HOSTS,
  ORIGEM_A,
  fotoDeBanner,
  iniciarServidorDoisHosts,
} from "./servidor.ts";

const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST_TEST_DIR e a constante exportada por `servidor.ts`, nunca entrada externa.
if (!existsSync(DIST_TEST_DIR)) {
  throw new Error(
    `PORTEIRO_DOIS_HOSTS_SEM_DIST_TEST: rode \`${COMANDO_DE_BUILD}\` na raiz do repositorio antes desta suite.`,
  );
}

const PRIMEIRA_ABERTURA = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};

function pedir(
  porta: number,
  host: string,
  caminho: string,
  cabecalhos: Record<string, string> = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  corpo: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        method: "GET",
        headers: { Host: host, ...cabecalhos },
      },
      (resp) => {
        const pedacos: Buffer[] = [];
        resp.on("data", (p: Buffer) => pedacos.push(p));
        resp.on("end", () =>
          resolve({
            status: resp.statusCode ?? 0,
            headers: resp.headers,
            corpo: Buffer.concat(pedacos).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("cartaz pre-impresso -- ponta a ponta com hosts de verdade", () => {
  let servidor: { porta: number; fechar(): Promise<void> };

  beforeAll(async () => {
    servidor = await iniciarServidorDoisHosts();
  });
  afterAll(async () => {
    await servidor.fechar();
  });

  it("loja com banner + cabecalhos de 1a abertura: cartaz como PRIMEIRO FILHO do splash, foto do storage da PROPRIA loja", async () => {
    const resp = await pedir(servidor.porta, HOSTS.A, "/", PRIMEIRA_ABERTURA);
    expect(resp.status).toBe(200);
    expect(resp.headers["x-ikcous-porteiro"]).toBe("ok");
    expect(resp.headers["x-ikcous-cartaz"]).toBe("ok");
    expect(resp.headers.vary).toBe(
      "host, sec-fetch-dest, sec-fetch-mode, save-data",
    );
    expect(resp.headers["set-cookie"]).toBeUndefined();
    const html = resp.corpo;
    expect(html).toContain(
      '<div id="silent-guardian-loader"><img id="cartaz-da-loja"',
    );
    expect(html.indexOf("cartaz-da-loja")).toBeGreaterThan(
      html.indexOf("<body"),
    );
    expect(html.indexOf("cartaz-da-loja")).toBeGreaterThan(
      html.indexOf('name="viewport"'),
    );
    expect(html).toContain(
      `${ORIGEM_A}/storage/v1/render/image/public/banners/1791565996435-7tdkqgfb019.webp?width=640`,
    );
    // Nenhum atributo que a CSP mataria em silencio.
    const img = html.match(/<img id="cartaz-da-loja"[^>]*>/)?.[0] ?? "";
    expect(img).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("o resto do documento e byte a byte o de hoje (cartaz tirado, igual ao pedido sem cabecalhos)", async () => {
    const com = await pedir(servidor.porta, HOSTS.A, "/", PRIMEIRA_ABERTURA);
    const hoje = await pedir(servidor.porta, HOSTS.A, "/");
    expect(hoje.headers["x-ikcous-cartaz"]).toBeUndefined();
    const inicio = com.corpo.indexOf('<img id="cartaz-da-loja"');
    const fim = com.corpo.indexOf(">", inicio) + 1;
    expect(com.corpo.slice(0, inicio) + com.corpo.slice(fim)).toBe(hoje.corpo);
  });

  it("a MESMA loja com Sec-Fetch-Dest: empty (revalidacao do service worker): nada", async () => {
    const resp = await pedir(servidor.porta, HOSTS.A, "/", {
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "navigate",
    });
    expect(resp.status).toBe(200);
    expect(resp.corpo).not.toContain("cartaz-da-loja");
    expect(resp.headers["x-ikcous-cartaz"]).toBeUndefined();
  });

  it("foto no storage de OUTRA loja: nada, 200", async () => {
    const resp = await pedir(servidor.porta, HOSTS.B, "/", PRIMEIRA_ABERTURA);
    expect(resp.status).toBe(200);
    expect(resp.corpo).not.toContain("cartaz-da-loja");
    expect(resp.corpo).not.toContain(fotoDeBanner(ORIGEM_A).slice(8, 40));
  });

  it("loja em manutencao: nada, 200, mesmo HTML de hoje", async () => {
    const com = await pedir(
      servidor.porta,
      HOSTS.MANUTENCAO,
      "/",
      PRIMEIRA_ABERTURA,
    );
    const hoje = await pedir(servidor.porta, HOSTS.MANUTENCAO, "/");
    expect(com.status).toBe(200);
    expect(com.corpo).not.toContain("cartaz-da-loja");
    expect(com.corpo).toBe(hoje.corpo);
  });

  for (const [rotulo, host] of [
    ["leitura do banner com erro HTTP", HOSTS.BANNER_ERRO],
    ["leitura do banner com JSON quebrado", HOSTS.BANNER_QUEBRADO],
    [
      "leitura do banner TRAVADA (so o prazo do porteiro corta)",
      HOSTS.BANNER_TRAVADO,
    ],
  ] as const) {
    it(`${rotulo}: 200 e o HTML byte a byte igual ao de hoje`, async () => {
      const com = await pedir(servidor.porta, host, "/", PRIMEIRA_ABERTURA);
      const hoje = await pedir(servidor.porta, host, "/");
      expect(com.status).toBe(200);
      expect(com.headers["x-ikcous-porteiro"]).toBe("ok");
      expect(com.headers["x-ikcous-cartaz"]).toBeUndefined();
      expect(com.corpo).toBe(hoje.corpo);
    });
  }
});
