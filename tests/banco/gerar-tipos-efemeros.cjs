"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { isAbsolute, join } = require("node:path");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const CLI = "2.121.0";
const MAX_BUFFER = 4 * 1024 * 1024;

function gerarTiposEfemeros() {
  // A guarda compartilhada é sempre a primeira operação, inclusive antes do fs.
  const url = lerDatabaseUrlEfemera();
  const { CI, GITHUB_SHA, RUNNER_TEMP, PATH } = process.env;
  if (
    CI !== "true" ||
    !/^[a-f0-9]{40}$/i.test(GITHUB_SHA || "") ||
    !RUNNER_TEMP ||
    !isAbsolute(RUNNER_TEMP)
  ) {
    throw new Error(
      "RECUSADO: exige CI, SHA completo e pasta temporária absoluta.",
    );
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
  } catch {
    throw new Error("Falha ao executar o gerador de tipos efêmeros.");
  }
  if (resultado.error || resultado.status !== 0 || resultado.signal) {
    // Nunca anexar error.message, stdout ou stderr: podem conter a conexão.
    throw new Error("CLI de tipos efêmeros falhou ou excedeu seus limites.");
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
    throw new Error(
      "Saída de tipos inválida: Database e RPCs do caixa são obrigatórios.",
    );
  }

  const metadata = {
    sha: GITHUB_SHA,
    schema: "public",
    cli: CLI,
    sha256: createHash("sha256").update(tipos, "utf8").digest("hex"),
  };
  const pasta = join(RUNNER_TEMP, "tipos-efemeros");
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
  return metadata;
}

module.exports = { gerarTiposEfemeros };

if (require.main === module) {
  try {
    gerarTiposEfemeros();
  } catch {
    console.error(
      "Geração de tipos efêmeros recusada ou malsucedida; nenhum upload autorizado.",
    );
    process.exitCode = 1;
  }
}
