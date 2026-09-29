import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * A FIAÇÃO de scripts/db-check-objetos-do-codigo.mjs — o que os testes das
 * funções puras não provam sobre `main()` e o `ci.yml`:
 *
 *   (a) o CI usa SUPABASE_ACCESS_TOKEN e o ref da loja no endpoint somente
 *       leitura; não depende do DATABASE_URL antigo;
 *   (b) no uso LOCAL por DATABASE_URL, o script RODADO DE VERDADE
 *       recusa um projeto errado ANTES de abrir conexão — prova de que
 *       `main()` de fato chama `conferirProjeto()` e sai 1 sem passar por
 *       `lerCatalogo()` — E também DEIXA PASSAR o projeto certo, para que o
 *       guard não vire uma recusa cega (comparar o campo errado, ou inverter
 *       a condição, ainda recusaria sempre e passaria batido se só houvesse
 *       o teste do "errado").
 *
 * (b) usa DATABASE_URL apontando para 127.0.0.1:1 (porta baixa, fechada:
 * medido — connect ECONNREFUSED em ~0.2-0.4s). Se o guard NÃO disparasse
 * antes no caso do projeto errado, a tentativa de conexão real apareceria no
 * log como "ECONNREFUSED"; se o guard recusasse INDEVIDAMENTE no caso do
 * projeto certo, o log NUNCA chegaria a "ECONNREFUSED". As duas combinações
 * ("sai 1, com ::error::, sem ECONNREFUSED" e "sai 1, sem ::error::, com
 * ECONNREFUSED") só acontecem se a decisão de aceitar/recusar for a certa —
 * é isso que os dois casos abaixo verificam, e não a mensagem de erro de
 * conexão do driver `pg`.
 *
 * Prova ao vivo de que os testes locais pegam mutações do guard: comentei o bloco
 * do `if (esperado)` de `main()` — os 18 casos de
 * tests/db_check_objetos_do_codigo_test.ts continuaram 18/18 verdes (eles
 * nunca chamam main()), e o caso (b) do projeto errado falhou (achou
 * "ECONNREFUSED" e não achou "::error::"). Testei também, à parte, trocar
 * `conferirProjeto(ref, esperado)` por `conferirProjeto(host, esperado)` e
 * trocar `if (!conferencia.ok)` por `if (true)` — as duas quebram o caso do
 * projeto CERTO (ele passa a recusar sempre, então nunca chega a
 * "ECONNREFUSED"). Revertidas as três mutações, os dois arquivos voltam a
 * 100%.
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

// O ref real só verifica a fiação do CI; os testes de conexão usam refs fictícios.
const REF_LOJA = "dekxabvqdsuukijblazl";
// Refs fictícios para o processo real — nunca o da loja.
const REF_FICTICIO_CONECTADO = "aaaaaaaaaaaaaaaaaaaa";
const REF_FICTICIO_ESPERADO = "bbbbbbbbbbbbbbbbbbbb";
// Para o caso "aceita o banco certo": o MESMO ref dos dois lados.
const REF_FICTICIO_IGUAL = "cccccccccccccccccccc";

Deno.test("ci.yml passa token existente e ref da loja ao detector pela API", async () => {
  const yaml = await Deno.readTextFile(CI_YML);
  assertStringIncludes(
    yaml,
    `SUPABASE_ACCESS_TOKEN: \${{ secrets.SUPABASE_ACCESS_TOKEN }}\n          SUPABASE_PROJECT_REF: ${REF_LOJA}\n        run: node scripts/db-check-objetos-do-codigo.mjs`,
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

// O lado que faltava: o guard também tem de DEIXAR PASSAR o banco certo — uma
// implementação que recusasse SEMPRE (ex.: comparar `host` em vez de `ref`, ou
// inverter a condição do `if`) deixaria o caso acima verde e este vermelho de
// forma diferente do esperado, mas passaria batido se só houvesse o teste do
// "errado". Aqui o ref do DATABASE_URL e o PROJETO_REF_ESPERADO são O MESMO
// (fictício) — o guard tem de deixar seguir para lerCatalogo(), que tenta
// conectar de verdade a 127.0.0.1:1 e falha com ECONNREFUSED (medido:
// ~290-415ms, dentro do timeout de 5s). "Sem ::error::, com ECONNREFUSED" só
// é possível se o guard aceitou e a tentativa de conexão aconteceu.
Deno.test("processo real: projeto CERTO passa do guard e tenta conectar (ECONNREFUSED, sem ::error::)", async () => {
  const { code, saida } = await rodarDetector({
    DATABASE_URL: `postgresql://postgres.${REF_FICTICIO_IGUAL}@127.0.0.1:1/p`,
    PROJETO_REF_ESPERADO: REF_FICTICIO_IGUAL,
  });
  assertEquals(code, 1, saida); // ainda sai 1 — mas por ECONNREFUSED, não pelo guard
  assert(
    !saida.includes("::error::"),
    `o guard recusou um projeto que deveria ter sido aceito: ${saida}`,
  );
  assertStringIncludes(saida, "ECONNREFUSED");
});
