import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * A FIAÇÃO do guard-rail de scripts/db-check-objetos-do-codigo.mjs
 * (BANCO-080 seguinte) — o que tests/db_check_objetos_do_codigo_test.ts NÃO
 * prova, porque só testa `refDoProjeto`/`conferirProjeto` ISOLADAS, nunca
 * através de `main()` nem do `ci.yml`:
 *
 *   (a) o `ci.yml` de fato passa PROJETO_REF_ESPERADO=cafkrminfnokvgjqtkle
 *       (o ref REAL da loja) no step que roda o detector — sem essa linha o
 *       guard nunca liga em produção, mesmo com refDoProjeto/conferirProjeto
 *       corretos;
 *   (b) o script, RODADO DE VERDADE como processo (`node scripts/...`),
 *       recusa um projeto errado ANTES de abrir conexão — prova de que
 *       `main()` de fato chama `conferirProjeto()` e sai 1 sem passar por
 *       `lerCatalogo()`.
 *
 * (b) usa DATABASE_URL apontando para 127.0.0.1:1 (porta baixa, fechada:
 * medido — connect ECONNREFUSED em ~0.2s). Se o guard NÃO disparasse antes,
 * a tentativa de conexão real apareceria no log como "ECONNREFUSED". Então
 * "sai 1, com ::error::, e SEM ECONNREFUSED" só é possível se a recusa
 * aconteceu antes de qualquer query — é essa combinação que os casos abaixo
 * verificam, e não a mensagem de erro de conexão do driver `pg`.
 *
 * Prova ao vivo de que este arquivo pega a mutação "remover o `if (esperado)`
 * de `main()`": comentei o bloco do guard, rodei
 * `deno test tests/db_check_objetos_do_codigo_test.ts
 * tests/ci_objetos_do_codigo_test.ts` — os 18 casos do primeiro arquivo
 * continuaram 18/18 verdes (eles nunca chamam main()), e o caso (b) deste
 * arquivo falhou (achou "ECONNREFUSED" e não achou "::error::"). Recolocado
 * o `if`, os dois arquivos voltam a 100%.
 *
 * URLs de teste NUNCA levam senha: uma connection string com usuário:senha@
 * host aciona o secretlint do pre-commit mesmo sendo fictícia — foi por isso
 * que a rodada 1 desta frente teve 3 URLs de teste barradas no commit.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const CI_YML = fromFileUrl(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const SCRIPT = fromFileUrl(
  new URL("../scripts/db-check-objetos-do-codigo.mjs", import.meta.url),
);

// Único lugar deste arquivo (e do irmão db_check_objetos_do_codigo_test.ts)
// em que o ref REAL da loja é necessário: provar que o guard está de fato
// ligado no ci.yml, não só implementado no script.
const REF_LOJA = "cafkrminfnokvgjqtkle";
// Refs fictícios para o processo real — nunca o da loja.
const REF_FICTICIO_CONECTADO = "aaaaaaaaaaaaaaaaaaaa";
const REF_FICTICIO_ESPERADO = "bbbbbbbbbbbbbbbbbbbb";

Deno.test("ci.yml passa PROJETO_REF_ESPERADO=<ref da loja> para o step que roda o detector", async () => {
  const yaml = await Deno.readTextFile(CI_YML);
  assertStringIncludes(
    yaml,
    `DATABASE_URL: \${{ secrets.DATABASE_URL }}\n          PROJETO_REF_ESPERADO: ${REF_LOJA}\n        run: node scripts/db-check-objetos-do-codigo.mjs`,
  );
});

/** Roda o detector como processo de verdade (o jeito que o CI roda), com
 * timeout curto: se o guard não disparar, a tentativa de conexão a
 * 127.0.0.1:1 falha rápido (ECONNREFUSED, medido em ~0.2s) — 5s é folga de
 * sobra sem deixar o teste pendurado numa regressão que trave. */
async function rodarDetector(env: Record<string, string>) {
  const comando = new Deno.Command("node", {
    args: [SCRIPT],
    env: { PATH: Deno.env.get("PATH") ?? "", ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const filho = comando.spawn();
  const matadorPorTimeout = setTimeout(() => {
    try {
      filho.kill();
    } catch {
      // já pode ter saído sozinho
    }
  }, 5000);
  const { code, stdout, stderr } = await filho.output();
  clearTimeout(matadorPorTimeout);
  const dec = new TextDecoder();
  return { code, saida: dec.decode(stdout) + dec.decode(stderr) };
}

Deno.test("processo real: projeto errado recusa ANTES de conectar (sem ECONNREFUSED)", async () => {
  const { code, saida } = await rodarDetector({
    DATABASE_URL: `postgresql://postgres.${REF_FICTICIO_CONECTADO}@127.0.0.1:1/p`,
    PROJETO_REF_ESPERADO: REF_FICTICIO_ESPERADO,
  });
  assertEquals(code, 1, saida);
  assertStringIncludes(saida, "::error::");
  assert(
    !saida.includes("ECONNREFUSED"),
    `recusou tarde demais (chegou a tentar conectar): ${saida}`,
  );
});
