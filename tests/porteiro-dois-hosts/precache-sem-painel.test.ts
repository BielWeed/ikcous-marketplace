/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos fixos sob a raiz do repositório (dist-test/, .portao-tamanho/) e nomes tirados do próprio sw.js do build, nunca texto de usuário. */
// precache-sem-painel.test.ts — a guarda do lote 252 (28/10/2026), DEPOIS do
// build: o service worker não baixa nada do painel da lojista no primeiro
// acesso de quem só compra.
//
// Mora aqui, e não em `tests/front/`, pelo mesmo motivo do ensaio do porteiro:
// precisa do `dist-test/` e do `.portao-tamanho/dist-test.json` que o
// `IKCOUS_IDENTITY_MODE=fixture npm run build` gera, e o job `test` do CI roda
// ANTES do build. O job `build` roda `vitest.porteiro.config.ts` logo depois
// do build (ver README.md desta pasta) — é lá que esta guarda é cobrada.
// A pasta também já está no `--ignore` do Deno (`npm run test:unit`).
//
// A lista do que é "painel" NÃO é escrita aqui: vem do `dist-test.json` que o
// `scripts/portaoDividido.ts` grava a partir do grafo real do Rollup. Peça
// NOVA do painel, com nome comum, cai nessa lista sozinha — e esta guarda
// reprova se ela aparecer no manifesto do `sw.js`.
//
// Sem build, FALHA (nunca pula): guarda que some em silêncio não guarda nada.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const SAIDA = "dist-test";
const COMANDO_DE_BUILD = "IKCOUS_IDENTITY_MODE=fixture npm run build";

const CAMINHO_DO_SW = path.join(RAIZ, SAIDA, "sw.js");
const CAMINHO_DA_CLASSIFICACAO = path.join(
  RAIZ,
  ".portao-tamanho",
  `${SAIDA}.json`,
);

// Tela pública do login da lojista: o portão a classifica como `cliente` (ela
// abre sem `is_admin`), mas o `assets/Admin*.js` do `globIgnores` a deixa de
// fora do precache desde antes deste lote. Não é peça do painel, e não é
// deste lote mexer nisso.
const CLIENTE_FORA_DO_PRECACHE_DE_PROPOSITO = /^assets\/AdminLoginView-/;

function lerOuFalhar(caminho: string): string {
  if (!existsSync(caminho))
    throw new Error(
      `Falta ${path.relative(RAIZ, caminho)}. Gere o build primeiro: ${COMANDO_DE_BUILD}`,
    );
  return readFileSync(caminho, "utf8");
}

/** Os `url` do manifesto que o Workbox injeta em `self.__WB_MANIFEST`. O
 * formato é o do Workbox: `{"revision":"…" | null,"url":"…"}`. */
function manifestoDoSw(sw: string): string[] {
  return [
    ...sw.matchAll(/\{"revision":(?:"[^"]*"|null),"url":"([^"]+)"\}/g),
  ].map((m) => m[1]);
}

const swTexto = lerOuFalhar(CAMINHO_DO_SW);
const classificacao = JSON.parse(lerOuFalhar(CAMINHO_DA_CLASSIFICACAO)) as {
  versao: number;
  cliente: string[];
  painel: string[];
};
const manifesto = manifestoDoSw(swTexto);
const noManifesto = new Set(manifesto);

describe("precache do service worker sem o painel da lojista", () => {
  it("o manifesto foi lido de verdade (formato do Workbox) e tem a loja inteira", () => {
    expect(classificacao.versao).toBe(1);
    // Se o formato mudar e a leitura vier vazia, as outras provas passariam à toa.
    expect(noManifesto.size).toBeGreaterThan(50);
  });

  it("nenhum arquivo que o portão classificou como painel está no manifesto", () => {
    const vazaram = classificacao.painel.filter((arquivo) =>
      noManifesto.has(arquivo),
    );
    expect(vazaram).toEqual([]);
  });

  it("o leitor de código de barras (JS e .wasm) não está no manifesto", () => {
    // O `leitor-zxing-*` tem orçamento próprio e o portão não o põe em nenhuma
    // das duas listas; o .wasm também não é JS. Os dois só existem para o balcão.
    expect(manifesto.filter((url) => /leitor-zxing-/.test(url))).toEqual([]);
    expect(manifesto.filter((url) => /\.wasm$/.test(url))).toEqual([]);
  });

  it("nenhum CSS com o nome de uma peça do painel está no manifesto", () => {
    // O Vite nomeia o CSS de um chunk como o chunk (`AdminArea-<hash>.css` para
    // `AdminArea-<hash>.js`). Prova independente do código que filtra: compara
    // só o nome, sem olhar o grafo.
    const nomeSemHash = (arquivo: string) =>
      arquivo.replace(/-[A-Za-z0-9_-]{8}\.[a-z]+$/, "");
    const nomesDoPainel = new Set(classificacao.painel.map(nomeSemHash));
    const nomesDoCliente = new Set(classificacao.cliente.map(nomeSemHash));
    const css = manifesto.filter((url) => /\.css$/.test(url));
    const doPainel = css.filter(
      (url) =>
        nomesDoPainel.has(nomeSemHash(url)) &&
        !nomesDoCliente.has(nomeSemHash(url)),
    );
    expect(doPainel).toEqual([]);
  });

  it("nada da loja saiu: todo JS de cliente segue no manifesto", () => {
    const sairam = classificacao.cliente.filter(
      (arquivo) =>
        !noManifesto.has(arquivo) &&
        !CLIENTE_FORA_DO_PRECACHE_DE_PROPOSITO.test(arquivo),
    );
    expect(sairam).toEqual([]);
  });

  it("a página inicial só usa arquivos do manifesto (senão o app não abre sem rede)", () => {
    // O `guardarPaginaInicialComFicha` do sw.ts só guarda a página inicial se
    // todo /assets/ citado nela estiver no precache.
    const html = readFileSync(path.join(RAIZ, SAIDA, "index.html"), "utf8");
    const citados = [
      ...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)/g),
    ].map((m) => m[1]);
    expect(citados.length).toBeGreaterThan(0);
    expect(citados.filter((arquivo) => !noManifesto.has(arquivo))).toEqual([]);
  });

  it("todo arquivo do manifesto existe na saída (a lista não aponta para o vazio)", () => {
    const sumiram = manifesto.filter(
      (url) => !existsSync(path.join(RAIZ, SAIDA, url)),
    );
    expect(sumiram).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FECHAMENTO dos imports — prova que NÃO depende do classificador.
//
// As provas acima usam o `dist-test.json` como gabarito, e ele sai da mesma
// `classificarBundle` que o filtro usa: se o classificador errasse (ex.: uma
// tela da loja passa a importar ESTATICAMENTE algo de `AdminPdvView.tsx`, o
// chunk vira "painel" e sai do precache), filtro e gabarito errariam juntos e
// tudo ficaria verde. Aqui o gabarito é o PRÓPRIO JAVASCRIPT gerado: todo JS do
// manifesto é lido, e tudo que ele importa estaticamente, ou pré-carrega
// (`__vite__mapDeps`) ao importar dinamicamente uma tela da loja, tem de estar
// no manifesto também. Sem isso a tela abre com rede e quebra sem rede.

/** `import()` dinâmico para fora do precache que é de PROPÓSITO: rotas do
 * painel (carregadas só depois do `is_admin`) e o login público da lojista,
 * que o `assets/Admin*.js` do `globIgnores` já deixava fora. Qualquer outro
 * alvo fora do manifesto é defeito. */
const IMPORT_DINAMICO_FORA_DE_PROPOSITO = [
  /^assets\/AdminArea-[\w-]+\.js$/,
  /^assets\/AdminLoginView-[\w-]+\.js$/,
  /^assets\/Admin[A-Za-z]+View-[\w-]+\.js$/,
  // A tela do Balcão (rota admin) tem o nome `PdvBalcao` em vez de Admin*.
  /^assets\/PdvBalcao-[\w-]+\.js$/,
];

interface ResultadoDoFechamento {
  violacoes: string[];
  examinados: { estaticos: number; dinamicos: number; preCargas: number };
}

/** Confere, para todo JS do `manifesto`, que o que ele puxa também está nele. */
function fechamentoDosImports(
  manifestoDoBuild: ReadonlySet<string>,
  lerJs: (url: string) => string,
): ResultadoDoFechamento {
  const violacoes: string[] = [];
  const examinados = { estaticos: 0, dinamicos: 0, preCargas: 0 };
  for (const url of manifestoDoBuild) {
    if (!url.endsWith(".js")) continue;
    const texto = lerJs(url);

    // import estático: `import{a}from"./x.js"`, `import"./x.js"`, `export*from"./x.js"`.
    for (const m of texto.matchAll(
      /(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g,
    )) {
      examinados.estaticos++;
      const alvo = `assets/${m[1]}`;
      if (!manifestoDoBuild.has(alvo))
        violacoes.push(`${url} importa ${alvo}, que não está no manifesto`);
    }

    // Lista de pré-carga deste chunk (`<f>.f=["assets/a.js","assets/b.css",…]`).
    const lista = texto.match(/\.f=\[("assets\/[^\]]*)\]/);
    const arquivos = lista
      ? (JSON.parse(`[${lista[1]}]`) as string[])
      : undefined;

    // import() dinâmico: o alvo e a lista de pré-carga dele.
    for (const m of texto.matchAll(/import\("\.\/([^"]+\.js)"\)/g)) {
      examinados.dinamicos++;
      const alvo = `assets/${m[1]}`;
      if (!manifestoDoBuild.has(alvo)) {
        if (!IMPORT_DINAMICO_FORA_DE_PROPOSITO.some((re) => re.test(alvo)))
          violacoes.push(
            `${url} importa dinamicamente ${alvo}, fora do manifesto e fora das exceções do painel`,
          );
        continue;
      }
      const preCarga = texto
        .slice(m.index + m[0].length)
        .match(/^,__vite__mapDeps\(\[([0-9,]*)\]/);
      if (!preCarga) continue;
      if (!arquivos) {
        violacoes.push(`${url} usa __vite__mapDeps mas a lista não foi lida`);
        continue;
      }
      for (const indice of preCarga[1].split(",").filter(Boolean).map(Number)) {
        examinados.preCargas++;
        const dep = arquivos.at(indice);
        if (dep === undefined || !manifestoDoBuild.has(dep))
          violacoes.push(
            `${url}: ao importar ${alvo} pré-carrega ${dep ?? `#${indice} (inexistente)`}, que não está no manifesto`,
          );
      }
    }
  }
  return { violacoes, examinados };
}

describe("fechamento dos imports do precache (sem depender do classificador)", () => {
  const lerDoBuild = (url: string) =>
    readFileSync(path.join(RAIZ, SAIDA, url), "utf8");

  it("no build real, tudo que um JS do manifesto importa ou pré-carrega está no manifesto", () => {
    const { violacoes, examinados } = fechamentoDosImports(
      noManifesto,
      lerDoBuild,
    );
    // Se o formato do JS gerado mudar e nada for lido, a prova seria vazia.
    expect(examinados.estaticos).toBeGreaterThan(100);
    expect(examinados.dinamicos).toBeGreaterThan(20);
    expect(examinados.preCargas).toBeGreaterThan(50);
    expect(violacoes).toEqual([]);
  });

  it("a conferência tem dente: manifesto sem o chunk que o index importa estaticamente é reprovado", () => {
    const indice = manifesto.find((url) =>
      /^assets\/index-[\w-]+\.js$/.test(url),
    );
    const importado = [
      ...lerDoBuild(indice ?? "").matchAll(
        /\bfrom"\.\/(vendor-inicio-[^"]+\.js)"/g,
      ),
    ][0]?.[1];
    expect(importado).toBeDefined();
    const semEle = new Set(noManifesto);
    semEle.delete(`assets/${importado}`);
    const { violacoes } = fechamentoDosImports(semEle, lerDoBuild);
    expect(violacoes.some((v) => v.includes(`assets/${importado}`))).toBe(true);
  });

  it("a conferência tem dente: manifesto sem um arquivo que uma tela da loja pré-carrega é reprovado", () => {
    // Tira do manifesto um arquivo que SÓ aparece como pré-carga (não é
    // import estático de ninguém): o CSS de uma rota da loja.
    const css = manifesto.find((url) =>
      /^assets\/FavoritesView-[\w-]+\.css$/.test(url),
    );
    expect(css).toBeDefined();
    const semEle = new Set(noManifesto);
    semEle.delete(css ?? "");
    const { violacoes } = fechamentoDosImports(semEle, lerDoBuild);
    expect(violacoes.some((v) => v.includes(css ?? "?"))).toBe(true);
  });

  it("a conferência tem dente: tela da loja que passa a puxar o Balcão por import estático é reprovada", () => {
    // O cenário que o gabarito do classificador não via: o chunk do Balcão
    // vira dependência estática de um JS da loja (aqui simulado no texto).
    const balcao = readdirSync(path.join(RAIZ, SAIDA, "assets")).find((f) =>
      /^PdvBalcao-/.test(f),
    );
    expect(balcao).toBeDefined();
    const { violacoes } = fechamentoDosImports(noManifesto, (url) =>
      /^assets\/HomeView-/.test(url)
        ? `${lerDoBuild(url)};import{x}from"./${balcao}";`
        : lerDoBuild(url),
    );
    expect(violacoes).toEqual([
      expect.stringContaining(`importa assets/${balcao}`),
    ]);
  });

  it("import dinâmico novo para fora do manifesto e fora das exceções é reprovado", () => {
    const { violacoes } = fechamentoDosImports(noManifesto, (url) =>
      /^assets\/HomeView-/.test(url)
        ? `${lerDoBuild(url)};import("./relatorio-novo-AAAAAAAA.js");`
        : lerDoBuild(url),
    );
    expect(violacoes).toEqual([
      expect.stringContaining("relatorio-novo-AAAAAAAA.js"),
    ]);
  });
});
