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
