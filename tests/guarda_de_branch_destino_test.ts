// @ts-nocheck
/**
 * O guarda de branch olha o DESTINO do push — scripts/guarda-de-branch.mjs
 *
 * O DEFEITO QUE ESTES TESTES FECHAM (varredura de 20/08/2026, achado 3):
 * o guarda lia `git rev-parse --abbrev-ref HEAD`, ou seja, o nome do branch
 * que está checked out, e o cabeçalho dele afirmava ser "a única trava contra
 * escrita direta em main/develop". Mas o destino de um push não é o branch
 * local: `git push origin HEAD:develop`, feito de uma feature branch, escreve
 * em develop e passava batido.
 *
 * Reproduzido em 20/08/2026 num repositório descartável:
 *
 *   CENARIO A — push estando EM develop     -> recusado, exit 1
 *   CENARIO B — git push origin HEAD:develop de feat/disfarce
 *                                           -> ACEITO, exit 0
 *   remoto develop: c97f41f feat: escrita direta disfarcada
 *                   7e4932a feat: direto em develop   <- o que o guarda barrou em A
 *
 * O push disfarçado ainda levou junto o commit que o guarda havia recusado.
 *
 * O git entrega o destino real pelo STDIN do hook pre-push, uma linha por ref:
 *   <local ref> SP <local sha1> SP <remote ref> SP <remote sha1> LF
 * O script ignorava esse stdin por inteiro.
 *
 * ATENÇÃO ao que NÃO mudou: no modo `commit` o guarda continua olhando o
 * branch local, porque commit não tem destino — é o único sinal que existe.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const MODULO = new URL(
  "../scripts/guarda-de-branch.mjs",
  import.meta.url,
).href;
const { refsProtegidosNoPush } = await import(MODULO);

const PROTEGIDAS = ["main", "develop"];
const SHA = "c97f41f0000000000000000000000000000000aa";
const ZERO = "0000000000000000000000000000000000000000";

// --------------------------------------------------------------------------
// A leitura do stdin do pre-push
// --------------------------------------------------------------------------

Deno.test("refsProtegidosNoPush lê o DESTINO, não o branch local", async (t) => {
  await t.step(
    "o caso provado: HEAD:develop de uma feature branch é pego",
    () => {
      const stdin = `refs/heads/feat/disfarce ${SHA} refs/heads/develop ${SHA}\n`;
      assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["develop"]);
    },
  );

  await t.step("push normal de feature para ela mesma passa", () => {
    const stdin = `refs/heads/feat/x ${SHA} refs/heads/feat/x ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), []);
  });

  await t.step("push estando EM develop continua sendo pego", () => {
    const stdin = `refs/heads/develop ${SHA} refs/heads/develop ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["develop"]);
  });

  await t.step("APAGAR a branch protegida remota é pego", () => {
    // `git push origin :develop` — local ref vira "(delete)". O guarda antigo
    // nem via isso: quem apaga develop remota costuma estar em outra branch.
    const stdin = `(delete) ${ZERO} refs/heads/develop ${ZERO}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["develop"]);
  });

  await t.step("push --all pega TODAS as protegidas do lote", () => {
    const stdin =
      `refs/heads/feat/x ${SHA} refs/heads/feat/x ${SHA}\n` +
      `refs/heads/main ${SHA} refs/heads/main ${SHA}\n` +
      `refs/heads/develop ${SHA} refs/heads/develop ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["main", "develop"]);
  });

  await t.step("tag não é branch protegida", () => {
    const stdin = `refs/tags/v1.5.0 ${SHA} refs/tags/v1.5.0 ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), []);
  });

  await t.step(
    "nome que ENCOSTA na protegida não pode casar (developer, main-antiga)",
    () => {
      // O caso negativo tem de se parecer com o autorizado, senão não toca a
      // fronteira: comparar por prefixo aceitaria os dois.
      const stdin =
        `refs/heads/developer ${SHA} refs/heads/developer ${SHA}\n` +
        `refs/heads/main-antiga ${SHA} refs/heads/main-antiga ${SHA}\n` +
        `refs/heads/feat/develop ${SHA} refs/heads/feat/develop ${SHA}\n`;
      assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), []);
    },
  );

  await t.step("nome curto sem refs/heads/ também é reconhecido", () => {
    // Nem todo git escreve o remote ref completo em toda versão; aceitar as
    // duas formas custa nada e o inverso é uma trava que não trava.
    const stdin = `refs/heads/feat/x ${SHA} develop ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["develop"]);
  });

  await t.step("CRLF e linhas em branco não quebram a leitura", () => {
    const stdin =
      `\r\nrefs/heads/feat/x ${SHA} refs/heads/main ${SHA}\r\n\r\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["main"]);
  });

  await t.step("stdin vazio não inventa destino", () => {
    assertEquals(refsProtegidosNoPush("", PROTEGIDAS), []);
    assertEquals(refsProtegidosNoPush("   \n", PROTEGIDAS), []);
  });

  await t.step("a mesma protegida em duas linhas não duplica", () => {
    const stdin =
      `refs/heads/a ${SHA} refs/heads/main ${SHA}\n` +
      `refs/heads/b ${SHA} refs/heads/main ${SHA}\n`;
    assertEquals(refsProtegidosNoPush(stdin, PROTEGIDAS), ["main"]);
  });
});

// --------------------------------------------------------------------------
// O script inteiro, rodado de verdade com stdin — sem isto, a função pura
// pode estar certa e o script continuar aprovando tudo
// --------------------------------------------------------------------------

async function rodarGuarda(argumento: string, stdin: string) {
  const cmd = new Deno.Command("node", {
    args: ["scripts/guarda-de-branch.mjs", argumento],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const proc = cmd.spawn();
  const w = proc.stdin.getWriter();
  await w.write(new TextEncoder().encode(stdin));
  await w.close();
  const { code, stderr } = await proc.output();
  return { code, erro: new TextDecoder().decode(stderr) };
}

Deno.test("o script recusa pelo destino lido no stdin", async (t) => {
  await t.step("HEAD:develop de feature branch -> exit 1", async () => {
    const r = await rodarGuarda(
      "push",
      `refs/heads/feat/disfarce ${SHA} refs/heads/develop ${SHA}\n`,
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.erro, "develop");
    assertStringIncludes(r.erro, "recusado");
  });

  await t.step("apagar main remota -> exit 1", async () => {
    const r = await rodarGuarda(
      "push",
      `(delete) ${ZERO} refs/heads/main ${ZERO}\n`,
    );
    assertEquals(r.code, 1);
    assertStringIncludes(r.erro, "main");
  });

  await t.step("push de feature para ela mesma -> exit 0", async () => {
    const r = await rodarGuarda(
      "push",
      `refs/heads/feat/x ${SHA} refs/heads/feat/x ${SHA}\n`,
    );
    assertEquals(r.code, 0);
  });

  await t.step(
    "stdin VAZIO não vira aprovação silenciosa: avisa que não leu o destino",
    async () => {
      // Sem `use_stdin: true` no lefthook.yml o script cai aqui. Ele volta ao
      // sinal antigo (branch local), mas a saída tem de DIZER que não mediu o
      // destino — senão o verde continua sem lastro, que é o defeito original.
      const r = await rodarGuarda("push", "");
      assertStringIncludes(r.erro, "destino");
      assertStringIncludes(r.erro, "use_stdin");
    },
  );
});
