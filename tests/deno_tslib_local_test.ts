// @ts-nocheck
/**
 * O job "Testes (Deno — edge + unit)" falhava ao acaso com
 * "Integrity check failed for remote specifier" no MESMO endereço:
 * https://esm.sh/tslib@2.8.1/denonext/tslib.mjs (7 de 7 falhas de integridade
 * lidas em 10-12/11/2026; no run 43176472308 a tentativa 2 falhou e a 3 passou
 * no mesmo commit). O CDN serve DOIS conteúdos para essa URL versionada
 * (sha256 c38da5dd… e ebce3cd5…); o deno.lock guarda um, e quando o CDN
 * entrega o outro o Deno recusa. Quem importa o tslib é o `auth-js` e o
 * `functions-js` do esm.sh, de forma transitiva, então não dá para trocar o
 * import no nosso código: o deno.json mapeia a URL para uma cópia local.
 *
 * O QUE ESTES TESTES MEDEM:
 *
 * 1. O mapa do deno.json está valendo: a URL do CDN resolve para um arquivo
 *    local, não para https. Sem o mapa, o Deno volta a baixar do CDN e a
 *    falha aleatória volta.
 * 2. A cópia local não mudou por descuido (sha256 fixado) e exporta os
 *    ajudantes que o auth-js/functions-js usam.
 * 3. O deno.lock NÃO volta a fixar o hash do CDN para esse endereço: um hash
 *    fixado ali é exatamente a comparação que falhava.
 */
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_DO_CDN = "https://esm.sh/tslib@2.8.1/denonext/tslib.mjs";
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const COPIA = `${RAIZ}supabase/functions/_shared/vendor/tslib-2.8.1.mjs`;
// sha256 da cópia local, com o cabeçalho de proveniência. Mudou de propósito?
// Recalcule e explique o porquê no cabeçalho da cópia.
const SHA256_DA_COPIA =
  "d52592a396755eaf93be57f0d40f46f983c015109b1b33c19db764ba1ff6fa31";

async function sha256(bytes: Uint8Array): Promise<string> {
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("tslib do esm.sh resolve para a cópia local, não para o CDN", () => {
  const resolvido = import.meta.resolve(URL_DO_CDN);
  assert(
    resolvido.startsWith("file:"),
    `a URL do CDN deveria resolver para arquivo local, resolveu para ${resolvido}`,
  );
  assertStringIncludes(
    resolvido,
    "/supabase/functions/_shared/vendor/tslib-2.8.1.mjs",
  );
});

Deno.test("a cópia local do tslib está intacta e exporta o que o auth-js usa", async () => {
  const bytes = await Deno.readFile(COPIA);
  assertEquals(await sha256(bytes), SHA256_DA_COPIA);

  // Importar pelo ENDEREÇO DO CDN prova o mapa de ponta a ponta: se ele
  // sumir, este import vai à rede e/ou cai na checagem de integridade.
  const {
    __rest,
    __awaiter,
    __extends,
    __assign,
    default: padrao,
  } = await import(URL_DO_CDN);
  assertEquals(typeof __rest, "function");
  assertEquals(typeof __awaiter, "function");
  assertEquals(typeof __extends, "function");
  assertEquals(typeof __assign, "function");
  assertEquals(typeof padrao, "object");
});

Deno.test("o deno.lock não fixa de novo o hash do tslib do CDN", async () => {
  const lock = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.lock`));
  const remotos = Object.keys(lock.remote ?? {});
  assertEquals(
    remotos.filter((u) => u.includes("esm.sh/tslib@")),
    [],
    "hash fixado do tslib no lock = a comparação que falhava ao acaso",
  );
});

Deno.test("o deno.json mapeia o tslib e continua exigindo o lock dos demais", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.json`));
  assertEquals(
    Object.entries(config.imports ?? {}).filter(([url]) => url === URL_DO_CDN),
    [[URL_DO_CDN, "./supabase/functions/_shared/vendor/tslib-2.8.1.mjs"]],
  );
  // Nada de desligar a verificação de integridade para "resolver" a flake.
  assertEquals(config.lock, undefined);
  const pacote = JSON.parse(await Deno.readTextFile(`${RAIZ}package.json`));
  assert(!pacote.scripts["test:edge"].includes("--no-lock"));
  assert(!pacote.scripts["test:unit"].includes("--no-lock"));
});
