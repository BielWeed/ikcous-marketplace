// porteiro-dois-hosts.test.ts — a prova ponta a ponta da etapa 2 da escala
// (T6, ADENDO D): um build ÚNICO (`dist-test/`, gerado por
// `IKCOUS_IDENTITY_MODE=fixture npm run build`) servindo lojas DIFERENTES
// por HOST, através do `middleware()` REAL — nada de fingir o porteiro.
//
// Roda em Vitest, com o config próprio `vitest.porteiro.config.ts`
// (`npx vitest run --config vitest.porteiro.config.ts`), fora do
// `npm run test:front` (que só varre `tests/front/`). Ver README.md para o
// que este ensaio prova e para o que fica de fora dele.
//
// SEM GUARDA DE DENO (rodada D): até a rodada C, `npm run test:unit`
// (`deno test`) varria `tests/` inteiro exceto `tests/front`, e este arquivo
// morava FORA daquele ignore — a suíte precisava de um `if (typeof Deno ===
// "undefined")` em volta de tudo, com `import()` DINÂMICO de `./servidor.ts`
// (import estático seria resolvido pelo Deno mesmo atrás de um `if` falso, e
// `servidor.ts` importa `src/` sem extensão, que o Deno recusa resolver). A
// hub já pôs `--ignore=tests/front,tests/porteiro-dois-hosts` no
// `package.json` ANTES desta rodada (medido, `npx tsc -b` exit 0) — o Deno
// não visita mais esta pasta, e a guarda virou peso morto. Import estático
// normal, como o resto do repositório. Prova: `npm run test:unit` continua
// com 369 passed (o mesmo número de antes da guarda existir).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DIST_TEST_DIR,
  HOSTS,
  IDENTIDADES_ESPERADAS,
  ORIGEM_B,
  iniciarServidorDoisHosts,
} from "./servidor.ts";

const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";

/**
 * `fetch()` do Node recusa `Host` como cabeçalho (é um dos "forbidden
 * header names" do Fetch spec — medido em 11/09/2026: com
 * `fetch(url, { headers: { Host: "x" } })` o servidor recebe o `Host` real
 * da conexão TCP, nunca o que foi passado). `*.localhost` também não
 * resolve por DNS no Node (só no Chrome) — `getaddrinfo ENOTFOUND`, medido
 * na mesma sessão. As DUAS medições juntas são por que este `pedir` fala
 * `node:http` direto, conectando por IP (`127.0.0.1`) e escrevendo o `Host`
 * desejado na própria requisição — a técnica padrão para simular hosts
 * virtuais localmente sem tocar `/etc/hosts` (mudança de máquina, fora de
 * escopo de um teste).
 */
function pedir(
  porta: number,
  host: string,
  caminho: string,
  opcoes: { method?: string } = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  corpo: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const requisicao = http.request(
      {
        host: "127.0.0.1",
        port: porta,
        path: caminho,
        method: opcoes.method ?? "GET",
        headers: { Host: host },
      },
      (resposta) => {
        const pedacos: Buffer[] = [];
        resposta.on("data", (pedaco: Buffer) => pedacos.push(pedaco));
        resposta.on("end", () =>
          resolve({
            status: resposta.statusCode ?? 0,
            headers: resposta.headers,
            corpo: Buffer.concat(pedacos),
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
  identidade: any;
  conexao: any;
} {
  const casado = html.match(
    /<script type="application\/json" id="ikcous-loja">([\s\S]*?)<\/script>/,
  );
  expect(casado).not.toBeNull();
  return JSON.parse(casado![1]!);
}

// Regra estrita do ADENDO B (item iii): a AUSÊNCIA de `dist-test/` FALHA a
// suíte com uma mensagem clara — nunca "pula" em silêncio.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- DIST_TEST_DIR é a constante exportada por `servidor.ts` (`path.resolve(process.cwd(), "dist-test")`), nunca entrada externa.
if (!existsSync(DIST_TEST_DIR)) {
  throw new Error(
    `PORTEIRO_DOIS_HOSTS_SEM_DIST_TEST: rode \`${COMANDO_DE_BUILD}\` na raiz ` +
      `do repositório antes desta suíte (dist-test/ não existe em ${DIST_TEST_DIR}).`,
  );
}

describe("porteiro-dois-hosts — prova ponta a ponta (T6, ADENDO D)", () => {
  let servidor: { porta: number; fechar(): Promise<void> };

  beforeAll(async () => {
    servidor = await iniciarServidorDoisHosts();
  });

  afterAll(async () => {
    await servidor.fechar();
  });

  // A asserção positiva de `loja-a.localhost` vem ANTES das negativas
  // (ADENDO B, item ii do T6) — é o cenário que prova que o mecanismo
  // funciona antes de provar que ele recusa o que deve recusar.
  it("loja-a.localhost: título, --primary-color e data block da PRÓPRIA ficha (caminho b)", async () => {
    const resp = await pedir(servidor.porta, HOSTS.A, "/");
    expect(resp.status).toBe(200);
    expect(resp.headers["x-ikcous-porteiro"]).toBe("ok");
    expect(resp.headers["x-ikcous-caderneta"]).toBe("ausente");
    const html = resp.corpo.toString("utf-8");
    const esperado = IDENTIDADES_ESPERADAS[HOSTS.A]!;
    expect(html).toContain(`<title>${esperado.storeName}</title>`);
    expect(html).toContain(`--primary-color:${esperado.cor}`);
    const ficha = lerDataBlock(html);
    expect(ficha.host).toBe(HOSTS.A);
    expect(ficha.identidade.identity.storeName).toBe(esperado.storeName);
    expect(ficha.conexao.supabaseUrl).toBe(esperado.origem);
  });

  // Achado do revisor (rodada D, achado 1 — substitui o teste anterior desta
  // mesma ideia, que usava `HOSTS.A`): a suíte já tinha AQUECIDO o cache do
  // porteiro para `HOSTS.A` no teste acima (mesma chave, `normalizarHost`,
  // fresco por 60 s) — uma requisição com `Host: loja-a.localhost.` batia no
  // CACHE e passava mesmo que a normalização de host usada pelo SERVIDOR DE
  // ENSAIO para escolher o `process.env` (`aplicarAmbientePorHost`, chamada
  // com o resultado de `normalizarHost(url)` em `tratarRequisicao`) estivesse
  // QUEBRADA — o teste não discriminava nada na suíte completa. `HOSTS.D` é
  // DEDICADO: nenhum outro teste deste arquivo pede este host, então o cache
  // do porteiro começa SEMPRE vazio para ele, e a resposta só pode vir de
  // resolver a conexão de verdade — o que exige que `tratarRequisicao` tenha
  // usado a MESMA `normalizarHost` que o produto usa (`src/hospedagem/
  // porteiro.ts`), tirando o ponto final de FQDN antes de escolher o
  // `process.env`. PROVA (rodada D, colada no relatório da tarefa):
  // revertendo temporariamente `const hostname = normalizarHost(url);` em
  // `servidor.ts` para a forma antiga
  // `cabecalhoHost.split(":")[0]!.toLowerCase()` (que preserva o ponto) e
  // rodando a SUÍTE COMPLETA (sem `-t`), só este teste fica VERMELHO (503
  // `sem-loja`, porque `aplicarAmbientePorHost("loja-d.localhost.")` não bate
  // com `HOSTS.D` e nenhum ambiente é configurado); restaurando a linha, a
  // suíte inteira volta a ficar VERDE.
  it("loja-d.localhost. (ponto final, host DEDICADO — nada aqueceu o cache antes): resolve como loja-d.localhost", async () => {
    const resp = await pedir(servidor.porta, `${HOSTS.D}.`, "/");
    expect(resp.status).toBe(200);
    expect(resp.headers["x-ikcous-porteiro"]).toBe("ok");
    const html = resp.corpo.toString("utf-8");
    const esperado = IDENTIDADES_ESPERADAS[HOSTS.D]!;
    expect(html).toContain(`<title>${esperado.storeName}</title>`);
    const ficha = lerDataBlock(html);
    expect(ficha.host).toBe(HOSTS.D);
    expect(ficha.conexao.supabaseUrl).toBe(esperado.origem);
  });

  it("loja-b.localhost: ficha PRÓPRIA, diferente da de A (mesmo build assado)", async () => {
    const resp = await pedir(servidor.porta, HOSTS.B, "/");
    expect(resp.status).toBe(200);
    const html = resp.corpo.toString("utf-8");
    const esperado = IDENTIDADES_ESPERADAS[HOSTS.B]!;
    expect(html).toContain(`<title>${esperado.storeName}</title>`);
    expect(html).toContain(`--primary-color:${esperado.cor}`);
    const ficha = lerDataBlock(html);
    expect(ficha.host).toBe(HOSTS.B);
    expect(ficha.identidade.identity.storeName).toBe(esperado.storeName);
  });

  it("loja-c.localhost: resolvida pela CADERNETA CENTRAL dublada (caminho a, hit)", async () => {
    const resp = await pedir(servidor.porta, HOSTS.C, "/");
    expect(resp.status).toBe(200);
    expect(resp.headers["x-ikcous-caderneta"]).toBe("hit");
    const html = resp.corpo.toString("utf-8");
    const esperado = IDENTIDADES_ESPERADAS[HOSTS.C]!;
    expect(html).toContain(`<title>${esperado.storeName}</title>`);
    const ficha = lerDataBlock(html);
    expect(ficha.host).toBe(HOSTS.C);
    expect(ficha.conexao.supabaseUrl).toBe(esperado.origem);
  });

  // Achado do revisor (rodada D, achado 4): a versão anterior deste teste só
  // conferia DOIS campos (`host`, `identity.storeName`) — bastaria um campo
  // qualquer da ficha divergir (ex.: `identityRevision`, `localUrls`) sem
  // nenhum teste acusar. Igualdade PROFUNDA (`toEqual`) entre a ficha do
  // data block (`/`) e a de `/identidade.json`, para A e B, com as DUAS
  // requisições no MESMO host/porta (o `publicUrl` é recalculado por
  // requisição — `src/hospedagem/porteiro.ts`, `comPublicUrlAtual` — então
  // só é seguro comparar respostas do mesmo host/porta).
  it("loja-a.localhost: data block e /identidade.json são a MESMA ficha (igualdade profunda)", async () => {
    const respHtml = await pedir(servidor.porta, HOSTS.A, "/");
    const fichaDoHtml = lerDataBlock(respHtml.corpo.toString("utf-8"));
    const respJson = await pedir(servidor.porta, HOSTS.A, "/identidade.json");
    expect(respJson.status).toBe(200);
    const fichaDoJson = JSON.parse(respJson.corpo.toString("utf-8"));
    expect(fichaDoJson).toEqual(fichaDoHtml);
    expect(fichaDoJson.host).toBe(HOSTS.A);
  });

  it("loja-b.localhost: data block e /identidade.json são a MESMA ficha (igualdade profunda)", async () => {
    const respHtml = await pedir(servidor.porta, HOSTS.B, "/");
    const fichaDoHtml = lerDataBlock(respHtml.corpo.toString("utf-8"));
    const respJson = await pedir(servidor.porta, HOSTS.B, "/identidade.json");
    expect(respJson.status).toBe(200);
    const fichaDoJson = JSON.parse(respJson.corpo.toString("utf-8"));
    expect(fichaDoJson).toEqual(fichaDoHtml);
    expect(fichaDoJson.host).toBe(HOSTS.B);
  });

  it("/manifest.webmanifest com name/theme_color do host", async () => {
    const resp = await pedir(servidor.porta, HOSTS.B, "/manifest.webmanifest");
    expect(resp.status).toBe(200);
    const manifest = JSON.parse(resp.corpo.toString("utf-8"));
    const esperado = IDENTIDADES_ESPERADAS[HOSTS.B]!;
    expect(manifest.name).toBe(esperado.storeName);
    expect(manifest.short_name).toBe(esperado.storeName);
    expect(manifest.theme_color).toBe(esperado.cor);
  });

  it("/assets/*.js byte a byte igual ao disco e SEM x-ikcous-porteiro (passthrough, fora do matcher)", async () => {
    const pastaAssets = path.join(DIST_TEST_DIR, "assets");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- pastaAssets vem só de DIST_TEST_DIR, constante do próprio ensaio, nunca entrada externa.
    const arquivoJs = readdirSync(pastaAssets).find((nome) =>
      nome.endsWith(".js"),
    );
    if (!arquivoJs)
      throw new Error(
        `PORTEIRO_DOIS_HOSTS_SEM_ASSET_JS: nenhum .js em ${pastaAssets}`,
      );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivoJs vem da listagem do próprio dist-test/ acima, não de entrada externa.
    const bytesDoDisco = readFileSync(path.join(pastaAssets, arquivoJs));
    const resp = await pedir(servidor.porta, HOSTS.A, `/assets/${arquivoJs}`);
    expect(resp.status).toBe(200);
    expect(Buffer.compare(resp.corpo, bytesDoDisco)).toBe(0);
    expect(resp.headers["x-ikcous-porteiro"]).toBeUndefined();
  });

  // Negativo 1: host sem banco em NENHUM dos dois caminhos.
  it("loja-desconhecida.localhost -> 503 sem-loja", async () => {
    const resp = await pedir(servidor.porta, HOSTS.DESCONHECIDA, "/");
    expect(resp.status).toBe(503);
    expect(resp.headers["x-ikcous-porteiro"]).toBe("sem-loja");
    expect(resp.headers["retry-after"]).toBe("60");
  });

  // Negativo 2 (o teste negativo CENTRAL, ADENDO B): a caderneta devolve,
  // para `loja-trocada.localhost`, o banco de B — cujo `dominio_publico`
  // é `loja-b.localhost`. `decidirConcordancia` tem de recusar, e o corpo
  // da recusa não pode carregar NENHUM byte da ficha de B.
  it("cenário 'ficha trocada': caderneta devolve o banco de B para outro host -> 503 discorda, corpo sem nenhum byte de B", async () => {
    const resp = await pedir(servidor.porta, HOSTS.TROCADA, "/");
    expect(resp.status).toBe(503);
    expect(resp.headers["x-ikcous-porteiro"]).toBe("discorda");
    expect(resp.headers["x-ikcous-caderneta"]).toBe("hit");
    const corpo = resp.corpo.toString("utf-8");
    expect(corpo).not.toContain(IDENTIDADES_ESPERADAS[HOSTS.B]!.storeName);
    expect(corpo).not.toContain(ORIGEM_B);
    expect(corpo).not.toContain("sb_publishable_loja_b");
  });
});
