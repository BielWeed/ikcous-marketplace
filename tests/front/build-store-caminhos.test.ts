/* eslint-disable security/detect-non-literal-fs-filename -- Só caminhos de mkdtemp criados aqui. */
// Caminhos de scripts/buildStore.mjs: localDirectory() (raiz e pasta de
// saída), configuration() (build.outDir/watch/write/rollup dir) e o marcador
// anterior. O build de uma loja só pode escrever na pasta local, real e
// sem atalhos que ele mesmo calculou; qualquer coisa fora disso tem de
// recusar ANTES de o Vite escrever um byte (build não chamado).
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
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));

const plataformaReal = Object.getOwnPropertyDescriptor(process, "platform");
beforeEach(() => {
  dubles.build.mockReset();
  dubles.loadEnv.mockReset();
  dubles.gerarHospedagem.mockReset().mockResolvedValue(undefined);
  dubles.gerarSitemap.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (plataformaReal)
    Object.defineProperty(process, "platform", plataformaReal);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await limparRoots();
});

const comPlataforma = (nome: string) =>
  Object.defineProperty(process, "platform", {
    value: nome,
    configurable: true,
  });
const semVite = () => {
  expect(dubles.build).not.toHaveBeenCalled();
  expect(dubles.loadEnv).not.toHaveBeenCalled();
};

describe("raiz do build", () => {
  it("raiz que não é texto, relativa, com NUL ou com . e .. é recusada antes do Vite", async () => {
    const c = await cenario(dubles);
    const nome = path.basename(c.root);
    const invalidas: unknown[] = [
      5,
      "scripts",
      `${c.root}\0`,
      `${c.root}${path.sep}..${path.sep}${nome}`,
      `${c.root}${path.sep}.`,
      `${c.root}${path.sep}.${path.sep}`,
    ];
    for (const raiz of invalidas) {
      await recusa(c.executar({ root: raiz }), "OUTPUT");
      semVite();
    }
  });

  it("fora do Windows, NUL, '.' e '..' no caminho também são recusados (a checagem de nome do Windows não os cobre)", async () => {
    const c = await cenario(dubles);
    comPlataforma("linux");
    const nome = path.basename(c.root);
    for (const raiz of [
      `${c.root}\0`,
      `${c.root}${path.sep}..${path.sep}${nome}`,
      `${c.root}${path.sep}.`,
    ]) {
      await recusa(c.executar({ root: raiz }), "OUTPUT");
      semVite();
    }
  });

  it("raiz que começa com // (extensão de caminho) é recusada", async () => {
    const c = await cenario(dubles);
    const comDuasBarras =
      process.platform === "win32"
        ? `//?/${c.root.replaceAll("\\", "/")}`
        : `/${c.root}`;
    expect(comDuasBarras.startsWith("//")).toBe(true);
    await recusa(c.executar({ root: comDuasBarras }), "OUTPUT");
    semVite();
  });

  it.runIf(process.platform === "win32")(
    "raiz \\\\?\\ (caminho estendido do Windows) é recusada mesmo existindo",
    async () => {
      const c = await cenario(dubles);
      await recusa(c.executar({ root: `\\\\?\\${c.root}` }), "OUTPUT");
      semVite();
    },
  );

  it("raiz inexistente ou que é um arquivo é recusada", async () => {
    const c = await cenario(dubles);
    await recusa(
      c.executar({ root: path.join(c.root, "nao-existe") }),
      "OUTPUT",
    );
    await recusa(
      c.executar({ root: path.join(c.root, "package.json") }),
      "OUTPUT",
    );
    semVite();
  });
});

describe("nomes de pasta inválidos no Windows (regras valem pelo process.platform)", () => {
  const reservados = [
    "con",
    "prn",
    "aux",
    "nul",
    "conin$",
    "conout$",
    "com1",
    "com9",
    "com\u00b9",
    "com\u00b2",
    "com\u00b3",
    "lpt1",
    "lpt9",
    "lpt\u00b9",
    "lpt\u00b2",
    "lpt\u00b3",
    "CON",
    "Aux",
    "con.txt",
    "nul.log",
    "com1.x",
  ];
  const proibidos = [
    "x.",
    "x ",
    "a<b",
    "a>b",
    "a:b",
    'a"b',
    "a|b",
    "a?b",
    "a*b",
    "a\u0001b",
    "a\u001fb",
  ];
  const permitidos = [
    "console",
    "com10",
    "lpt0",
    "com0",
    "comx",
    "conx",
    "con1",
    "a b",
    "x.y",
    "prnx",
    "bacon",
    "xlpt1",
    "xcom¹",
  ];

  function pastaFalsa(alvo: string) {
    const lstat = fs.lstat.bind(fs);
    const realpath = fs.realpath.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(((p: string, ...r: unknown[]) =>
      p === alvo
        ? Promise.resolve({
            isSymbolicLink: () => false,
            isDirectory: () => true,
            isFile: () => false,
            nlink: 1,
          })
        : (lstat as (...a: unknown[]) => unknown)(p, ...r)) as never);
    vi.spyOn(fs, "realpath").mockImplementation(((
      p: string,
      ...r: unknown[]
    ) =>
      p === alvo
        ? Promise.resolve(p)
        : (realpath as (...a: unknown[]) => unknown)(p, ...r)) as never);
  }

  it.each([...reservados, ...proibidos])(
    "no Windows, a pasta %j é recusada",
    async (nome) => {
      const c = await cenario(dubles);
      const raiz = `${c.root}${path.sep}${nome}`;
      // A pasta "existe" (dublê): sem a checagem de nome ela passaria, e só o
      // nome a derruba. Com pasta inexistente o erro seria OUTPUT de qualquer jeito.
      pastaFalsa(raiz);
      comPlataforma("win32");
      await recusa(c.executar({ root: raiz }), "OUTPUT");
      semVite();
    },
  );

  it.each(permitidos)(
    "no Windows, a pasta %j é aceita (passa da checagem de nome)",
    async (nome) => {
      const c = await cenario(dubles);
      const raiz = `${c.root}${path.sep}${nome}`;
      pastaFalsa(raiz);
      comPlataforma("win32");
      await expect(c.executar({ root: raiz })).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.each([...reservados, ...proibidos].filter((n) => !n.includes("\u0001")))(
    "fora do Windows a pasta %j NÃO passa por essa checagem",
    async (nome) => {
      const c = await cenario(dubles);
      const raiz = `${c.root}${path.sep}${nome}`;
      pastaFalsa(raiz);
      comPlataforma("linux");
      await expect(c.executar({ root: raiz })).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("no Windows a raiz de unidade (C:) e o separador não contam como nome inválido", async () => {
    const c = await cenario(dubles);
    comPlataforma("win32");
    await c.executar();
  });
});

describe("pasta de saída", () => {
  it("saída que é um arquivo comum é recusada ANTES do Vite escrever", async () => {
    const c = await cenario(dubles);
    await fs.writeFile(c.saida(), "sou um arquivo");
    await recusa(c.executar(), "OUTPUT");
    expect(dubles.build).not.toHaveBeenCalled();
    expect(await fs.readFile(c.saida(), "utf8")).toBe("sou um arquivo");
  });

  it("saída que é atalho/junção é recusada ANTES do Vite escrever e o destino fica intacto", async () => {
    const c = await cenario(dubles);
    const alvo = path.join(c.root, "intocada");
    await fs.mkdir(alvo);
    await fs.symlink(alvo, c.saida(), "junction");
    try {
      await recusa(c.executar(), "OUTPUT");
    } finally {
      await fs.unlink(c.saida());
    }
    expect(dubles.build).not.toHaveBeenCalled();
    expect(await fs.readdir(alvo)).toEqual([]);
  });

  it("erro de disco que não é 'não existe' (acesso negado) propaga em vez de virar 'saída ausente'", async () => {
    const c = await cenario(dubles);
    const real = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(((p: string, ...r: unknown[]) =>
      p === c.saida()
        ? Promise.reject(Object.assign(new Error("negado"), { code: "EACCES" }))
        : (real as (...a: unknown[]) => unknown)(p, ...r)) as never);
    await expect(c.executar()).rejects.toMatchObject({ code: "EACCES" });
    expect(dubles.build).not.toHaveBeenCalled();
  });

  it("saída ainda inexistente é aceita (o build a cria)", async () => {
    const c = await cenario(dubles);
    await ausente(c.saida());
    await c.executar();
  });

  it("depois do build, a raiz resolvida para outro lugar não confirma", async () => {
    const c = await cenario(dubles);
    const real = fs.realpath.bind(fs);
    let depois = false;
    c.aoConstruir = () => {
      depois = true;
    };
    vi.spyOn(fs, "realpath").mockImplementation(((
      p: string,
      ...r: unknown[]
    ) =>
      depois && p === c.root
        ? Promise.resolve(`${c.root}-outra`)
        : (real as (...a: unknown[]) => unknown)(p, ...r)) as never);
    await recusa(c.executar(), "OUTPUT");
    await ausente(path.join(c.saida(), "version.json"));
  });

  it("depois do build, a saída resolvida para outro lugar não confirma", async () => {
    const c = await cenario(dubles);
    const real = fs.realpath.bind(fs);
    let depois = false;
    c.aoConstruir = () => {
      depois = true;
    };
    vi.spyOn(fs, "realpath").mockImplementation(((
      p: string,
      ...r: unknown[]
    ) =>
      depois && p === c.saida()
        ? Promise.resolve(`${c.saida()}-outra`)
        : (real as (...a: unknown[]) => unknown)(p, ...r)) as never);
    await recusa(c.executar(), "OUTPUT");
    await ausente(path.join(c.saida(), "version.json"));
  });
});

describe("configuration() nas opções do chamador (antes do Vite)", () => {
  const recusadas: [string, Record<string, unknown>, string][] = [
    ["write false", { write: false }, "WRITE"],
    ["watch objeto vazio", { watch: {} }, "WATCH"],
    ["watch true", { watch: true }, "WATCH"],
    ["outDir em outra pasta", { outDir: "elsewhere" }, "OUTPUT"],
    ["outDir = a própria raiz", { outDir: "." }, "OUTPUT"],
    ["outDir dist num build fixture", { outDir: "dist" }, "OUTPUT"],
    [
      "rollup output.dir",
      { rollupOptions: { output: { dir: "x" } } },
      "OUTPUT",
    ],
    [
      "rollup output.file",
      { rollupOptions: { output: { file: "x.js" } } },
      "OUTPUT",
    ],
    [
      "rollup output em array com dir no 2º",
      { rollupOptions: { output: [{}, { dir: "x" }] } },
      "OUTPUT",
    ],
    [
      "rollup output em array com file",
      { rollupOptions: { output: [{ file: "x.js" }] } },
      "OUTPUT",
    ],
  ];
  it.each(recusadas)(
    "%s é recusado, com o código certo, sem chamar o Vite",
    async (_n, build, codigo) => {
      const c = await cenario(dubles, "fixture-none");
      await recusa(c.executar({ build }), codigo);
      expect(dubles.build).not.toHaveBeenCalled();
    },
  );

  const aceitas: [string, Record<string, unknown>][] = [
    ["outDir relativo igual à saída", { outDir: "dist-test" }],
    ["outDir com ./ e barra final", { outDir: "./dist-test/" }],
    ["watch nulo", { watch: null }],
    ["watch false", { watch: false }],
    ["write true", { write: true }],
    ["rollup sem output", { rollupOptions: {} }],
    ["rollup output vazio", { rollupOptions: { output: {} } }],
    ["rollup output array de vazios", { rollupOptions: { output: [{}, {}] } }],
  ];
  it.each(aceitas)("%s é aceito", async (_n, build) => {
    const c = await cenario(dubles, "fixture-none");
    await c.executar({ build });
    expect(dubles.build).toHaveBeenCalledTimes(1);
  });

  it("outDir absoluto igual à saída é aceito", async () => {
    const c = await cenario(dubles, "fixture-none");
    await c.executar({ build: { outDir: c.saida() } });
  });
});

describe("configuration() no config que o Vite resolveu (dentro do gancho)", () => {
  const adulteradas: [string, (cfg: any, c: Cenario) => void, string][] = [
    [
      "root diferente",
      (cfg, c) => {
        cfg.root = path.dirname(c.root);
      },
      "OUTPUT",
    ],
    [
      "outDir em outra pasta",
      (cfg, c) => {
        cfg.build.outDir = path.join(c.root, "outra");
      },
      "OUTPUT",
    ],
    [
      "rollup output.dir",
      (cfg) => {
        cfg.build.rollupOptions.output = { dir: "x" };
      },
      "OUTPUT",
    ],
    [
      "watch ligado",
      (cfg) => {
        cfg.build.watch = {};
      },
      "WATCH",
    ],
    [
      "write false",
      (cfg) => {
        cfg.build.write = false;
      },
      "WRITE",
    ],
    [
      "write ausente",
      (cfg) => {
        Reflect.deleteProperty(cfg.build, "write");
      },
      "OUTPUT",
    ],
    [
      "modo diferente do pedido",
      (cfg) => {
        cfg.mode = "development";
      },
      "OUTPUT",
    ],
    [
      "envDir apontando para a raiz com envFile:false",
      (cfg, c) => {
        cfg.envDir = c.root;
      },
      "OUTPUT",
    ],
  ];
  it.each(adulteradas)(
    "%s: recusa dentro do gancho, antes de o build terminar",
    async (_n, adulterar, codigo) => {
      const c = await cenario(dubles);
      c.ajustarConfig = (cfg) => adulterar(cfg, c);
      const terminou = vi.fn();
      c.aoConstruir = terminou;
      await recusa(c.executar(), codigo);
      expect(terminou).not.toHaveBeenCalled();
      await ausente(path.join(c.saida(), "version.json"));
    },
  );

  it("sem envFile:false o envDir tem de ser a raiz; falso, texto de outra pasta ou ausente recusam", async () => {
    for (const envDir of [false, undefined, "C:\\outra"] as const) {
      const c = await cenario(dubles);
      dubles.loadEnv.mockReturnValue({});
      c.ajustarConfig = (cfg) => {
        cfg.envDir = envDir;
      };
      await recusa(c.executar({ envFile: undefined }), "OUTPUT");
    }
    const ok = await cenario(dubles);
    dubles.loadEnv.mockReturnValue({});
    await ok.executar({ envFile: undefined });
  });

  it("depois do build, config resolvido que mudou de saída, de raiz ou ligou watch não confirma", async () => {
    const casos: [(cfg: any, c: Cenario) => void, string][] = [
      [
        (cfg, c) => {
          cfg.build.outDir = path.join(c.root, "outra");
        },
        "OUTPUT",
      ],
      [
        (cfg, c) => {
          cfg.root = path.dirname(c.root);
        },
        "OUTPUT",
      ],
      [
        (cfg) => {
          cfg.build.watch = {};
        },
        "WATCH",
      ],
    ];
    for (const [mudar, codigo] of casos) {
      const c = await cenario(dubles);
      c.aoConstruir = (cfg) => mudar(cfg, c);
      await recusa(c.executar(), codigo);
      await ausente(path.join(c.saida(), "version.json"));
    }
  });
});

describe("marcador version.json anterior", () => {
  it("marcador antigo é removido ANTES do build; o resto da saída fica", async () => {
    const c = await cenario(dubles);
    const marcador = path.join(c.saida(), "version.json");
    await fs.mkdir(c.saida(), { recursive: true });
    await fs.writeFile(marcador, "antigo");
    await fs.writeFile(path.join(c.saida(), "sentinela"), "fica");
    let existiaNoBuild = true;
    c.aoConstruir = async () => {
      existiaNoBuild = await fs.access(marcador).then(
        () => true,
        () => false,
      );
    };
    await c.executar();
    expect(existiaNoBuild).toBe(false);
    expect(await fs.readFile(path.join(c.saida(), "sentinela"), "utf8")).toBe(
      "fica",
    );
    expect(JSON.parse(await fs.readFile(marcador, "utf8")).source).toBe(
      "database",
    );
  });

  it("marcador com mais de um link físico não é removido (apagaria o outro nome)", async () => {
    const c = await cenario(dubles);
    const marcador = path.join(c.saida(), "version.json");
    await fs.mkdir(c.saida(), { recursive: true });
    await fs.writeFile(marcador, "antigo");
    const outroNome = path.join(c.root, "outro-nome");
    await fs.link(marcador, outroNome);
    await recusa(c.executar(), "OUTPUT");
    expect(dubles.build).not.toHaveBeenCalled();
    expect(await fs.readFile(marcador, "utf8")).toBe("antigo");
    expect(await fs.readFile(outroNome, "utf8")).toBe("antigo");
  });

  it("marcador que é uma pasta é recusado com o código de saída, sem tocar nela", async () => {
    const c = await cenario(dubles);
    const marcador = path.join(c.saida(), "version.json");
    await fs.mkdir(marcador, { recursive: true });
    await recusa(c.executar(), "OUTPUT");
    expect(dubles.build).not.toHaveBeenCalled();
    expect((await fs.lstat(marcador)).isDirectory()).toBe(true);
  });
});
