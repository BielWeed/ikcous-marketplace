// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
/**
 * As REGRAS de scripts/verifica-links-md.mjs — o que ele varre, o que ele
 * ignora e o que conta como link quebrado.
 *
 * O teste vizinho (verifica_links_md_percentual_test.ts) só prova o `%` solto.
 * O resto do verificador — que decide o vermelho do `npm run lint:links` e
 * imprime o número de linha que o dono segue para achar o link — não tinha
 * prova: trocar `>` por `>=` no corte do sufixo `:linha`, remover a âncora do
 * regex de link externo ou ligar a recursão na RAIZ deixava tudo verde.
 *
 * Mesma técnica do vizinho: o script é COPIADO para uma raiz descartável
 * (ele deduz a raiz de import.meta.url), com a árvore de .md montada à mão.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = new URL("../scripts/verifica-links-md.mjs", import.meta.url);

type Arvore = Record<string, string>;

async function rodar(arvore: Arvore) {
  const raiz = mkdtempSync(join(tmpdir(), "h36-links-"));
  try {
    mkdirSync(join(raiz, "scripts"));
    copyFileSync(SCRIPT, join(raiz, "scripts", "verifica-links-md.mjs"));
    for (const [relativo, texto] of Object.entries(arvore)) {
      const alvo = join(raiz, relativo);
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, texto);
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

Deno.test("referência de código `arquivo:linha` não é link quebrado", async () => {
  const r = await rodar({
    "docs/a.md": "[x](codigo.ts:13) [y](codigo.ts:13:5)\n",
    "docs/codigo.ts": "// existe\n",
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "Links relativos verificados: 2 em 1 arquivos.",
  );
});

Deno.test("só sufixo NUMÉRICO inteiro é cortado: `arquivo.ts:13x` e `arquivo.ts:x13` quebram", async () => {
  const r = await rodar({
    "docs/a.md": "[x](codigo.ts:13x)\n[y](codigo.ts:x13)\n",
    "docs/codigo.ts": "// existe\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "docs/a.md:1  ->  codigo.ts:13x");
  assertStringIncludes(r.stderr, "docs/a.md:2  ->  codigo.ts:x13");
});

Deno.test("dois pontos que NÃO são número não cortam nada (não vira o arquivo que existe)", async () => {
  const r = await rodar({
    "docs/a.md": "[x](codigo.ts:nota:final)\n",
    "docs/codigo.ts": "// existe\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "codigo.ts:nota:final");
});

Deno.test("destino só de dígitos é caminho (nunca é cortado até sobrar vazio)", async () => {
  const r = await rodar({ "docs/a.md": "[x](123)\n" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "docs/a.md:1  ->  123");
  assertStringIncludes(
    r.stdout,
    "Links relativos verificados: 1 em 1 arquivos.",
  );
});

Deno.test("link externo e âncora pura ficam de fora; `mailto:` no MEIO de um caminho não", async () => {
  const r = await rodar({
    "docs/a.md":
      "[a](https://exemplo.com/x) [b](http://exemplo.com) [c](mailto:a@b.c) [d](tel:123) [e](#secao)\n",
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "Links relativos verificados: 0 em 1 arquivos.",
  );

  const meio = await rodar({ "docs/a.md": "[x](./pasta/mailto:caso.md)\n" });
  assertEquals(meio.code, 1);
  assertStringIncludes(meio.stderr, "./pasta/mailto:caso.md");
});

Deno.test("âncora é cortada: `arquivo.md#secao` confere só o arquivo", async () => {
  const r = await rodar({
    "docs/a.md": "[x](b.md#qualquer-coisa)\n[y](faltando.md#x)\n",
    "docs/b.md": "# b\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "docs/a.md:2  ->  faltando.md#x");
  assertEquals(r.stderr.includes("b.md#qualquer-coisa"), false);
});

Deno.test("a linha reportada conta as quebras ANTES do link (começando em 1)", async () => {
  const r = await rodar({
    "docs/a.md": "\n\n[x](sumiu.md)\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "docs/a.md:3  ->  sumiu.md");
});

Deno.test("conta verificados e arquivos exatamente (nem a mais, nem a menos)", async () => {
  const r = await rodar({
    "docs/a.md": "[x](b.md)\n[y](b.md)\n",
    "docs/b.md": "sem links\n",
    "docs/sub/c.md": "[z](../b.md)\n",
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "Links relativos verificados: 3 em 3 arquivos.",
  );
  assertStringIncludes(r.stdout, "Nenhum link quebrado.");
});

Deno.test("docs/ e supabase/ entram RECURSIVAMENTE; node_modules, dist, .git e .vite-pwa não", async () => {
  const quebrado = "[x](nao-existe.md)\n";
  const r = await rodar({
    "docs/n1/n2/fundo.md": quebrado,
    "supabase/migrations/leia.md": quebrado,
    "docs/node_modules/x.md": quebrado,
    "docs/dist/x.md": quebrado,
    "docs/.git/x.md": quebrado,
    "docs/.vite-pwa/x.md": quebrado,
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "Links quebrados: 2");
  assertStringIncludes(r.stderr, "docs/n1/n2/fundo.md:1");
  assertStringIncludes(r.stderr, "supabase/migrations/leia.md:1");
  assertStringIncludes(r.stdout, "em 2 arquivos.");
});

Deno.test("a RAIZ entra SEM recursão: .md solto na raiz vale, pasta qualquer da raiz não", async () => {
  const r = await rodar({
    "README.md": "[x](faltou-na-raiz.md)\n",
    "outra/pasta/x.md": "[y](faltou-fora-dos-alvos.md)\n",
    "outra/y.md": "[y](faltou-fora-dos-alvos.md)\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "README.md:1  ->  faltou-na-raiz.md");
  assertEquals(r.stderr.includes("faltou-fora-dos-alvos"), false);
  assertStringIncludes(r.stderr, "Links quebrados: 1");
});

Deno.test("extensão .md em MAIÚSCULA também é varrida; outras extensões não", async () => {
  const r = await rodar({
    "docs/MAIUSCULA.MD": "[x](sumiu-1.md)\n",
    "docs/texto.txt": "[x](sumiu-2.md)\n",
    "docs/a.md.bak": "[x](sumiu-3.md)\n",
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stderr, "sumiu-1.md");
  assertEquals(r.stderr.includes("sumiu-2.md"), false);
  assertEquals(r.stderr.includes("sumiu-3.md"), false);
});

Deno.test("sem docs/ nem supabase/: só a raiz, e sai 0 se estiver limpa", async () => {
  const r = await rodar({ "LEIA.md": "sem link nenhum\n" });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "Links relativos verificados: 0 em 1 arquivos.",
  );
});
