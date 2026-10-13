/* eslint-disable security/detect-non-literal-fs-filename -- Só a pasta criada por mkdtemp é escrita e removida; nenhum caminho vem de fora do teste. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ConfigEnv, UserConfigFnPromise } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// O workbox-build NÃO é dependência declarada do app: vem do vite-plugin-pwa
// (dependência + peer dele). Carregá-lo pelo PRÓPRIO plugin garante a mesma
// cópia que o build usa — o plugin faz `import("workbox-build")` a partir de
// `node_modules/vite-plugin-pwa/dist/`, e um require ancorado na entrada do
// plugin resolve do mesmo diretório. Um `import` direto daqui pegaria a
// cópia içada na raiz (não necessariamente a do plugin) e contaria como
// dependência não listada no knip. O tipo é local, só com o que o teste usa,
// pelo mesmo motivo: nem uma referência de tipo ao pacote.
type ResultadoDoManifesto = {
  manifestEntries?: Array<{ url: string }>;
};
type WorkboxBuild = {
  getManifest(opcoes: {
    globDirectory: string;
    globPatterns: string[];
    globIgnores: string[];
    maximumFileSizeToCacheInBytes?: number;
  }): Promise<ResultadoDoManifesto>;
};
const requireDoPlugin = createRequire(
  createRequire(import.meta.url).resolve("vite-plugin-pwa"),
);
const { getManifest } = requireDoPlugin("workbox-build") as WorkboxBuild;

// O MAPA SAI DO PRECACHE (correções da revisão da PR #712, frente
// mapa-precache). O chunk `assets/maplibre-gl-<hash>.js` (1.051.513 B crus,
// 228 kB brotli, medido no dist-test de 12/10/2026) entrava no
// `self.__WB_MANIFEST` pelo `**/*.js` do `globPatterns`: todo visitante com a
// PWA instalada baixava o renderer do mapa no `install` do SW, mesmo sem
// nunca abrir o Perfil — o contrário do "só é baixado sob demanda" que
// justifica a categoria "opcional" do portão de tamanho. O worker empacotado
// (`assets/maplibre-gl-worker-<hash>.js`, ~507 kB crus) cairia no mesmo glob.
//
// POR QUE ESTE TESTE EXECUTA O FACTORY E A FUNÇÃO DO WORKBOX, E NÃO SÓ UMA
// REGEX NO TEXTO: uma regex prova que a string está no arquivo, não que o
// glob casa com o nome que o build emite (`maplibre-gl*` vs.
// `maplibre-gl-worker-*`, `*` que não atravessa `/`...). Aqui o
// `vite.config.ts` de verdade monta as opções do PWA (só o `VitePWA` é
// trocado por um capturador, e a identidade da loja — que não toca o
// `injectManifest` — por um plugin vazio), e as opções capturadas passam
// pelo `getManifest` do workbox-build (a cópia que o plugin carrega, ver o
// `requireDoPlugin` acima): é o mesmo `globSync(padrão, { cwd,
// ignore })` que o `injectManifest` do vite-plugin-pwa chama no fim do build
// (`vite-plugin-pwa/dist/vite-build-*.js` repassa `options.injectManifest`
// sem mexer no glob). Sem build pesado: a "entrega" é uma pasta temporária
// com arquivos de 1 byte e os NOMES do build real.
const capturado = vi.hoisted(() => ({
  opcoes: undefined as Partial<VitePWAOptions> | undefined,
}));

vi.mock("vite-plugin-pwa", () => ({
  VitePWA: (opcoes: Partial<VitePWAOptions>) => {
    capturado.opcoes = opcoes;
    return { name: "pwa-capturado-pelo-teste" };
  },
}));

// A identidade só mexe em `manifest` e `includeAssets`, e só dentro do hook
// `config` — que este teste não roda. Trocada por um plugin vazio para o
// factory não exigir kit de fixture nem variável de ambiente.
vi.mock("../../scripts/identityBuildConfig", () => ({
  createIdentityBuildConfig: () => ({
    plugin: { name: "identidade-fora-do-teste" },
    outDir: "dist-test",
  }),
}));

// Hermeticidade aos .env* do disco (mesmo motivo de
// tests/front/identity-build-config.test.ts): o loadEnv real lê arquivos que
// variam por máquina. O glob do precache não depende de nenhuma variável.
vi.mock("vite", async (importOriginal) => {
  const real = await importOriginal<typeof import("vite")>();
  return { ...real, loadEnv: () => ({}) };
});

// Nomes copiados do dist-test de 12/10/2026 (o worker ainda não existia
// nele: nome no formato que o Vite dá a `?worker&url`, `[name]-[hash].js`).
const FORA_DO_PRECACHE = [
  "assets/maplibre-gl-C3P6mhBu.js",
  "assets/maplibre-gl-worker-B7kQ2xZp.js",
];
const NO_PRECACHE = [
  "index.html",
  "offline.html",
  "assets/index-BJFc2I_4.js",
  "assets/index-B0FDCX_A.css",
  "assets/vendor-react-C7UUoBZs.js",
  // A lista de endereços do Perfil (que hospeda o cartão do mapa) continua
  // offline: só o RENDERER sai, o cartão segue útil sem ele.
  "assets/AddressList-Dr2Ko67y.js",
  // O CSS desse chunk carrega os estilos do mapa (import estático do CSS do
  // maplibre no AddressCardMap) e é pré-carregado também no caminho do
  // Carrinho/Checkout (lista de dependências do index no dist-test de
  // 12/10/2026): não tem o nome `maplibre-gl` e tem de continuar no precache.
  "assets/AddressList-CwBrWzMg.css",
  // O balcão vende offline (C2): tela, leitor e binário seguem no precache.
  "assets/PdvBalcao-CqJgMFS5.js",
  "assets/leitor-zxing-CEBPNyUk.js",
  "assets/zxing_reader-Bb9Mx2Pu.wasm",
];

const prefixoDaPasta = "precache-sem-maplibre-";
let pasta = "";
let urlsDoPrecache: string[] = [];

beforeAll(async () => {
  // O factory, em `command: "build"`, faz `process.env.NODE_ENV =
  // "production"` (atribuição direta); o stub guarda o valor de antes para o
  // `unstubAllEnvs` devolver no afterAll.
  vi.stubEnv("NODE_ENV", process.env.NODE_ENV);
  const fabrica = (await import("../../vite.config"))
    .default as UserConfigFnPromise;
  const contexto: ConfigEnv = {
    command: "build",
    mode: "production",
    isPreview: false,
  };
  await fabrica(contexto);
  const opcoes = capturado.opcoes;
  // Pré-condições: o precache continua sendo o do `injectManifest` com o
  // `src/sw/sw.ts` (esta frente não troca de estratégia nem de SW).
  expect(opcoes?.strategies).toBe("injectManifest");
  expect(opcoes?.srcDir).toBe("src/sw");
  expect(opcoes?.filename).toBe("sw.ts");
  const injectManifest = opcoes?.injectManifest;
  expect(injectManifest?.globPatterns).toBeDefined();
  expect(injectManifest?.globIgnores).toBeDefined();

  pasta = mkdtempSync(path.join(os.tmpdir(), prefixoDaPasta));
  for (const arquivo of [...FORA_DO_PRECACHE, ...NO_PRECACHE]) {
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

describe("precache do SW sem o renderer do mapa", () => {
  it.each(FORA_DO_PRECACHE)(
    "%s fica FORA do self.__WB_MANIFEST — só baixa quando um mapa monta",
    (arquivo) => {
      expect(urlsDoPrecache).not.toContain(arquivo);
    },
  );

  it.each(NO_PRECACHE)(
    "%s continua no precache — a exclusão não alcança o resto da entrega",
    (arquivo) => {
      expect(urlsDoPrecache).toContain(arquivo);
    },
  );

  it("o manifesto tem exatamente o resto da entrega (nada a mais, nada a menos)", () => {
    expect([...urlsDoPrecache].sort()).toEqual([...NO_PRECACHE].sort());
  });
});
