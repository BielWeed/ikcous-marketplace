/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// scripts/buildStore.mjs com o Vite, a hospedagem e o sitemap trocados por
// dublês: o caminho feliz inteiro (o que o marcador version.json afirma, para
// onde o build escreve, o que a hospedagem recebe) e as opções/modo que
// escolhem a pasta de saída. Cada guarda aqui tem um defeito de uma linha
// que a suíte antiga, feita de builds reais lentos, deixava passar.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_ANON,
  ORIGEM,
  REV,
  SHA,
  VERSAO,
  ausente,
  buildStore,
  cenario,
  limparRoots,
  recusa,
  versaoDeEntrega,
} from "./build-store-cenario";

const dubles = vi.hoisted(() => ({
  build: vi.fn(),
  loadEnv: vi.fn(),
  gerarHospedagem: vi.fn(),
  gerarSitemap: vi.fn(),
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));

beforeEach(() => {
  dubles.build.mockReset();
  dubles.loadEnv.mockReset();
  dubles.gerarHospedagem.mockReset().mockResolvedValue(undefined);
  dubles.gerarSitemap.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await limparRoots();
});

describe("sucesso: o que o marcador afirma e para onde o build escreve", () => {
  it("database: devolve e grava exatamente os seis campos, em dist, sem sobras", async () => {
    const c = await cenario(dubles);
    const resultado = await c.executar();
    const esperado = {
      version: versaoDeEntrega(),
      codeVersion: VERSAO,
      codeSha: SHA,
      identityRevision: REV,
      source: "database",
      promotable: true,
    };
    expect(resultado).toEqual(esperado);
    const texto = await fs.readFile(
      path.join(c.root, "dist/version.json"),
      "utf8",
    );
    expect(texto).toBe(JSON.stringify(esperado, null, 2));
    expect((await fs.readdir(path.join(c.root, "dist"))).sort()).toEqual([
      "index.html",
      "version.json",
    ]);
  });

  it("fixture-none: vai para dist-test e nunca é promovível", async () => {
    const c = await cenario(dubles, "fixture-none");
    const resultado = await c.executar();
    expect(resultado).toMatchObject({ source: "fixture", promotable: false });
    expect(
      JSON.parse(
        await fs.readFile(path.join(c.root, "dist-test/version.json"), "utf8"),
      ),
    ).toEqual(resultado);
    await ausente(path.join(c.root, "dist"));
  });

  it("fixture-synthetic (par A6) confirma e não vira database", async () => {
    const c = await cenario(dubles, "fixture-synthetic");
    expect(await c.executar()).toMatchObject({
      source: "fixture",
      promotable: false,
    });
  });

  it("chave anon-jwt com barra final na URL e keySource da anon confirma", async () => {
    const c = await cenario(dubles);
    c.envelope.publicDefines = {
      url: `${ORIGEM}/`,
      publishable: "",
      anon: CHAVE_ANON,
    };
    c.envelope.connection = {
      ...c.envelope.connection,
      key: CHAVE_ANON,
      keyClass: "anon-jwt",
      keySource: "VITE_SUPABASE_ANON_KEY",
    };
    c.publicos = { ...c.envelope.publicDefines };
    expect(await c.executar()).toMatchObject({ promotable: true });
  });

  it("chave publishable declarada vinda da variável anon também é aceita (as duas fontes existem)", async () => {
    const c = await cenario(dubles);
    c.envelope.connection.keySource = "VITE_SUPABASE_ANON_KEY";
    expect(await c.executar()).toMatchObject({ promotable: true });
  });

  it("build que devolve vários resultados confirma; um só objeto também", async () => {
    const c = await cenario(dubles);
    c.resultado = [
      { output: [{ fileName: "a" }] },
      { output: [{ fileName: "b" }] },
    ];
    await c.executar();
    const d = await cenario(dubles);
    d.resultado = { output: [{ fileName: "a" }] };
    await d.executar();
  });

  it("o Vite recebe a raiz real, o modo, as opções repassadas e o observador por último", async () => {
    const c = await cenario(dubles);
    const antes = { name: "plugin-do-usuario" };
    c.plugins = [c.provider, antes];
    await c.executar({ configFile: false });
    expect(dubles.build).toHaveBeenCalledTimes(1);
    const opts = dubles.build.mock.calls[0]?.[0];
    expect(opts.root).toBe(c.root);
    expect(opts.mode).toBe("production");
    expect(opts.envFile).toBe(false);
    expect(opts.logLevel).toBe("silent");
    expect(opts.configFile).toBe(false);
    expect(opts.plugins.slice(0, 2)).toEqual([c.provider, antes]);
    expect(opts.plugins).toHaveLength(3);
    const observador = opts.plugins.at(-1);
    expect(observador.name).toBe("store-build-finalization-observer");
    expect(observador.enforce).toBe("post");
    expect(c.retornos).toEqual([undefined]);
  });

  it("hospedagem e sitemap recebem a saída e uma cópia congelada da entrega, antes do marcador, nessa ordem", async () => {
    const c = await cenario(dubles);
    const marcador = path.join(c.saida(), "version.json");
    const vistos: string[] = [];
    const ordem: string[] = [];
    dubles.gerarHospedagem.mockImplementation(async () => {
      ordem.push("hospedagem");
      vistos.push(
        await fs.access(marcador).then(
          () => "existe",
          () => "ausente",
        ),
      );
    });
    dubles.gerarSitemap.mockImplementation(async () => {
      ordem.push("sitemap");
      vistos.push(
        await fs.access(marcador).then(
          () => "existe",
          () => "ausente",
        ),
      );
    });
    await c.executar();
    expect(ordem).toEqual(["hospedagem", "sitemap"]);
    expect(vistos).toEqual(["ausente", "ausente"]);
    for (const dub of [dubles.gerarHospedagem, dubles.gerarSitemap]) {
      const [saida, entrega] = dub.mock.calls[0] as [string, object];
      expect(saida).toBe(c.saida());
      expect(entrega).toEqual(c.envelope);
      expect(entrega).not.toBe(c.envelope);
      expect(Object.isFrozen(entrega)).toBe(true);
    }
    await fs.access(marcador);
  });
});

describe("opções e raiz", () => {
  it.each([
    ["mode", "production"],
    ["configFile", false],
    ["build", {}],
  ])("a chave permitida %s não é recusada", async (chave, valor) => {
    const c = await cenario(dubles);
    await c.executar({ [chave]: valor });
    expect(Reflect.get(dubles.build.mock.calls[0]?.[0], chave)).toEqual(valor);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["texto", "raiz"],
    ["chave desconhecida", { snapshot: {} }],
    [
      "chave desconhecida ao lado de uma permitida",
      { mode: "production", define: {} },
    ],
  ])(
    "opções inválidas (%s) recusam antes de tocar no Vite",
    async (_nome, opcoes) => {
      await recusa(buildStore(opcoes), "OPTIONS");
      expect(dubles.build).not.toHaveBeenCalled();
      expect(dubles.loadEnv).not.toHaveBeenCalled();
    },
  );

  it("sem raiz nas opções usa o diretório de trabalho; raiz vazia NÃO cai nele", async () => {
    const c = await cenario(dubles);
    vi.spyOn(process, "cwd").mockReturnValue(c.root);
    await c.executar({ root: undefined });
    expect(dubles.build.mock.calls[0]?.[0].root).toBe(c.root);
    dubles.build.mockClear();
    await recusa(c.executar({ root: "" }), "OUTPUT");
    expect(dubles.build).not.toHaveBeenCalled();
  });

  it("raiz com separador no fim é normalizada e a versão vem do package.json DELA", async () => {
    const c = await cenario(dubles);
    await c.executar({ root: `${c.root}${path.sep}` });
    expect(dubles.build.mock.calls[0]?.[0].root).toBe(c.root);
  });
});

describe("modo e pasta de saída", () => {
  it.each([5, "", "../producao", "producao/..", "a b", "..", "prod\n"])(
    "modo %j é recusado antes do Vite",
    async (modo) => {
      const c = await cenario(dubles);
      await recusa(c.executar({ mode: modo }), "MODE");
      expect(dubles.build).not.toHaveBeenCalled();
      expect(dubles.loadEnv).not.toHaveBeenCalled();
    },
  );

  it("modo de letras, dígitos, _ e - é aceito e repassado", async () => {
    const c = await cenario(dubles);
    await c.executar({ mode: "staging_1-b" });
    expect(dubles.build.mock.calls[0]?.[0].mode).toBe("staging_1-b");
  });

  it("sem modo, o padrão é production (Vite e loadEnv)", async () => {
    const c = await cenario(dubles);
    dubles.loadEnv.mockReturnValue({});
    await c.executar({ envFile: undefined });
    expect(dubles.build.mock.calls[0]?.[0].mode).toBe("production");
    expect(dubles.loadEnv).toHaveBeenCalledWith("production", c.root, "");
  });

  it("envFile false lê process.env e NÃO chama loadEnv", async () => {
    const c = await cenario(dubles);
    await c.executar();
    expect(dubles.loadEnv).not.toHaveBeenCalled();
  });

  it("sem envFile:false o modo vem do loadEnv com prefixo vazio (senão IKCOUS_* some)", async () => {
    const c = await cenario(dubles, "fixture-none");
    vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
    dubles.loadEnv.mockReturnValue({ IKCOUS_IDENTITY_MODE: "fixture" });
    const resultado = await c.executar({ envFile: undefined });
    expect(resultado.source).toBe("fixture");
    expect(dubles.loadEnv).toHaveBeenCalledWith("production", c.root, "");
    await fs.access(path.join(c.root, "dist-test/version.json"));
  });

  it("IKCOUS_IDENTITY_MODE desconhecido recusa; ausente é database", async () => {
    const c = await cenario(dubles);
    vi.stubEnv("IKCOUS_IDENTITY_MODE", "banana");
    await recusa(c.executar(), "MODE");
    expect(dubles.build).not.toHaveBeenCalled();
    vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
    expect((await c.executar()).source).toBe("database");
  });
});
