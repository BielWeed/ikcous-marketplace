// @ts-nocheck
/**
 * O gate de mensagem de commit — scripts/commitlint-mensagem.mjs
 *
 * Nenhum teste vigiava este script. Ele decide se um commit entra: recebe o
 * caminho da mensagem que o git entrega ao hook `commit-msg`, descobre qual
 * arquivo valer (COMMIT_EDITMSG, MERGE_MSG ou SQUASH_MSG) e roda o commitlint
 * nele. Cada mutação de uma linha ali (tirar o basename, olhar o primeiro em
 * vez do último argumento, trocar o nome padrão, engolir o código de saída)
 * deixava a suíte inteira verde.
 *
 * O script é de efeito colateral puro (roda `main` ao ser importado e termina
 * com process.exit), então ele é executado como processo filho, dentro de um
 * repositório git descartável. O repositório e o worktree dos testes ficam em
 * pastas COM ESPAÇO no nome, que é o defeito original de 06/08/2026.
 *
 * Config do commitlint no repositório descartável: só regras (sem `extends`,
 * que exigiria node_modules ali). O que se prova é o ENCANADO — qual arquivo é
 * lido e como o veredito vira código de saída —, não as regras do projeto.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = new URL("../scripts/commitlint-mensagem.mjs", import.meta.url);
const CAMINHO_SCRIPT = decodeURIComponent(
  SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

const VALIDA = "feat: mensagem valida\n";
const INVALIDA = "mensagem sem tipo nenhum\n";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) {
    throw new Error(
      `git ${args.join(" ")}: ${new TextDecoder().decode(r.stderr)}`,
    );
  }
  return new TextDecoder().decode(r.stdout).trim();
}

/** Repositório descartável, em pasta com espaço, com regras mínimas. */
async function repositorio(): Promise<string> {
  const base = await Deno.makeTempDir({ prefix: "h36 commitlint " });
  await git(base, "init", "-q", ".");
  await Deno.writeTextFile(
    `${base}/.commitlintrc.json`,
    JSON.stringify({
      rules: {
        "type-empty": [2, "never"],
        "subject-empty": [2, "never"],
        "header-max-length": [2, "always", 40],
      },
    }),
  );
  return base;
}

async function escreveMensagem(
  cwd: string,
  nome: string,
  conteudo: string,
): Promise<void> {
  const caminho = await git(cwd, "rev-parse", "--git-path", nome);
  await Deno.writeTextFile(
    `${cwd}/${caminho}`.replace(/\/\.\//, "/"),
    conteudo,
  );
}

type Saida = { codigo: number; texto: string };

async function roda(cwd: string, ...args: string[]): Promise<Saida> {
  const r = await new Deno.Command("node", {
    args: [CAMINHO_SCRIPT, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    codigo: r.code,
    texto: dec.decode(r.stdout) + dec.decode(r.stderr),
  };
}

Deno.test("sem argumento valida o COMMIT_EDITMSG", async (t) => {
  const repo = await repositorio();
  try {
    await t.step("mensagem válida: exit 0", async () => {
      await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
      const r = await roda(repo);
      assertEquals(r.codigo, 0, r.texto);
    });

    await t.step("mensagem inválida: exit 1 e o motivo aparece", async () => {
      await escreveMensagem(repo, "COMMIT_EDITMSG", INVALIDA);
      const r = await roda(repo);
      assertEquals(r.codigo, 1, r.texto);
      assertStringIncludes(r.texto, "type-empty");
    });

    await t.step(
      "cabeçalho acima do limite do repositório reprova",
      async () => {
        await escreveMensagem(
          repo,
          "COMMIT_EDITMSG",
          `feat: ${"a".repeat(40)}\n`,
        );
        const r = await roda(repo);
        assertEquals(r.codigo, 1, r.texto);
        assertStringIncludes(r.texto, "header-max-length");
      },
    );

    await t.step("cabeçalho EXATAMENTE no limite passa", async () => {
      const cabecalho = `feat: ${"a".repeat(34)}`;
      assertEquals(cabecalho.length, 40);
      await escreveMensagem(repo, "COMMIT_EDITMSG", `${cabecalho}\n`);
      const r = await roda(repo);
      assertEquals(r.codigo, 0, r.texto);
    });
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("o argumento do hook escolhe QUAL arquivo é validado", async (t) => {
  const repo = await repositorio();
  try {
    await t.step(
      "merge inválido com COMMIT_EDITMSG antigo válido: reprova (o bug de 06/08)",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
        await escreveMensagem(repo, "MERGE_MSG", INVALIDA);
        const r = await roda(repo, `${repo}/.git/MERGE_MSG`);
        assertEquals(r.codigo, 1, r.texto);
        assertStringIncludes(r.texto, "type-empty");
      },
    );

    await t.step(
      "merge válido com COMMIT_EDITMSG antigo inválido: passa",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", INVALIDA);
        await escreveMensagem(repo, "MERGE_MSG", VALIDA);
        const r = await roda(repo, `${repo}/.git/MERGE_MSG`);
        assertEquals(r.codigo, 0, r.texto);
      },
    );

    await t.step("SQUASH_MSG também é respeitado", async () => {
      await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
      await escreveMensagem(repo, "SQUASH_MSG", INVALIDA);
      const r = await roda(repo, `${repo}/.git/SQUASH_MSG`);
      assertEquals(r.codigo, 1, r.texto);
    });

    await t.step(
      "caminho com barra invertida (Windows): só o último pedaço vale",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
        await escreveMensagem(repo, "MERGE_MSG", INVALIDA);
        const r = await roda(repo, "C:\\pasta\\sub\\.git\\MERGE_MSG");
        assertEquals(r.codigo, 1, r.texto);
        assertStringIncludes(r.texto, "type-empty");
      },
    );

    await t.step(
      "caminho com barra invertida (Windows) e MERGE_MSG válida: passa (só o nome decide, não o resto do caminho)",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", INVALIDA);
        await escreveMensagem(repo, "MERGE_MSG", VALIDA);
        const r = await roda(repo, "C:\\pasta\\sub\\.git\\MERGE_MSG");
        assertEquals(r.codigo, 0, r.texto);
        const barra = await roda(repo, "/pasta/sub/.git/MERGE_MSG");
        assertEquals(barra.codigo, 0, barra.texto);
      },
    );

    await t.step(
      "caminho quebrado nos espaços: vários argv, o ÚLTIMO é o nome",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
        await escreveMensagem(repo, "MERGE_MSG", INVALIDA);
        const r = await roda(
          repo,
          "C:/Users/x/software",
          "Gerenciador",
          "ecossistema/.git/MERGE_MSG",
        );
        assertEquals(r.codigo, 1, r.texto);
      },
    );

    await t.step(
      "o primeiro argv NÃO decide: último válido, primeiro inválido passa",
      async () => {
        await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
        await escreveMensagem(repo, "MERGE_MSG", INVALIDA);
        const r = await roda(repo, "x/MERGE_MSG", "y/COMMIT_EDITMSG");
        assertEquals(r.codigo, 0, r.texto);
      },
    );
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("falha FECHADA: arquivo que não existe não aprova", async () => {
  const repo = await repositorio();
  try {
    // COMMIT_EDITMSG válido existe; o argumento aponta para um nome sem arquivo.
    await escreveMensagem(repo, "COMMIT_EDITMSG", VALIDA);
    const r = await roda(repo, `${repo}/.git/NAO_EXISTE_MSG`);
    assert(r.codigo !== 0, `aprovou sem arquivo: ${r.texto}`);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("dentro de um git worktree a mensagem fica no gitdir do worktree", async () => {
  const repo = await repositorio();
  const filho = await Deno.makeTempDir({ prefix: "h36 worktree filho " });
  try {
    await git(repo, "config", "user.email", "h36@example.invalid");
    await git(repo, "config", "user.name", "h36");
    await git(repo, "commit", "-q", "--allow-empty", "-m", "feat: raiz");
    const wt = `${filho}/arvore com espaco`;
    await git(repo, "worktree", "add", "-q", "-b", "h36-ramo", wt);
    await Deno.copyFile(
      `${repo}/.commitlintrc.json`,
      `${wt}/.commitlintrc.json`,
    );

    const caminho = await git(wt, "rev-parse", "--git-path", "COMMIT_EDITMSG");
    // No worktree o git-path NÃO é `.git/COMMIT_EDITMSG` da raiz.
    assert(caminho.includes("worktrees"), caminho);

    // A mensagem da RAIZ é inválida; a do worktree é válida. Validar a errada
    // (a da raiz) reprovaria — passar prova que o script olhou o gitdir certo.
    await escreveMensagem(repo, "COMMIT_EDITMSG", INVALIDA);
    await Deno.writeTextFile(
      caminho.startsWith("/") || /^[A-Za-z]:/.test(caminho)
        ? caminho
        : `${wt}/${caminho}`,
      VALIDA,
    );
    const r = await roda(wt, `${wt}/${caminho}`);
    assertEquals(r.codigo, 0, r.texto);

    // E o inverso: inválida no worktree reprova.
    await Deno.writeTextFile(
      caminho.startsWith("/") || /^[A-Za-z]:/.test(caminho)
        ? caminho
        : `${wt}/${caminho}`,
      INVALIDA,
    );
    const r2 = await roda(wt);
    assertEquals(r2.codigo, 1, r2.texto);
  } finally {
    await Deno.remove(filho, { recursive: true });
    await Deno.remove(repo, { recursive: true });
  }
});
