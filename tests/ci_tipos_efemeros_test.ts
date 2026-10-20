// @ts-nocheck
// Sem rede, subprocesso ou escrita real: VM injeta só as fronteiras externas.
// Remover uma guarda, vazar ambiente ou aceitar saída inválida quebra estes controles.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { runInNewContext } = require("node:vm");
const { createHash } = require("node:crypto");
const path = require("node:path");
const fonte = Deno.readTextFileSync(
  new URL("./banco/gerar-tipos-efemeros.cjs", import.meta.url),
);
const guarda = Deno.readTextFileSync(
  new URL("./banco/efemero.cjs", import.meta.url),
);
const SHA = "0123456789abcdef0123456789abcdef01234567";
const URL_EFEMERA = "postgres://postgres:postgres@localhost:5432/postgres";
const TIPOS = `export type Database = {
  public: { Functions: {
    fin_caixa_fechar_sessao: { Args: { p_sessao_id: string }; Returns: unknown }
    fin_caixa_movimentar_com_chave: { Args: { p_chave: string }; Returns: unknown }
  } }
}
`;

function montar(
  alteracoes = {},
  resultado = { status: 0, stdout: TIPOS, stderr: "" },
  opcoes = {},
) {
  const env = {
    CI: "true",
    CI_BANCO_EFEMERO: "1",
    DATABASE_URL: URL_EFEMERA,
    GITHUB_SHA: SHA,
    RUNNER_TEMP: "/runner/temp",
    PATH: "/usr/bin",
    SUPABASE_ACCESS_TOKEN: "credencial-ficticia",
    SUPABASE_DB_PASSWORD: "nao-herdar",
    NODE_OPTIONS: "--require=nao-carregar",
    npm_config_registry: "https://nao-usar.invalid",
    ...alteracoes,
  };
  const chamadas = [];
  const gravados = new Map();
  const logs = [];
  const fs = {
    mkdirSync: (...args) => {
      if (opcoes.erroFs) throw opcoes.erroFs;
      chamadas.push(["mkdir", ...args]);
    },
    writeFileSync: (nome, texto) => {
      chamadas.push(["write", nome]);
      gravados.set(nome, texto);
    },
  };
  const processo = {
    env,
    exit: () => {
      throw new Error("RECUSADO");
    },
  };
  const consoleMudo = { error: (...args) => logs.push(args.join(" ")) };
  const moduloGuarda = { exports: {} };
  runInNewContext(guarda, {
    module: moduloGuarda,
    process: processo,
    console: consoleMudo,
    URL,
    require: () => fs,
  });
  const modulo = { exports: {} };
  const importar = (nome) => {
    if (nome === "./efemero.cjs")
      return {
        lerDatabaseUrlEfemera: () => {
          chamadas.push(["guarda"]);
          return moduloGuarda.exports.lerDatabaseUrlEfemera();
        },
      };
    if (nome === "node:fs") return fs;
    if (nome === "node:child_process")
      return {
        spawnSync: (...args) => {
          chamadas.push(["spawn", ...args]);
          if (resultado instanceof Error) throw resultado;
          return resultado;
        },
      };
    if (nome === "node:crypto")
      return {
        createHash: (...args) => {
          if (opcoes.erroHash) throw opcoes.erroHash;
          return createHash(...args);
        },
      };
    if (nome === "node:path") return path;
    throw new Error("Importação inesperada");
  };
  if (opcoes.entrada) importar.main = modulo;
  runInNewContext(fonte, {
    module: modulo,
    require: importar,
    process: processo,
    console: consoleMudo,
    URL,
    Buffer,
  });
  if (!opcoes.entrada)
    assertEquals(chamadas.length, 0, "importar não pode executar nem escrever");
  return {
    gerar: modulo.exports.gerarTiposEfemeros,
    chamadas,
    gravados,
    logs,
    processo,
  };
}

Deno.test("tipos efêmeros: recusa ambiente e host antes de qualquer efeito", () => {
  for (const alteracao of [
    { CI_BANCO_EFEMERO: "" },
    { DATABASE_URL: "postgres://fixture:fixture@banco.invalid/postgres" },
    {
      DATABASE_URL:
        "postgres://fixture:fixture@localhost.banco.invalid/postgres",
    },
    { DATABASE_URL: "postgresql://fixture:fixture@localhost/postgres" },
    { DATABASE_URL: "" },
    { CI: "" },
    { CI: "false" },
    { GITHUB_SHA: "" },
    { GITHUB_SHA: "a".repeat(39) },
    { GITHUB_SHA: "g".repeat(40) },
    { RUNNER_TEMP: "" },
    { RUNNER_TEMP: "relativo" },
  ]) {
    const caso = montar(alteracao);
    assertThrows(() => caso.gerar());
    assertEquals(
      caso.chamadas.map(([tipo]) => tipo),
      ["guarda"],
    );
    assertEquals(caso.gravados.size, 0);
    assert(!caso.logs.join("").includes("postgres://"));
  }
});

Deno.test("tipos efêmeros: comando fixado, sem shell nem credenciais herdadas", () => {
  const caso = montar();
  caso.gerar();
  assertEquals(caso.chamadas[0], ["guarda"]);
  const [, comando, argv, opcoes] = caso.chamadas[1];
  assertEquals(comando, "npx");
  assertEquals(Array.from(argv), [
    "--yes",
    "--package=supabase@2.121.0",
    "supabase",
    "gen",
    "types",
    "--lang",
    "typescript",
    "--schema",
    "public",
    "--db-url",
    URL_EFEMERA,
  ]);
  assertEquals(opcoes.shell, false);
  assert(opcoes.timeout > 0 && opcoes.timeout <= 120000);
  assert(opcoes.maxBuffer > 0 && opcoes.maxBuffer <= 4 * 1024 * 1024);
  assertEquals(opcoes.encoding, "utf8");
  assertEquals(opcoes.cwd, "/runner/temp");
  assertEquals(JSON.parse(JSON.stringify(opcoes.env)), {
    PATH: "/usr/bin",
    CI: "true",
    HOME: "/runner/temp",
    TMPDIR: "/runner/temp",
    npm_config_cache: path.join("/runner/temp", ".npm"),
    npm_config_userconfig: "/dev/null",
  });
});

Deno.test("tipos efêmeros: falha, timeout, vazio e RPC ausente não escrevem", () => {
  for (const resultado of [
    { status: 1, stdout: TIPOS, stderr: URL_EFEMERA },
    { status: null, stdout: TIPOS, signal: "SIGTERM" },
    { status: 0, stdout: TIPOS, error: new Error(URL_EFEMERA) },
    new Error(URL_EFEMERA),
    { status: 0, stdout: "" },
    { status: 0, stdout: "erro do CLI" },
    { status: 0, stdout: TIPOS.replace("export type Database", "type Outro") },
    { status: 0, stdout: TIPOS.replace("fin_caixa_fechar_sessao", "antiga") },
    {
      status: 0,
      stdout: TIPOS.replace("fin_caixa_movimentar_com_chave", "antiga"),
    },
  ]) {
    const caso = montar({}, resultado);
    const erro = assertThrows(() => caso.gerar());
    assert(!erro.message.includes(URL_EFEMERA));
    assertEquals(
      caso.chamadas.map(([tipo]) => tipo),
      ["guarda", "spawn"],
    );
    assertEquals(caso.gravados.size, 0);
    assertEquals(caso.logs, []);
  }
});

Deno.test("tipos efêmeros: sucesso preserva bytes e metadata amarra SHA e hash", () => {
  const caso = montar({}, { status: 0, stdout: TIPOS, stderr: URL_EFEMERA });
  caso.gerar();
  const pasta = path.join("/runner/temp", "tipos-efemeros");
  assertEquals(Array.from(caso.gravados.keys()), [
    path.join(pasta, "database.types.ts"),
    path.join(pasta, "metadata.json"),
  ]);
  assertEquals(caso.gravados.get(path.join(pasta, "database.types.ts")), TIPOS);
  const metadata = caso.gravados.get(path.join(pasta, "metadata.json"));
  assertEquals(JSON.parse(metadata), {
    sha: SHA,
    schema: "public",
    cli: "2.121.0",
    sha256: createHash("sha256").update(TIPOS).digest("hex"),
  });
  assert(!metadata.includes("postgres"));
  assertEquals(caso.logs, []);
});

const PAYLOAD = "DADO_SINTETICO_NAO_PUBLICAR";
const PREFIXO = "TIPOS_EFEMEROS ";

function diagnostico(mensagem) {
  assert(mensagem.startsWith(PREFIXO));
  assert(!mensagem.includes(PAYLOAD));
  assert(!mensagem.includes(URL_EFEMERA));
  return JSON.parse(mensagem.slice(PREFIXO.length));
}

Deno.test("diagnóstico: status 1 é retorno CLI, não validação de saída", () => {
  const caso = montar({}, { status: 1, stdout: PAYLOAD, stderr: PAYLOAD });
  const erro = assertThrows(() => caso.gerar());
  assertEquals(diagnostico(erro.message), {
    etapa: "RETORNO_CLI",
    status: 1,
    codigo: null,
    sinal: null,
  });
  assertEquals(caso.gravados.size, 0);
  const entrada = montar(
    {},
    { status: 1, stdout: PAYLOAD, stderr: PAYLOAD },
    { entrada: true },
  );
  assertEquals(entrada.processo.exitCode, 1);
  assertEquals(entrada.logs, [erro.message]);
  const invalido = montar({}, { status: 0, stdout: PAYLOAD, stderr: PAYLOAD });
  assertEquals(diagnostico(assertThrows(() => invalido.gerar()).message), {
    etapa: "VALIDACAO_SAIDA",
    status: 0,
    codigo: null,
    sinal: null,
  });
});

Deno.test("diagnóstico: códigos e sinais fora da lista nunca saem", () => {
  for (const [codigo, sinal, esperadoCodigo, esperadoSinal] of [
    ["ETIMEDOUT", "SIGTERM", "ETIMEDOUT", "SIGTERM"],
    ["ENOBUFS", "SIGKILL", "ENOBUFS", "SIGKILL"],
    [PAYLOAD, PAYLOAD, null, null],
    [URL_EFEMERA, URL_EFEMERA, null, null],
  ]) {
    const erro = Object.assign(new Error(PAYLOAD), { code: codigo });
    const caso = montar(
      {},
      { status: null, error: erro, signal: sinal, stderr: PAYLOAD },
      { entrada: true },
    );
    assertEquals(caso.processo.exitCode, 1);
    assertEquals(caso.logs.length, 1);
    assertEquals(diagnostico(caso.logs[0]), {
      etapa: "RETORNO_CLI",
      status: null,
      codigo: esperadoCodigo,
      sinal: esperadoSinal,
    });
  }
  const statusForjado = montar(
    {},
    { status: PAYLOAD, stdout: PAYLOAD },
    { entrada: true },
  );
  assertEquals(diagnostico(statusForjado.logs[0]).status, null);
});

Deno.test("diagnóstico: spawn, guarda, ambiente e escrita mantêm causa fechada", () => {
  const erro = Object.assign(new Error(PAYLOAD), { code: "ENOENT" });
  const spawn = montar({}, erro, { entrada: true });
  assertEquals(diagnostico(spawn.logs[0]), {
    etapa: "SPAWN",
    status: null,
    codigo: "ENOENT",
    sinal: null,
  });
  const escrita = montar(
    {},
    { status: 0, stdout: TIPOS, stderr: PAYLOAD },
    { entrada: true, erroFs: erro },
  );
  assertEquals(diagnostico(escrita.logs[0]), {
    etapa: "ESCRITA",
    status: null,
    codigo: "ENOENT",
    sinal: null,
  });
  for (const env of [
    { CI: "false" },
    { DATABASE_URL: PAYLOAD },
    { CI_BANCO_EFEMERO: "" },
  ]) {
    const caso = montar(env, undefined, { entrada: true });
    assertEquals(caso.processo.exitCode, 1);
    for (const log of caso.logs) {
      assertEquals(diagnostico(log).etapa, "GUARDA_AMBIENTE");
      assert(!log.includes(PAYLOAD));
      assert(!log.includes(URL_EFEMERA));
    }
    assertEquals(caso.gravados.size, 0);
  }
});

Deno.test("diagnóstico: erro inesperado com prefixo forjado continua genérico", () => {
  const erro = new Error(`${PREFIXO}${PAYLOAD}`);
  const caso = montar({}, undefined, { entrada: true, erroHash: erro });
  assertEquals(caso.processo.exitCode, 1);
  assertEquals(caso.logs, [
    "Geração de tipos efêmeros recusada ou malsucedida; nenhum upload autorizado.",
  ]);
});

Deno.test("RPC-CI: geração e upload dependem dos passos certos e gatilhos", () => {
  const texto = Deno.readTextFileSync(
    new URL("../.github/workflows/rpc-ci.yml", import.meta.url),
  );
  const passos = texto.split(/(?=^ {6}- )/m);
  const tipos = passos.find((p) => /^ {8}id: tipos$/m.test(p));
  assert(tipos, "passo tipos ausente");
  assertMatch(
    tipos,
    /if: \$\{\{ !cancelled\(\) && steps\.aplica\.outcome == 'success' \}\}/,
  );
  assertMatch(tipos, /run: node tests\/banco\/gerar-tipos-efemeros\.cjs/);
  const upload = passos[passos.indexOf(tipos) + 1];
  assertMatch(upload, /uses: actions\/upload-artifact@v7/);
  assertMatch(
    upload,
    /if: \$\{\{ !cancelled\(\) && steps\.tipos\.outcome == 'success' \}\}/,
  );
  assertMatch(upload, /name: tipos-public-\$\{\{ github\.sha \}\}/);
  assertMatch(upload, /path: \$\{\{ runner\.temp \}\}\/tipos-efemeros/);
  assertMatch(upload, /if-no-files-found: error/);
  assertMatch(upload, /retention-days: 1/);
  assert(passos.indexOf(tipos) > passos.findIndex((p) => /id: aplica/.test(p)));
  const gatilhos = texto.slice(
    texto.indexOf("\non:"),
    texto.indexOf("\nconcurrency:"),
  );
  for (const gatilho of gatilhos.split(/(?=^ {2}push:)/m)) {
    assert(gatilho.includes('"tests/banco/gerar-tipos-efemeros.cjs"'));
    assert(gatilho.includes('"tests/ci_tipos_efemeros_test.ts"'));
  }
});
