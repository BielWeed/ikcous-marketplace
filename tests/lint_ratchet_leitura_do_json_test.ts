// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
/**
 * A leitura do JSON do Biome e as mensagens de falha de scripts/lint-ratchet.mjs.
 *
 * O teste vizinho (lint_ratchet_biome_nao_rodou_test.ts) prova que a catraca
 * falha fechada quando o Biome não roda, mas o "primeiro JSON balanceado" que
 * lê o resumo nunca era exercitado com o que o Biome REALMENTE imprime dentro
 * do JSON: código-fonte com `{`/`}` e aspas escapadas (o campo `dictionary` de
 * um diff de formatação). Errar o estado "estou dentro de uma string" fecha o
 * objeto no `}` errado, o JSON.parse falha, o resumo some e a catraca passa a
 * reprovar com "biome não rodou" — ou, num erro de contagem, a ler outro
 * objeto. Aqui cada pedaço do estado (abrir string, escape, fechar string,
 * profundidade, corte exato do `}`) tem um caso que só ele derruba.
 *
 * Valores esperados escritos à mão. Importa o módulo (a guarda
 * `argv[1] === import.meta.url` impede que o main rode).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const MODULO = new URL("../scripts/lint-ratchet.mjs", import.meta.url).href;
const { contarBiome, contarEslint } = await import(MODULO);

function resumoBiome(over = {}, extra = {}) {
  return {
    summary: {
      changed: 0,
      unchanged: 30,
      matches: 0,
      errors: 4,
      warnings: 2,
      ...over,
    },
    diagnostics: [],
    command: "check",
    ...extra,
  };
}

Deno.test("contarBiome: `}` dentro de uma STRING não fecha o objeto", () => {
  const saida = JSON.stringify(
    resumoBiome(
      {},
      { diagnostics: [{ description: "fecha } e abre { na string" }] },
    ),
  );
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: aspas ESCAPADAS dentro da string não encerram a string", () => {
  // O `}` depois do \" só é texto se o escape for respeitado.
  const saida = JSON.stringify(
    resumoBiome(
      {},
      { diagnostics: [{ description: 'ele disse "oi } ainda texto"' }] },
    ),
  );
  assert(saida.includes('\\"oi } ainda'), saida);
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: o escape vale para UM caractere só (barra seguida de aspas de fechamento)", () => {
  // `"a\\"` é a string `a\`: a barra escapa a barra, e a aspa seguinte FECHA.
  // Depois dela vem um `}` que é estrutura, não texto.
  const saida = JSON.stringify(
    resumoBiome({}, { diagnostics: [{ description: "termina em barra \\" }] }),
  );
  assert(saida.includes('barra \\\\"'), saida);
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test('contarBiome: primeira string do JSON vazia (`""`) não confunde o estado inicial', () => {
  const saida =
    '{"":1,"summary":{"changed":0,"unchanged":9,"matches":0,"errors":1,"warnings":0}}';
  assertEquals(
    contarBiome(() => saida),
    { errors: 1, warnings: 0 },
  );
});

Deno.test("contarBiome: objetos aninhados são contados em profundidade (só o `}` de nível zero fecha)", () => {
  const saida = JSON.stringify(
    resumoBiome(
      {},
      { diagnostics: [{ a: { b: { c: { d: 1 } } } }, { e: {} }] },
    ),
  );
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: corta EXATAMENTE no `}` que fecha (lixo colado logo depois não entra no parse)", () => {
  const saida = `${JSON.stringify(resumoBiome())}x-lixo-colado`;
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: texto antes do primeiro `{` é ignorado", () => {
  const saida = `cabeçalho sem chave\n${JSON.stringify(resumoBiome())}`;
  assertEquals(
    contarBiome(() => saida),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: JSON que nunca fecha vira 'biome não rodou' (não aprova)", () => {
  const saida =
    '{"summary":{"changed":0,"unchanged":9,"matches":0,"errors":1,"warnings":0}';
  assertThrows(() => contarBiome(() => saida), Error, "biome não rodou");
});

Deno.test("contarBiome: `{...}` que fecha mas não é JSON válido vira 'biome não rodou'", () => {
  assertThrows(
    () => contarBiome(() => "{isto nao e json}"),
    Error,
    "biome não rodou",
  );
});

Deno.test("contarBiome: arquivos processados = changed + unchanged + matches (cada parcela conta)", () => {
  // Cada caso zera o total se a soma trocar um sinal.
  assertEquals(
    contarBiome(() =>
      JSON.stringify(resumoBiome({ changed: 2, unchanged: 2, matches: 0 })),
    ),
    { errors: 4, warnings: 2 },
  );
  assertEquals(
    contarBiome(() =>
      JSON.stringify(resumoBiome({ changed: 3, unchanged: 0, matches: 3 })),
    ),
    { errors: 4, warnings: 2 },
  );
  assertEquals(
    contarBiome(() =>
      JSON.stringify(resumoBiome({ changed: 0, unchanged: 0, matches: 1 })),
    ),
    { errors: 4, warnings: 2 },
  );
  assertEquals(
    contarBiome(() =>
      JSON.stringify(resumoBiome({ changed: 1, unchanged: 0, matches: 0 })),
    ),
    { errors: 4, warnings: 2 },
  );
});

Deno.test("contarBiome: só `errors` numérico OU só `warnings` numérico não basta", () => {
  assertThrows(
    () => contarBiome(() => JSON.stringify(resumoBiome({ errors: "4" }))),
    Error,
    "contagens numéricas",
  );
  assertThrows(
    () => contarBiome(() => JSON.stringify(resumoBiome({ warnings: null }))),
    Error,
    "contagens numéricas",
  );
});

Deno.test("contarBiome: a mensagem de falha carrega no máximo os 800 primeiros caracteres da saída", () => {
  const saida = `sem json ${"y".repeat(2000)}`;
  let msg = "";
  try {
    contarBiome(() => saida);
  } catch (e) {
    msg = e.message;
  }
  assert(
    msg.endsWith(saida.slice(0, 800)),
    "deve terminar com os 800 primeiros",
  );
  assert(!msg.endsWith(saida.slice(0, 801)), "não pode levar o 801º");
  assert(msg.includes("falha de execução, nunca como"), msg);
});

function pastaTemp() {
  return mkdtempSync(join(tmpdir(), "h36-lint-leitura-"));
}

Deno.test("contarEslint: a mensagem de relatório ilegível carrega no máximo 800 caracteres da saída e o caminho", () => {
  const pasta = pastaTemp();
  const arquivo = join(pasta, "eslint.json");
  const saida = `ruido ${"z".repeat(2000)}`;
  try {
    let msg = "";
    try {
      contarEslint(() => saida, arquivo);
    } catch (e) {
      msg = e.message;
    }
    assert(msg.includes(`relatório ${arquivo} ausente ou ilegível`), msg);
    assert(
      msg.endsWith(saida.slice(0, 800)),
      "deve terminar com os 800 primeiros",
    );
    assert(!msg.endsWith(saida.slice(0, 801)), "não pode levar o 801º");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

Deno.test("contarEslint: relatório que não é lista leva a mensagem própria e no máximo 800 caracteres", () => {
  const pasta = pastaTemp();
  const arquivo = join(pasta, "eslint.json");
  const saida = `ruido ${"w".repeat(2000)}`;
  try {
    let msg = "";
    try {
      contarEslint((comando) => {
        writeFileSync(
          comando.match(/--output-file "([^"]+)"/)[1],
          '{"nao":"lista"}',
        );
        return saida;
      }, arquivo);
    } catch (e) {
      msg = e.message;
    }
    assert(msg.includes("o relatório não é a lista de resultados"), msg);
    assert(
      msg.endsWith(saida.slice(0, 800)),
      "deve terminar com os 800 primeiros",
    );
    assert(!msg.endsWith(saida.slice(0, 801)), "não pode levar o 801º");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

Deno.test("contarEslint: se a pasta temporária já sumiu, o erro mostrado é o do relatório (a limpeza não o mascara)", () => {
  let msg = "";
  try {
    contarEslint((comando) => {
      const arquivo = comando.match(/--output-file "([^"]+)"/)[1];
      rmSync(dirname(arquivo), { recursive: true, force: true });
      return "";
    });
  } catch (e) {
    msg = e.message;
  }
  assert(
    msg.includes("eslint não devolveu JSON"),
    `erro mascarado pela limpeza: ${msg}`,
  );
});

Deno.test("contarEslint: o comando pede cache por CONTEÚDO e relatório em arquivo", () => {
  let comando = "";
  contarEslint((c) => {
    comando = c;
    writeFileSync(c.match(/--output-file "([^"]+)"/)[1], "[]");
    return "";
  });
  assert(
    comando.startsWith('npx eslint . --format json --output-file "'),
    comando,
  );
  assert(comando.endsWith('" --cache --cache-strategy content'), comando);
});

Deno.test("contarEslint: relatório vazio (nenhum arquivo) conta zero e zero", () => {
  assertEquals(
    contarEslint((c) => {
      writeFileSync(c.match(/--output-file "([^"]+)"/)[1], "[]");
      return "";
    }),
    { errors: 0, warnings: 0 },
  );
});
