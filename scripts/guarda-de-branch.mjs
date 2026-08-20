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
 *
 * ──────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU EM 20/08/2026, e por quê (varredura de falha aberta, achado 3)
 *
 * Até esta data o guarda lia `git rev-parse --abbrev-ref HEAD` nos DOIS modos
 * — ou seja, media o nome do branch que está checked out. Só que o destino de
 * um push não é o branch local. Reproduzido num repositório descartável:
 *
 *   push estando EM develop ................... recusado, exit 1
 *   git push origin HEAD:develop de feat/x .... ACEITO, exit 0
 *
 * E o push disfarçado ainda levou junto o commit que o guarda tinha recusado
 * no primeiro cenário. A trava existia e apontava para o lado errado.
 *
 * O git entrega o destino real pelo STDIN do hook `pre-push`, uma linha por
 * ref sendo empurrada:
 *
 *   <local ref> SP <local sha1> SP <remote ref> SP <remote sha1> LF
 *
 * É o `remote ref` que decide. Ele também é o único jeito de pegar
 * `git push origin :develop` (apagar a branch protegida remota), que o sinal
 * antigo não via de forma nenhuma.
 *
 * PARA ISSO FUNCIONAR SOB O LEFTHOOK, o job precisa de `use_stdin: true` no
 * lefthook.yml — sem essa chave o lefthook não repassa o stdin do git. A
 * documentação do lefthook 2.x avisa junto que, se VÁRIOS jobs do mesmo hook
 * pedirem `use_stdin`, só um recebe os dados; por isso a chave vai só no job
 * `guarda-de-branch`, nunca também no `typecheck`.
 *
 * COMO ELE FALHA, quando não consegue ler o destino: volta ao sinal antigo
 * (o branch local) e IMPRIME que não mediu o destino. Não é uma aprovação
 * silenciosa — foi exatamente a aprovação silenciosa que criou este defeito.
 * Recusar todo push porque o stdin não veio seria pior que o problema: este
 * hook é um lembrete local, e um lembrete que trava o trabalho é desligado.
 *
 * NOTA DE ALCANCE, deliberada: no modo `push` quem manda é o destino. Então
 * `git push origin develop:feat/x` — estar EM develop e empurrar para uma
 * feature branch — passa a ser aceito, e deve mesmo: não escreve em branch
 * protegida nenhuma. O modo `commit` continua olhando o branch local, porque
 * commit não tem destino.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PROTEGIDAS = ["main", "develop"];

/** Tempo máximo esperando o stdin do hook. Ver `lerStdin`. */
const TIMEOUT_STDIN_MS = 2000;

/**
 * Extrai, do stdin do `pre-push`, os nomes de branch PROTEGIDA que estão sendo
 * escritas — na ordem em que aparecem, sem repetir.
 *
 * Cada linha é `<local ref> <local sha> <remote ref> <remote sha>`. Só o
 * terceiro campo interessa. Numa deleção o primeiro campo vira `(delete)` e os
 * shas viram zeros, mas o terceiro continua dizendo o que vai ser apagado.
 *
 * A comparação é do NOME INTEIRO, nunca por prefixo: `developer`,
 * `main-antiga` e `feat/develop` não podem ser confundidos com as protegidas.
 * Aceita tanto `refs/heads/develop` quanto `develop` cru.
 */
export function refsProtegidosNoPush(stdin, protegidas = PROTEGIDAS) {
  const achados = [];
  for (const linha of String(stdin ?? "").split("\n")) {
    const campos = linha.trim().split(/\s+/);
    if (campos.length < 3) continue;
    const remoteRef = campos[2];
    if (!remoteRef) continue;
    // Só branch. `refs/tags/...` e `refs/notes/...` não são o alvo desta trava.
    if (remoteRef.startsWith("refs/") && !remoteRef.startsWith("refs/heads/")) {
      continue;
    }
    const nome = remoteRef.replace(/^refs\/heads\//, "");
    if (protegidas.includes(nome) && !achados.includes(nome)) {
      achados.push(nome);
    }
  }
  return achados;
}

/**
 * Lê o stdin inteiro, ou devolve `null` quando não há stdin para ler.
 *
 * `null` significa "não consegui medir o destino" e é diferente de `""`, que
 * seria "li e não veio nada". Quem chama trata os dois como falta de destino,
 * mas a distinção existe para o dia em que alguém precisar depurar isto.
 *
 * Dois cuidados, os dois medidos:
 * - `isTTY` corta o caso do terminal e o do pseudo-TTY que o lefthook usa
 *   quando `use_stdin` não está ligado. Sem esse corte a leitura fica pendurada.
 * - O timeout é a rede de segurança para um cano que abre e nunca fecha. Um
 *   hook que trava o `git push` é pior do que um hook que mede menos.
 */
function lerStdin() {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let dados = "";
    let terminou = false;
    const fim = (valor) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      resolve(valor);
    };
    const relogio = setTimeout(() => fim(dados === "" ? null : dados), TIMEOUT_STDIN_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (pedaco) => {
      dados += pedaco;
    });
    process.stdin.on("end", () => fim(dados));
    process.stdin.on("error", () => fim(null));
  });
}

/** O branch checked out, ou `null` se o git não souber dizer. */
function branchLocal() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // Sem branch resolvível (rebase, detached HEAD, repo recém-criado).
    return null;
  }
}

function recusar(alvos, acao) {
  const verbo = acao === "push" ? "Push direto" : "Commit direto";
  const prefixo = acao === "push" ? "fix" : "feat";
  const alvo = alvos.join("' e '");
  const primeiro = alvos[0];

  process.stderr.write(
    [
      "",
      `  ${verbo} em '${alvo}' recusado.`,
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
      `    git reset --hard origin/${primeiro}    # devolve a branch protegida`,
      `    git switch ${prefixo}/<assunto>`,
      "",
      "  Este hook é local e some com --no-verify. Ele não é uma garantia:",
      "  é um lembrete que funciona. Ver CONTRIBUTING.md.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  const acao = process.argv[2] === "push" ? "push" : "commit";

  if (acao === "push") {
    const stdin = await lerStdin();
    const protegidosNoDestino = stdin ? refsProtegidosNoPush(stdin) : [];

    if (protegidosNoDestino.length > 0) recusar(protegidosNoDestino, "push");

    // Leu o destino e ele está limpo: acabou. Nada de olhar o branch local
    // aqui — `git push origin develop:feat/x` não escreve em protegida.
    if (stdin !== null && stdin.trim() !== "") process.exit(0);

    // Não veio destino. Volta ao sinal antigo, mas DIZ que voltou.
    process.stderr.write(
      [
        "",
        "  guarda-de-branch: não consegui ler o DESTINO deste push.",
        "  Conferindo só o branch local, que é um sinal mais fraco —",
        "  `git push origin HEAD:develop` NÃO é pego por este caminho.",
        "",
        "  Para ligar a checagem de destino, o job `guarda-de-branch` do",
        "  `pre-push` no lefthook.yml precisa de `use_stdin: true`.",
        "",
      ].join("\n"),
    );
  }

  const branch = branchLocal();
  if (branch === null) process.exit(0);
  if (!PROTEGIDAS.includes(branch)) process.exit(0);
  recusar([branch], acao);
}

// Só executa quando chamado como programa. Sem este guarda, importar o módulo
// num teste dispara o `process.exit(0)` do caminho feliz e a suíte inteira
// termina com "0 passed" — que é verde, e não prova nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
