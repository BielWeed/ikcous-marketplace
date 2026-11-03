// @ts-nocheck
/**
 * O verificador de links dos .md não pode morrer num destino com `%` solto —
 * scripts/verifica-links-md.mjs (achado c10)
 *
 * O DEFEITO QUE ESTE TESTE FECHA: o script faz `decodeURI` no destino de cada
 * link, e `decodeURI("100%.md")` LANÇA `URIError: URI malformed`. Um `.md` com
 * `[desconto](100%.md)` derrubava o job "Links da documentação" com um stack
 * trace cru, sem imprimir "Links quebrados", e o erro parecia defeito do CI.
 * O certo é tratar o `%` solto como nome literal: se o arquivo não existe, o
 * link cai na lista de quebrados como qualquer outro.
 *
 * O script resolve a raiz a partir de `import.meta.url`, então o teste copia
 * o script para `<tmp>/scripts/` e roda lá — a raiz vira o diretório temporário.
 */
/* Caminhos montados a partir de um diretório temporário criado aqui mesmo. */
/* eslint-disable security/detect-non-literal-fs-filename -- ver acima */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = new URL("../scripts/verifica-links-md.mjs", import.meta.url);

async function rodarComDoc(
  conteudo: string,
  extras: Record<string, string> = {},
) {
  const raiz = mkdtempSync(join(tmpdir(), "links-md-"));
  try {
    mkdirSync(join(raiz, "scripts"));
    mkdirSync(join(raiz, "docs"));
    copyFileSync(SCRIPT, join(raiz, "scripts", "verifica-links-md.mjs"));
    writeFileSync(join(raiz, "docs", "a.md"), conteudo);
    for (const [nome, texto] of Object.entries(extras)) {
      writeFileSync(join(raiz, "docs", nome), texto);
    }
    const saida = await new Deno.Command("node", {
      args: [join(raiz, "scripts", "verifica-links-md.mjs")],
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: saida.code,
      stdout: new TextDecoder().decode(saida.stdout),
      stderr: new TextDecoder().decode(saida.stderr),
    };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

Deno.test("link com % solto vira link quebrado, não URIError", async () => {
  const r = await rodarComDoc("[desconto](100%.md)\n");
  assert(!r.stderr.includes("URIError"), `não podia lançar: ${r.stderr}`);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "Links quebrados");
  assertStringIncludes(r.stderr, "100%.md");
});

Deno.test("CONTROLE: link com % solto para arquivo que EXISTE passa", async () => {
  const r = await rodarComDoc("[desconto](100%.md)\n", { "100%.md": "# ok\n" });
  assertEquals(r.code, 0, r.stderr);
});

Deno.test("CONTROLE: %20 continua desfeito (caminho com espaço)", async () => {
  const r = await rodarComDoc("[x](com%20espaco.md)\n", {
    "com espaco.md": "# ok\n",
  });
  assertEquals(r.code, 0, r.stderr);
});
