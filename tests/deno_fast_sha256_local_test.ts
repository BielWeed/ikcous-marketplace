// @ts-nocheck
/**
 * Em 28/11/2026 o job "Testes (Deno — edge + unit)" caiu 3 vezes no mesmo dia
 * (PRs #2076, #2069, #2083, e de novo no run 46124860819) com "Integrity check
 * failed for remote specifier" em
 * https://esm.sh/fast-sha256@1.3.0/deno/fast-sha256.mjs: o lock trava sha256
 * bcf37227…, e o CDN entregou 7a13f9da… ao runner. O esm.sh serve dois
 * conteúdos para essa URL versionada (medido em 28/11 a partir do Brasil: 8 de
 * 8 downloads deram bcf37227…; o runner do GitHub recebeu o outro). As
 * tentativas no mesmo runner recebem os mesmos bytes errados, então repetir o
 * download não resolve. Quem importa é o `standardwebhooks@1.1.1` (hook de
 * e-mail do login), de forma transitiva, então o import não é nosso.
 *
 * Mesma receita do tslib (PR #1535) e do stablelib/base64
 * (tests/deno_stablelib_local_test.ts): o deno.json mapeia a URL do CDN para
 * uma cópia local, e o hash dela sai do deno.lock.
 *
 * O QUE ESTES TESTES MEDEM:
 *
 * 1. O mapa do deno.json está valendo: a URL do CDN resolve para um arquivo
 *    local. Sem o mapa, o Deno volta ao CDN e a falha de integridade volta.
 * 2. A cópia local é EXATAMENTE o conteúdo que o lock travava (bcf37227…):
 *    tirando o cabeçalho de proveniência e devolvendo a linha
 *    sourceMappingURL, o sha256 é o mesmo. E ela FAZ o que o standardwebhooks
 *    usa dela (`hmac`), conferido contra a RFC 4231 e contra o crypto.subtle.
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
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_DO_CDN = "https://esm.sh/fast-sha256@1.3.0/deno/fast-sha256.mjs";
const PONTE_DO_CDN = "https://esm.sh/fast-sha256@1.3.0?target=deno";
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const COPIA = `${RAIZ}supabase/functions/_shared/vendor/fast-sha256-1.3.0.mjs`;
// sha256 da cópia local, com o cabeçalho de proveniência. Mudou de propósito?
// Recalcule e explique o porquê no cabeçalho da cópia.
const SHA256_DA_COPIA =
  "ddcb92cee7c16452b9f2f79952b4bc5055add42eea9fcd728616bafe9e7392d0";
// O hash que o deno.lock travava para a URL do CDN até 28/11/2026.
const SHA256_TRAVADO_NO_LOCK =
  "bcf37227dddce83918628de1aed52ce77d8211499b3ad06c019cc77e0322c0b2";
// A última linha do arquivo do CDN, que a cópia não carrega (sem barra final).
const LINHA_DO_MAPA = "//# sourceMappingURL=fast-sha256.mjs.map";
const INICIO_DO_CONTEUDO = "/* esm.sh - fast-sha256@1.3.0 */";

async function sha256(bytes: Uint8Array): Promise<string> {
  const resumo = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.test("fast-sha256 do esm.sh resolve para a cópia local, não para o CDN", () => {
  const resolvido = import.meta.resolve(URL_DO_CDN);
  assert(
    resolvido.startsWith("file:"),
    `a URL do CDN deveria resolver para arquivo local, resolveu para ${resolvido}`,
  );
  assertStringIncludes(
    resolvido,
    "/supabase/functions/_shared/vendor/fast-sha256-1.3.0.mjs",
  );
});

Deno.test("a cópia local do fast-sha256 é o conteúdo travado no lock", async () => {
  const bytes = await Deno.readFile(COPIA);
  assertEquals(await sha256(bytes), SHA256_DA_COPIA);

  // Equivalência provada byte a byte: cabeçalho fora, linha do mapa de volta.
  const texto = new TextDecoder().decode(bytes);
  const inicio = texto.indexOf(INICIO_DO_CONTEUDO);
  assert(
    inicio > 0,
    "a cópia deveria ter o cabeçalho de proveniência antes do conteúdo",
  );
  const original = new TextEncoder().encode(
    texto.slice(inicio) + LINHA_DO_MAPA,
  );
  assertEquals(await sha256(original), SHA256_TRAVADO_NO_LOCK);
});

Deno.test("a cópia local do fast-sha256 calcula hash e hmac de verdade", async () => {
  // Importar pelo ENDEREÇO DO CDN prova o mapa de ponta a ponta: se ele
  // sumir, este import vai à rede e/ou cai na checagem de integridade.
  const { default: sha } = await import(URL_DO_CDN);
  assertEquals(typeof sha.hash, "function");
  assertEquals(typeof sha.hmac, "function");

  const texto = (s: string) => new TextEncoder().encode(s);
  // FIPS 180-2, "abc".
  assertEquals(
    hex(sha.hash(texto("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  // RFC 4231, caso 2 — `hmac` é o que o standardwebhooks usa para assinar.
  assertEquals(
    hex(sha.hmac(texto("Jefe"), texto("what do ya want for nothing?"))),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );

  // Uso real: segredo de 32 bytes, mensagem "id.timestamp.corpo" com todos
  // os 256 valores de byte. Tem de bater com o HMAC do próprio runtime.
  const segredo = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255);
  const mensagem = Uint8Array.from({ length: 256 }, (_, i) => i);
  const chave = await crypto.subtle.importKey(
    "raw",
    segredo,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const esperado = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, mensagem),
  );
  assertEquals(hex(sha.hmac(segredo, mensagem)), hex(esperado));
});

Deno.test("o deno.lock não fixa de novo o hash do fast-sha256 do CDN", async () => {
  const lock = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.lock`));
  const remotos = Object.keys(lock.remote ?? {});
  // Só o arquivo MAPEADO sai do lock; o endereço-ponte continua verificado.
  assertEquals(
    remotos.filter((u) => u === URL_DO_CDN),
    [],
    "hash fixado do arquivo do fast-sha256 no lock = a comparação que falhava",
  );
  assert(
    remotos.includes(PONTE_DO_CDN),
    "o endereço-ponte do fast-sha256 deveria continuar verificado pelo lock",
  );
});

Deno.test("o deno.json mapeia o fast-sha256 e continua exigindo o lock dos demais", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${RAIZ}deno.json`));
  assertEquals(
    Object.entries(config.imports ?? {}).filter(([url]) => url === URL_DO_CDN),
    [[URL_DO_CDN, "./supabase/functions/_shared/vendor/fast-sha256-1.3.0.mjs"]],
  );
  // Os mapas anteriores (tslib, PR #1535; stablelib) não podem se perder.
  assertEquals(
    config.imports["https://esm.sh/tslib@2.8.1/denonext/tslib.mjs"],
    "./supabase/functions/_shared/vendor/tslib-2.8.1.mjs",
  );
  assertEquals(
    config.imports["https://esm.sh/@stablelib/base64@1.0.1/deno/base64.mjs"],
    "./supabase/functions/_shared/vendor/stablelib-base64-1.0.1.mjs",
  );
  // Nada de desligar a verificação de integridade para "resolver" a flake.
  assertEquals(config.lock, undefined);
  const pacote = JSON.parse(await Deno.readTextFile(`${RAIZ}package.json`));
  assert(!pacote.scripts["test:edge"].includes("--no-lock"));
  assert(!pacote.scripts["test:unit"].includes("--no-lock"));
});
