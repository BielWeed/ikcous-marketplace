/* eslint-disable security/detect-non-literal-fs-filename -- Só a pasta criada por mkdtemp é escrita e removida; nenhum caminho vem de fora do teste. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ConfigEnv, UserConfigFnPromise } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ARQUIVO_DO_WORKER_DO_MAPA,
  CHUNKS_OPCIONAIS,
  type ChunkParaClassificar,
  classificarBundle,
} from "../../scripts/portaoDividido";

// O PORTÃO DE TAMANHO E O PRECACHE DO SW TÊM DE CONCORDAR (onda 2 da PR #712,
// achado A3 do revisor-risco do SW). Dois arquivos decidem, cada um com o seu
// padrão de NOME, que o renderer do mapa é "sob demanda":
//   - `scripts/portaoDividido.ts` tira o chunk `maplibre-gl-*` de `cliente`
//     (grupo `opcional`, 250 kB) e o worker `maplibre-gl-worker-*` também
//     (grupo `workerDoMapa`, 130 kB) — porque a cliente só os baixa quando um
//     mapa monta;
//   - o `globIgnores` do `vite.config.ts` os tira do `self.__WB_MANIFEST` —
//     senão o `**/*.js` do precache os baixaria no `install` de TODO visitante.
// Se um lado for renomeado e o outro não, o portão passa a aprovar como "sob
// demanda" um arquivo que o SW baixa de todo mundo — os ~344 kB brotli saem
// do teto de 550 e entram no install da PWA sem ninguém medir.
//
// O teste DERIVA os nomes dos PRÓPRIOS padrões do portão (o prefixo literal
// de cada regex ancorada), confere que o portão de fato os classifica fora de
// `cliente` (pela `classificarBundle` real, não pela regex solta) e roda o
// glob REAL do precache sobre eles — o mesmo caminho de
// `mapa-precache-sem-maplibre.test.ts` (só leitura daqui): o factory de verdade
// do `vite.config.ts` monta as opções do PWA, com o `VitePWA` trocado por um
// capturador, e o `getManifest` do workbox-build (a cópia que o plugin carrega)
// aplica `globPatterns`/`globIgnores` numa pasta temporária de arquivos de 1
// byte. Renomear o padrão do portão (o prefixo muda) ou o do glob reprova aqui.

// Mesmo motivo de `mapa-precache-sem-maplibre.test.ts`: o workbox-build vem do
// vite-plugin-pwa, e o require ancorado na entrada do plugin pega a MESMA
// cópia que o build usa. Tipo local, só com o que o teste usa.
type WorkboxBuild = {
  getManifest(opcoes: {
    globDirectory: string;
    globPatterns: string[];
    globIgnores: string[];
    maximumFileSizeToCacheInBytes?: number;
  }): Promise<{ manifestEntries?: Array<{ url: string }> }>;
};
const requireDoPlugin = createRequire(
  createRequire(import.meta.url).resolve("vite-plugin-pwa"),
);
const { getManifest } = requireDoPlugin("workbox-build") as WorkboxBuild;

const capturado = vi.hoisted(() => ({
  opcoes: undefined as Partial<VitePWAOptions> | undefined,
}));

vi.mock("vite-plugin-pwa", () => ({
  VitePWA: (opcoes: Partial<VitePWAOptions>) => {
    capturado.opcoes = opcoes;
    return { name: "pwa-capturado-pelo-teste" };
  },
}));

// A identidade da loja não toca o `injectManifest`; plugin vazio para o
// factory não exigir kit de fixture nem variável de ambiente.
vi.mock("../../scripts/identityBuildConfig", () => ({
  createIdentityBuildConfig: () => ({
    plugin: { name: "identidade-fora-do-teste" },
    outDir: "dist-test",
  }),
}));

// Hermeticidade aos .env* do disco: o glob do precache não lê variável.
vi.mock("vite", async (importOriginal) => {
  const real = await importOriginal<typeof import("vite")>();
  return { ...real, loadEnv: () => ({}) };
});

/**
 * Prefixo LITERAL de uma regex ancorada em `^`: os caracteres (ou escapes de
 * pontuação, `\/`, `\.`, `\-`) até o primeiro metacaractere. Um quantificador
 * que pode zerar o último literal (`?`, `*`, `{`) o devolve ao resto. Regex
 * sem `^`, com flag (o `i` casaria maiúscula que o glob não casa), com
 * QUALQUER `|` (numa alternância de topo, `^a|^b`, o prefixo cobriria só o
 * primeiro ramo e o segundo passaria sem prova) ou com prefixo que não passa
 * de `assets/` reprova: o teste não sabe provar cobertura dela, e "não sei
 * provar" aqui é reprovar.
 */
function prefixoLiteral(padrao: RegExp): string {
  // Roda na COLETA (os nomes alimentam o `it.each`): erro aqui derruba o
  // arquivo inteiro, que é o que se quer.
  const exigir = (condicao: boolean, oQue: string) => {
    if (!condicao) throw new Error(`portão × precache: ${padrao} — ${oQue}`);
  };
  exigir(padrao.flags === "", "precisa vir sem flags");
  const fonte = padrao.source;
  exigir(fonte.startsWith("^"), "precisa ser ancorada em ^");
  exigir(
    !fonte.includes("|"),
    "alternância | não suportada: use um padrão por regex",
  );
  let prefixo = "";
  for (let i = 1; i < fonte.length; i += 1) {
    const caractere = fonte.charAt(i);
    if (caractere === "\\") {
      const escapado = fonte.charAt(i + 1);
      if (!/[^A-Za-z0-9]/.test(escapado)) break; // \d, \w, \b...: não é literal
      prefixo += escapado;
      i += 1;
      continue;
    }
    if (".*+?()[]{}|^$".includes(caractere)) {
      if ("?*{".includes(caractere)) prefixo = prefixo.slice(0, -1);
      break;
    }
    prefixo += caractere;
  }
  exigir(
    prefixo.startsWith("assets/") && prefixo.length > "assets/".length,
    "precisa ter um prefixo literal além de assets/",
  );
  return prefixo;
}

/** Sufixos no formato que o Rollup/Vite dá (`[name]-[hash].js`, hash em
 * base64url): o hash real do build de 13/10/2026, um curto e um com `_`/`-`. */
const SUFIXOS = ["C3P6mhBu.js", "a.js", "x_-9.js"];

const nomesOpcionais = CHUNKS_OPCIONAIS.flatMap((padrao) =>
  SUFIXOS.map((sufixo) => `${prefixoLiteral(padrao)}${sufixo}`),
);
const nomesDoWorker = SUFIXOS.map(
  (sufixo) => `${prefixoLiteral(ARQUIVO_DO_WORKER_DO_MAPA)}${sufixo}`,
);
// Controle: o resto da entrega CONTINUA no precache — prova que a pasta e o
// glob funcionam (um manifesto vazio "excluiria" tudo e passaria à toa).
const CONTROLE_NO_PRECACHE = [
  "index.html",
  "assets/index-BJFc2I_4.js",
  "assets/AddressList-Dr2Ko67y.js",
];

const prefixoDaPasta = "portao-e-precache-";
let pasta = "";
let urlsDoPrecache: string[] = [];

beforeAll(async () => {
  // O factory faz `process.env.NODE_ENV = "production"` em build; o stub
  // guarda o valor de antes para o `unstubAllEnvs` devolver.
  vi.stubEnv("NODE_ENV", process.env.NODE_ENV);
  const fabrica = (await import("../../vite.config"))
    .default as UserConfigFnPromise;
  const contexto: ConfigEnv = {
    command: "build",
    mode: "production",
    isPreview: false,
  };
  await fabrica(contexto);
  const injectManifest = capturado.opcoes?.injectManifest;
  expect(injectManifest?.globPatterns).toBeDefined();
  expect(injectManifest?.globIgnores).toBeDefined();

  pasta = mkdtempSync(path.join(os.tmpdir(), prefixoDaPasta));
  for (const arquivo of [
    ...nomesOpcionais,
    ...nomesDoWorker,
    ...CONTROLE_NO_PRECACHE,
  ]) {
    const destino = path.join(pasta, arquivo);
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, "x", { flag: "wx" });
  }
  const { manifestEntries } = await getManifest({
    globDirectory: pasta,
    globPatterns: [...(injectManifest?.globPatterns ?? [])],
    globIgnores: [...(injectManifest?.globIgnores ?? [])],
    maximumFileSizeToCacheInBytes:
      injectManifest?.maximumFileSizeToCacheInBytes,
  });
  urlsDoPrecache = (manifestEntries ?? []).map((entrada) => entrada.url);
});

afterAll(() => {
  vi.unstubAllEnvs();
  if (pasta === "") return;
  if (
    path.dirname(pasta) !== os.tmpdir() ||
    !path.basename(pasta).startsWith(prefixoDaPasta)
  )
    throw new Error("limpeza insegura");
  rmSync(pasta, { recursive: true, force: true });
});

describe("portão de tamanho × precache do SW: o que o portão chama de sob demanda fica fora do install", () => {
  it("os nomes derivados dos padrões são de fato o que o portão tira de cliente", () => {
    // Pela classificação REAL: os opcionais por import() dinâmico a partir
    // da entrada, o worker como asset do Rollup.
    const entrada: ChunkParaClassificar = {
      fileName: "assets/index-BJFc2I_4.js",
      isEntry: true,
      isDynamicEntry: false,
      moduleIds: [],
      imports: [],
      dynamicImports: nomesOpcionais,
    };
    const opcionais = nomesOpcionais.map(
      (fileName): ChunkParaClassificar => ({
        fileName,
        isEntry: false,
        isDynamicEntry: true,
        moduleIds: [],
        imports: [],
        dynamicImports: [],
      }),
    );
    const resultado = classificarBundle([entrada, ...opcionais], nomesDoWorker);
    expect(resultado.opcional).toEqual([...nomesOpcionais].sort());
    expect(resultado.workerDoMapa).toEqual([...nomesDoWorker].sort());
    expect(resultado.cliente).toEqual(["assets/index-BJFc2I_4.js"]);
  });

  it.each([...nomesOpcionais, ...nomesDoWorker])(
    "%s (sob demanda no portão) fica FORA do self.__WB_MANIFEST",
    (arquivo) => {
      expect(urlsDoPrecache).not.toContain(arquivo);
    },
  );

  it.each(CONTROLE_NO_PRECACHE)(
    "controle: %s continua no precache",
    (arquivo) => {
      expect(urlsDoPrecache).toContain(arquivo);
    },
  );
});
