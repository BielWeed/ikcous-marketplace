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

function falhaDeEtapa(etapa, retorno = {}) {
  if (!ETAPAS.has(etapa)) return new Error("Falha inesperada.");
  const codigo = retorno.error?.code ?? retorno.code;
  const diagnostico = {
    etapa,
    status: Number.isSafeInteger(retorno.status) ? retorno.status : null,
    codigo: CODIGOS.has(codigo) ? codigo : null,
    sinal: SINAIS.has(retorno.signal) ? retorno.signal : null,
  };
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
        url,
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
