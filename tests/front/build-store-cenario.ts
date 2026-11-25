/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// Cenário em memória para os testes de scripts/buildStore.mjs: o Vite, a
// hospedagem e o sitemap são dublês; o disco é só um mkdtemp descartável.
// Nada de rede, banco, .env ou segredo: tudo aqui é inventado.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";
// @ts-expect-error Node entry é JavaScript nativo, sem declaração de tipos.
import { buildStore } from "../../scripts/buildStore.mjs";

export { buildStore };

export const SHA = "a".repeat(40);
export const REV = "b".repeat(64);
export const VERSAO = "1.2.3";
export const REF = "abcdefghijklmnopqrst";
export const ORIGEM = `https://${REF}.supabase.co`;
export const CHAVE_PUB = "sb_publishable_chave-de-teste";
export const CHAVE_ANON = "chave-de-teste";
export const CHAVE_SINTETICA = "a6c-public-artificial-key-no-account";
export const URL_PUBLICA = "https://loja-de-teste.example";
export const versaoDeEntrega = (v = VERSAO, sha = SHA, rev = REV) =>
  `${v}-sha.${sha.slice(0, 7)}-identity.${rev}`;

export type Tipo = "database" | "fixture-none" | "fixture-synthetic";
export type J = any;

export interface Dubles {
  build: ReturnType<typeof vi.fn>;
  loadEnv: ReturnType<typeof vi.fn>;
  gerarHospedagem: ReturnType<typeof vi.fn>;
  gerarSitemap: ReturnType<typeof vi.fn>;
}

export interface Cenario {
  root: string;
  tipo: Tipo;
  source: "database" | "fixture";
  pkgVersion: string;
  snapshot: J;
  envelope: J;
  publicos: { url: string; publishable: string; anon: string };
  appVersion: string;
  plugins: J[];
  provider: J;
  resultado: J;
  chamadasDoGancho: number;
  engolirErroDoGancho: boolean;
  ajustarConfig: (config: J) => void;
  aoConstruir: (config: J, opts: J) => Promise<void> | void;
  configCapturada?: J;
  retornos: unknown[];
  saida: () => string;
  fixarVersao: (v: string) => void;
  fixarSha: (sha: J, entrega?: string) => void;
  fixarRevisao: (rev: J, entrega?: string) => void;
  executar: (opcoes?: Record<string, unknown>) => Promise<J>;
}

const roots: string[] = [];
export async function limparRoots() {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
}

export async function raizTemporaria(version = VERSAO) {
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, "build-store-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version, type: "module" }),
  );
  return root;
}

export function envelopeDe(tipo: Tipo, snapshot: J): J {
  if (tipo === "fixture-none")
    return {
      deliveryApiVersion: 1,
      publicDefines: { url: "", publishable: "", anon: "" },
      connection: { kind: "fixture-none" },
      snapshot,
    };
  if (tipo === "fixture-synthetic")
    return {
      deliveryApiVersion: 1,
      publicDefines: { url: ORIGEM, publishable: CHAVE_SINTETICA, anon: "" },
      connection: {
        kind: "fixture-synthetic",
        origin: ORIGEM,
        projectRef: REF,
        key: CHAVE_SINTETICA,
      },
      snapshot,
    };
  return {
    deliveryApiVersion: 1,
    publicDefines: { url: ORIGEM, publishable: CHAVE_PUB, anon: "" },
    connection: {
      kind: "database",
      origin: ORIGEM,
      projectRef: REF,
      key: CHAVE_PUB,
      keyClass: "publishable",
      keySource: "VITE_SUPABASE_PUBLISHABLE_KEY",
    },
    snapshot,
  };
}

export async function cenario(
  dubles: Dubles,
  tipo: Tipo = "database",
): Promise<Cenario> {
  const source = tipo === "database" ? "database" : "fixture";
  vi.stubEnv(
    "IKCOUS_IDENTITY_MODE",
    source === "fixture" ? "fixture" : undefined,
  );
  const root = await raizTemporaria();
  const snapshot: J = {
    schemaVersion: 1,
    source,
    identity: { schemaVersion: 1, projectRef: REF },
    localUrls: {},
    publicUrl: URL_PUBLICA,
    codeVersion: VERSAO,
    codeSha: SHA,
    identityRevision: REV,
    deliveryVersion: versaoDeEntrega(),
  };
  const envelope = envelopeDe(tipo, snapshot);
  const provider = {
    name: "fornecedor-de-teste",
    api: {
      name: "ikcous-store-delivery",
      version: 1,
      get: () => c.envelope,
    },
  };
  const c: Cenario = {
    root,
    tipo,
    source,
    pkgVersion: VERSAO,
    snapshot,
    envelope,
    publicos: { ...envelope.publicDefines },
    appVersion: snapshot.deliveryVersion,
    plugins: [provider],
    provider,
    resultado: [{ output: [{ fileName: "index.html" }] }],
    retornos: [],
    chamadasDoGancho: 1,
    engolirErroDoGancho: false,
    ajustarConfig: () => undefined,
    aoConstruir: () => undefined,
    saida: () => path.join(root, source === "fixture" ? "dist-test" : "dist"),
    fixarVersao(v) {
      c.pkgVersion = v;
      c.snapshot.codeVersion = v;
      c.snapshot.deliveryVersion = versaoDeEntrega(v);
      c.appVersion = c.snapshot.deliveryVersion;
    },
    fixarSha(sha, entrega) {
      c.snapshot.codeSha = sha;
      c.snapshot.deliveryVersion =
        entrega ?? versaoDeEntrega(VERSAO, String(sha));
      c.appVersion = c.snapshot.deliveryVersion;
    },
    fixarRevisao(rev, entrega) {
      c.snapshot.identityRevision = rev;
      c.snapshot.deliveryVersion =
        entrega ?? versaoDeEntrega(VERSAO, SHA, String(rev));
      c.appVersion = c.snapshot.deliveryVersion;
    },
    executar: (opcoes = {}) =>
      buildStore({
        root,
        envFile: false,
        logLevel: "silent",
        plugins: c.plugins,
        ...opcoes,
      }),
  };
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version: VERSAO }),
  );
  dubles.build.mockReset();
  dubles.build.mockImplementation(async (opts: J) => {
    await fs.mkdir(c.saida(), { recursive: true });
    await fs.writeFile(path.join(c.saida(), "index.html"), "<html></html>");
    // O pacote.json do cenário pode ser trocado depois; o gancho lê o estado atual.
    const config: J = {
      root: opts.root,
      mode: opts.mode,
      envDir: opts.envFile === false ? false : opts.root,
      build: {
        outDir: c.saida(),
        write: true,
        rollupOptions: {},
      },
      define: {
        __STORE_IDENTITY__: JSON.stringify(c.snapshot),
        __APP_VERSION__: JSON.stringify(c.appVersion),
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(c.publicos.url),
        "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
          c.publicos.publishable,
        ),
        "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
          c.publicos.anon,
        ),
      },
      plugins: opts.plugins,
    };
    c.ajustarConfig(config);
    c.configCapturada = config;
    const observador = opts.plugins.at(-1);
    for (let i = 0; i < c.chamadasDoGancho; i++) {
      try {
        c.retornos.push(observador.configResolved(config));
      } catch (erro) {
        if (!c.engolirErroDoGancho) throw erro;
      }
    }
    await c.aoConstruir(config, opts);
    return c.resultado;
  });
  return c;
}

export async function recusa(promessa: Promise<unknown>, codigo: string) {
  await expect(promessa).rejects.toMatchObject({
    message: `IDENTITY_${codigo}`,
  });
}

export async function ausente(caminho: string) {
  await expect(fs.lstat(caminho)).rejects.toMatchObject({ code: "ENOENT" });
}
