// Lote C do plano "primeira visita leve" (T11, 26/11/2026), ponta a ponta:
// o `middleware()` REAL guarda o `/index.html` em memória por endereço, e duas
// lojas servidas pela MESMA instância (os mesmos `Map`s de módulo de
// `middleware.ts`) nunca recebem o HTML nem a ficha uma da outra.
//
// Arquivo PRÓPRIO de propósito: o Vitest dá a cada arquivo um registro de
// módulos novo, então o cache do porteiro começa VAZIO aqui e a contagem de
// buscas ao `/index.html` é exata (no `porteiro-dois-hosts.test.ts` os outros
// testes já aqueceriam A e B antes).
//
// Ressalva do revisor (PR #1910): só se guarda o HTML marcado com o id DESTE
// deploy. O servidor simula o build da Vercel (`deployDoBuild`) e o runtime
// recebe o mesmo `VERCEL_DEPLOYMENT_ID`; o último teste troca o id do runtime
// para provar que o HTML de outro deploy nunca fica guardado.
//
// Precisa do `dist-test/` (ver README.md desta pasta).
import { existsSync } from "node:fs";
import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DIST_TEST_DIR,
  HOSTS,
  IDENTIDADES_ESPERADAS,
  iniciarServidorDoisHosts,
  pedidosAoDuble,
} from "./servidor.ts";

const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";
const DEPLOY_DO_ENSAIO = "dpl_EnsaioDoisHosts1";

// O mesmo `pedir` de `porteiro-dois-hosts.test.ts`: `node:http` por IP com o
// `Host` escrito na requisição (o `fetch` do Node ignora `Host`).
function pedir(
  porta: number,
  host: string,
  caminho: string,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  corpo: string;
}> {
  return new Promise((resolve, reject) => {
    const requisicao = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        method: "GET",
        headers: { Host: host },
      },
      (resposta) => {
        const pedacos: Buffer[] = [];
        resposta.on("data", (pedaco: Buffer) => pedacos.push(pedaco));
        resposta.on("end", () =>
          resolve({
            status: resposta.statusCode ?? 0,
            headers: resposta.headers,
            corpo: Buffer.concat(pedacos).toString("utf-8"),
          }),
        );
      },
    );
    requisicao.on("error", reject);
    requisicao.end();
  });
}

function lerDataBlock(html: string): {
  host: string;
  identidade: { identity: { storeName: string } };
  conexao: { supabaseUrl: string };
} {
  const casado = html.match(
    /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
  );
  expect(casado).not.toBeNull();
  return JSON.parse(casado![1]!);
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST_TEST_DIR é a constante exportada por `servidor.ts`, nunca entrada externa.
if (!existsSync(DIST_TEST_DIR)) {
  throw new Error(
    `PORTEIRO_DOIS_HOSTS_SEM_DIST_TEST: rode \`${COMANDO_DE_BUILD}\` na raiz ` +
      `do repositório antes desta suíte (dist-test/ não existe em ${DIST_TEST_DIR}).`,
  );
}

describe("porteiro guarda o /index.html — duas lojas na mesma instância", () => {
  let servidor: { porta: number; fechar(): Promise<void> };

  let deployAntes: string | undefined;

  beforeAll(async () => {
    deployAntes = process.env.VERCEL_DEPLOYMENT_ID;
    process.env.VERCEL_DEPLOYMENT_ID = DEPLOY_DO_ENSAIO;
    servidor = await iniciarServidorDoisHosts({
      deployDoBuild: DEPLOY_DO_ENSAIO,
    });
  });

  afterAll(async () => {
    await servidor.fechar();
    // `= undefined` gravaria a STRING "undefined" no ambiente do Node.
    if (deployAntes === undefined)
      Reflect.deleteProperty(process.env, "VERCEL_DEPLOYMENT_ID");
    else process.env.VERCEL_DEPLOYMENT_ID = deployAntes;
  });

  // O `Host` do pedido vai sem porta (`pedir`), então o self-fetch do porteiro
  // é `http://<host>/index.html`.
  const buscasDoIndex = (host: string) =>
    pedidosAoDuble.filter((p) => p === `http://${host}/index.html`).length;

  function conferirLoja(html: string, host: string, outro: string): void {
    // eslint-disable-next-line security/detect-object-injection -- `host` e `outro` são constantes de HOSTS do próprio ensaio.
    const esperado = IDENTIDADES_ESPERADAS[host]!;
    // eslint-disable-next-line security/detect-object-injection -- idem.
    const alheio = IDENTIDADES_ESPERADAS[outro]!;
    expect(html).toContain(`<title>${esperado.storeName}</title>`);
    expect(html).toContain(`--primary-color:${esperado.cor}`);
    expect(html).not.toContain(alheio.storeName);
    expect(html).not.toContain(alheio.origem);
    const ficha = lerDataBlock(html);
    expect(ficha.host).toBe(host);
    expect(ficha.identidade.identity.storeName).toBe(esperado.storeName);
    expect(ficha.conexao.supabaseUrl).toBe(esperado.origem);
  }

  it("A, A, B, A, B: uma busca ao /index.html por endereço, e cada loja só com a ficha DELA", async () => {
    const a1 = await pedir(servidor.porta, HOSTS.A, "/");
    expect(a1.status).toBe(200);
    conferirLoja(a1.corpo, HOSTS.A, HOSTS.B);
    expect(buscasDoIndex(HOSTS.A)).toBe(1);

    const a2 = await pedir(servidor.porta, HOSTS.A, "/");
    expect(a2.status).toBe(200);
    conferirLoja(a2.corpo, HOSTS.A, HOSTS.B);
    expect(buscasDoIndex(HOSTS.A)).toBe(1);

    // O cache de A está quente: B ainda assim busca o endereço DELA e recebe
    // a ficha DELA, sem nenhum byte de A.
    const b1 = await pedir(servidor.porta, HOSTS.B, "/");
    expect(b1.status).toBe(200);
    conferirLoja(b1.corpo, HOSTS.B, HOSTS.A);
    expect(buscasDoIndex(HOSTS.B)).toBe(1);

    const a3 = await pedir(servidor.porta, HOSTS.A, "/");
    conferirLoja(a3.corpo, HOSTS.A, HOSTS.B);
    const b2 = await pedir(servidor.porta, HOSTS.B, "/");
    conferirLoja(b2.corpo, HOSTS.B, HOSTS.A);

    expect(buscasDoIndex(HOSTS.A)).toBe(1);
    expect(buscasDoIndex(HOSTS.B)).toBe(1);
  });

  it("pedidos simultâneos do mesmo host novo se juntam numa busca só", async () => {
    expect(buscasDoIndex(HOSTS.C)).toBe(0);
    // Aquece a ficha de C (caderneta) para só o `/index.html` ficar em jogo.
    await pedir(servidor.porta, HOSTS.C, "/identidade.json");
    const respostas = await Promise.all(
      Array.from({ length: 4 }, () => pedir(servidor.porta, HOSTS.C, "/")),
    );
    for (const r of respostas) {
      expect(r.status).toBe(200);
      expect(lerDataBlock(r.corpo).host).toBe(HOSTS.C);
    }
    expect(buscasDoIndex(HOSTS.C)).toBe(1);
  });

  it("instância de OUTRO deploy (id do runtime diferente da marca do HTML): serve a loja, mas busca a cada pedido", async () => {
    expect(buscasDoIndex(HOSTS.D)).toBe(0);
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_OutroDeployQualquer";
    try {
      for (let i = 0; i < 2; i += 1) {
        const r = await pedir(servidor.porta, HOSTS.D, "/");
        expect(r.status).toBe(200);
        expect(lerDataBlock(r.corpo).host).toBe(HOSTS.D);
      }
      expect(buscasDoIndex(HOSTS.D)).toBe(2);
    } finally {
      process.env.VERCEL_DEPLOYMENT_ID = DEPLOY_DO_ENSAIO;
    }
  });

  it("/manifest.webmanifest sai com `private, max-age=300`", async () => {
    const resp = await pedir(servidor.porta, HOSTS.B, "/manifest.webmanifest");
    expect(resp.status).toBe(200);
    expect(resp.headers["cache-control"]).toBe("private, max-age=300");
    expect(JSON.parse(resp.corpo).name).toBe(
      IDENTIDADES_ESPERADAS[HOSTS.B]!.storeName,
    );
  });
});
