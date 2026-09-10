/* eslint-disable security/detect-non-literal-fs-filename -- Only isolated mkdtemp kits and output
   paths (created by this file's own beforeEach/afterEach) are read or written here; no production
   path is ever touched. Mesmo modelo de ameaca do eslint-disable de
   tests/front/identidade-bootstrap.test.ts. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Achado A1 da revisao A11: o lancador (.mjs) nao tinha nenhuma cobertura --
// nem o mutante 2 do revisor ("--desfazer" volta a executar sempre porque
// `aplicar: argumentos.aplicar` virou `aplicar: true`) derrubava a suite
// antiga, que so' testa o nucleo (.ts) direto. `principal(argv, env,
// fabricas)` e' o que este arquivo importa e chama com portas falsas -- as
// duas fabricas de porta e o fetchImpl, no mesmo molde do `portasFalsas` de
// tests/front/identidade-bootstrap.test.ts.
import {
  executavelNpx,
  montarChamadaCp,
  principal,
} from "../../scripts/identidade-bootstrap.mjs";
import {
  CODIGOS_DE_SAIDA,
  canonico,
  lerKit,
  montarIdentidade,
} from "../../scripts/identidadeBootstrap";
import type {
  IdentidadeLida,
  Portas,
  Valores,
} from "../../scripts/identidadeBootstrap";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

// Fixtures de URL de banco, montadas por concatenacao: nenhuma e' real, e o
// secretlint do repositorio recusa qualquer URL de banco escrita inteira.
const URL_DE_BANCO_FALSA = ["postgresql:", "//u:SENHA@h/db"].join("");
const URL_DE_BANCO_FALSA_LONGA = [
  "postgresql:",
  "//postgres.projref:SENHA@host/db",
].join("");

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const ANON_KEY = "sb_publishable_fixture_only";
const valoresBase: Valores = {
  store_name: "Loja Ensaio",
  primary_color: "#18181B",
  secondary_color: "#059669",
  accent_color: "#F4F4F5",
  store_city: null,
  store_state: null,
};
const linhaNula: IdentidadeLida = {
  revision: "0",
  identity: {
    store_name: null,
    store_city: null,
    store_state: null,
    primary_color: null,
    secondary_color: null,
    accent_color: null,
    logo_url: null,
    branding_assets: null,
  },
};

let dir: string;
// Kit sintetico duplicado do molde de tests/front/identidade-bootstrap.test.ts
// (o docblock da tarefa autoriza "reuse ou copie"): importar as funcoes de um
// arquivo .test.ts faria o vitest recolher os describe/it de la' outra vez,
// como um segundo arquivo -- copiar e' o jeito seguro de reusar o molde.
async function kitSintetico(loja: "ikcous" | "savy" = "ikcous") {
  const fixture = await createIdentityBuildFixture("aurora");
  const kitRoot = path.join(dir, "kit");
  await fs.mkdir(path.join(kitRoot, loja), { recursive: true });
  await fs.writeFile(
    path.join(kitRoot, "manifesto.json"),
    JSON.stringify({ scope: "local-preparation" }),
  );
  await fs.writeFile(
    path.join(kitRoot, loja, "branding-assets.json"),
    JSON.stringify(fixture.identity.assets),
  );
  for (const file of fixture.files) {
    const nomeOriginal = file.path.split("/")[2];
    await fs.mkdir(path.join(kitRoot, "objetos", file.sha256), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(kitRoot, "objetos", file.sha256, nomeOriginal),
      file.bytes,
    );
  }
  return fixture;
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "lancador-a11d-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// Servidor falso: objetos "no bucket" + a linha da view publica, em memoria.
// Copia do `portasFalsas` da suite do nucleo, sem o parametro `_kit` (aqui
// nunca serve so' de documentacao de tipo -- esta suite nao usa o kit dentro
// da funcao de jeito nenhum).
function portasFalsas(inicial: IdentidadeLida) {
  const bucket = new Map<string, { bytes: Uint8Array; mime: string }>();
  let linha = inicial;
  const chamadas: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname.startsWith("/storage/v1/object/public/branding/")) {
      const objeto = bucket.get(
        url.pathname.slice("/storage/v1/object/public/branding/".length),
      );
      if (!objeto) return new Response("nao existe", { status: 404 });
      return new Response(Buffer.from(objeto.bytes), {
        status: 200,
        headers: {
          "content-type": objeto.mime,
          "content-length": String(objeto.bytes.length),
        },
      });
    }
    if (url.pathname === "/rest/v1/v_store_config") {
      chamadas.push("consulta:v_store_config");
      const { identity } = linha;
      return new Response(JSON.stringify([identity]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(`rota inesperada ${url.pathname}`, { status: 500 });
  };
  const portas: Portas = {
    supabaseUrl: SUPABASE_URL,
    chavePublica: ANON_KEY,
    fetchImpl,
    banco: {
      async ler() {
        chamadas.push("ler");
        return linha;
      },
      async gravar(_rev, _expected, desired) {
        chamadas.push("gravar");
        linha = {
          revision: String(Number(linha.revision) + 1),
          identity: desired,
        };
        return linha;
      },
    },
    storage: {
      async subir(objeto) {
        chamadas.push(`subir:${objeto.path}`);
        bucket.set(objeto.path, {
          bytes: await fs.readFile(objeto.arquivo),
          mime: objeto.mime,
        });
      },
      async remover(paths) {
        chamadas.push(`remover:${paths.length}`);
        for (const p of paths) bucket.delete(p);
      },
    },
  };
  return { portas, bucket, chamadas, linha: () => linha };
}

function envFalso(): Record<string, string> {
  // O :SENHA@ aqui existe SO' para o teste "nenhuma saida contem segredo"
  // (abaixo) ter algo real para procurar -- nenhum caminho deste arquivo se
  // conecta de verdade a um banco. Montada em duas partes porque o secretlint
  // do pre-commit recusa qualquer string literal "postgresql://...:...@" mesmo
  // sendo fixture.
  return {
    DATABASE_URL: URL_DE_BANCO_FALSA,
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: ANON_KEY,
  };
}

async function rodar(
  argv: readonly string[],
  env: Record<string, string>,
  f: ReturnType<typeof portasFalsas>,
) {
  const logs: string[] = [];
  const errs: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  const errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      errs.push(args.map(String).join(" "));
    });
  try {
    const exit = await principal(argv, env, {
      portaBanco: () => f.portas.banco,
      portaStorage: () => f.portas.storage,
      fetchImpl: f.portas.fetchImpl,
    });
    return { exit, logs, errs };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

async function prepararValores() {
  const valoresPath = path.join(dir, "valores.json");
  await fs.writeFile(valoresPath, JSON.stringify(valoresBase));
  return valoresPath;
}

// Tarefa A11e: o "npx" quotado ENTRE ASPAS e SEM CAMINHO (o que a `cli()` do
// lancador fazia antes desta tarefa) faz o cmd.exe expandir %~dp0 do atalho
// para o CWD do processo pai, nao para a pasta do proprio npx.cmd -- por
// isso o caminho absoluto ao lado do node.exe (process.execPath) so' entra
// quando o arquivo realmente existe ali; caso contrario ("npx" sem caminho)
// e fora do Windows, o PATH resolve normalmente.
describe("executavelNpx", () => {
  it("win32 com npx.cmd existente ao lado do node.exe: caminho absoluto", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const existe = (caminho: string) =>
      caminho === "C:\\Program Files\\nodejs\\npx.cmd";
    expect(executavelNpx({ plataforma: "win32", execPath, existe })).toBe(
      "C:\\Program Files\\nodejs\\npx.cmd",
    );
  });

  it("win32 sem npx.cmd ao lado do node.exe: cai para 'npx' (PATH)", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const existe = () => false;
    expect(executavelNpx({ plataforma: "win32", execPath, existe })).toBe(
      "npx",
    );
  });

  it("linux: sempre 'npx', mesmo com o arquivo existindo (nao e' o problema deste SO)", () => {
    const execPath = "/usr/local/bin/node";
    const existe = () => true;
    expect(executavelNpx({ plataforma: "linux", execPath, existe })).toBe(
      "npx",
    );
  });
});

// Tarefa A11f: medido pela hub em 10/09/2026 (loja real) -- `cp` com <src>
// ABSOLUTO de Windows (com "C:/..." ou "C:\\...") falha SEMPRE porque o CLI
// le "C:" como esquema de URL (LegacyStorageUnsupportedOperationError,
// "Unsupported operation"); com <src> RELATIVO ao cwd (o proprio diretorio
// do arquivo), o upload funciona. `montarChamadaCp` e' a funcao pura que
// monta { cwd, partes } sem rede, para o teste comparar contra o MESMO
// comando que `subir()` manda ao CLI de verdade.
describe("montarChamadaCp", () => {
  it("cwd = pasta do objeto no kit, <src> = basename relativo (sem ':' nem barra do arquivo absoluto)", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const kit = await lerKit(kitRoot, "ikcous");
    const header = kit.objetos.get(kit.assets.header.path);
    if (!header) throw new Error("fixture sem header");
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const existe = (caminho: string) =>
      caminho === "C:\\Program Files\\nodejs\\npx.cmd";
    const workdir = path.join(dir, "workdir");
    const { cwd, partes } = montarChamadaCp(header, {
      plataforma: "win32",
      execPath,
      existe,
      workdir,
    });
    expect(cwd).toBe(path.dirname(header.arquivo));
    expect(partes).toEqual([
      "C:\\Program Files\\nodejs\\npx.cmd",
      "supabase",
      "storage",
      "cp",
      path.basename(header.arquivo),
      `ss:///branding/${header.path}`,
      "--content-type",
      header.mime,
      "--cache-control",
      "max-age=31536000",
      "--linked",
      "--experimental",
      "--workdir",
      workdir,
    ]);
    // mutante: <src> absoluto (o caminho inteiro do arquivo, com
    // drive/barra) derruba este teste -- e' exatamente o que falhava na
    // loja real.
    expect(partes.some((p) => p === header.arquivo)).toBe(false);
    expect(partes[4]).not.toContain(":");
    expect(partes[4]).not.toMatch(/[\\/]/);
  });
});

describe("principal (lancador)", () => {
  it("dry-run bootstrap: exit 0, nenhuma porta de escrita chamada", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const valoresPath = await prepararValores();
    const f = portasFalsas(linhaNula);
    const { exit, logs } = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
      ],
      envFalso(),
      f,
    );
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(
      f.chamadas.filter(
        (c) =>
          c.startsWith("subir") || c === "gravar" || c.startsWith("remover"),
      ),
    ).toEqual([]);
    expect(logs.some((l) => l.includes('"acao": "bootstrap"'))).toBe(true);
  });

  it("--desfazer sem --aplicar: exit 0, banco NAO gravado (mutante 2 do revisor: aplicar fixo em true derruba isto)", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const kit = await lerKit(kitRoot, "ikcous");
    const desired = montarIdentidade(kit, valoresBase, SUPABASE_URL);
    // Banco ja com a identidade do kit (simula um --aplicar anterior) --
    // e' o estado que ESTADO em desfazer() exige para nao recusar.
    const f = portasFalsas({ revision: "1", identity: desired });
    const valoresPath = await prepararValores();
    const { exit } = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
        "--desfazer",
      ],
      envFalso(),
      f,
    );
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(f.chamadas).not.toContain("gravar");
    expect(canonico(f.linha().identity)).toBe(canonico(desired));
  });

  it("--aplicar --saida em diretorio inexistente: exit PROVA (6), banco gravado, stdout contem 'subidos' (B1)", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const valoresPath = await prepararValores();
    const f = portasFalsas(linhaNula);
    const saidaInexistente = path.join(dir, "pasta-que-nao-existe", "r.json");
    const { exit, logs } = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
        "--aplicar",
        "--saida",
        saidaInexistente,
      ],
      envFalso(),
      f,
    );
    expect(exit).toBe(CODIGOS_DE_SAIDA.prova);
    expect(f.chamadas).toContain("gravar");
    expect(f.linha().revision).not.toBe("0");
    expect(logs.some((l) => l.includes('"subidos"'))).toBe(true);
    await expect(fs.access(saidaInexistente)).rejects.toThrow();
  });

  it("--desfazer --aplicar --subidos com subconjunto remove so' esse subconjunto", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const kit = await lerKit(kitRoot, "ikcous");
    const desired = montarIdentidade(kit, valoresBase, SUPABASE_URL);
    const header = kit.objetos.get(kit.assets.header.path);
    if (!header) throw new Error("fixture sem header");
    const f = portasFalsas({ revision: "1", identity: desired });
    // Bucket ja com TODOS os objetos do kit (simula um bootstrap anterior
    // completo), --subidos referenciando so' o subconjunto que NAO e' o
    // header -- espelha o cenario da revisao A11b (objeto que outra
    // ferramenta ja tinha subido no mesmo path nunca pode ser apagado).
    for (const [p, objeto] of kit.objetos)
      f.bucket.set(p, {
        bytes: await fs.readFile(objeto.arquivo),
        mime: objeto.mime,
      });
    const subconjunto = [...kit.objetos.keys()].filter(
      (p) => p !== header.path,
    );
    const subidosPath = path.join(dir, "subidos.json");
    await fs.writeFile(subidosPath, JSON.stringify({ subidos: subconjunto }));
    const valoresPath = await prepararValores();
    const { exit } = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
        "--desfazer",
        "--aplicar",
        "--subidos",
        subidosPath,
      ],
      envFalso(),
      f,
    );
    expect(exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(f.bucket.has(header.path)).toBe(true);
    expect(f.bucket.size).toBe(1);
    expect(Object.values(f.linha().identity).every((v) => v === null)).toBe(
      true,
    );
  });

  it("nenhuma saida contem segredo, URL de conexao, chave nem o caminho absoluto do kit", async () => {
    await kitSintetico();
    const kitRoot = path.join(dir, "kit");
    const valoresPath = await prepararValores();
    const env = envFalso();

    // Cenario 1: B1 -- falha ao gravar --saida depois do banco ja gravado.
    const f1 = portasFalsas(linhaNula);
    const r1 = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
        "--aplicar",
        "--saida",
        path.join(dir, "outra-pasta-que-nao-existe", "r.json"),
      ],
      env,
      f1,
    );

    // Cenario 2: erro INESPERADO (nao BootstrapError) com uma URL de conexao
    // de verdade dentro da mensagem -- prova que o mascarar() do lancador
    // tambem cobre o catch generico ("inesperado"), nao so' o das portas
    // reais (ja provado no nucleo pela suite antiga).
    const f2 = portasFalsas(linhaNula);
    f2.portas.banco.ler = async () => {
      throw new Error(`conexao recusada: ${URL_DE_BANCO_FALSA_LONGA}`);
    };
    const r2 = await rodar(
      [
        "--kit",
        kitRoot,
        "--loja",
        "ikcous",
        "--valores",
        valoresPath,
        "--workdir-supabase",
        path.join(dir, "workdir"),
      ],
      env,
      f2,
    );

    const tudo = [...r1.logs, ...r1.errs, ...r2.logs, ...r2.errs].join("\n");
    expect(tudo).not.toContain("SENHA");
    expect(tudo).not.toContain("postgresql://");
    expect(tudo).not.toContain(ANON_KEY);
    // O caminho de --saida (fora do kit) pode aparecer na mensagem de erro
    // do B1 -- e' o texto real de ENOENT, previsto no proprio achado. O que
    // NUNCA pode vazar e' o caminho absoluto do KIT (que carrega
    // ObjetoDoKit.arquivo, filtrado por semArquivo em todo Relatorio).
    expect(tudo).not.toContain(kitRoot);
  });
});
