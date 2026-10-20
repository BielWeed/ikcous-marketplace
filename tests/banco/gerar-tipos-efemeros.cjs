"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { isAbsolute, join } = require("node:path");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const CLI = "2.121.0";
const MAX_BUFFER = 4 * 1024 * 1024;
const ETAPAS = new Set([
  "GUARDA_AMBIENTE",
  "SPAWN",
  "RETORNO_CLI",
  "VALIDACAO_SAIDA",
  "ESCRITA",
]);
const CODIGOS = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ETIMEDOUT",
  "ENOBUFS",
  "ENOMEM",
  "EINVAL",
  "ENOSPC",
  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
]);
const SINAIS = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"]);
// Só mensagens criadas aqui podem atravessar o catch CLI; prefixo não é prova.
const diagnosticos = new WeakMap();

const CAUSAS_NPM = new Map([
  ["E404", "NPM_E404"],
  ["ETARGET", "NPM_ETARGET"],
  ["ENOTFOUND", "NPM_ENOTFOUND"],
  ["EAI_AGAIN", "NPM_EAI_AGAIN"],
  ["ECONNRESET", "NPM_ECONNRESET"],
  ["EINTEGRITY", "NPM_EINTEGRITY"],
  ["EBADPLATFORM", "NPM_EBADPLATFORM"],
  ["ENOSPC", "NPM_ENOSPC"],
  ["EACCES", "NPM_EACCES"],
]);
const PADROES_LAUNCHER = [
  [
    /No matching Supabase CLI binary package found|Unsupported (platform|architecture)/,
    "LAUNCHER_SEM_PACOTE",
  ],
  [/\bspawn\b[^\r\n]*\bEACCES\b/i, "LAUNCHER_SPAWN_EACCES"],
  [/\bspawn\b[^\r\n]*\bENOENT\b/i, "LAUNCHER_SPAWN_ENOENT"],
  [/\bspawn\b[^\r\n]*\bENOEXEC\b/i, "LAUNCHER_SPAWN_ENOEXEC"],
];
const PADROES_CLI = [
  [/supabase start is not running/i, "CLI_LOCAL_NAO_RODANDO"],
  [/failed to generate types|error generating types/i, "CLI_GERACAO"],
  [/unknown (option|flag)|invalid (option|flag)/i, "CLI_FLAG"],
  [/ssl|tls|certificate/i, "DB_TLS"],
  [/ECONNREFUSED|connection refused/i, "DB_RECUSADA"],
  [/ETIMEDOUT|timed? out/i, "DB_TIMEOUT"],
  [/ENOTFOUND|EAI_AGAIN/i, "DB_DNS"],
  [/password authentication failed|\b28P01\b/i, "DB_AUTH"],
  [/\b42P01\b/, "SQLSTATE_42P01"],
  [/\b42883\b/, "SQLSTATE_42883"],
  [/\b42501\b/, "SQLSTATE_42501"],
  [/\b3F000\b/, "SQLSTATE_3F000"],
  [/\b42704\b/, "SQLSTATE_42704"],
];

function classificarStderr(stderr) {
  const texto = typeof stderr === "string" ? stderr : "";
  const causas = new Set();
  const npm = /^npm (error|ERR!)/m.test(texto);
  const chegouConexao = /^Connecting to /m.test(texto);
  if (
    /^npm (?:error|ERR!) could not determine executable to run/m.test(texto)
  ) {
    causas.add("NPM_SEM_EXECUTAVEL");
  }
  for (const linha of texto.matchAll(
    /^npm (?:error|ERR!) (?:code (\S+)|(E[A-Z0-9_]+)\b)/gm,
  )) {
    causas.add(CAUSAS_NPM.get(linha[1] ?? linha[2]) ?? "NPM_OUTRO");
  }
  let launcher = false;
  for (const [padrao, causa] of PADROES_LAUNCHER) {
    if (padrao.test(texto)) {
      launcher = true;
      causas.add(causa);
    }
  }
  let cli = chegouConexao;
  for (const [padrao, causa] of PADROES_CLI) {
    if (padrao.test(texto)) {
      cli = true;
      causas.add(causa);
    }
  }
  if (!causas.size) causas.add("OUTRO");
  return {
    camada: npm ? "NPM" : launcher ? "LAUNCHER" : cli ? "CLI" : "DESCONHECIDA",
    chegou_conexao: chegouConexao,
    loopback_v6: texto.includes("::1"),
    causas: [...causas].sort(),
  };
}

function falhaDeEtapa(etapa, retorno = {}) {
  if (!ETAPAS.has(etapa)) return new Error("Falha inesperada.");
  const codigo = retorno.error?.code ?? retorno.code;
  const diagnostico = {
    etapa,
    status: Number.isSafeInteger(retorno.status) ? retorno.status : null,
    codigo: CODIGOS.has(codigo) ? codigo : null,
    sinal: SINAIS.has(retorno.signal) ? retorno.signal : null,
  };
  if (etapa === "RETORNO_CLI") {
    Object.assign(diagnostico, classificarStderr(retorno.stderr));
  }
  const mensagem = `TIPOS_EFEMEROS ${JSON.stringify(diagnostico)}`;
  const erro = new Error(mensagem);
  diagnosticos.set(erro, mensagem);
  return erro;
}

function gerarTiposEfemeros() {
  const erroGuarda = falhaDeEtapa("GUARDA_AMBIENTE");
  const relatar = console.error;
  let url;
  try {
    // A guarda é síncrona e usa process.exit. Seu diagnóstico original inclui
    // hostname: trocar só a impressão impede vazar entrada até nessa saída direta.
    console.error = () => relatar(diagnosticos.get(erroGuarda));
    url = lerDatabaseUrlEfemera();
  } catch {
    throw erroGuarda;
  } finally {
    console.error = relatar;
  }
  const { CI, GITHUB_SHA, RUNNER_TEMP, PATH } = process.env;
  if (
    CI !== "true" ||
    !/^[a-f0-9]{40}$/i.test(GITHUB_SHA || "") ||
    !RUNNER_TEMP ||
    !isAbsolute(RUNNER_TEMP)
  ) {
    throw erroGuarda;
  }

  // CLI 2.121.0: URL sem sslmode que não é da pilha local exige TLS (sem queda para texto
  // puro). O Postgres efêmero do CI (loopback, já validado acima) não oferece TLS.
  const urlCli = new URL(url);
  urlCli.searchParams.set("sslmode", "disable");

  let resultado;
  try {
    resultado = spawnSync(
      "npx",
      [
        "--yes",
        `--package=supabase@${CLI}`,
        "supabase",
        "gen",
        "types",
        "--lang",
        "typescript",
        "--schema",
        "public",
        "--db-url",
        urlCli.toString(),
      ],
      {
        shell: false,
        timeout: 120000,
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
        cwd: RUNNER_TEMP,
        // Runner Linux: nem projeto linkado/.env nem npmrc/home do checkout.
        // Allowlist deliberada: tokens, NODE_OPTIONS e configuração npm não entram.
        env: {
          PATH,
          CI: "true",
          HOME: RUNNER_TEMP,
          TMPDIR: RUNNER_TEMP,
          npm_config_cache: join(RUNNER_TEMP, ".npm"),
          npm_config_userconfig: "/dev/null",
        },
      },
    );
  } catch (erro) {
    throw falhaDeEtapa("SPAWN", erro);
  }
  if (resultado.error || resultado.status !== 0 || resultado.signal) {
    throw falhaDeEtapa("RETORNO_CLI", resultado);
  }
  const tipos = resultado.stdout;
  if (
    typeof tipos !== "string" ||
    !tipos.trim() ||
    Buffer.byteLength(tipos, "utf8") > MAX_BUFFER ||
    !/export type Database\s*=/.test(tipos) ||
    !/\bfin_caixa_fechar_sessao\s*:/.test(tipos) ||
    !/\bfin_caixa_movimentar_com_chave\s*:/.test(tipos)
  ) {
    throw falhaDeEtapa("VALIDACAO_SAIDA", resultado);
  }

  const metadata = {
    sha: GITHUB_SHA,
    schema: "public",
    cli: CLI,
    sha256: createHash("sha256").update(tipos, "utf8").digest("hex"),
  };
  const pasta = join(RUNNER_TEMP, "tipos-efemeros");
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- RUNNER_TEMP absoluto do Actions, com nome de saída constante.
    fs.mkdirSync(pasta, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Mesmo diretório temporário validado; nunca src/types.
    fs.writeFileSync(join(pasta, "database.types.ts"), tipos, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Metadata sem DSN no mesmo diretório do artefato.
    fs.writeFileSync(
      join(pasta, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  } catch (erro) {
    throw falhaDeEtapa("ESCRITA", erro);
  }
  return metadata;
}

module.exports = { gerarTiposEfemeros };

if (require.main === module) {
  try {
    gerarTiposEfemeros();
  } catch (erro) {
    console.error(
      diagnosticos.get(erro) ??
        "Geração de tipos efêmeros recusada ou malsucedida; nenhum upload autorizado.",
    );
    process.exitCode = 1;
  }
}
