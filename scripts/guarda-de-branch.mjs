#!/usr/bin/env node
/**
 * Recusa commit e push direto em `main` e `develop`.
 *
 * Por que em Node e não em shell: o `run:` multilinha do lefthook é repassado
 * para shells diferentes em cada sistema. No Git Bash do Windows o
 * `$(git rev-parse ...)` foi quebrado em pedaços e o hook falhou com
 * "unexpected EOF" — ou seja, reprovava por acidente, não pela regra.
 * Node já é pré-requisito do projeto e se comporta igual nos três sistemas.
 *
 * Uso: node scripts/guarda-de-branch.mjs <commit|push>
 *
 * Esta é a única trava contra escrita direta em main/develop: branch protection
 * do GitHub retorna 403 em repositório privado no plano Free. Ver a seção
 * "A trava que não existe" do CONTRIBUTING.md.
 */

import { execFileSync } from "node:child_process";

const PROTEGIDAS = ["main", "develop"];
const acao = process.argv[2] === "push" ? "push" : "commit";

let branch;
try {
  branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // Sem branch resolvível (rebase, detached HEAD, repo recém-criado).
  // Não é o caso que este hook existe para pegar; deixa passar.
  process.exit(0);
}

if (!PROTEGIDAS.includes(branch)) {
  process.exit(0);
}

const verbo = acao === "push" ? "Push direto" : "Commit direto";
const prefixo = acao === "push" ? "fix" : "feat";

process.stderr.write(
  [
    "",
    `  ${verbo} em '${branch}' recusado.`,
    "",
    "  main    = o que está no ar. Só entra por PR de release ou de hotfix.",
    "  develop = integração. Só entra por PR.",
    "",
    "  Caminho certo:",
    `    git switch -c ${prefixo}/<assunto> develop`,
    `    git push -u origin ${prefixo}/<assunto>`,
    "    gh pr create --base develop",
    "",
    "  Se você já commitou em cima da branch errada, nada foi perdido:",
    `    git branch ${prefixo}/<assunto>      # salva o trabalho`,
    `    git reset --hard origin/${branch}    # devolve a branch protegida`,
    `    git switch ${prefixo}/<assunto>`,
    "",
    "  Este hook é local e some com --no-verify. Ele não é uma garantia:",
    "  é um lembrete que funciona. Ver CONTRIBUTING.md.",
    "",
  ].join("\n"),
);

process.exit(1);
