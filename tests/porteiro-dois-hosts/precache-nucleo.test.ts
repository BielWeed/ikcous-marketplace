/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos fixos sob a raiz do repositório (dist-test/) e nomes tirados do próprio sw.js do build, nunca texto de usuário. */
// precache-nucleo.test.ts — plano "a primeira visita deixa de baixar o app
// inteiro" (26/11/2026), T3, DEPOIS do build: o `sw.js` gerado leva a marca
// `nucleo: true` que `scripts/precacheNucleo.ts` põe no manifesto, e o núcleo
// marcado abre a vitrine e o produto sem internet.
//
// Mora aqui pelo mesmo motivo de `precache-sem-painel.test.ts`: precisa do
// `dist-test/` que o `IKCOUS_IDENTITY_MODE=fixture npm run build` gera, e o job
// `build` do CI roda `vitest.porteiro.config.ts` logo depois do build.
//
// O que só o build real prova (o teste puro em tests/front/ usa bundle falso):
//   - o Workbox (injectManifest) preserva o campo extra `nucleo` no `sw.js`;
//   - o gabarito daqui é o PRÓPRIO JavaScript gerado, não o grafo que o plugin
//     leu: tudo que um JS do núcleo importa estaticamente está no núcleo, e o
//     que ele pré-carrega ao abrir uma peça do núcleo também.
//
// Sem build, FALHA (nunca pula): guarda que some em silêncio não guarda nada.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const SAIDA = "dist-test";
const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";

function lerOuFalhar(caminho: string): string {
  if (!existsSync(caminho))
    throw new Error(
      `Falta ${path.relative(RAIZ, caminho)}. Gere o build primeiro: ${COMANDO_DE_BUILD}`,
    );
  return readFileSync(caminho, "utf8");
}

interface Entrada {
  url: string;
  nucleo: boolean;
}

/** As entradas do manifesto que o Workbox injeta em `self.__WB_MANIFEST`. O
 * Workbox serializa com chaves em ordem alfabética (fast-json-stable-stringify):
 * `{"nucleo":true,"revision":…,"url":"…"}` ou `{"revision":…,"url":"…"}`. */
function manifestoDoSw(sw: string): Entrada[] {
  return [
    ...sw.matchAll(
      /\{("nucleo":true,)?"revision":(?:"[^"]*"|null),"url":"([^"]+)"\}/g,
    ),
  ].map((m) => ({ url: m[2], nucleo: m[1] !== undefined }));
}

const swTexto = lerOuFalhar(path.join(RAIZ, SAIDA, "sw.js"));
const manifesto = manifestoDoSw(swTexto);
const todos = new Set(manifesto.map((e) => e.url));
const nucleo = new Set(manifesto.filter((e) => e.nucleo).map((e) => e.url));
const lerDoBuild = (url: string) =>
  readFileSync(path.join(RAIZ, SAIDA, url), "utf8");
const doNucleo = (padrao: RegExp) => [...nucleo].filter((u) => padrao.test(u));
const deTodos = (padrao: RegExp) => [...todos].filter((u) => padrao.test(u));

describe("o sw.js do build leva a marca do núcleo", () => {
  it("o manifesto foi lido INTEIRO: nenhuma entrada num formato que a leitura não conhece", () => {
    // Se o Workbox mudar o formato (ou descartar o campo), as contas abaixo
    // ficariam vazias e passariam à toa.
    const objetosComUrl = swTexto.match(/\{"(?:nucleo|revision)":/g) ?? [];
    expect(manifesto.length).toBeGreaterThan(50);
    expect(manifesto.length).toBe(objetosComUrl.length);
  });

  it("o Workbox preserva o campo `nucleo`: parte do manifesto marcada, parte não", () => {
    expect(nucleo.size).toBeGreaterThan(10);
    expect(nucleo.size).toBeLessThan(todos.size);
    // Só `true` existe: o plugin não escreve `nucleo: false`.
    expect(swTexto).not.toMatch(/"nucleo":false/);
  });

  it("a página offline e os ícones de coração e carrinho são do núcleo", () => {
    for (const arquivo of [
      "offline.html",
      "icons/heart-96x96.png",
      "icons/cart-96x96.png",
    ])
      expect(nucleo, arquivo).toContain(arquivo);
  });

  it("a vitrine e a página do produto são do núcleo; o carrinho e o checkout não", () => {
    expect(doNucleo(/^assets\/HomeView-[\w-]+\.js$/)).toHaveLength(1);
    expect(doNucleo(/^assets\/ProductView-[\w-]+\.js$/)).toHaveLength(1);
    // Controle: as telas existem no manifesto, só não são do núcleo.
    expect(deTodos(/^assets\/CartView-[\w-]+\.js$/)).toHaveLength(1);
    expect(doNucleo(/^assets\/CartView-/)).toEqual([]);
    expect(deTodos(/^assets\/CheckoutView-[\w-]+\.js$/)).toHaveLength(1);
    expect(doNucleo(/^assets\/CheckoutView-/)).toEqual([]);
  });

  it("a página inicial só cita arquivos do núcleo (o install a guarda com a ficha)", () => {
    // O `guardarPaginaInicialComFicha` do sw.ts só guarda a página inicial se
    // todo /assets/ citado nela estiver na lista que a instalação baixou.
    const html = lerDoBuild("index.html");
    const citados = [
      ...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)/g),
    ].map((m) => m[1]);
    expect(citados.length).toBeGreaterThan(0);
    expect(citados.filter((arquivo) => !nucleo.has(arquivo))).toEqual([]);
  });

  it("todo arquivo do manifesto que a página inicial pede, mesmo fora de /assets/, é do núcleo", () => {
    // Reabrir o app sem internet depois de UMA visita: a `/` guardada pede o
    // `silent-guardian.js` e o `loading.css` (fora de /assets/). Se eles estão
    // no manifesto mas não no núcleo, a 1ª instalação não os guarda e a
    // página abre sem eles (medido em navegador, 26/11/2026). A marca da loja
    // (`store-identity/`) fica de fora: o porteiro troca esses endereços pelos
    // de cada loja (src/config/identidadeNoHtml.ts), e os do build não são os
    // que a cliente recebe. O
    // `manifest.webmanifest` também: o sw.ts o manda sempre à rede (o porteiro
    // o monta com a marca da loja), nunca o serve do cache.
    const html = lerDoBuild("index.html");
    const pedidos = [...html.matchAll(/(?:src|href)="\/([^"?#]+)"/g)]
      .map((m) => m[1])
      .filter(
        (arquivo) =>
          !arquivo.startsWith("store-identity/") &&
          arquivo !== "manifest.webmanifest",
      );
    const doManifesto = pedidos.filter((arquivo) => todos.has(arquivo));
    expect(doManifesto).toEqual(
      expect.arrayContaining(["silent-guardian.js", "loading.css"]),
    );
    expect(doManifesto.filter((arquivo) => !nucleo.has(arquivo))).toEqual([]);
  });
});

/** Quantos caracteres depois de um `import()` se procura a pré-carga. */
const JANELA_DA_PRE_CARGA = 60;

/** Os índices da pré-carga (`__vite__mapDeps([…])`) logo depois de um
 * `import()`, com um `.then(...)` opcional no meio (a Home vem assim);
 * `undefined` se o import não pré-carrega nada. Por texto, sem regex com
 * repetição — molde de `precache-sem-painel.test.ts`. */
function indicesDaPreCarga(
  texto: string,
  fimDoImport: number,
): string | undefined {
  const janela = texto.slice(fimDoImport, fimDoImport + JANELA_DA_PRE_CARGA);
  const marca = janela.indexOf("__vite__mapDeps([");
  const proximoImport = janela.indexOf("import(");
  if (marca === -1 || (proximoImport !== -1 && proximoImport < marca))
    return undefined;
  const abre = fimDoImport + marca + "__vite__mapDeps([".length;
  const fecha = texto.indexOf("]", abre);
  return fecha === -1 ? undefined : texto.slice(abre, fecha);
}

/**
 * Para cada JS do núcleo: tudo que ele importa ESTATICAMENTE está no núcleo
 * (sem isso ele não roda sem internet), e, quando ele importa dinamicamente
 * outra peça do núcleo, o que essa peça pré-carrega (`__vite__mapDeps`, o CSS
 * dela) também está. Import dinâmico para fora do núcleo é trocar de tela (ou
 * o painel): fica fora de propósito, e não é cobrado aqui.
 */
function fechamentoDoNucleo(
  doNucleoNoBuild: ReadonlySet<string>,
  ler: (url: string) => string,
): { violacoes: string[]; estaticos: number; preCargas: number } {
  const violacoes: string[] = [];
  let estaticos = 0;
  let preCargas = 0;
  for (const url of doNucleoNoBuild) {
    if (!url.endsWith(".js")) continue;
    const texto = ler(url);
    for (const m of texto.matchAll(
      /(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g,
    )) {
      estaticos++;
      const alvo = `assets/${m[1]}`;
      if (!doNucleoNoBuild.has(alvo))
        violacoes.push(`${url} importa ${alvo}, fora do núcleo`);
    }
    const lista = texto.match(/\.f=\[("assets\/[^\]]*)\]/);
    if (!lista) continue;
    const arquivos = JSON.parse(`[${lista[1]}]`) as string[];
    for (const m of texto.matchAll(/import\("\.\/([^"]+\.js)"\)/g)) {
      if (!doNucleoNoBuild.has(`assets/${m[1]}`)) continue;
      const indices = indicesDaPreCarga(texto, (m.index ?? 0) + m[0].length);
      if (indices === undefined) continue;
      if (!/^[0-9,]*$/.test(indices)) {
        violacoes.push(`${url}: pré-carga de assets/${m[1]} ilegível`);
        continue;
      }
      for (const indice of indices.split(",").filter(Boolean).map(Number)) {
        preCargas++;
        const dep = arquivos.at(indice);
        if (dep === undefined || !doNucleoNoBuild.has(dep))
          violacoes.push(
            `${url}: ao abrir assets/${m[1]} pré-carrega ${dep ?? `#${indice}`}, fora do núcleo`,
          );
      }
    }
  }
  return { violacoes, estaticos, preCargas };
}

describe("o núcleo marcado se fecha sozinho (gabarito: o JS gerado)", () => {
  it("todo import estático e toda pré-carga de peça do núcleo estão no núcleo", () => {
    const { violacoes, estaticos, preCargas } = fechamentoDoNucleo(
      nucleo,
      lerDoBuild,
    );
    // Prova não vazia: o formato do JS mudou e nada foi lido = reprovação.
    expect(estaticos).toBeGreaterThan(20);
    expect(preCargas).toBeGreaterThan(3);
    expect(violacoes).toEqual([]);
  });

  it("a conferência tem dente: tirar do núcleo o que o index importa estaticamente reprova", () => {
    const indice = doNucleo(/^assets\/index-[\w-]+\.js$/)[0];
    const importado = [
      ...lerDoBuild(indice ?? "").matchAll(
        /\bfrom"\.\/(vendor-inicio-[^"]+\.js)"/g,
      ),
    ][0]?.[1];
    expect(importado).toBeDefined();
    const semEle = new Set(nucleo);
    semEle.delete(`assets/${importado}`);
    const { violacoes } = fechamentoDoNucleo(semEle, lerDoBuild);
    expect(violacoes.some((v) => v.includes(`assets/${importado}`))).toBe(true);
  });

  it("a conferência tem dente: tirar do núcleo o CSS que a vitrine pré-carrega reprova", () => {
    const indice = doNucleo(/^assets\/index-[\w-]+\.js$/)[0] ?? "";
    const texto = lerDoBuild(indice);
    const m = texto.match(/import\("\.\/HomeView-[\w-]+\.js"\)/);
    expect(m).not.toBeNull();
    const indices = indicesDaPreCarga(
      texto,
      (m?.index ?? 0) + (m?.[0].length ?? 0),
    );
    expect(indices).toBeDefined();
    const lista = JSON.parse(
      `[${texto.match(/\.f=\[("assets\/[^\]]*)\]/)?.[1] ?? ""}]`,
    ) as string[];
    const cssDaHome = (indices ?? "")
      .split(",")
      .map((i) => lista.at(Number(i)))
      .find((a) => a?.endsWith(".css"));
    expect(cssDaHome).toBeDefined();
    const semEle = new Set(nucleo);
    semEle.delete(cssDaHome ?? "");
    const { violacoes } = fechamentoDoNucleo(semEle, lerDoBuild);
    expect(violacoes.some((v) => v.includes(cssDaHome ?? "?"))).toBe(true);
  });
});
