/**
 * O bash que os testes de workflow usam — o mesmo bloco, no Windows e no
 * Linux (#677).
 *
 * O DEFEITO QUE ESTE HELPER FECHA: no Windows, o `bash` que o PATH entrega
 * a `new Deno.Command("bash", …)` pode ser o do WSL
 * (C:\Windows\System32\bash.exe), e ele não serve para rodar os blocos que
 * estes testes medem:
 *
 *   - o caminho temporário do Windows (`C:\Users\…\bloco.sh`) chega SEM
 *     conversão, e o WSL não enxerga `C:\…`;
 *   - o PATH montado com `:` juntando caminhos do Windows vira uma string
 *     que nenhum dos dois bash entende;
 *   - e as variáveis de ambiente do processo NÃO atravessam a fronteira do
 *     WSL: medido em 28/09/2026, com PROJETO=loja no env do Deno.Command o
 *     bloco morria em `::error::projeto desconhecido:  (use loja ou
 *     sandbox)` — a variável chegou VAZIA lá dentro.
 *
 * O bash do Git for Windows (MSYS) resolve os três: recebe caminho POSIX
 * convertido na mão, converte o PATH de `;` para `:` sozinho ao iniciar e
 * herda o ambiente do processo pai. E ele existe em toda máquina onde
 * `git` existe — o helper o acha a partir de `git --exec-path`, sem
 * depender da ordem do PATH (que é justamente o que está quebrado).
 *
 * No Linux nada muda: `bash` é o bash do runner do CI, caminho é caminho e
 * PATH é PATH. Identidade.
 */

/** Onde o bash escolhido foi guardado após a primeira procura (Windows). */
let bashEncontrado: string | undefined;

/**
 * O executável de bash para `new Deno.Command(…)`: o caminho ABSOLUTO do
 * bash do Git for Windows no Windows, e `"bash"` no Linux. Absoluto de
 * propósito: é a ordem do PATH que decide entre o bash do Git e o do WSL,
 * e confiar nela é o defeito.
 */
export function bashMultiplataforma(): string {
  if (Deno.build.os !== "windows") return "bash";
  if (!bashEncontrado) bashEncontrado = acharBashDoGitForWindows();
  return bashEncontrado;
}

/**
 * `git --exec-path` devolve p.ex. `C:/Program Files/Git/mingw64/libexec/
 * git-core`. O bash mora na RAIZ da instalação, em `bin/bash.exe` (o
 * launcher que prepara o ambiente) ou em `usr/bin/bash.exe` (o bash de
 * verdade). Sobe-se da pasta do git-core até achar uma raiz que tenha um
 * deles — cobre o Git instalado em Program Files, portable e o vendido
 * junto com outras ferramentas.
 *
 * O caminho devolvido é o WINDOWS (com barra normal, `C:/…`): é o Deno que
 * recebe e executa — `Deno.statSync`/`Deno.Command` não entendem a forma
 * `/c/…` do MSYS. A forma POSIX é só para o que entra DENTRO do bash
 * (argumento de script, variável de ambiente), que é o papel de
 * `caminhoPosix`.
 */
function acharBashDoGitForWindows(): string {
  let execPath: string;
  try {
    const git = new Deno.Command("git", {
      args: ["--exec-path"],
      stdout: "piped",
      stderr: "piped",
    });
    const saida = git.outputSync();
    execPath = new TextDecoder().decode(saida.stdout).trim();
    if (!execPath) throw new Error(String(saida.code));
  } catch {
    throw new Error(
      "não deu para achar o bash do Git for Windows: `git --exec-path` " +
        "falhou. O teste precisa de um `git` (e do bash que vem com ele) " +
        "no PATH do Windows.",
    );
  }

  let dir = execPath.replaceAll("\\", "/");
  for (let sobe = 0; sobe < 4; sobe++) {
    const fim = dir.lastIndexOf("/");
    if (fim <= 0) break;
    dir = dir.slice(0, fim);
    for (const relativo of ["bin/bash.exe", "usr/bin/bash.exe"]) {
      const candidato = `${dir}/${relativo}`;
      try {
        if (Deno.statSync(candidato).isFile) return candidato;
      } catch {
        // este candidato não existe: tenta o próximo
      }
    }
  }
  throw new Error(
    `bash do Git for Windows não achado a partir de \`git --exec-path\` (${execPath}): esperava <raiz>/bin/bash.exe ou <raiz>/usr/bin/bash.exe.`,
  );
}

/**
 * Caminho na forma que o bash escolhido entende: `C:\a\b` (ou `C:/a/b`)
 * vira `/c/a/b` no Windows; no Linux é identidade. Serve para argumento de
 * script (`bash /c/…/bloco.sh`), para variável usada em redirecionamento
 * (`>> "$CHAMADAS"`) e para montar diretório de trabalho.
 */
export function caminhoPosix(caminho: string): string {
  if (Deno.build.os !== "windows") return caminho;
  let posix = caminho.replaceAll("\\", "/");
  // `C:/a/b` -> `/c/a/b`, com a letra minúscula, que é como o bash do Git
  // nomeia as unidades. UNC (`\\servidor\compartilhamento`) já vira
  // `//servidor/compartilhamento` no replace e fica como está.
  posix = posix.replace(
    /^([A-Za-z]):/,
    (_completo, letra: string) => `/${letra.toLowerCase()}`,
  );
  return posix;
}

/**
 * Um PATH para o bash escolhido: os diretórios dados na frente do PATH
 * atual. No Windows ele é montado no formato NATIVO (`;` e caminhos do
 * Windows) porque o bash do Git for Windows converte o PATH inteiro para
 * POSIX ao iniciar; juntar com `:` aqui é misturar os dois mundos e
 * entregar uma string inútil. No Linux, `:` — exatamente o que os testes
 * já faziam.
 */
export function montarPath(...naFrente: string[]): string {
  const atual = Deno.env.get("PATH") ?? "";
  const separador = Deno.build.os === "windows" ? ";" : ":";
  return [...naFrente, atual].join(separador);
}
