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
 * A primeira correção (06/08/2026) resolveu isso jogando fora o argumento e
 * chamando sempre `git rev-parse --git-path COMMIT_EDITMSG` — mas o hook
 * `commit-msg` não recebe sempre esse nome. Medido nesta mesma data:
 *
 *   git commit -m/-F/--amend  -> $1 = .../COMMIT_EDITMSG
 *   git merge --no-ff -m ".." -> $1 = .../MERGE_MSG   <- diverge
 *
 * Ignorando o argumento, um `git merge --no-ff -m "mensagem inválida"`
 * validava o COMMIT_EDITMSG do commit ANTERIOR (que já tinha passado no gate)
 * em vez do MERGE_MSG do merge em curso — reproduzido: o merge com mensagem
 * fora do padrão passava. Regressão consertada em 06/08/2026 (mesmo PR).
 *
 * A correção final volta a receber o argumento, mas em vez de usar o caminho
 * inteiro (que é o que quebra o shell), usa só o BASENAME do último elemento
 * de argv. O basename nunca tem espaço — git só nomeia este arquivo
 * COMMIT_EDITMSG, MERGE_MSG ou SQUASH_MSG — e não importa em quantos pedaços
 * o shell quebrou o caminho por causa dos espaços: como os separadores reais
 * (`\` ou `/`) não são espaço, eles nunca são o ponto de quebra, então o
 * ÚLTIMO fragmento de argv sempre termina no basename verdadeiro. Passar esse
 * nome para `git rev-parse --git-path` deixa o próprio git reconstruir o
 * caminho absoluto certo — dentro de worktree ou fora dele.
 *
 * Sem argumento nenhum (uso manual, fora do hook), o fallback continua sendo
 * COMMIT_EDITMSG.
 *
 * Falha fechada: se o caminho resolvido não apontar para um arquivo que
 * existe, o script sai com erro em vez de deixar o commitlint "passar" sem
 * ter lido mensagem nenhuma — foi exatamente essa aprovação silenciosa que
 * caracterizou a regressão do parágrafo acima.
 *
 * O CLI é invocado pelo arquivo (`cli.js`) em vez de `npx` porque `npx` no
 * Windows é um .cmd e reintroduziria o mesmo problema de citação.
 *
 * Uso: node scripts/commitlint-mensagem.mjs [caminho-da-mensagem]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Último fragmento de um caminho, sem depender de qual `path` (win32/posix)
 * o processo usaria — os separadores possíveis são só `\` e `/`. */
function basename(caminho) {
  const partes = caminho.split(/[\\/]/);
  return partes[partes.length - 1];
}

const argumentos = process.argv.slice(2);
const nomeArquivo =
  argumentos.length > 0
    ? basename(argumentos[argumentos.length - 1])
    : "COMMIT_EDITMSG";

const caminhoMensagem = execFileSync(
  "git",
  ["rev-parse", "--git-path", nomeArquivo],
  { encoding: "utf8" },
).trim();

if (!existsSync(caminhoMensagem)) {
  console.error(
    `commitlint-mensagem: arquivo de mensagem não encontrado (${nomeArquivo} -> ${caminhoMensagem}).`,
  );
  process.exit(1);
}

const cli = require.resolve("@commitlint/cli/cli.js");

const resultado = spawnSync(
  process.execPath,
  [cli, "--edit", caminhoMensagem],
  { stdio: "inherit" },
);

process.exit(resultado.status ?? 1);
