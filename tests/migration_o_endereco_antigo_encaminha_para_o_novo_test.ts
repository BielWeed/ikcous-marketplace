// @ts-nocheck
// O ENDEREÇO ANTIGO ENCAMINHA PARA O NOVO — a prova viva da 20261570000000 está ligada ao CI (26/11/2026).
//
// A decisão real (tabela fechada, gatilho do principal, porta de leitura com o bloco da chave da v2, porta de troca com as recusas,
// a falha no meio, duas conexões, rollbacks e pré-voo) fica com tests/banco/o-endereco-antigo-encaminha-viva.cjs, que só roda no
// Postgres efêmero do rpc-ci. Este teste fixa que ela RODA: no job BLOQUEANTE (contrato-dinheiro, sem continue-on-error), num clone
// próprio (rodar-isolado.cjs), depois do passo que aplica as migrations — e que o LEIA-ME da pasta a descreve.
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const PROVA = "tests/banco/o-endereco-antigo-encaminha-viva.cjs";

Deno.test("rpc-ci.yml roda a prova viva da 20261570 no job bloqueante, num clone próprio, depois do apply", async () => {
  const yaml = (
    await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`)
  ).replace(/\r/g, "");
  assertStringIncludes(
    yaml,
    [
      "      - name: Prova viva do endereco antigo que encaminha para o novo (migration 20261570000000)",
      "        if: ${{ !cancelled() && steps.aplica.outcome == 'success' }}",
      "        timeout-minutes: 3",
      `        run: node tests/banco/rodar-isolado.cjs ${PROVA}`,
      "",
    ].join("\n"),
  );
  // No job bloqueante: o passo vem antes do job informacional (que é o único com continue-on-error).
  const iPasso = yaml.indexOf(
    `run: node tests/banco/rodar-isolado.cjs ${PROVA}`,
  );
  const iBloqueante = yaml.indexOf("\n  contrato-dinheiro:\n");
  const iInformacional = yaml.indexOf("\n  provas-informacionais:\n");
  assert(
    iBloqueante > 0 && iPasso > iBloqueante && iPasso < iInformacional,
    "a prova está no job contrato-dinheiro (bloqueante)",
  );
  assertStringIncludes(
    yaml.slice(0, yaml.indexOf("\n  push:\n")),
    '      - "tests/banco/**"\n',
    "o pull_request dispara pela pasta da prova",
  );
});

// Um CR cru dentro de um literal (E'<CR>') some em qualquer leitura que normalize o fim de linha (o ler() das provas, editor,
// checkout): o replace vira replace(x, '', '') e o rollback recusa a migration aplicada com CRLF. O \r se escreve com a barra.
// Fim de linha CRLF de um checkout Windows (\r seguido de \n) não é CR solto.
Deno.test("os três arquivos da 20261570 não têm byte \\r solto", async () => {
  const NOME = "20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql";
  for (const arquivo of [
    NOME,
    `rollback-manual-${NOME}`,
    `rollback-manual-destrutivo-${NOME}`,
  ]) {
    const sql = await Deno.readTextFile(
      `${RAIZ}/supabase/migrations/${arquivo}`,
    );
    const i = sql.search(/\r(?!\n)/);
    assert(
      i < 0,
      `${arquivo}: \\r solto na linha ${sql.slice(0, i).split("\n").length}`,
    );
  }
});

Deno.test("o LEIA-ME de tests/banco descreve a prova da 20261570", async () => {
  const leiame = await Deno.readTextFile(`${RAIZ}/tests/banco/LEIA-ME.md`);
  assertMatch(
    leiame,
    /\n- \*\*O endereco antigo encaminha para o novo \(`o-endereco-antigo-encaminha-viva\.cjs`, via `rodar-isolado\.cjs`\)\*\*: migration 20261570000000;/,
  );
});
