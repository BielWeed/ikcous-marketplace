// @ts-nocheck
/**
 * As duas chaves de topo que mantêm o hook de git FECHADO — lefthook.yml
 *
 * Cobre o que a medição de 20/08/2026 encontrou: o `pre-commit` gerado pelo
 * lefthook 2.1.10 é compartilhado por todos os `git worktree` (o
 * `core.hooksPath` de cada um aponta para o `.git/hooks` da árvore principal),
 * e o último ramo do shim fazia `echo "Can't find lefthook in PATH"` SEM
 * `exit 1`. Em 3 dos 5 worktrees, que não têm `node_modules` próprio, o
 * resultado era exit 0: a trava de secretlint estava desligada em silêncio, e
 * a mensagem passava por ruído no meio de uma saída de sucesso.
 *
 * Duas linhas consertam isso, e são exatamente as duas que estes testes
 * guardam:
 *
 *   - `lefthook: "$(git rev-parse --path-format=relative --git-common-dir)/../
 *     node_modules/.bin/lefthook"` resolve o binário pela árvore PRINCIPAL.
 *     `--show-toplevel`, que o shim usa por padrão, devolve a pasta do
 *     worktree e é justamente o que não acha nada lá dentro. E
 *     `--path-format=relative` não é enfeite: o lefthook emite este valor SEM
 *     aspas no shim, e o caminho absoluto deste projeto tem espaços.
 *     É ESTA chave que fecha a trava hoje, sozinha.
 *   - `assert_lefthook_installed: true` é a RESERVA. Ela põe `exit 1` no
 *     ramo final do shim — mas, medido em 20/08/2026, esse ramo é código
 *     MORTO enquanto a chave `lefthook:` existir: o lefthook a emite como
 *     `elif test -n <valor>/../node_modules/.bin/lefthook`, e essa string tem
 *     sufixo LITERAL, então `test -n` nela é SEMPRE verdadeiro. O `exit != 0`
 *     que se observa hoje vem do ramo 2 não achar o binário (127), NÃO do
 *     `assert_`. A chave fica porque volta a valer no dia em que a `lefthook:`
 *     sumir ou parar de resolver — não a credite pelo comportamento de hoje,
 *     e não a apague.
 *
 * Sem esta guarda, apagar as duas linhas não quebra nenhum teste e não deixa
 * rastro: o hook volta a aprovar commit com segredo e ninguém percebe até o
 * CI (ou até o segredo chegar ao remoto).
 *
 * A prova de comportamento de ponta a ponta é `npm run hooks:prova`; isto
 * aqui é só a guarda barata que roda em toda suíte.
 *
 * O terceiro bloco guarda uma chave que NÃO é de topo — o `use_stdin: true`
 * do job `guarda-de-branch` no `pre-push` — pelo mesmo motivo das outras
 * duas: apagá-la não quebra nada visível e o buraco volta calado.
 *
 * Mora em tests/ pelo mesmo motivo do truth_gate_test.ts.
 */
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const CAMINHO = new URL("../lefthook.yml", import.meta.url);
const TEXTO = await Deno.readTextFile(CAMINHO);
const CONFIG = parse(TEXTO) as Record<string, unknown>;

Deno.test("lefthook.yml mantém o hook falhando FECHADO", async (t) => {
  await t.step("assert_lefthook_installed está presente", () => {
    assert(
      Object.prototype.hasOwnProperty.call(CONFIG, "assert_lefthook_installed"),
      "a chave `assert_lefthook_installed` sumiu do lefthook.yml — ela é a " +
        "RESERVA que volta a valer se a chave `lefthook:` sumir ou parar de " +
        "resolver. Sem nenhuma das duas, o shim termina no echo final (o que " +
        "avisa que não achou o lefthook no PATH) SEM `exit 1`, e o git APROVA " +
        "o commit quando não acha o binário. " +
        "Hoje o ramo onde ela age é código morto: " +
        "não a credite pelo comportamento observável, e não a apague",
    );
  });

  await t.step("e vale `true`, não `false` nem string", () => {
    assertEquals(
      CONFIG.assert_lefthook_installed,
      true,
      "`assert_lefthook_installed` só VOLTA a fechar a trava valendo booleano true — e só no dia em que a chave `lefthook:` sumir. Hoje ela é reserva; quem fecha é a `lefthook:`",
    );
  });
});

Deno.test("lefthook.yml resolve o binário pela árvore principal", async (t) => {
  await t.step("a chave `lefthook` está presente", () => {
    assert(
      typeof CONFIG.lefthook === "string" && CONFIG.lefthook.length > 0,
      "a chave de topo `lefthook` sumiu — sem ela o shim cai no ramo do " +
        "`--show-toplevel`, que dentro de um worktree aponta para uma pasta " +
        "sem node_modules",
    );
  });

  await t.step("resolve por --git-common-dir", () => {
    assertStringIncludes(
      String(CONFIG.lefthook),
      "--git-common-dir",
      "`--git-common-dir` é o que aponta para o .git da árvore PRINCIPAL a " +
        "partir de qualquer worktree; trocar por outra coisa reabre o buraco",
    );
  });

  await t.step("pede o caminho RELATIVO", () => {
    assertStringIncludes(
      String(CONFIG.lefthook),
      "--path-format=relative",
      "sem esta flag o git devolve o caminho absoluto, que neste projeto tem " +
        "espaços; o lefthook emite o valor sem aspas no shim (`then <valor> " +
        '"$@"`), o shell quebra em palavras e o hook morre com exit 127 em ' +
        "TODO worktree",
    );
  });

  await t.step("não volta a usar --show-toplevel", () => {
    assert(
      !String(CONFIG.lefthook).includes("--show-toplevel"),
      "`--show-toplevel` devolve a pasta do worktree — é o defeito original",
    );
  });

  await t.step("aponta para o binário do lefthook em node_modules", () => {
    assertStringIncludes(String(CONFIG.lefthook), "node_modules/.bin/lefthook");
  });
});

// --------------------------------------------------------------------------
// O `use_stdin` do guarda de branch no pre-push
// --------------------------------------------------------------------------

/** Qualquer coisa que o schema do lefthook deixe pedir `use_stdin`. */
type Unidade = { nome: string; use_stdin?: unknown };

/**
 * Um job e, RECURSIVAMENTE, os jobs aninhados no `group:` dele.
 * Sem descer no `group`, um `use_stdin` posto lá dentro passa despercebido — e
 * o `lefthook validate` aprova esse arquivo (medido em 20/08/2026).
 */
function achata(jobs: unknown): Unidade[] {
  if (!Array.isArray(jobs)) return [];
  const unidades: Unidade[] = [];
  for (const job of jobs) {
    if (job === null || typeof job !== "object") continue;
    unidades.push({
      nome: String(job.name ?? "(sem nome)"),
      use_stdin: job.use_stdin,
    });
    unidades.push(...achata(job.group?.jobs));
  }
  return unidades;
}

/**
 * Tudo que aceita `use_stdin` dentro de UM hook. Recebe o VALOR do hook, não o
 * nome dele.
 *
 * São três listas, não uma: o schema que veio instalado
 * (`node_modules/lefthook/schema.json`, lefthook 2.1.10) põe `use_stdin` em
 * Job, Command e Script, e um hook aceita `jobs`, `commands` e `scripts`.
 * Olhar só `jobs` deixava passar um bloco `commands:` com a chave — que é a
 * sintaxe do lefthook 1.x, a que a maioria dos exemplos por aí mostra.
 */
function unidadesDo(bloco: unknown): Unidade[] {
  const hook = bloco as
    | { jobs?: unknown; commands?: unknown; scripts?: unknown }
    | undefined;
  const unidades = achata(hook?.jobs);
  for (const mapa of [hook?.commands, hook?.scripts]) {
    if (mapa === null || typeof mapa !== "object") continue;
    for (const [nome, unidade] of Object.entries(mapa)) {
      if (unidade === null || typeof unidade !== "object") continue;
      unidades.push({ nome, use_stdin: unidade.use_stdin });
    }
  }
  return unidades;
}

/** O bloco do `pre-push`. Chave literal de propósito: ver o comentário abaixo. */
const PRE_PUSH = CONFIG["pre-push"];

/** `<hook>/<nome>` de tudo que pede `use_stdin`, em qualquer chave de topo. */
function quemPedeStdin(): string[] {
  const pedem: string[] = [];
  // A varredura passa por TODAS as chaves de topo, inclusive as que não são
  // hook (`assert_lefthook_installed`, `lefthook`): em valor que não é objeto,
  // `.jobs` é `undefined` e o `Array.isArray` derruba. Uma lista branca de
  // hooks conhecidos seria pior — perderia um `use_stdin` posto num hook que
  // hoje não existe no arquivo (`prepare-commit-msg`, `post-checkout`), que é
  // exatamente a regressão calada que este passo existe para pegar.
  //
  // `Object.entries` em vez de `CONFIG[hook]`: a regra
  // `security/detect-object-injection` só acende em acesso computado cuja
  // propriedade é IDENTIFICADOR, e warning novo reprova a catraca do CI.
  for (const [hook, bloco] of Object.entries(CONFIG)) {
    for (const unidade of unidadesDo(bloco)) {
      if (unidade.use_stdin) pedem.push(`${hook}/${unidade.nome}`);
    }
  }
  return pedem;
}

Deno.test("o guarda de branch recebe o STDIN do pre-push", async (t) => {
  await t.step("o job `guarda-de-branch` existe no pre-push", () => {
    const job = unidadesDo(PRE_PUSH).find((u) => u.nome === "guarda-de-branch");
    assert(
      job !== undefined,
      "o job `guarda-de-branch` sumiu do `pre-push` — ele é a única barreira " +
        "que resta contra push direto em main/develop, já que branch " +
        "protection retorna 403 neste plano do GitHub",
    );
  });

  await t.step("e pede `use_stdin: true`", () => {
    const job = unidadesDo(PRE_PUSH).find((u) => u.nome === "guarda-de-branch");
    assertEquals(
      job?.use_stdin,
      true,
      "sem `use_stdin: true` o lefthook NÃO repassa o stdin do git, e o " +
        "guarda perde o DESTINO do push. Ele não fica cego: cai no sinal " +
        "fraco (o nome do branch local) e escreve um aviso em stderr. O " +
        "aviso SAI inteiro — mas fora de ordem, depois do visto verde do " +
        "job e depois do resumo, descolado dele, e com o push terminando em " +
        "exit 0: vira ruído no fim de uma saída de sucesso, o mesmo modo de " +
        "falha do `Can't find lefthook in PATH`. (Medido por pipe em " +
        "20/08/2026; em terminal interativo o lefthook pode capturar o " +
        "stderr, e isso NÃO foi reproduzido.) O que escapa é " +
        "`git push origin HEAD:develop` de uma branch de trabalho — destino " +
        "protegido, branch local inocente. Reproduzido em 20/08/2026 num " +
        "repositório descartável: exit 0, e o remoto develop recebeu o commit",
    );
  });

  await t.step("e é o ÚNICO que pede stdin, em todo o arquivo", () => {
    assertEquals(
      quemPedeStdin(),
      ["pre-push/guarda-de-branch"],
      "a documentação do lefthook avisa que, quando VÁRIOS pedem " +
        "`use_stdin`, só UM recebe os dados e os outros ficam sem nada — ela " +
        "fala em *commands* e *scripts*, e no 2.x a mesma chave existe " +
        "também em *job* (inclusive em job aninhado dentro de `group:`). Por " +
        "isso a varredura passa pelos três: um segundo pedinte — o " +
        "`typecheck` do mesmo `pre-push`, um bloco `commands:` novo, um job " +
        "dentro de um `group:` — rouba o stdin do guarda e devolve o buraco " +
        "sem quebrar mais nada. As quatro variantes foram mutadas em " +
        "20/08/2026: o `lefthook validate` aprova TODAS",
    );
  });
});
