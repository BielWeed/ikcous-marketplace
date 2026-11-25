/* eslint-disable security/detect-non-literal-fs-filename -- Só pastas criadas por mkdtemp neste arquivo são lidas ou escritas. */
// Caça por mutação em scripts/identidade-bootstrap.mjs (25/11/2026): o teste
// vizinho (identidade-bootstrap-lancador) sempre injeta portas FALSAS, então o
// código das duas portas REAIS — a transação do banco (BEGIN, SET LOCAL ROLE,
// COMMIT, ROLLBACK) e a chamada do CLI do Supabase — nunca rodava. É o código
// que grava a identidade de uma loja de verdade.
//
// Aqui as portas reais rodam, mas `pg` e `child_process.spawnSync` são dublês em
// memória: nenhum banco, nenhum CLI, nenhuma rede. O núcleo (TypeScript) entra
// já carregado, sem esbuild, para o teste poder trocar `process.platform` sem
// mexer em quem carrega binário.
//
// Mutantes equivalentes (nenhum teste os derruba, e não precisa):
//  - `if (!paths.length) return;` em `remover`: guarda defensiva; quem chama
//    (`desfazer` no núcleo) já só chama com lista não vazia.
//  - `path.win32.join` -> `path.join` em executavelNpx: no Windows `path` JÁ é
//    `path.win32` (a razão do comentário no código); só difere no Linux do CI,
//    e lá o teste vizinho `executavelNpx` já simula win32.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cada caso monta um kit sintético em disco; o padrão de 5 s é curto.
vi.setConfig({ testTimeout: 30_000 });
const pgEstado = vi.hoisted(() => ({
  clientes: [] as Array<{
    opcoes: Record<string, unknown>;
    consultas: Array<{ sql: string; params?: unknown[] }>;
    fim: boolean;
  }>,
  responder: ((_sql: string, _params?: unknown[]) => ({ rows: [] })) as (
    sql: string,
    params?: unknown[],
  ) => unknown,
}));
vi.mock("pg", () => {
  class Client {
    opcoes: Record<string, unknown>;
    consultas: Array<{ sql: string; params?: unknown[] }> = [];
    fim = false;
    constructor(opcoes: Record<string, unknown>) {
      this.opcoes = opcoes;
      pgEstado.clientes.push(this);
    }
    async connect() {}
    async query(sql: string, params?: unknown[]) {
      this.consultas.push({ sql, params });
      return pgEstado.responder(sql, params);
    }
    async end() {
      this.fim = true;
    }
  }
  return { Client, default: { Client } };
});
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawnSync: spawnMock,
  default: { spawnSync: spawnMock },
}));

import {
  executavelNpx,
  principal,
  quotarComando,
} from "../../scripts/identidade-bootstrap.mjs";
import * as nucleo from "../../scripts/identidadeBootstrap";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

const { CODIGOS_DE_SAIDA, lerKit, montarIdentidade } = nucleo;
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const ANON_KEY = "sb_publishable_fixture_only";
// URL de banco falsa, montada por concatenação (o secretlint recusa uma inteira).
const URL_DE_BANCO_FALSA = ["postgresql:", "//u:SENHA@h/db"].join("");
const valoresBase = {
  store_name: "Loja Ensaio",
  primary_color: "#18181B",
  secondary_color: "#059669",
  accent_color: "#F4F4F5",
  store_city: null,
  store_state: null,
};
const PATHS = ["v1/aaa/x.webp", "v1/bbb/y.webp"];

let dir: string;
const plataformaOriginal = Object.getOwnPropertyDescriptor(process, "platform");
const trocarPlataforma = (valor: string) =>
  Object.defineProperty(process, "platform", {
    value: valor,
    configurable: true,
  });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "portas-reais-"));
  pgEstado.clientes.length = 0;
  spawnMock.mockReset();
  spawnMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
});
afterEach(async () => {
  if (plataformaOriginal)
    Object.defineProperty(process, "platform", plataformaOriginal);
  await fs.rm(dir, { recursive: true, force: true });
});

async function prepararDesfazer() {
  const fixture = await createIdentityBuildFixture("aurora");
  const kitRoot = path.join(dir, "kit");
  await fs.mkdir(path.join(kitRoot, "ikcous"), { recursive: true });
  await fs.writeFile(
    path.join(kitRoot, "manifesto.json"),
    JSON.stringify({ scope: "local-preparation" }),
  );
  await fs.writeFile(
    path.join(kitRoot, "ikcous", "branding-assets.json"),
    JSON.stringify(fixture.identity.assets),
  );
  for (const file of fixture.files) {
    const nome = file.path.split("/")[2];
    await fs.mkdir(path.join(kitRoot, "objetos", file.sha256), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(kitRoot, "objetos", file.sha256, nome),
      file.bytes,
    );
  }
  const valores = path.join(dir, "valores.json");
  await fs.writeFile(valores, JSON.stringify(valoresBase));
  const subidos = path.join(dir, "subidos.json");
  await fs.writeFile(subidos, JSON.stringify({ subidos: PATHS }));
  const kit = await lerKit(kitRoot, "ikcous");
  const desired = montarIdentidade(kit, valoresBase, SUPABASE_URL);
  const workdir = path.join(dir, "workdir");
  const argv = [
    "--kit",
    kitRoot,
    "--loja",
    "ikcous",
    "--valores",
    valores,
    "--workdir-supabase",
    workdir,
    "--desfazer",
    "--aplicar",
    "--subidos",
    subidos,
  ];
  return { argv, desired, workdir };
}

const env = () => ({
  DATABASE_URL: URL_DE_BANCO_FALSA,
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
});

function bancoComIdentidade(desired: unknown, erroNaGravacao?: unknown) {
  pgEstado.responder = (sql) => {
    if (/read_store_identity/.test(sql))
      return { rows: [{ r: { revision: "1", identity: desired } }] };
    if (/save_store_identity/.test(sql)) {
      if (erroNaGravacao) throw erroNaGravacao;
      return { rows: [{ r: { revision: "2", identity: {} } }] };
    }
    return { rows: [] };
  };
}

async function rodar(argv: string[]) {
  const logs: string[] = [];
  const errs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    errs.push(a.map(String).join(" "));
  });
  const exit = await principal(argv, env(), {
    carregarNucleo: async () => nucleo,
  });
  return { exit, logs, errs };
}

describe("porta real do banco (pg em memória)", () => {
  it("cada leitura e cada gravação é UMA transação própria: BEGIN, SET LOCAL ROLE, a consulta, COMMIT", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    trocarPlataforma("linux");
    const { exit } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(pgEstado.clientes).toHaveLength(2);
    const [leitura, gravacao] = pgEstado.clientes;
    expect(leitura.consultas.map((c) => c.sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE service_role",
      "SELECT public.read_store_identity() AS r",
      "COMMIT",
    ]);
    expect(gravacao.consultas.map((c) => c.sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE service_role",
      "SELECT public.save_store_identity($1, $2::jsonb, $3::jsonb) AS r",
      "COMMIT",
    ]);
    // revisão esperada, identidade esperada (a lida), identidade desejada (a linha nula)
    const [rev, esperado, desejado] = gravacao.consultas[2].params as [
      string,
      string,
      string,
    ];
    expect(rev).toBe("1");
    expect(JSON.parse(esperado)).toEqual(JSON.parse(JSON.stringify(desired)));
    expect(JSON.parse(desejado)).toEqual({
      store_name: null,
      store_city: null,
      store_state: null,
      primary_color: null,
      secondary_color: null,
      accent_color: null,
      logo_url: null,
      branding_assets: null,
    });
  });

  it("conecta com a DATABASE_URL do ambiente, ssl sem verificar certificado, e fecha toda conexão", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    trocarPlataforma("linux");
    await rodar(argv);
    for (const c of pgEstado.clientes) {
      expect(c.opcoes).toEqual({
        connectionString: URL_DE_BANCO_FALSA,
        ssl: { rejectUnauthorized: false },
      });
      expect(c.fim).toBe(true);
    }
  });

  it("falha na gravação: ROLLBACK, conexão fechada e o erro ORIGINAL chega ao operador (mascarado)", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired, new Error("falha do disco do banco"));
    trocarPlataforma("linux");
    const { exit, errs } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.inesperado);
    const gravacao = pgEstado.clientes[1];
    expect(gravacao.consultas.map((c) => c.sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE service_role",
      "SELECT public.save_store_identity($1, $2::jsonb, $3::jsonb) AS r",
      "ROLLBACK",
    ]);
    expect(gravacao.fim).toBe(true);
    expect(errs.join("\n")).toContain("falha do disco do banco");
    expect(spawnMock).not.toHaveBeenCalled(); // banco primeiro: com a gravação falha, nada sai do bucket
  });

  it("um ROLLBACK que também falha não esconde o erro original", async () => {
    const { argv, desired } = await prepararDesfazer();
    pgEstado.responder = (sql) => {
      if (/read_store_identity/.test(sql))
        return { rows: [{ r: { revision: "1", identity: desired } }] };
      if (/save_store_identity/.test(sql))
        throw new Error("erro original da gravacao");
      if (sql === "ROLLBACK") throw new Error("rollback tambem falhou");
      return { rows: [] };
    };
    trocarPlataforma("linux");
    const { exit, errs } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.inesperado);
    expect(errs.join("\n")).toContain("erro original da gravacao");
    expect(errs.join("\n")).not.toContain("rollback tambem falhou");
  });

  it("IDENTITY_CONFLICT (P0001) vira CONFLITO; mesma mensagem com outro código, ou outro texto com P0001, não", async () => {
    const { argv, desired } = await prepararDesfazer();
    const conflito = Object.assign(new Error("IDENTITY_CONFLICT"), {
      code: "P0001",
    });
    bancoComIdentidade(desired, conflito);
    trocarPlataforma("linux");
    let r = await rodar(argv);
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.conflito);
    expect(r.errs.join("\n")).toContain("CONFLITO: IDENTITY_CONFLICT");

    pgEstado.clientes.length = 0;
    bancoComIdentidade(
      desired,
      Object.assign(new Error("IDENTITY_CONFLICT"), { code: "XX000" }),
    );
    r = await rodar(argv);
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.inesperado);

    pgEstado.clientes.length = 0;
    bancoComIdentidade(
      desired,
      Object.assign(new Error("outra coisa"), { code: "P0001" }),
    );
    r = await rodar(argv);
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.inesperado);
  });
});

describe("porta real do storage (spawnSync em memória)", () => {
  it("linux: chama o CLI com o executável e os argumentos separados, sem shell", async () => {
    const { argv, desired, workdir } = await prepararDesfazer();
    bancoComIdentidade(desired);
    trocarPlataforma("linux");
    const { exit } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]).toEqual([
      "npx",
      [
        "supabase",
        "storage",
        "rm",
        ...PATHS.map((p) => `ss:///branding/${p}`),
        "--linked",
        "--experimental",
        "--workdir",
        workdir,
      ],
      { encoding: "utf8", cwd: undefined },
    ]);
  });

  it("win32: monta UM comando com cada parte entre aspas e roda com shell", async () => {
    const { argv, desired, workdir } = await prepararDesfazer();
    bancoComIdentidade(desired);
    trocarPlataforma("win32");
    const { exit } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const exe = executavelNpx({
      plataforma: "win32",
      execPath: process.execPath,
      existe: (c: string) => nodeFsExiste(c),
    });
    expect(spawnMock.mock.calls[0]).toEqual([
      quotarComando([
        exe,
        "supabase",
        "storage",
        "rm",
        ...PATHS.map((p) => `ss:///branding/${p}`),
        "--linked",
        "--experimental",
        "--workdir",
        workdir,
      ]),
      [],
      { encoding: "utf8", shell: true, cwd: undefined },
    ]);
  });

  it("o banco é gravado ANTES de remover do bucket", async () => {
    const { argv, desired } = await prepararDesfazer();
    const ordem: string[] = [];
    pgEstado.responder = (sql) => {
      if (/read_store_identity/.test(sql))
        return { rows: [{ r: { revision: "1", identity: desired } }] };
      if (/save_store_identity/.test(sql)) ordem.push("gravou");
      return { rows: [{ r: { revision: "2", identity: {} } }] };
    };
    spawnMock.mockImplementation(() => {
      ordem.push("removeu");
      return { status: 0, stdout: "", stderr: "" };
    });
    trocarPlataforma("linux");
    await rodar(argv);
    expect(ordem).toEqual(["gravou", "removeu"]);
  });

  it("CLI que não executa (erro do spawn): UPLOAD, mensagem mascarada, sem vazar a URL do banco", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    spawnMock.mockReturnValue({
      error: new Error(`falhou em ${URL_DE_BANCO_FALSA} agora`),
    });
    trocarPlataforma("linux");
    const { exit, errs } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.upload);
    const texto = errs.join("\n");
    expect(texto).toContain("UPLOAD: nao foi possivel executar supabase:");
    expect(texto).toContain("<url-mascarada>");
    expect(texto).not.toContain("SENHA");
  });

  it("a máscara da URL para na aspa: o resto da frase continua legível", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    spawnMock.mockReturnValue({
      error: new Error(`falha com '${URL_DE_BANCO_FALSA}' e mais texto`),
    });
    trocarPlataforma("linux");
    const { errs } = await rodar(argv);
    expect(errs.join("\n")).toContain(
      "falha com '<url-mascarada>' e mais texto",
    );
  });

  it("CLI que sai com erro: UPLOAD citando o subcomando, com a saída (mascarada) e sem stack", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    spawnMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: `boom em ${URL_DE_BANCO_FALSA}`,
    });
    trocarPlataforma("linux");
    const { exit, errs } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.upload);
    const texto = errs.join("\n");
    expect(texto).toContain(
      "UPLOAD: supabase storage rm falhou: boom em <url-mascarada>",
    );
    expect(texto).not.toContain("SENHA");
  });

  it("CLI que devolve 409 numa remoção também é erro de upload, nunca sucesso", async () => {
    const { argv, desired } = await prepararDesfazer();
    bancoComIdentidade(desired);
    spawnMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: '{"statusCode":"409"}',
    });
    trocarPlataforma("linux");
    const { exit, errs } = await rodar(argv);
    expect(exit).toBe(CODIGOS_DE_SAIDA.upload);
    expect(errs.join("\n")).toContain("objeto ja existe no bucket (409)");
  });
});

// existsSync de verdade, sem importar fs síncrono no topo (o mock de child_process não o afeta).
import { existsSync as nodeFsExiste } from "node:fs";
