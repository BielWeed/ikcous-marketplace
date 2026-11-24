// @ts-nocheck
/**
 * Em 24/11/2026 o job "Testes (Deno — edge + unit)" ficou vermelho em TODO PR
 * (run 45396219487) com "Integrity check failed for remote specifier" em
 * https://esm.sh/@stablelib/base64@1.0.1/deno/base64.mjs. Não foi o
 * supabase-js: é o `standardwebhooks@1.1.1` (hook de e-mail do login) que
 * importa o stablelib de forma transitiva. O esm.sh reconstruiu o arquivo com
 * outra versão do minificador (sha256 34390feb… no lock → 2cbea3c1… no ar);
 * medido contra a cópia de 21/10 do cache do Deno, a diferença é só
 * formatação: parênteses em volta de função autoexecutada e constante dobrada
 * (`18` virou `3*6`). O comportamento é o mesmo — mas o lock recusa.
 *
 * Mesma família do tslib (PR #1535, tests/deno_tslib_local_test.ts): o import
 * não é nosso para trocar, então o deno.json mapeia a URL do CDN para uma
 * cópia local, e o hash dela sai do deno.lock.
 *
 * O QUE ESTES TESTES MEDEM:
 *
 * 1. O mapa do deno.json está valendo: a URL do CDN resolve para um arquivo
 *    local. Sem o mapa, o Deno volta ao CDN e a falha de integridade volta.
 * 2. A cópia local não mudou por descuido (sha256 fixado) e FAZ o que o
 *    standardwebhooks usa dela: codifica/decodifica base64, inclusive nas
 *    bordas (vazio, os três tamanhos de preenchimento, caractere inválido).
 * 3. O deno.lock NÃO volta a fixar o hash do CDN para esse endereço.
 *
 * Nenhum teste aqui toca a rede: o endereço-ponte `?target=deno` (o que o
 * standardwebhooks de fato importa) continua verificado pelo deno.lock, e o
 * teste 3 exige que ele siga lá.
 */
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_DO_CDN = "https://esm.sh/@stablelib/base64@1.0.1/deno/base64.mjs";
const PONTE_DO_CDN = "https://esm.sh/@stablelib/base64@1.0.1?target=deno";
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const COPIA = `${RAIZ}supabase/functions/_shared/vendor/stablelib-base64-1.0.1.mjs`;
// sha256 da cópia local, com o cabeçalho de proveniência. Mudou de propósito?
// Recalcule e explique o porquê no cabeçalho da cópia.
const SHA256_DA_COPIA =
  "3bd7b624b2ab9c742e7bbc341ff10a37b66db8fba3b61630262da84b2a30f435";

async function sha256(bytes: Uint8Array): Promise<string> {
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("stablelib/base64 do esm.sh resolve para a cópia local, não para o CDN", () => {
  const resolvido = import.meta.resolve(URL_DO_CDN);
  assert(
    resolvido.startsWith("file:"),
    `a URL do CDN deveria resolver para arquivo local, resolveu para ${resolvido}`,
  );
  assertStringIncludes(
    resolvido,
    "/supabase/functions/_shared/vendor/stablelib-base64-1.0.1.mjs",
  );
});

Deno.test("a cópia local do stablelib/base64 está intacta e codifica/decodifica de verdade", async () => {
  const bytes = await Deno.readFile(COPIA);
  assertEquals(await sha256(bytes), SHA256_DA_COPIA);

  // Importar pelo ENDEREÇO DO CDN prova o mapa de ponta a ponta: se ele
  // sumir, este import vai à rede e/ou cai na checagem de integridade.
  const { encode, decode, default: padrao } = await import(URL_DO_CDN);
  assertEquals(typeof encode, "function");
  assertEquals(typeof decode, "function");
  assertEquals(typeof padrao, "object");

  const texto = (s: string) => new TextEncoder().encode(s);
  // Bordas: vazio e os três restos possíveis (0, 1 e 2 bytes sobrando).
  // Vetores da RFC 4648 §10.
  assertEquals(encode(new Uint8Array(0)), "");
  assertEquals(encode(texto("f")), "Zg==");
  assertEquals(encode(texto("fo")), "Zm8=");
  assertEquals(encode(texto("foo")), "Zm9v");
  assertEquals(encode(texto("foobar")), "Zm9vYmFy");
  assertEquals(new TextDecoder().decode(decode("Zm9vYmE=")), "fooba");
  assertEquals(decode("").length, 0);
  // `encodedLength` fica de fora de propósito: a fórmula da própria
  // biblioteca é uma estimativa (3 bytes -> 6), e o standardwebhooks não a usa.

  // Ida e volta com todos os 256 valores de byte (cobre os 64 símbolos e o
  // preenchimento), que é o uso real: segredo do webhook em base64.
  const todos = Uint8Array.from({ length: 256 }, (_, i) => i);
  assertEquals(decode(encode(todos)), todos);

  // Entrada inválida tem de FALHAR, não devolver lixo: o standardwebhooks
  // usa isto para ler o segredo da assinatura.
  assertThrows(() => decode("Zm9v!mFy"), Error, "incorrect characters");
});

Deno.test("o deno.lock não fixa de novo o hash do stablelib/base64 do CDN", async () => {
  const lock = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.lock`));
  const remotos = Object.keys(lock.remote ?? {});
  // Só o arquivo MAPEADO sai do lock; o endereço-ponte continua verificado.
  assertEquals(
    remotos.filter((u) => u === URL_DO_CDN),
    [],
    "hash fixado do arquivo do stablelib no lock = a comparação que falhava",
  );
  assert(
    remotos.includes(PONTE_DO_CDN),
    "o endereço-ponte do stablelib deveria continuar verificado pelo lock",
  );
});

Deno.test("o deno.json mapeia o stablelib e continua exigindo o lock dos demais", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.json`));
  assertEquals(
    Object.entries(config.imports ?? {}).filter(([url]) => url === URL_DO_CDN),
    [
      [
        URL_DO_CDN,
        "./supabase/functions/_shared/vendor/stablelib-base64-1.0.1.mjs",
      ],
    ],
  );
  // O mapa do tslib (PR #1535) não pode ter sido perdido no caminho.
  assertEquals(
    config.imports["https://esm.sh/tslib@2.8.1/denonext/tslib.mjs"],
    "./supabase/functions/_shared/vendor/tslib-2.8.1.mjs",
  );
  // Nada de desligar a verificação de integridade para "resolver" a flake.
  assertEquals(config.lock, undefined);
  const pacote = JSON.parse(await Deno.readTextFile(`${RAIZ}package.json`));
  assert(!pacote.scripts["test:edge"].includes("--no-lock"));
  assert(!pacote.scripts["test:unit"].includes("--no-lock"));
});
