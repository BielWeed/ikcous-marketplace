#!/usr/bin/env node
/**
 * Roda o commitlint na mensagem do commit em andamento.
 *
 * Por que em Node e não `npx commitlint --edit {1}` direto no lefthook.yml —
 * mesmo motivo do guarda-de-branch.mjs: o `run:` do lefthook é repassado a um
 * shell, e no Git Bash do Windows o argumento é quebrado nos espaços.
 *
 * O caminho deste projeto tem espaços ("software Gerenciador ecossistema
 * ikcous") e, dentro de um `git worktree`, o git passa o COMMIT_EDITMSG como
 * caminho ABSOLUTO — num clone normal ele é o relativo `.git/COMMIT_EDITMSG`,
 * sem espaço nenhum, e por isso o bug nunca apareceu na raiz. Medido em
 * 06/08/2026, dentro de um worktree:
 *
 *   npx commitlint --edit {1}    -> "Unknown arguments: Gerenciador, ..."
 *   npx commitlint --edit "{1}"  -> ENOENT em 'C:\\Users\\Gabriel\\...\\software'
 *   $(git rev-parse --git-path)  -> "unexpected EOF while looking for `)'"
 *
 * Nos três casos o hook recusava o commit por acidente, não pela regra — e
 * empurrava quem trabalha em worktree para o `--no-verify`, que é exatamente o
 * que ele deveria impedir.
 *
 * Aqui o caminho é resolvido pelo próprio git e entregue como um elemento de
 * argv, sem shell no meio. O CLI é invocado pelo arquivo (`cli.js`) em vez de
 * `npx` porque `npx` na Windows é um .cmd e reintroduziria o mesmo problema de
 * citação.
 *
 * Uso: node scripts/commitlint-mensagem.mjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const caminhoMensagem = execFileSync(
  "git",
  ["rev-parse", "--git-path", "COMMIT_EDITMSG"],
  { encoding: "utf8" },
).trim();

const cli = require.resolve("@commitlint/cli/cli.js");

const resultado = spawnSync(
  process.execPath,
  [cli, "--edit", caminhoMensagem],
  { stdio: "inherit" },
);

process.exit(resultado.status ?? 1);
