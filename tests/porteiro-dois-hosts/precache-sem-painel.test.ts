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

import { existsSync, readFileSync } from "node:fs";
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
