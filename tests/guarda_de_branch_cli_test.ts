// @ts-nocheck
/**
 * O PROGRAMA scripts/guarda-de-branch.mjs — exit code, mensagem e leitura do
 * stdin do `pre-push`.
 *
 * O teste vizinho (guarda_de_branch_destino_test.ts) cobre só a função pura
 * `refsProtegidosNoPush`. Quem realmente barra o commit/push é o `main()`, e
 * ele não tinha prova nenhuma: `process.exit(1)` virar `exit(0)` na recusa,
 * perder o `trim()` do stdin ou trocar a ordem dos ramos deixava tudo verde —
 * e este hook é a trava local contra escrita direta em `main`/`develop`.
 *
 * COMO: o script roda como processo filho, dentro de um repositório descartável
 * com o branch pedido checked out, e o stdin do hook (as linhas do pre-push) é
 * alimentado à mão.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = new URL("../scripts/guarda-de-branch.mjs", import.meta.url);
const CAMINHO_SCRIPT = decodeURIComponent(
  SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const SHA = "c97f41f0000000000000000000000000000000aa";
const ZERO = "0000000000000000000000000000000000000000";
const dec = new TextDecoder();

async function git(cwd: string, ...args: string[]) {
  const r = await new Deno.Command("git", {
    args: [
      "-c",
      "user.name=h36",
      "-c",
      "user.email=h36@example.invalid",
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success)
    throw new Error(`git ${args.join(" ")}: ${dec.decode(r.stderr)}`);
}

/** Repositório descartável com um commit e o branch pedido checked out. */
async function repositorio(branch: string): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), "h36-guarda-"));
  await git(base, "init", "-q", "-b", "main", ".");
  await git(base, "commit", "-q", "--allow-empty", "-m", "raiz");
  if (branch !== "main") await git(base, "checkout", "-q", "-b", branch);
  return base;
}

async function roda(cwd: string, args: string[], stdin: string | null) {
  const cmd = new Deno.Command("node", {
    args: [CAMINHO_SCRIPT, ...args],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const filho = cmd.spawn();
  const escritor = filho.stdin.getWriter();
  if (stdin !== null) await escritor.write(new TextEncoder().encode(stdin));
  await escritor.close();
  const r = await filho.output();
  return {
    code: r.code,
    stdout: dec.decode(r.stdout),
    stderr: dec.decode(r.stderr),
  };
}

function linhaPush(remoto: string, local = "refs/heads/feat/x") {
  return `${local} ${SHA} ${remoto} ${ZERO}\n`;
}

Deno.test("COMMIT em branch protegida é recusado (exit 1) com a mensagem completa", async () => {
  for (const protegida of ["main", "develop"]) {
    const repo = await repositorio(protegida);
    try {
      for (const args of [["commit"], []]) {
        const r = await roda(repo, args, "");
        assertEquals(r.code, 1, `${protegida}/${args}: ${r.stderr}`);
        assertStringIncludes(
          r.stderr,
          `Commit direto em '${protegida}' recusado.`,
        );
        assertStringIncludes(
          r.stderr,
          "main    = o que está no ar. Só entra por PR de release ou de hotfix.",
        );
        assertStringIncludes(
          r.stderr,
          "develop = integração. Só entra por PR.",
        );
        assertStringIncludes(
          r.stderr,
          "git switch -c feat/<assunto> develop\n",
        );
        assertStringIncludes(r.stderr, "git push -u origin feat/<assunto>\n");
        assertStringIncludes(r.stderr, "gh pr create --base develop");
        assertStringIncludes(
          r.stderr,
          "git branch feat/<assunto>      # salva o trabalho",
        );
        assertStringIncludes(
          r.stderr,
          `git reset --hard origin/${protegida}    # devolve a branch protegida`,
        );
        assertStringIncludes(r.stderr, "git switch feat/<assunto>\n");
        assertStringIncludes(
          r.stderr,
          "Este hook é local e some com --no-verify.",
        );
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

Deno.test("COMMIT em feature branch passa calado; nome parecido com protegida também", async () => {
  for (const branch of ["feat/x", "developer", "main-antiga", "feat/develop"]) {
    const repo = await repositorio(branch);
    try {
      const r = await roda(repo, ["commit"], "");
      assertEquals(r.code, 0, `${branch}: ${r.stderr}`);
      assertEquals(r.stderr, "", branch);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

Deno.test("COMMIT com HEAD solto (detached) ou fora de repositório não é barrado (git não sabe dizer o branch)", async () => {
  const repo = await repositorio("feat/x");
  try {
    await git(repo, "checkout", "-q", "--detach");
    const solto = await roda(repo, ["commit"], "");
    assertEquals(solto.code, 0, solto.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  const fora = mkdtempSync(join(tmpdir(), "h36-guarda-fora-"));
  try {
    const r = await roda(fora, ["commit"], "");
    assertEquals(r.code, 0, r.stderr);
    // O `git` reclama no stderr herdado ("not a git repository"); o guarda não.
    assert(!r.stderr.includes("recusado"), r.stderr);
  } finally {
    rmSync(fora, { recursive: true, force: true });
  }
});

Deno.test("PUSH: o DESTINO manda — HEAD:develop de feature branch é recusado, com 'Push direto' e prefixo fix/", async () => {
  const repo = await repositorio("feat/disfarce");
  try {
    const r = await roda(
      repo,
      ["push"],
      linhaPush("refs/heads/develop", "HEAD"),
    );
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "Push direto em 'develop' recusado.");
    assertStringIncludes(r.stderr, "git switch -c fix/<assunto> develop\n");
    assertStringIncludes(r.stderr, "git push -u origin fix/<assunto>\n");
    assertStringIncludes(
      r.stderr,
      "git branch fix/<assunto>      # salva o trabalho",
    );
    assertStringIncludes(
      r.stderr,
      "git reset --hard origin/develop    # devolve a branch protegida",
    );
    assertStringIncludes(r.stderr, "git switch fix/<assunto>\n");
    assert(!r.stderr.includes("não consegui ler o DESTINO"), r.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH com duas protegidas no destino nomeia as duas, na ordem, e usa a PRIMEIRA no reset", async () => {
  const repo = await repositorio("feat/x");
  try {
    const stdin =
      linhaPush("refs/heads/main") +
      linhaPush("refs/heads/feat/livre") +
      linhaPush("refs/heads/develop");
    const r = await roda(repo, ["push"], stdin);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(
      r.stderr,
      "Push direto em 'main' e 'develop' recusado.",
    );
    assertStringIncludes(
      r.stderr,
      "git reset --hard origin/main    # devolve a branch protegida",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH: destino lido e limpo termina em 0 SEM olhar o branch local (develop:feat/x estando em develop)", async () => {
  const repo = await repositorio("develop");
  try {
    const r = await roda(
      repo,
      ["push"],
      linhaPush("refs/heads/feat/x", "refs/heads/develop"),
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stderr, "");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH de tag com nome de protegida não é barrado", async () => {
  const repo = await repositorio("feat/x");
  try {
    const r = await roda(
      repo,
      ["push"],
      linhaPush("refs/tags/develop", "refs/tags/develop"),
    );
    assertEquals(r.code, 0, r.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH sem destino legível (stdin vazio): AVISA que mediu só o branch local — e então recusa se for protegida", async () => {
  const emFeature = await repositorio("feat/x");
  try {
    const r = await roda(emFeature, ["push"], "");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      r.stderr,
      "guarda-de-branch: não consegui ler o DESTINO deste push.",
    );
    assertStringIncludes(r.stderr, "precisa de `use_stdin: true`.");
    assertStringIncludes(
      r.stderr,
      "`git push origin HEAD:develop` NÃO é pego por este caminho.",
    );
  } finally {
    rmSync(emFeature, { recursive: true, force: true });
  }

  const emDevelop = await repositorio("develop");
  try {
    const r = await roda(emDevelop, ["push"], "");
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "não consegui ler o DESTINO");
    assertStringIncludes(r.stderr, "Push direto em 'develop' recusado.");
  } finally {
    rmSync(emDevelop, { recursive: true, force: true });
  }
});

Deno.test("PUSH com stdin só de espaço/quebra de linha vale como SEM destino (cai no branch local)", async () => {
  const repo = await repositorio("develop");
  try {
    const r = await roda(repo, ["push"], "   \n\n  \n");
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "não consegui ler o DESTINO");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH com cano aberto que NUNCA fecha: desiste em ~2 s e cai no branch local (não pendura o git push)", async () => {
  const repo = await repositorio("develop");
  try {
    const filho = new Deno.Command("node", {
      args: [CAMINHO_SCRIPT, "push"],
      cwd: repo,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const escritor = filho.stdin.getWriter(); // não escreve nada e não fecha
    const inicio = Date.now();
    const r = await filho.output();
    const levou = Date.now() - inicio;
    assert(levou >= 1500, `desistiu cedo demais: ${levou} ms`);
    assert(levou < 15000, `ficou pendurado: ${levou} ms`);
    assertEquals(r.code, 1, dec.decode(r.stderr));
    assertStringIncludes(dec.decode(r.stderr), "não consegui ler o DESTINO");
    try {
      await escritor.close();
    } catch {
      /* o filho já saiu */
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("PUSH com dados chegando e cano que não fecha: o que já chegou VALE depois do tempo limite", async () => {
  const repo = await repositorio("feat/x");
  try {
    const filho = new Deno.Command("node", {
      args: [CAMINHO_SCRIPT, "push"],
      cwd: repo,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const escritor = filho.stdin.getWriter();
    await escritor.write(
      new TextEncoder().encode(linhaPush("refs/heads/main")),
    );
    const r = await filho.output();
    assertEquals(r.code, 1, dec.decode(r.stderr));
    assertStringIncludes(
      dec.decode(r.stderr),
      "Push direto em 'main' recusado.",
    );
    try {
      await escritor.close();
    } catch {
      /* o filho já saiu */
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

Deno.test("IMPORTAR o módulo não executa o guarda (sem exit, sem mensagem)", async () => {
  const repo = await repositorio("develop");
  try {
    const r = await new Deno.Command("node", {
      args: [
        "--input-type=module",
        "--eval",
        `const m = await import(${JSON.stringify(SCRIPT.href)}); console.log("IMPORTADO", typeof m.refsProtegidosNoPush);`,
      ],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(r.code, 0, dec.decode(r.stderr));
    assertStringIncludes(dec.decode(r.stdout), "IMPORTADO function");
    assertEquals(
      dec.decode(r.stderr),
      "",
      "estando em develop, o guarda recusaria se tivesse rodado",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ---- refsProtegidosNoPush: bordas da leitura de linha -----------------------

const MODULO = SCRIPT.href;
const { refsProtegidosNoPush } = await import(MODULO);

Deno.test("refsProtegidosNoPush: espaço no INÍCIO da linha não desloca os campos", () => {
  assertEquals(
    refsProtegidosNoPush(`   refs/heads/x ${SHA} refs/heads/main ${ZERO}`),
    ["main"],
  );
});

Deno.test("refsProtegidosNoPush: linha com EXATAMENTE 3 campos (sem o sha remoto) ainda vale; com 2 não", () => {
  assertEquals(refsProtegidosNoPush(`refs/heads/x ${SHA} refs/heads/develop`), [
    "develop",
  ]);
  assertEquals(refsProtegidosNoPush("refs/heads/x refs/heads/develop"), []);
});

Deno.test("refsProtegidosNoPush: `refs/heads/` no MEIO do nome não é removido (só o prefixo)", () => {
  assertEquals(refsProtegidosNoPush(`x ${SHA} marefs/heads/in ${ZERO}`), []);
  assertEquals(
    refsProtegidosNoPush(`x ${SHA} refs/heads/refs/heads/main ${ZERO}`),
    [],
  );
});

Deno.test("refsProtegidosNoPush: aceita nome cru, tolera CRLF e não repete", () => {
  assertEquals(
    refsProtegidosNoPush(
      `a ${SHA} develop ${ZERO}\r\nb ${SHA} refs/heads/develop ${ZERO}\r\nc ${SHA} main ${ZERO}\r\n`,
    ),
    ["develop", "main"],
  );
});

Deno.test("refsProtegidosNoPush: null, undefined e vazio não lançam", () => {
  assertEquals(refsProtegidosNoPush(null), []);
  assertEquals(refsProtegidosNoPush(undefined), []);
  assertEquals(refsProtegidosNoPush(""), []);
});
