// @ts-nocheck
/**
 * O job "Varredura de segredo" do CI varre mesmo — .github/workflows/ci.yml
 *
 * O DEFEITO QUE ESTES TESTES FECHAM (varredura de 20/08/2026, achado 2):
 * o passo montava a lista de arquivos com
 *
 *   mapfile -t ARQUIVOS < <(git diff --name-only ... "$BASE_SHA" "$HEAD_SHA")
 *
 * e `set -euo pipefail` NÃO propaga a falha de dentro de um process
 * substitution `< <(...)`. Medido no mesmo dia:
 *
 *   $ set -euo pipefail; mapfile -t A < <(git diff naoexiste1 naoexiste2); ...
 *   fatal: ambiguous argument 'naoexiste1111': unknown revision
 *   SOBREVIVEU. len=0
 *   exit=0
 *
 * Com a lista vazia o passo caía em "Nenhum arquivo alterado." e saía 0 — o
 * job ficava VERDE sem o secretlint ter olhado um único arquivo. Num
 * repositório cujo histórico já teve `service_role` e senha de banco
 * commitados, e onde não há branch protection para segurar o merge.
 *
 * O QUE ESTES TESTES MEDEM: se o secretlint É CHAMADO. Não a saída do passo,
 * não o texto — a chamada. "0 achados" e "não olhei" produzem o mesmo verde,
 * então o verde não serve de medida.
 *
 * COMO: o bloco de shell é EXTRAÍDO do ci.yml de verdade (não copiado para
 * cá, senão o teste passaria enquanto o arquivo apodrece) e rodado com `npm`
 * e `npx` substituídos por stubs que anotam a chamada num arquivo.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const CI = fromFileUrl(new URL("../.github/workflows/ci.yml", import.meta.url));

/**
 * Tira do ci.yml o corpo do `run: |` que pertence ao step cujo `name:` casa.
 * Parsing por indentação, sem lib de YAML: é um bloco escalar literal e o
 * arquivo é nosso.
 */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((l) => l.includes(`name: ${nomeDoStep}`));
  assert(iNome >= 0, `step "${nomeDoStep}" não achado no ci.yml`);

  const iRun = linhas.findIndex((l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l));
  assert(iRun > iNome, `o step "${nomeDoStep}" não tem um \`run: |\``);

  // `.at()` e `.slice()` em vez de `linhas[i]`: indexação por variável dispara
  // security/detect-object-injection, e a catraca de lint não abre exceção
  // para arquivo de teste.
  const recuoDe = (l: string) => l.match(/^\s*/)[0].length;
  const recuoRun = recuoDe(linhas.at(iRun));
  const corpo: string[] = [];
  for (const l of linhas.slice(iRun + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    if (recuoDe(l) <= recuoRun) break;
    corpo.push(l);
  }
  const menorRecuo = Math.min(
    ...corpo.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)[0].length),
  );
  return corpo.map((l) => l.slice(menorRecuo)).join("\n");
}

/** Monta uma pasta com stubs de `npm` e `npx` que anotam o que foi chamado. */
async function prepararSandbox(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ci_segredo_" });
  const stub = (nome: string) =>
    `#!/usr/bin/env bash\nprintf '%s %s\\n' "${nome}" "$*" >> "$CHAMADAS"\nexit 0\n`;
  for (const nome of ["npm", "npx"]) {
    const caminho = `${dir}/${nome}`;
    await Deno.writeTextFile(caminho, stub(nome));
    await Deno.chmod(caminho, 0o755);
  }
  return dir;
}

/**
 * Roda o bloco num repositório git descartável e devolve o que foi chamado.
 * `baseSha`/`headSha` entram como o workflow os entrega: variáveis de ambiente.
 */
async function rodarBloco(
  bloco: string,
  { baseSha, headSha, arquivosNoCommit = true },
) {
  const sandbox = await prepararSandbox();
  const repo = `${sandbox}/repo`;
  await Deno.mkdir(repo);

  const git = async (...args: string[]) => {
    const c = new Deno.Command("git", { args, cwd: repo, stdout: "piped", stderr: "piped" });
    return await c.output();
  };
  await git("init", "-q");
  await git("config", "user.email", "t@t.t");
  await git("config", "user.name", "t");
  await git("config", "commit.gpgsign", "false");
  await Deno.writeTextFile(`${repo}/base.txt`, "base\n");
  await git("add", "base.txt");
  await git("commit", "-q", "-m", "base", "--", "base.txt");
  const base = new TextDecoder().decode((await git("rev-parse", "HEAD")).stdout).trim();

  let head = base;
  if (arquivosNoCommit) {
    await Deno.writeTextFile(`${repo}/novo.txt`, "conteudo novo\n");
    await git("add", "novo.txt");
    await git("commit", "-q", "-m", "novo", "--", "novo.txt");
    head = new TextDecoder().decode((await git("rev-parse", "HEAD")).stdout).trim();
  }

  const chamadas = `${sandbox}/chamadas.txt`;
  await Deno.writeTextFile(chamadas, "");
  const script = `${sandbox}/bloco.sh`;
  await Deno.writeTextFile(script, bloco);

  const proc = new Deno.Command("bash", {
    args: [script],
    cwd: repo,
    env: {
      PATH: `${sandbox}:${Deno.env.get("PATH")}`,
      CHAMADAS: chamadas,
      BASE_SHA: baseSha === "REAL" ? base : baseSha,
      HEAD_SHA: headSha === "REAL" ? head : headSha,
      RUNNER_TEMP: sandbox,
    },
    stdout: "piped",
    stderr: "piped",
  });
  const saida = await proc.output();
  return {
    code: saida.code,
    stdout: new TextDecoder().decode(saida.stdout),
    stderr: new TextDecoder().decode(saida.stderr),
    chamadas: (await Deno.readTextFile(chamadas)).trim(),
  };
}

const yaml = await Deno.readTextFile(CI);
const BLOCO = blocoRunDoStep(yaml, "Varre os arquivos alterados");

// --------------------------------------------------------------------------

Deno.test("o passo de varredura de segredo nunca aprova sem varrer", async (t) => {
  await t.step("o bloco foi mesmo extraído do ci.yml", () => {
    assertStringIncludes(BLOCO, "secretlint");
    assertStringIncludes(BLOCO, "BASE_SHA");
  });

  await t.step(
    "O DEFEITO: git diff falha (base inalcançável) -> tem de varrer assim mesmo",
    async () => {
      const r = await rodarBloco(BLOCO, {
        // Um sha bem formado que não existe neste repositório: é o que sobra
        // depois de um force-push na base do PR.
        baseSha: "1111111111111111111111111111111111111111",
        headSha: "REAL",
      });
      assert(
        r.chamadas.includes("secretlint"),
        `o secretlint NÃO foi chamado. O passo aprovou sem varrer.\nsaida:\n${r.stdout}\n${r.stderr}`,
      );
    },
  );

  await t.step("branch nova (BASE_SHA vazio) -> varre o repositório inteiro", async () => {
    const r = await rodarBloco(BLOCO, { baseSha: "", headSha: "REAL" });
    assertStringIncludes(r.chamadas, "secretlint");
    assertEquals(r.code, 0);
  });

  await t.step("BASE_SHA de zeros -> varre o repositório inteiro", async () => {
    const r = await rodarBloco(BLOCO, {
      baseSha: "0000000000000000000000000000000000000000",
      headSha: "REAL",
    });
    assertStringIncludes(r.chamadas, "secretlint");
    assertEquals(r.code, 0);
  });

  await t.step("diff normal -> varre os arquivos alterados, nominalmente", async () => {
    const r = await rodarBloco(BLOCO, { baseSha: "REAL", headSha: "REAL" });
    assertStringIncludes(r.chamadas, "secretlint");
    assertStringIncludes(r.chamadas, "novo.txt");
    assertEquals(r.code, 0);
  });

  await t.step(
    "CONTROLE: diff que rodou e voltou vazio pode sair 0 sem varrer",
    async () => {
      // Este é o único caso legítimo de não varrer, e ele precisa continuar
      // barato — senão todo PR de merge vazio vira varredura do repo inteiro.
      // O que mudou é que agora ele é DISTINGUÍVEL de "o diff falhou".
      const r = await rodarBloco(BLOCO, {
        baseSha: "REAL",
        headSha: "REAL",
        arquivosNoCommit: false,
      });
      assertEquals(r.code, 0);
      assertEquals(r.chamadas, "");
    },
  );

  await t.step(
    "o process substitution que causou o defeito não voltou ao arquivo",
    () => {
      // Teste de forma, e ele é de propósito: `mapfile < <(cmd)` engole o
      // status de `cmd` mesmo sob `set -euo pipefail`. Quem reintroduzir a
      // construção precisa ler este teste antes.
      //
      // Comentário não conta: o bloco cita a construção errada de propósito,
      // para ensinar por que ela saiu. Medir o texto em vez do código faria
      // este teste reprovar justamente a documentação do defeito.
      const codigo = BLOCO.split("\n")
        .filter((l) => !l.trim().startsWith("#"))
        .join("\n");
      assert(
        !/mapfile[^\n]*<\s*<\(/.test(codigo),
        "voltou um `mapfile -t X < <(...)`: o status do comando de dentro é " +
          "descartado, e foi assim que o job ficou verde sem varrer nada.",
      );
      // E o aviso escrito tem de continuar lá para quem for editar o bloco.
      assertStringIncludes(BLOCO, "process substitution");
    },
  );
});
