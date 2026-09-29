// @ts-nocheck
/**
 * A catraca de lint aprova em silêncio quando o Biome não consegue rodar —
 * scripts/lint-ratchet.mjs (lint-ratchet-103)
 *
 * O DEFEITO QUE ESTE TESTE FECHA: `contarBiome()` extraía o número só por
 * regex (`/Found (\d+) errors?\./`) em cima da saída decorativa de
 * `npx biome check .`, e quando a regex não casava — porque o Biome não
 * rodou de verdade, não porque achou zero problema — devolvia
 * `{errors: 0, warnings: 0}` sem avisar ninguém. Contra o teto de
 * `.lint-baseline.json` (hoje 19 erros de Biome), zero LÊ como "a dívida
 * caiu": delta negativo, `baixou`, a catraca nunca chama `process.exit`. O
 * Biome não olhou um arquivo sequer e o job "Catraca de lint" fica verde.
 *
 * Reproduzido (achado da tarefa): `npx biome check /caminho/inexistente`
 * imprime "Checked 0 files" e nenhum "Found N errors." — a saída de onde a
 * regex não casa. Trocando pra `--reporter=json`, o mesmo caso vira
 * `summary.errors: 0, summary.warnings: 0` mesmo com um diagnóstico
 * `internalError/io` no array: `summary.errors` só conta achado de lint, não
 * falha de execução. Por isso a correção não podia ser só "trocar de regex
 * pra JSON" — tinha de exigir também que o Biome tenha PROCESSADO arquivo.
 *
 * Mora em tests/ e usa `await import(...)` — não `createRequire`, como
 * tests/ler_migration_test.ts faz para o `ler-migration.cjs` (CommonJS) —
 * porque scripts/lint-ratchet.mjs é ESM (`import`/`export`), e o `require`
 * do Node/Deno não carrega ESM. O padrão certo pra ESM já existe no
 * repositório, em tests/guarda_de_branch_destino_test.ts: importar o módulo
 * e chamar a função exportada. lint-ratchet.mjs ganhou o mesmo guarda de
 * execução (`if (process.argv[1] && import.meta.url === ...)`) pelo mesmo
 * motivo de scripts/guarda-de-branch.mjs — sem ele, este `import` dispararia
 * eslint e biome de verdade e o `process.exit` de dentro do script.
 *
 * `contarBiome(executar)` aceita a função que roda o comando como parâmetro
 * (padrão `rodar`, o `execSync` de verdade) só para o teste poder injetar
 * uma saída fabricada sem mexer em PATH nem chamar processo nenhum.
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const MODULO = new URL("../scripts/lint-ratchet.mjs", import.meta.url).href;
const { contarBiome } = await import(MODULO);

const CABECALHO_JSON_INSTAVEL =
  "The --json option is unstable/experimental and its output might change between patches/minor releases.\n";

// Saída real reproduzida com `npx biome check --reporter=json` num caminho
// que não existe: nenhum arquivo processado, `summary.errors` e
// `summary.warnings` zerados, mas HÁ um diagnóstico (internalError/io) — a
// prova de que o Biome tentou e falhou, não que achou "zero problema".
function saidaBiomeNaoRodou() {
  const resumo = {
    summary: {
      changed: 0,
      unchanged: 0,
      matches: 0,
      duration: { secs: 0, nanos: 271938 },
      errors: 0,
      warnings: 0,
      skipped: 0,
      suggestedFixesSkipped: 0,
      diagnosticsNotPrinted: 0,
    },
    diagnostics: [
      {
        category: "internalError/io",
        severity: "error",
        description: "No such file or directory (os error 2)",
        tags: ["internal"],
      },
    ],
    command: "check",
  };
  return `${CABECALHO_JSON_INSTAVEL}${JSON.stringify(resumo)}\ninternalError/io ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  × No files were processed in the specified paths.\n`;
}

// Saída real de uma contagem que rodou de verdade e achou problema — o
// caminho normal, que não pode virar reprovação por causa deste guarda.
function saidaBiomeContou(errors, warnings) {
  const resumo = {
    summary: {
      changed: 0,
      unchanged: 1037,
      matches: 0,
      duration: { secs: 2, nanos: 159586019 },
      errors,
      warnings,
      skipped: 0,
      suggestedFixesSkipped: 0,
      diagnosticsNotPrinted: 0,
    },
    diagnostics: [],
    command: "check",
  };
  return `${CABECALHO_JSON_INSTAVEL}${JSON.stringify(resumo)}\ncheck ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  × Some errors were emitted while running checks.\n`;
}

Deno.test("contarBiome REPROVA (lança) quando o Biome não processou nenhum arquivo", () => {
  assertThrows(
    () => contarBiome(() => saidaBiomeNaoRodou()),
    Error,
    "biome não rodou",
  );
});

Deno.test("contarBiome REPROVA quando a saída não tem JSON nenhum (ex.: npx quebrou antes de chamar o Biome)", () => {
  assertThrows(
    () => contarBiome(() => "npm ERR! could not resolve biome\n"),
    Error,
    "biome não rodou",
  );
});

Deno.test("o BUG antigo não volta: saída sem resumo nunca vira {errors: 0, warnings: 0} silencioso", () => {
  // Antes da correção, `contarBiome` devolvia {errors:0, warnings:0} para
  // esta mesma saída (a regex `/Found (\d+) errors?\./` não casava). Este
  // teste prende a CLASSE do defeito: se alguém reintroduzir um `return
  // {errors:0, warnings:0}` de fallback em vez de lançar, ele reprova aqui
  // ANTES de reprovar silenciosamente no CI.
  let lancou = false;
  let resultado = null;
  try {
    resultado = contarBiome(() => saidaBiomeNaoRodou());
  } catch {
    lancou = true;
  }
  assert(lancou, "deveria ter lançado, não devolvido um número");
  assertEquals(resultado, null);
});

Deno.test("contarBiome REPROVA quando o resumo existe mas errors/warnings não são números (chave renomeada viraria NaN no delta)", () => {
  const saida = JSON.stringify({
    summary: { changed: 0, unchanged: 12, matches: 0, erros: 1, avisos: 2 },
  });
  assertThrows(() => contarBiome(() => saida), Error, "contagens numéricas");
});

Deno.test("contarBiome PASSA e devolve o número certo quando o Biome rodou de verdade", () => {
  // O caso feliz: contagem abaixo do teto vivo de .lint-baseline.json não
  // pode ser afetado pelo guarda novo — ele só reage à AUSÊNCIA de resumo.
  const r = contarBiome(() => saidaBiomeContou(5, 1));
  assertEquals(r, { errors: 5, warnings: 1 });
});

Deno.test("contarBiome PASSA mesmo quando o resumo diz zero achado de verdade (0 é um número válido)", () => {
  // Diferença do caso "não rodou": aqui `unchanged` é > 0 — o Biome
  // efetivamente olhou arquivo e não achou nada. Isso é "dívida zero", não
  // "não rodou", e não pode lançar.
  const r = contarBiome(() => saidaBiomeContou(0, 0));
  assertEquals(r, { errors: 0, warnings: 0 });
});

Deno.test("contarBiome ignora o rodapé decorativo que o Biome imprime DEPOIS do JSON", () => {
  // `--reporter=json` do Biome escreve o resumo e ainda imprime, na mesma
  // saída, o rodapé "check ━━━...". Um parser que fizesse
  // `saida.slice(saida.indexOf("{"))` direto pro JSON.parse (como
  // `contarEslint` faz com `[`) quebraria aqui — por isso o parser desta
  // correção acha o `}` que FECHA o objeto, não o fim da string.
  const saida = `${saidaBiomeContou(3, 0)}\nlixo depois do rodapé {não é json`;
  const r = contarBiome(() => saida);
  assertEquals(r, { errors: 3, warnings: 0 });
});
