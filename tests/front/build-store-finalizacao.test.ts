/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// A janela entre "o Vite terminou" e "o marcador version.json existe" em
// scripts/buildStore.mjs: captura única do observador, fotografia e entrega
// que não mudam depois, resultado do build, marcador que ninguém pode ter
// criado antes de nós, falha da hospedagem/sitemap com a causa lavada, e a
// gravação exclusiva (flag wx) + rename do marcador. A regra de ouro:
// qualquer falha tardia deixa a saída SEM version.json.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Cenario,
  ausente,
  cenario,
  limparRoots,
  recusa,
} from "./build-store-cenario";

const dubles = vi.hoisted(() => ({
  build: vi.fn(),
  loadEnv: vi.fn(),
  gerarHospedagem: vi.fn(),
  gerarSitemap: vi.fn(),
  randomUUID: vi.fn(),
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  dubles.randomUUID.mockImplementation(() => real.randomUUID());
  return { ...real, default: real, randomUUID: dubles.randomUUID };
});

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

const marcador = (c: Cenario) => path.join(c.saida(), "version.json");

describe("captura do observador", () => {
  it("gancho chamado duas vezes reprova sem marcador", async () => {
    const c = await cenario(dubles);
    c.chamadasDoGancho = 2;
    await recusa(c.executar(), "SNAPSHOT_DUPLICATE");
    await ausente(marcador(c));
  });

  it("gancho chamado duas vezes com o erro engolido pelo Vite ainda não confirma", async () => {
    const c = await cenario(dubles);
    c.chamadasDoGancho = 2;
    c.engolirErroDoGancho = true;
    await recusa(c.executar(), "SNAPSHOT_MISSING");
    await ausente(marcador(c));
  });

  it("gancho que falhou no meio (entrega inválida) e foi engolido não confirma com metade capturada", async () => {
    const c = await cenario(dubles);
    c.engolirErroDoGancho = true;
    c.envelope.deliveryApiVersion = 2;
    await recusa(c.executar(), "SNAPSHOT_MISSING");
    await ausente(marcador(c));
  });

  it("gancho que nunca roda não confirma", async () => {
    const c = await cenario(dubles);
    c.chamadasDoGancho = 0;
    await recusa(c.executar(), "SNAPSHOT_MISSING");
    await ausente(marcador(c));
  });

  it("erro do Vite propaga e não deixa marcador", async () => {
    const c = await cenario(dubles);
    dubles.build.mockRejectedValue(new Error("vite quebrou"));
    await expect(c.executar()).rejects.toThrow("vite quebrou");
    await ausente(marcador(c));
  });
});

describe("o que mudou depois da captura", () => {
  it.each([
    [
      "__STORE_IDENTITY__",
      (cfg: any) => {
        cfg.define.__STORE_IDENTITY__ = JSON.stringify({ outra: 1 });
      },
    ],
  ])("define %s alterado não confirma", async (_n, mudar) => {
    const c = await cenario(dubles);
    c.aoConstruir = (cfg) => mudar(cfg);
    await recusa(c.executar(), "SNAPSHOT_CHANGED");
    await ausente(marcador(c));
  });

  it("define __APP_VERSION__ alterado não confirma", async () => {
    const c = await cenario(dubles);
    c.aoConstruir = (cfg) => {
      cfg.define.__APP_VERSION__ = '"outra"';
    };
    await recusa(c.executar(), "SNAPSHOT_CHANGED");
    await ausente(marcador(c));
  });

  it.each([
    "import.meta.env.VITE_SUPABASE_URL",
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
    "import.meta.env.VITE_SUPABASE_ANON_KEY",
  ])(
    "define público %s alterado depois da captura não confirma",
    async (chave) => {
      const c = await cenario(dubles);
      c.aoConstruir = (cfg) => {
        Reflect.set(
          cfg.define,
          chave,
          JSON.stringify("https://zzzzzzzzzzzzzzzzzzzz.supabase.co"),
        );
      };
      await recusa(c.executar(), "DELIVERY_CHANGED");
      await ausente(marcador(c));
    },
  );

  it("fornecedor que devolve outra chave na segunda leitura não confirma", async () => {
    const c = await cenario(dubles);
    let leituras = 0;
    const original = c.provider.api.get;
    c.provider.api.get = () => {
      leituras++;
      const v = original();
      return leituras === 1
        ? v
        : { ...v, connection: { ...v.connection, key: "chave-trocada" } };
    };
    await recusa(c.executar(), "DELIVERY_CHANGED");
    await ausente(marcador(c));
  });
});

describe("resultado do build", () => {
  const ruins: [string, unknown][] = [
    ["lista vazia", []],
    ["saída vazia", [{ output: [] }]],
    ["sem output", [{}]],
    ["output que não é lista (texto)", [{ output: "abc" }]],
    ["resultado indefinido", undefined],
    ["nulo dentro da lista", [null]],
    ["um bom e um ruim", [{ output: [{ fileName: "a" }] }, { output: [] }]],
    ["objeto único com saída vazia", { output: [] }],
  ];
  it.each(ruins)("%s não confirma", async (_n, resultado) => {
    const c = await cenario(dubles);
    c.resultado = resultado;
    await recusa(c.executar(), "WRITE");
    await ausente(marcador(c));
    expect(dubles.gerarHospedagem).not.toHaveBeenCalled();
  });
});

describe("marcador que ninguém pode ter criado", () => {
  it("version.json que aparece durante o build reprova e não é sobrescrito", async () => {
    const c = await cenario(dubles);
    c.aoConstruir = async () => {
      await fs.writeFile(marcador(c), "intruso");
    };
    await recusa(c.executar(), "MARKER_UNEXPECTED");
    expect(await fs.readFile(marcador(c), "utf8")).toBe("intruso");
    expect(dubles.gerarHospedagem).not.toHaveBeenCalled();
  });

  it("version.json que aparece durante a hospedagem/sitemap reprova e não é sobrescrito", async () => {
    const c = await cenario(dubles);
    dubles.gerarSitemap.mockImplementation(async () => {
      await fs.writeFile(marcador(c), "intruso-tardio");
    });
    await recusa(c.executar(), "MARKER_UNEXPECTED");
    expect(await fs.readFile(marcador(c), "utf8")).toBe("intruso-tardio");
  });

  it("saída que vira atalho entre o sitemap e o marcador reprova e não grava", async () => {
    const c = await cenario(dubles);
    const real = fs.lstat.bind(fs);
    let virou = false;
    dubles.gerarSitemap.mockImplementation(async () => {
      virou = true;
    });
    vi.spyOn(fs, "lstat").mockImplementation(((p: string, ...r: unknown[]) =>
      virou && p === c.saida()
        ? Promise.resolve({
            isSymbolicLink: () => true,
            isDirectory: () => false,
          })
        : (real as (...a: unknown[]) => unknown)(p, ...r)) as never);
    await recusa(c.executar(), "OUTPUT");
    await ausente(marcador(c));
  });
});

describe("hospedagem e sitemap", () => {
  it("falha da hospedagem vira IDENTITY_HOSTING com a causa lavada e não chama o sitemap", async () => {
    const c = await cenario(dubles);
    vi.stubEnv("IKCOUS_TOKEN_DE_TESTE", "valor-do-ambiente-12345");
    dubles.gerarHospedagem.mockRejectedValue(
      new Error("disco cheio com valor-do-ambiente-12345"),
    );
    await expect(c.executar()).rejects.toThrow(
      /^IDENTITY_HOSTING disco cheio com \[oculto\]$/,
    );
    expect(dubles.gerarSitemap).not.toHaveBeenCalled();
    await ausente(marcador(c));
  });

  it("falha do sitemap vira IDENTITY_SITEMAP com a causa lavada, depois da hospedagem", async () => {
    const c = await cenario(dubles);
    vi.stubEnv("IKCOUS_TOKEN_DE_TESTE", "valor-do-ambiente-12345");
    dubles.gerarSitemap.mockRejectedValue(
      new Error("rede caiu valor-do-ambiente-12345"),
    );
    await expect(c.executar()).rejects.toThrow(
      /^IDENTITY_SITEMAP rede caiu \[oculto\]$/,
    );
    expect(dubles.gerarHospedagem).toHaveBeenCalledTimes(1);
    await ausente(marcador(c));
  });

  it("a hospedagem é esperada: erro assíncrono tardio também derruba", async () => {
    const c = await cenario(dubles);
    dubles.gerarHospedagem.mockImplementation(
      () =>
        new Promise((_ok, falha) =>
          setTimeout(() => falha(new Error("tarde")), 30),
        ),
    );
    await expect(c.executar()).rejects.toThrow(/^IDENTITY_HOSTING tarde$/);
    await ausente(marcador(c));
  });

  it("o sitemap é esperado: erro assíncrono tardio também derruba", async () => {
    const c = await cenario(dubles);
    dubles.gerarSitemap.mockImplementation(
      () =>
        new Promise((_ok, falha) =>
          setTimeout(() => falha(new Error("tarde")), 30),
        ),
    );
    await expect(c.executar()).rejects.toThrow(/^IDENTITY_SITEMAP tarde$/);
    await ausente(marcador(c));
  });

  it("recebem exatamente (saída, entrega): dois argumentos", async () => {
    const c = await cenario(dubles);
    await c.executar();
    expect(dubles.gerarHospedagem.mock.calls[0]).toHaveLength(2);
    expect(dubles.gerarSitemap.mock.calls[0]).toHaveLength(2);
    expect(dubles.gerarHospedagem.mock.calls[0]?.[0]).toBe(c.saida());
    expect(dubles.gerarSitemap.mock.calls[0]?.[1]).toEqual(c.envelope);
  });
});

describe("gravação do marcador", () => {
  it("grava em arquivo temporário exclusivo (wx) e troca por rename; nada sobra", async () => {
    const c = await cenario(dubles);
    const grava = vi.spyOn(fs, "writeFile");
    const renomeia = vi.spyOn(fs, "rename");
    await c.executar();
    const chamada = grava.mock.calls.find((a) =>
      String(a[0]).includes("version.json."),
    );
    expect(path.basename(String(chamada?.[0]))).toMatch(
      /^version\.json\.[0-9a-f-]{36}\.tmp$/,
    );
    expect(chamada?.[2]).toEqual({ flag: "wx", encoding: "utf8" });
    expect(renomeia).toHaveBeenCalledTimes(1);
    expect(renomeia.mock.calls[0]).toEqual([String(chamada?.[0]), marcador(c)]);
    expect((await fs.readdir(c.saida())).sort()).toEqual([
      "index.html",
      "version.json",
    ]);
  });

  it("temporário que já existe (nome colidido) NÃO é sobrescrito e nada vira confirmação", async () => {
    const c = await cenario(dubles);
    const nome = "00000000-0000-4000-8000-000000000000";
    dubles.randomUUID.mockReturnValueOnce(nome);
    const temporario = path.join(c.saida(), `version.json.${nome}.tmp`);
    c.aoConstruir = async () => {
      await fs.writeFile(temporario, "alheio");
    };
    await expect(c.executar()).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(temporario, "utf8")).toBe("alheio");
    await ausente(marcador(c));
  });

  it("rename recusado não vira sucesso e não deixa marcador", async () => {
    const c = await cenario(dubles);
    vi.spyOn(fs, "rename").mockRejectedValue(new Error("rename recusado"));
    await expect(c.executar()).rejects.toThrow("rename recusado");
    await ausente(marcador(c));
  });

  it("o texto gravado tem recuo de 2 espaços e é o mesmo objeto devolvido", async () => {
    const c = await cenario(dubles);
    const resultado = await c.executar();
    const texto = await fs.readFile(marcador(c), "utf8");
    expect(texto).toBe(JSON.stringify(resultado, null, 2));
    expect(texto).toContain('\n  "version"');
    expect(Object.keys(resultado).sort()).toEqual([
      "codeSha",
      "codeVersion",
      "identityRevision",
      "promotable",
      "source",
      "version",
    ]);
  });

  it("rodar duas vezes seguidas troca o marcador e continua válido (idempotência)", async () => {
    const c = await cenario(dubles);
    const primeiro = await c.executar();
    const segundo = await c.executar();
    expect(segundo).toEqual(primeiro);
    expect((await fs.readdir(c.saida())).sort()).toEqual([
      "index.html",
      "version.json",
    ]);
  });
});
