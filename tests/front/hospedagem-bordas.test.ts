/* eslint-disable security/detect-non-literal-fs-filename -- pastas temporárias criadas por mkdtemp neste teste; os nomes de arquivo vêm de literais fechados. */
// Caça por mutação em scripts/hospedagem.mjs (25/11/2026). Os testes vizinhos
// (hospedagem-headers, hospedagem-rotas, vercel-headers-*) travam o caminho
// feliz e quatro recusas; ficaram sem prova: o limite exato de 2000 caracteres,
// a recusa de Cache-Control em minúsculas, lista de cabeçalhos vazia, vercel
// sem bloco global, CSP sem img-src, o conteúdo exato da config do worker, o
// banner do worker e a escrita/releitura de gerarHospedagem.
//
// Mutantes equivalentes (nenhum teste os derruba, e não precisa):
//  - `.slice(1)` -> `.slice(0)` em hostsDeImagem: o primeiro item é a própria
//    palavra "img-src", que o filtro `startsWith("https://")` descarta de
//    qualquer jeito.
//  - (parcial) `platform: "browser"` -> `"node"` em compilarWorker: o worker
//    não importa módulo do Node, então o esbuild gera o MESMO texto nas duas
//    plataformas (medido byte a byte em 25/11/2026). Por isso a OPÇÃO é
//    travada em hospedagem-esbuild-falso.test.ts, não o texto.
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();
const blocoGlobal = (v: {
  headers: { source: string; headers: unknown[] }[];
}) =>
  v.headers.find((b) => b.source === "/(.*)") as {
    headers: { key: string; value: string }[];
  };
const comGlobal = (extra: { key: string; value: string }) => {
  const alterado = structuredClone(vercel);
  blocoGlobal(alterado).headers.push(extra);
  return alterado;
};
const VERSAO = `1.2.3-sha.abcdef0-identity.${"a".repeat(64)}`;
const entrega = (connection: Record<string, unknown>) => ({
  snapshot: {
    publicUrl: "https://loja-ensaio.invalid",
    identity: { storeName: "Loja de Ensaio" },
    deliveryVersion: VERSAO,
  },
  connection,
});
const NENHUMA = { kind: "fixture-none" };
const BANCO = {
  kind: "database",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  key: "chave-publica-de-ensaio",
  keyClass: "publishable",
  projectRef: "abcdefghijklmnopqrst",
  keySource: "VITE_SUPABASE_PUBLISHABLE_KEY",
};
const semCsp = (csp?: string) => {
  const alterado = structuredClone(vercel);
  const global = blocoGlobal(alterado);
  global.headers = global.headers.filter(
    (h) => h.key !== "Content-Security-Policy",
  );
  if (csp !== undefined)
    global.headers.push({ key: "Content-Security-Policy", value: csp });
  return alterado;
};

describe("_headers: bordas das recusas", () => {
  // "  X-Longo: " tem 11 caracteres antes do valor.
  const comLinhaDe = (tamanho: number) =>
    comGlobal({ key: "X-Longo", value: "a".repeat(tamanho - 11) });

  it("linha de EXATAMENTE 2000 caracteres passa; 2001 reprova", () => {
    const texto: string = hospedagem.headers(comLinhaDe(2000));
    expect(texto.split("\n").some((l) => l.length === 2000)).toBe(true);
    expect(() => hospedagem.headers(comLinhaDe(2001))).toThrow(
      /HOSTING_HEADERS_LINE_TOO_LONG/,
    );
  });

  it("Cache-Control em minúsculas ou misto também reprova no bloco global", () => {
    for (const chave of ["cache-control", "CACHE-CONTROL", "Cache-control"]) {
      const alterado = comGlobal({ key: chave, value: "no-store" });
      expect(() => hospedagem.headers(alterado)).toThrow(
        /HOSTING_HEADERS_GLOBAL_CACHE/,
      );
      expect(() => hospedagem.cabecalhosDeFuncao(alterado)).toThrow(
        /HOSTING_HEADERS_GLOBAL_CACHE/,
      );
    }
  });

  it("vercel sem bloco de cabeçalhos gera um _headers vazio, não um erro de tipo", () => {
    expect(hospedagem.headers({})).toBe("\n");
    expect(hospedagem.headers({ headers: [] })).toBe("\n");
  });

  it("fonte com lista de cabeçalhos vazia ou que não é lista reprova, nomeando a fonte", () => {
    for (const lista of [[], "texto", undefined, {}]) {
      expect(() =>
        hospedagem.headers({
          headers: [{ source: "/assets/(.*)", headers: lista }],
        }),
      ).toThrow(/^HOSTING_HEADERS_EMPTY \/assets\/\(\.\*\)$/);
    }
  });

  it("sem bloco global, a função não tem cabeçalhos para repetir", () => {
    expect(() => hospedagem.cabecalhosDeFuncao({})).toThrow(
      /^HOSTING_HEADERS_NO_GLOBAL$/,
    );
    expect(() =>
      hospedagem.cabecalhosDeFuncao({
        headers: [
          { source: "/assets/(.*)", headers: [{ key: "A", value: "1" }] },
        ],
      }),
    ).toThrow(/^HOSTING_HEADERS_NO_GLOBAL$/);
  });
});

describe("hostsDeImagem: bordas do CSP", () => {
  it("sem Content-Security-Policy ou sem img-src, reprova com o código certo", () => {
    expect(() => hospedagem.hostsDeImagem(semCsp())).toThrow(
      /^HOSTING_CSP_NO_IMG_SRC$/,
    );
    expect(() =>
      hospedagem.hostsDeImagem(semCsp("default-src 'self'; script-src 'self'")),
    ).toThrow(/^HOSTING_CSP_NO_IMG_SRC$/);
  });

  it("diretiva de nome parecido (img-srcset, img-src sem fontes) não vale como img-src", () => {
    expect(() =>
      hospedagem.hostsDeImagem(
        semCsp("default-src 'self'; img-srcset https://intruso.example"),
      ),
    ).toThrow(/^HOSTING_CSP_NO_IMG_SRC$/);
    expect(() =>
      hospedagem.hostsDeImagem(semCsp("default-src 'self'; img-src")),
    ).toThrow(/^HOSTING_CSP_NO_IMG_SRC$/);
  });

  it("só fontes https:// viram host; http, data:, blob: e 'self' ficam de fora", () => {
    const hosts = hospedagem.hostsDeImagem(
      semCsp(
        "default-src 'self'; img-src 'self' data: blob: http://inseguro.example https://a.example https://*.b.example",
      ),
    );
    expect(hosts).toEqual(["a.example", "*.b.example"]);
    expect(Object.isFrozen(hosts)).toBe(true);
  });
});

describe("configDoWorker: o que o worker recebe, e só isso", () => {
  it("fixture sem conexão: não sai para a rede e carrega a versão e o nome da loja", () => {
    const config = hospedagem.configDoWorker(entrega(NENHUMA), vercel);
    expect(config).toStrictEqual({
      versao: 1,
      publicUrl: "https://loja-ensaio.invalid",
      storeName: "Loja de Ensaio",
      conexao: { kind: "none" },
      hostsDeImagem: hospedagem.hostsDeImagem(vercel),
      cabecalhos: hospedagem.cabecalhosDeFuncao(vercel),
      deliveryVersion: VERSAO,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("fixture sintética também não ganha conexão de banco", () => {
    const config = hospedagem.configDoWorker(
      entrega({ ...BANCO, kind: "fixture-synthetic" }),
      vercel,
    );
    expect(config.conexao).toStrictEqual({ kind: "none" });
  });

  it("banco: leva origem, chave e classe — e nenhum campo a mais (projectRef, keySource)", () => {
    const config = hospedagem.configDoWorker(entrega(BANCO), vercel);
    expect(config.conexao).toStrictEqual({
      kind: "database",
      origin: BANCO.origin,
      key: BANCO.key,
      keyClass: "publishable",
    });
  });
});

describe("gerarHospedagem: escrita real em pasta temporária", () => {
  const pastas: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const p of pastas.splice(0))
      await rm(p, { recursive: true, force: true });
  });
  const pastaComIndice = async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "hospedagem-bordas-"));
    pastas.push(pasta);
    await writeFile(
      path.join(pasta, "index.html"),
      "<html>indice da loja</html>",
    );
    return pasta;
  };
  const ARQUIVOS = [
    "_routes.json",
    "_redirects",
    "_headers",
    "404.html",
    "_worker.js",
  ];

  it("grava exatamente os cinco arquivos, na ordem, e devolve a lista congelada", async () => {
    const pasta = await pastaComIndice();
    const gravados = await hospedagem.gerarHospedagem(pasta, entrega(NENHUMA));
    expect([...gravados]).toEqual(ARQUIVOS);
    expect(Object.isFrozen(gravados)).toBe(true);
    expect((await readdir(pasta)).sort()).toEqual(
      [...ARQUIVOS, "index.html"].sort(),
    );
    expect(await readFile(path.join(pasta, "404.html"), "utf8")).toBe(
      "<html>indice da loja</html>",
    );
    expect(await readFile(path.join(pasta, "_routes.json"), "utf8")).toBe(
      hospedagem.routes(),
    );
    expect(await readFile(path.join(pasta, "_redirects"), "utf8")).toBe(
      hospedagem.redirects(),
    );
    expect(await readFile(path.join(pasta, "_headers"), "utf8")).toBe(
      hospedagem.headers(vercel),
    );
  });

  it("o worker começa pelo banner com a versão e a config em JSON compacto", async () => {
    const pasta = await pastaComIndice();
    await hospedagem.gerarHospedagem(pasta, entrega(NENHUMA));
    const worker = await readFile(path.join(pasta, "_worker.js"), "utf8");
    const config = hospedagem.configDoWorker(entrega(NENHUMA), vercel);
    expect(
      worker.startsWith(
        `// IKCOUS hospedagem ${VERSAO}\nconst __IKCOUS_HOSPEDAGEM__ = ${JSON.stringify(config)};`,
      ),
    ).toBe(true);
  });

  it("o worker compilado mantém async (alvo es2022, sem o auxiliar de es2015) e não termina com linha sobrando", async () => {
    const texto: string = await hospedagem.compilarWorker(
      hospedagem.configDoWorker(entrega(NENHUMA), vercel),
    );
    expect(texto).toMatch(/\basync\b/);
    expect(texto).not.toContain("__async");
    expect(texto.endsWith("\n\n")).toBe(false);
  });

  it("se o disco gravar outra coisa, a releitura reprova nomeando o arquivo", async () => {
    const pasta = await pastaComIndice();
    const original = fs.writeFile;
    vi.spyOn(fs, "writeFile").mockImplementation(
      async (destino, _conteudo, opcoes) =>
        original.call(fs, destino, "adulterado pelo disco", opcoes),
    );
    await expect(
      hospedagem.gerarHospedagem(pasta, entrega(NENHUMA)),
    ).rejects.toThrow(/^HOSTING_WRITE_MISMATCH _routes\.json$/);
  });

  it("arquivo já existente na saída reprova em vez de sobrescrever (wx)", async () => {
    const pasta = await pastaComIndice();
    await writeFile(path.join(pasta, "_routes.json"), "velho");
    await expect(
      hospedagem.gerarHospedagem(pasta, entrega(NENHUMA)),
    ).rejects.toThrow(/EEXIST/);
    expect(await readFile(path.join(pasta, "_routes.json"), "utf8")).toBe(
      "velho",
    );
  });

  it("sem index.html na saída, nada é gravado", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "hospedagem-bordas-"));
    pastas.push(pasta);
    await expect(
      hospedagem.gerarHospedagem(pasta, entrega(NENHUMA)),
    ).rejects.toThrow(/ENOENT/);
    expect(await readdir(pasta)).toEqual([]);
  });
});
