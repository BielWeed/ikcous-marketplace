// @ts-nocheck
/**
 * Pacote cifrado do cofre (scripts/frota/pacote-do-cofre.mjs), base do backup
 * das autorizações das lojistas (T9). O que este arquivo trava:
 *
 *  - ida e volta: decifrar(frase, cifrar(frase, mapa)) devolve o mesmo mapa;
 *  - frase errada, 1 byte trocado no corpo ou no cabeçalho, arquivo cortado:
 *    o MESMO erro genérico, sem nada do conteúdo, da frase nem do erro de
 *    baixo nível;
 *  - o cabeçalho é autenticado (AAD do AES-GCM): nenhum byte dele muda sem a
 *    decifragem recusar;
 *  - sal e IV aleatórios: dois cifrar seguidos dão bytes diferentes;
 *  - frase com menos de 12 caracteres é recusada antes de qualquer conta;
 *  - os parâmetros do scrypt são N=2^17, r=8, p=1, maxmem 256 MB.
 *
 * Os valores são FALSOS, inventados aqui. Cada cifrar/decifrar roda o scrypt
 * de verdade (~0,4 s).
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CABECALHO,
  ErroDoPacote,
  PARAMETROS_SCRYPT,
  cifrar,
  decifrar,
} from "../scripts/frota/pacote-do-cofre.mjs";

const FRASE = "uma frase FALSA bem comprida, com ação ✓";
const MAPA = {
  "loja-um":
    '{"refresh":"refresh-FALSO-um-xyz","segredo":"s3gr3d0-FALSO-um","senha":"senha-FALSA-um"}',
  "loja-dois": '{"refresh":"refresh-FALSO-dois","senha":"senha-FALSA-ção"}',
};
const MENSAGEM = "Pacote do cofre: frase errada ou arquivo danificado.";
const TAM_CABECALHO = new TextEncoder().encode(CABECALHO).length;

/** O erro que a promessa lança (falha se ela resolver). */
async function erroDe(promessa) {
  const e = await promessa.then(
    () => null,
    (x) => x,
  );
  assert(e !== null, "não lançou erro");
  return e;
}

/** O erro genérico, sem conteúdo do mapa, da frase nem do erro de baixo nível. */
function assertErroGenerico(e) {
  assert(e instanceof ErroDoPacote, `não é ErroDoPacote: ${e?.name}`);
  assertEquals(e.message, MENSAGEM);
  assertEquals(e.cause, undefined, "carrega o erro de baixo nível");
  const tudo = `${e.message}\n${e.stack}\n${JSON.stringify(e)}`;
  for (const proibido of [
    "FALSO",
    "FALSA",
    "loja-um",
    "refresh",
    FRASE,
    "authenticate",
    "Unsupported",
  ]) {
    assert(!tudo.includes(proibido), `o erro carrega "${proibido}"`);
  }
}

function trocarByte(bytes, i) {
  const copia = Uint8Array.from(bytes);
  copia.set([copia.at(i) ^ 0x01], i);
  return copia;
}

Deno.test("ida e volta devolve o mesmo mapa", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  assert(bytes instanceof Uint8Array);
  assertEquals(await decifrar(FRASE, bytes), MAPA);
  // nada do conteúdo em claro no pacote
  const texto = new TextDecoder("latin1").decode(bytes);
  assert(!texto.includes("FALSO"), "conteúdo em claro no pacote");
  assert(!texto.includes("loja-um"), "nome de loja em claro no pacote");
  // o pacote começa pelo cabeçalho em texto
  assertEquals(
    new TextDecoder().decode(bytes.subarray(0, TAM_CABECALHO)),
    CABECALHO,
  );
});

Deno.test("mapa vazio também faz ida e volta", async () => {
  assertEquals(await decifrar(FRASE, await cifrar(FRASE, {})), {});
});

Deno.test("frase errada: erro genérico, sem conteúdo", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  assertErroGenerico(
    await erroDe(decifrar("outra frase FALSA comprida", bytes)),
  );
});

Deno.test("1 byte trocado no corpo cifrado: erro genérico", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  // primeiro byte do texto cifrado (depois de cabeçalho, sal 16 e IV 12)
  assertErroGenerico(
    await erroDe(decifrar(FRASE, trocarByte(bytes, TAM_CABECALHO + 28))),
  );
  // último byte (a etiqueta do GCM)
  assertErroGenerico(
    await erroDe(decifrar(FRASE, trocarByte(bytes, bytes.length - 1))),
  );
});

Deno.test("1 byte trocado no cabeçalho: erro genérico (cabeçalho é autenticado)", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  // um byte no meio dos parâmetros e o primeiro byte da magia
  for (const i of [TAM_CABECALHO - 3, 0]) {
    assertErroGenerico(await erroDe(decifrar(FRASE, trocarByte(bytes, i))));
  }
});

Deno.test("pacote cortado, vazio ou que não é bytes: erro genérico", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  for (const ruim of [
    bytes.subarray(0, bytes.length - 1),
    bytes.subarray(0, TAM_CABECALHO + 28 + 16),
    new Uint8Array(0),
    "não é bytes",
    undefined,
  ]) {
    assertErroGenerico(await erroDe(decifrar(FRASE, ruim)));
  }
});

Deno.test("dois cifrar seguidos dão bytes diferentes (sal e IV novos)", async () => {
  const a = await cifrar(FRASE, MAPA);
  const b = await cifrar(FRASE, MAPA);
  assertEquals(a.length, b.length);
  // o sal e o IV mudam; e o cifrado também
  const sal = (x) => x.subarray(TAM_CABECALHO, TAM_CABECALHO + 16).join(",");
  const iv = (x) =>
    x.subarray(TAM_CABECALHO + 16, TAM_CABECALHO + 28).join(",");
  assertNotEquals(sal(a), sal(b), "sal repetido");
  assertNotEquals(iv(a), iv(b), "IV repetido");
  assertNotEquals(a.join(","), b.join(","));
  assertEquals(await decifrar(FRASE, b), MAPA);
});

Deno.test("frase curta ou que não é texto é recusada (cifrar e decifrar)", async () => {
  const bytes = await cifrar(FRASE, MAPA);
  for (const frase of [
    "",
    "curta",
    "12345678901",
    "ççççççççççç",
    undefined,
    42,
  ]) {
    const e1 = await erroDe(cifrar(frase, MAPA));
    assert(e1 instanceof ErroDoPacote);
    assert(e1.message.includes("12"), "a mensagem não diz o mínimo");
    const e2 = await erroDe(decifrar(frase, bytes));
    assert(e2 instanceof ErroDoPacote);
  }
  // 12 caracteres exatos (com acento) passam
  const doze = "ççççççççççç1";
  assertEquals(await decifrar(doze, await cifrar(doze, MAPA)), MAPA);
});

Deno.test("frase com acento: cifrada em NFD e decifrada em NFC (outro teclado) abre igual", async () => {
  const nfc = "frase FALSA da ação no coração";
  const nfd = nfc.normalize("NFD");
  assertNotEquals(nfd, nfc, "o teste precisa de bytes diferentes");
  assertEquals(await decifrar(nfc, await cifrar(nfd, MAPA)), MAPA);
});

Deno.test("mapa que não é objeto de textos é recusado", async () => {
  for (const ruim of [
    null,
    undefined,
    "texto",
    [],
    ["a"],
    new Map([["loja-um", "x"]]),
    { "loja-um": 42 },
    { "loja-um": { a: 1 } },
  ]) {
    await assertRejects(() => cifrar(FRASE, ruim), ErroDoPacote);
  }
});

Deno.test("parâmetros: scrypt N=2^17 r=8 p=1 maxmem 256 MB, e o cabeçalho os declara", () => {
  assertEquals(PARAMETROS_SCRYPT, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  assert(Object.isFrozen(PARAMETROS_SCRYPT));
  assert(CABECALHO.includes("N=131072"));
  assert(CABECALHO.includes("r=8"));
  assert(CABECALHO.includes("p=1"));
  assert(CABECALHO.includes("aes-256-gcm"));
});
