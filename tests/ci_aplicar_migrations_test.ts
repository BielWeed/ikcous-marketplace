// @ts-nocheck
/**
 * Teste MÍNIMO para o achado #1 da revisão de risco da rodada 2 do
 * conferir-banco-da-loja: `.github/workflows/aplicar-migrations.yml` tinha
 * o MESMO defeito de `projeto_ref` como texto livre indo direto para o
 * path da URL, com um token válido para todos os projetos da conta.
 *
 * Este arquivo NÃO tenta cobrir o workflow inteiro (isso mora em outro
 * branch, `fix/ci-banco-confere-projeto`, que mexe num comentário perto da
 * linha ~115 — este arquivo não toca essa área). Cobre só:
 *
 * 1. O input `projeto_ref` (texto livre) sumiu; entrou `projeto`, `choice`
 *    fechado em loja/sandbox.
 * 2. O trecho de resolução do ref — extraído do PRÓPRIO arquivo entre os
 *    marcadores `RESOLVE_REF_INICIO`/`RESOLVE_REF_FIM`, não copiado — recusa
 *    qualquer `PROJETO` que não seja exatamente "loja" ou "sandbox",
 *    inclusive os dois payloads que a revisão provou contra um stub:
 *    "<ref>/restart#" e "x/../outroref.../database/query#".
 *
 * Extraído e não copiado: copiado, o teste continuaria passando enquanto o
 * arquivo real apodrecesse (mesmo raciocínio de
 * tests/ci_publicar_functions_test.ts).
 */
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/aplicar-migrations.yml", import.meta.url),
);

/** Tira o trecho JS de resolução do ref, exatamente como está no arquivo,
 * entre os marcadores — sem os próprios marcadores. */
function extrairTrechoDeResolucaoDoRef(yaml: string): string {
  const ini = yaml.indexOf("RESOLVE_REF_INICIO");
  const fim = yaml.indexOf("RESOLVE_REF_FIM");
  assert(
    ini > 0 && fim > ini,
    "não achei os marcadores RESOLVE_REF_* no workflow",
  );
  const linhas = yaml.slice(ini, fim).split("\n").slice(1, -1);
  // O trecho vive dentro de `node -e "…"` (bash, aspas duplas): `\$` no
  // ARQUIVO é o jeito de sobreviver ao bash e chegar a node como `$` de
  // verdade (mesma convenção já usada em `\\.sql\$` neste mesmo arquivo).
  // Aqui rodamos o trecho DIRETO em JS, sem passar pelo bash — então
  // desfazemos manualmente o ÚNICO escape que o bash faria, para o teste
  // enxergar exatamente o que node veria em produção.
  return linhas.join("\n").replace(/\\\$/g, "$");
}

/** Roda o trecho extraído com `PROJETO` setado, capturando se `process.exit`
 * foi chamado (stub que lança, mesmo padrão de
 * tests/ci_banco_trava_dupla_test.ts) e o valor final de `ref` quando não
 * sai. Nunca toca rede: o trecho extraído termina antes de qualquer
 * `fetch`. */
function avaliarResolucaoDoRef(
  trecho: string,
  projeto: string | undefined,
): { ref?: string; codigoSaida?: number; saida: string } {
  const original = process.exit;
  let codigoSaida: number | undefined;
  const linhas: string[] = [];
  const errOriginal = console.error;
  // @ts-ignore -- stub de teste
  process.exit = (codigo?: number) => {
    codigoSaida = codigo;
    throw new Error(`process.exit(${codigo})`);
  };
  console.error = (...args: unknown[]) => linhas.push(args.join(" "));
  const envAnterior = process.env.PROJETO;
  // biome-ignore lint/performance/noDelete: `process.env.X = undefined` vira a STRING "undefined" (coerção do Node) — o delete de verdade é o que faz `typeof process.env.PROJETO === "undefined"`, que é o que `Object.hasOwn` do trecho testado precisa enxergar.
  if (projeto === undefined) delete process.env.PROJETO;
  else process.env.PROJETO = projeto;
  try {
    const fn = new Function(
      "process",
      "console",
      `${trecho}\nreturn typeof ref !== "undefined" ? ref : undefined;`,
    );
    const ref = fn(process, console);
    return { ref, saida: linhas.join("\n") };
  } catch {
    return { codigoSaida, saida: linhas.join("\n") };
  } finally {
    process.exit = original;
    console.error = errOriginal;
    // biome-ignore lint/performance/noDelete: mesmo motivo do delete acima — restaura a AUSÊNCIA da variável, não a string "undefined".
    if (envAnterior === undefined) delete process.env.PROJETO;
    else process.env.PROJETO = envAnterior;
  }
}

Deno.test("aplicar-migrations.yml — input projeto (achado #1, rodada 2)", async (t) => {
  const yaml = await Deno.readTextFile(WORKFLOW);

  await t.step(
    "`projeto_ref` (texto livre) sumiu como INPUT do workflow",
    () => {
      // A string pode aparecer em prosa/comentário explicando o achado; o que
      // não pode mais existir é a CHAVE do input (`projeto_ref:`).
      assert(
        !yaml.includes("projeto_ref:"),
        "o workflow ainda declara o input projeto_ref (texto livre) — achado #1 não corrigido",
      );
    },
  );

  await t.step("`projeto` é choice fechado em loja/sandbox", () => {
    assertStringIncludes(yaml, "projeto:");
    assertStringIncludes(yaml, "type: choice");
    assertStringIncludes(
      yaml,
      "options:\n          - loja\n          - sandbox",
    );
    assertStringIncludes(yaml, "default: loja");
  });

  await t.step(
    "loja e sandbox resolvem para os mesmos refs de publicar-functions.yml",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      const loja = avaliarResolucaoDoRef(trecho, "loja");
      assertEquals(loja.ref, "cafkrminfnokvgjqtkle", loja.saida);
      const sandbox = avaliarResolucaoDoRef(trecho, "sandbox");
      assertEquals(sandbox.ref, "lofznuxcvezrhxsgjqyg", sandbox.saida);
    },
  );

  await t.step(
    "qualquer coisa fora de loja/sandbox é recusada ANTES de qualquer URL — inclusive os payloads provados contra o stub",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      for (const malicioso of [
        "cafkrminfnokvgjqtkle/restart#",
        "x/../outroprojetoabcdefgh/database/query#",
        "cafkrminfnokvgjqtkle/pause?",
        "producao",
        "__proto__",
        "constructor",
        "",
        undefined,
      ]) {
        const r = avaliarResolucaoDoRef(trecho, malicioso);
        assertEquals(
          r.codigoSaida,
          1,
          `"${malicioso}" deveria ser recusado (exit 1); ref=${r.ref}, saída=${r.saida}`,
        );
        assertEquals(
          r.ref,
          undefined,
          `"${malicioso}" não pode resolver para um ref`,
        );
      }
    },
  );

  await t.step(
    "o trecho de resolução do ref não abre nenhuma chamada de rede (não tem `fetch`)",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      assert(
        !trecho.includes("fetch"),
        "o trecho extraído deveria terminar ANTES de qualquer fetch — os marcadores estão no lugar errado",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Crases e $ soltos no node -e (vindo de fix/ci-banco-confere-projeto, 734d4a51)
// ---------------------------------------------------------------------------
/*
 * .github/workflows/aplicar-migrations.yml — o passo "Prova, apply e
 * verificação" roda um `node -e "…"` DENTRO de um `run: |` do bash. O
 * argumento do `-e` é uma string bash entre ASPAS DUPLAS: dois caracteres
 * soltos (sem `\` antes) mudam de sentido para o bash em vez do node —
 *   - backtick (`` ` ``) vira início de substituição de comando;
 *   - `$` vira início de expansão de variável (`${x}` sai VAZIO em silêncio
 *     se `x` não for uma env var do shell — defeito que não aparece como
 *     erro, só como SQL/JS truncado).
 * Foi o backtick que aconteceu de verdade: um comentário com
 * `` `is_admin()` `` e `` `postgres` `` (crases de destaque, não de template
 * literal) produziu "command substitution: syntax error" e "postgres:
 * command not found" no log do workflow, sem nenhuma migration ter rodado.
 *
 * As crases e os `$` DE TEMPLATE LITERAL do próprio JS (as `` \` `` que abrem
 * os `sql('...', \`select ...\`)`, e o `\$` do regex de nome de arquivo) estão
 * corretamente ESCAPADOS para o bash — é isso que este teste distingue: conta
 * só o caractere que NÃO tem `\` logo antes.
 */

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

/** Conta backtick ou `$` que NÃO está escapado (`` \` ``/`\$`) — dentro de uma
 * string bash com aspas duplas, são exatamente esses dois caracteres que o
 * shell interpreta no lugar do node (substituição de comando e expansão de
 * variável). Função local, não exportada — usada só pelos casos deste
 * arquivo de teste. */
function crasesOuCifraoNaoEscapados(texto: string): number {
  const m = texto.match(/(?<!\\)[`$]/g);
  return m ? m.length : 0;
}

Deno.test("crasesOuCifraoNaoEscapados distingue escapado de solto (crase e $)", () => {
  assertEquals(crasesOuCifraoNaoEscapados(String.raw`sql(\`select 1\`)`), 0);
  assertEquals(crasesOuCifraoNaoEscapados(String.raw`\.sql\$`), 0);
  // 4 crases soltas: as duas de `is_admin()` e as duas de `postgres` — o
  // defeito real medido (linha 115 da versão quebrada do workflow).
  assertEquals(
    crasesOuCifraoNaoEscapados("gate `is_admin()` nega o role `postgres`"),
    4,
  );
  // `$` solto: ${x} viraria expansão de variável do bash, não do JS.
  assertEquals(crasesOuCifraoNaoEscapados("template ${x} solto"), 1);
});

Deno.test("o node -e do step 'Prova, apply e verificação' não tem crase nem $ sem escapar para o bash", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Prova, apply e verificação");
  const argumento = argumentoDoNodeE(bloco);
  const total = crasesOuCifraoNaoEscapados(argumento);
  assertEquals(
    total,
    0,
    'crase ou $ sem escapar dentro do node -e "...": o bash vai tentar rodar ' +
      'como comando ("command substitution: syntax error" / ' +
      '"postgres: command not found") ou expandir uma variável inexistente ' +
      "em silêncio (SQL/JS truncado) no log do workflow",
  );
});
