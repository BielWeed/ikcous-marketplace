/* eslint-disable security/detect-non-literal-fs-filename -- Lê só arquivos fixos do repositório; escreve e remove só a pasta criada por mkdtemp. */
// O PORTÃO DE TAMANHO MEDE POR ARQUIVO — frente tooling, tarefa
// size-limit-16 (A12.2 do plano; decisão D8 do dono: NÃO mudar o teto de
// 800 kB, corrigir a medida).
//
// O DEFEITO: a entrada de JS do `.size-limit.cjs` não passava `webpack:
// false` (a de CSS passava). Sem isso o size-limit jogava os ~107 chunks
// num projeto webpack vazio, re-minificava e comprimia UMA VEZ em brotli —
// medindo o bundle FUNDIDO (606 kB) enquanto o que o CDN entrega de verdade
// são respostas brotli independentes por arquivo (~777 kB somados). São 170
// kB de "folga" que não existem: o portão aprovava no papel uma biblioteca
// nova de leitor de código de barras que, na entrega real, estouraria o teto.
//
// POR QUE O TESTE LÊ O ARQUIVO E NÃO RODA O SIZE: `npm run size` exige um
// build completo antes (minutos) e o CI já o roda como job próprio — o que
// este teste trava permanentemente é a FORMA da medida (por arquivo, sem
// webpack, sem medida de tempo) e o TETO (800 kB, decisão D8; abaixar ou
// subir o teto é outro PR, com número medido no CI, e quebra este teste de
// propósito).
//
// 26/09/2026 — decisão do dono ("dividir o portão", depois "Painel 450 ·
// cliente 550"): o teto único de 800 kB virou DOIS, classificados pelo grafo
// real do Rollup (`scripts/portaoDividido.ts`): o JS que qualquer visitante
// pode baixar (cliente, 550 kB) e o JS que só existe atrás do `is_admin`
// (painel, 450 kB). A forma da medida continua a mesma: por arquivo, sem
// webpack, sem medida de tempo.
//
// 29/09/2026 — decisão do dono (em voz): acrescentado o terceiro orçamento
// `opcional` (250 kB) para chunks SOB DEMANDA (allowlist restrita ao
// `assets/maplibre-gl-*`, o renderer do mapa vetorial). Os tetos de cliente
// e painel NÃO mudaram — este teste continua derrubando mudança neles.
//
// 13/10/2026 — decisão do dono de 12/10/2026 (onda 2 da PR #712): o worker
// do MapLibre (asset `.js` que o Vite emite à parte, ~116 kB brotli) ganhou
// orçamento PRÓPRIO, `workerDoMapa` (130 kB). NENHUM teto existente subiu:
// 550 cliente, 450 painel, 250 opcional, 100 CSS, 400 leitor zxing.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const configTexto = readFileSync(".size-limit.cjs", "utf-8");
const validadorTexto = readFileSync(
  "scripts/validarPortaoDeTamanho.cjs",
  "utf-8",
);

/** Recorta o objeto de configuração que contém a âncora (do `{` da linha
 * dele até o `}` que o fecha) — sem regex, porque o path é template
 * literal (`${output}`) e as chaves do placeholder confundem qualquer
 * `[^{}]*`. */
function entrada(ancora: string): string {
  const meio = configTexto.indexOf(ancora);
  expect(meio).toBeGreaterThan(-1);
  const inicio = configTexto.lastIndexOf("{", meio);
  const fim = configTexto.indexOf("},", meio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(meio);
  return configTexto.slice(inicio, fim);
}

describe(".size-limit.cjs — o portão mede o que o servidor entrega", () => {
  it("as entradas de JS (cliente, painel, opcional e worker do mapa) medem por arquivo e sem medida de tempo", () => {
    for (const ancora of [
      "cliente.map(",
      "painel.map(",
      "opcional.map(",
      "workerDoMapa.map(",
    ]) {
      const trechoJs = entrada(ancora);
      expect(trechoJs, ancora).toContain("webpack: false");
      // A medida de tempo roda o bundle em Chrome headless — quebra em runner
      // sem Chrome e não é o que o portão protege.
      expect(trechoJs, ancora).toContain("running: false");
    }
  });

  it("a entrada de CSS continua medindo por arquivo com o teto de 100 kB", () => {
    const trechoCss = entrada("assets/*.css");
    expect(trechoCss).toContain('limit: "100 kB"');
    expect(trechoCss).toContain("webpack: false");
  });

  it("os tetos de JS são os que o dono fixou: cliente 550 kB, painel 450 kB, opcional 250 kB, worker do mapa 130 kB, leitor 400 kB", () => {
    // Se algum PR precisar mexer num teto, que seja explícito AQUI: mudar o
    // número quebra este teste de propósito. (29/09/2026: o 250 kB do
    // `opcional` é o orçamento novo do chunk de mapa sob demanda — os
    // números de cliente e painel são os mesmos de 26/09. 13/10/2026: o
    // 130 kB do worker é orçamento NOVO; nenhum dos outros subiu.)
    expect(entrada("cliente.map(")).toContain('limit: "550 kB"');
    expect(entrada("painel.map(")).toContain('limit: "450 kB"');
    expect(entrada("opcional.map(")).toContain('limit: "250 kB"');
    expect(entrada("workerDoMapa.map(")).toContain('limit: "130 kB"');
    expect(entrada("assets/leitor-zxing-*.js")).toContain('limit: "400 kB"');
    expect(configTexto).not.toContain('limit: "800 kB"');
  });

  it("não existe teto além dos seis fixados (um sétimo, mais frouxo, esconderia bytes)", () => {
    // Contar TODOS os `limit:` do arquivo fecha a porta lateral: mover um
    // arquivo para uma entrada nova com teto folgado não muda nenhum dos
    // números acima, mas muda esta lista.
    const tetos = [...configTexto.matchAll(/limit:\s*"([^"]+)"/g)].map(
      (achado) => achado[1],
    );
    expect([...tetos].sort()).toEqual(
      ["550 kB", "450 kB", "250 kB", "130 kB", "100 kB", "400 kB"].sort(),
    );
  });
});

describe(".size-limit.cjs EM EXECUÇÃO — o disco é lido com `.js` E `.mjs`", () => {
  // O recorte do disco (`readdirSync` + filtro de extensão) mora no próprio
  // `.size-limit.cjs`, que lê caminhos fixos a partir do `__dirname` dele.
  // Para exercitá-lo sem build, o texto REAL dele e o do validador são
  // copiados para uma pasta temporária com a mesma forma do repositório
  // (`scripts/`, `dist-test/version.json`, `dist-test/assets/`,
  // `.portao-tamanho/dist-test.json`) e carregados com `require` — o mesmo
  // carregamento CommonJS do size-limit. O `.mjs` é a extensão que um `?url`
  // cru sobre `maplibre-gl-worker.mjs` publicaria: lido só como `.js`, seria
  // JS servido fora de teto nenhum.
  type EntradaDoSizeLimit = { path: string | string[]; limit: string };
  const prefixoDaPasta = "size-limit-le-o-disco-";
  const pastas: string[] = [];
  const requireDaqui = createRequire(import.meta.url);
  const classificacaoValida = {
    versao: 3,
    cliente: ["assets/index-h1.js"],
    painel: [],
    opcional: ["assets/maplibre-gl-h1.js"],
    workerDoMapa: ["assets/maplibre-gl-worker-h1.js"],
  };
  const discoBase = [
    "assets/index-h1.js",
    "assets/maplibre-gl-h1.js",
    "assets/maplibre-gl-worker-h1.js",
    // Fora da conta de JS por desenho: leitor (teto próprio), CSS e wasm.
    "assets/leitor-zxing-h1.js",
    "assets/zxing_reader-h1.wasm",
    "assets/index-h1.css",
  ];

  function carregar(
    disco: readonly string[],
    classificacao: object,
  ): EntradaDoSizeLimit[] {
    const pasta = mkdtempSync(path.join(os.tmpdir(), prefixoDaPasta));
    pastas.push(pasta);
    mkdirSync(path.join(pasta, "scripts"));
    mkdirSync(path.join(pasta, "dist-test", "assets"), { recursive: true });
    mkdirSync(path.join(pasta, ".portao-tamanho"));
    writeFileSync(path.join(pasta, ".size-limit.cjs"), configTexto);
    writeFileSync(
      path.join(pasta, "scripts", "validarPortaoDeTamanho.cjs"),
      validadorTexto,
    );
    writeFileSync(
      path.join(pasta, "dist-test", "version.json"),
      JSON.stringify({ source: "fixture", promotable: false }),
    );
    writeFileSync(
      path.join(pasta, ".portao-tamanho", "dist-test.json"),
      JSON.stringify(classificacao),
    );
    for (const arquivo of disco)
      writeFileSync(path.join(pasta, "dist-test", arquivo), "x", {
        flag: "wx",
      });
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "fixture");
    return requireDaqui(
      path.join(pasta, ".size-limit.cjs"),
    ) as EntradaDoSizeLimit[];
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const pasta of pastas.splice(0)) {
      if (
        path.dirname(pasta) !== os.tmpdir() ||
        !path.basename(pasta).startsWith(prefixoDaPasta)
      )
        throw new Error("limpeza insegura");
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  const caminhosDoTeto = (entradas: EntradaDoSizeLimit[], limite: string) =>
    entradas.find((entrada) => entrada.limit === limite)?.path;

  it("controle: com o disco batendo, monta os seis tetos com os arquivos de cada grupo", () => {
    const entradas = carregar(discoBase, classificacaoValida);
    expect(entradas).toHaveLength(6);
    expect(caminhosDoTeto(entradas, "550 kB")).toEqual([
      "dist-test/assets/index-h1.js",
    ]);
    expect(caminhosDoTeto(entradas, "250 kB")).toEqual([
      "dist-test/assets/maplibre-gl-h1.js",
    ]);
    expect(caminhosDoTeto(entradas, "130 kB")).toEqual([
      "dist-test/assets/maplibre-gl-worker-h1.js",
    ]);
  });

  it("um `.mjs` no disco que a classificação não conhece reprova (não escapa calado)", () => {
    expect(() =>
      carregar([...discoBase, "assets/orfao-h1.mjs"], classificacaoValida),
    ).toThrow(/desatualizada.*só no disco: \["assets\/orfao-h1\.mjs"\]/);
  });

  it("um `.mjs` classificado entra no teto do grupo dele (é medido)", () => {
    const entradas = carregar([...discoBase, "assets/orfao-h1.mjs"], {
      ...classificacaoValida,
      cliente: [...classificacaoValida.cliente, "assets/orfao-h1.mjs"],
    });
    expect(caminhosDoTeto(entradas, "550 kB")).toEqual([
      "dist-test/assets/index-h1.js",
      "dist-test/assets/orfao-h1.mjs",
    ]);
  });
});
