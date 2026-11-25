// @ts-nocheck
/**
 * scripts/db-check-objetos-do-codigo.mjs — importar o módulo NÃO pode executar
 * o `main` (ele só roda quando o arquivo é o script invocado).
 *
 * Este teste mora num arquivo SEPARADO, e sem `import` do script, de propósito:
 * se a guarda `scriptInvocado` caísse, o `main` rodaria dentro do próprio
 * `deno test` ao importar, terminaria com `process.exit(0)` e os outros arquivos
 * (que importam o script) sairiam com "0 passed" e código 0 — uma suíte vazia
 * que parece verde. Aqui o módulo é importado num processo FILHO, a partir de
 * um arquivo de apoio (portanto `process.argv[1]` NÃO é o script), e o filho
 * imprimindo qualquer coisa além do esperado reprova este arquivo.
 */
import {
  fromFileUrl,
  toFileUrl,
} from "https://deno.land/std@0.177.0/path/mod.ts";
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const SCRIPT = fromFileUrl(
  new URL("../scripts/db-check-objetos-do-codigo.mjs", import.meta.url),
);

Deno.test("importar o módulo a partir de OUTRO arquivo não executa o main: nada impresso e exit 0, mesmo sem nenhuma fonte de catálogo", async () => {
  const pasta = Deno.makeTempDirSync();
  try {
    const apoio = `${pasta}/importa.mjs`;
    Deno.writeTextFileSync(
      apoio,
      `await import(${JSON.stringify(toFileUrl(SCRIPT).href)});\nconsole.log("importado");\n`,
    );
    const base = Object.fromEntries(
      [
        "PATH",
        "Path",
        "SystemRoot",
        "SYSTEMROOT",
        "HOME",
        "USERPROFILE",
      ].flatMap((chave) => {
        const v = Deno.env.get(chave);
        return v === undefined ? [] : [[chave, v]];
      }),
    );
    const saida = await new Deno.Command("node", {
      args: [apoio],
      env: base,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const texto =
      new TextDecoder().decode(saida.stdout) +
      new TextDecoder().decode(saida.stderr);
    assertEquals(saida.code, 0, texto);
    assertEquals(texto.trim(), "importado");
  } finally {
    Deno.removeSync(pasta, { recursive: true });
  }
});
