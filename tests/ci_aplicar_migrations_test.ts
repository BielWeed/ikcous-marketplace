import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/**
 * .github/workflows/aplicar-migrations.yml — o passo "Prova, apply e
 * verificação" roda um `node -e "…"` DENTRO de um `run: |` do bash. O
 * argumento do `-e` é uma string bash entre ASPAS DUPLAS: qualquer backtick
 * (`` ` ``) que sobre SEM escapar dentro dela vira início de substituição de
 * comando para o bash — não para o node. Foi o que aconteceu de verdade: um
 * comentário com `` `is_admin()` `` e `` `postgres` `` (crases de destaque,
 * não de template literal) produziu "command substitution: syntax error" e
 * "postgres: command not found" no log do workflow, sem nenhuma migration
 * ter rodado.
 *
 * As crases DE TEMPLATE LITERAL do próprio JS (as `` \` `` que abrem os
 * `sql('...', \`select ...\`)`) estão corretamente ESCAPADAS para o bash — é
 * isso que este teste distingue: conta só a crase que NÃO tem `\` logo antes.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/aplicar-migrations.yml", import.meta.url),
);

/** Tira do workflow o corpo do `run: |` do step cujo `name:` casa (mesmo
 * padrão de tests/ci_publicar_functions_test.ts, extraído e não copiado). */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((l) => l.includes(`name: "${nomeDoStep}"`));
  assert(iNome >= 0, `step "${nomeDoStep}" não achado no workflow`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome, `o step "${nomeDoStep}" não tem um \`run: |\``);
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
  return corpo.join("\n");
}

/** Isola o argumento do `node -e "…"` dentro do bloco `run:` — só entre a
 * linha `node -e "` e a linha de fechamento `"` sozinha (mesmo formato usado
 * no arquivo hoje). */
function argumentoDoNodeE(blocoRun: string): string {
  const linhas = blocoRun.split("\n");
  const iAbre = linhas.findIndex((l) => /^\s*node -e "\s*$/.test(l));
  assert(iAbre >= 0, 'abertura `node -e "` não achada no step');
  const iFecha = linhas.findIndex((l, i) => i > iAbre && /^\s*"\s*$/.test(l));
  assert(iFecha > iAbre, 'fechamento `"` do node -e não achado');
  return linhas.slice(iAbre + 1, iFecha).join("\n");
}

/** Conta backtick que NÃO está escapado (`` \` ``) — dentro de uma string bash
 * com aspas duplas, é exatamente esse backtick que o shell tenta rodar como
 * substituição de comando. Exportada só para os casos deste teste. */
function backticksNaoEscapados(texto: string): number {
  const m = texto.match(/(?<!\\)`/g);
  return m ? m.length : 0;
}

Deno.test("backticksNaoEscapados distingue crase escapada de crase solta", () => {
  assertEquals(backticksNaoEscapados(String.raw`sql(\`select 1\`)`), 0);
  // 4 crases soltas: as duas de `is_admin()` e as duas de `postgres` — o
  // defeito real medido (linha 115 da versão quebrada do workflow).
  assertEquals(
    backticksNaoEscapados("gate `is_admin()` nega o role `postgres`"),
    4,
  );
});

Deno.test("o node -e do step 'Prova, apply e verificação' não tem backtick sem escapar para o bash", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Prova, apply e verificação");
  const argumento = argumentoDoNodeE(bloco);
  const total = backticksNaoEscapados(argumento);
  assertEquals(
    total,
    0,
    'backtick sem escapar dentro do node -e "...": o bash vai tentar rodar ' +
      'como comando ("command substitution: syntax error" / ' +
      '"postgres: command not found" no log do workflow)',
  );
});
