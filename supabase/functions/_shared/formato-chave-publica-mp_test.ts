// @ts-nocheck
/**
 * `FORMATO_CHAVE_PUBLICA_MP` decide o que pode ser guardado como chave PÚBLICA
 * do Mercado Pago e devolvido ao navegador. O Access Token (secreto) também
 * começa com `APP_USR-`/`TEST-`; o que o separa da chave pública é a forma
 * `prefixo-UUID`. Se o formato aceitar demais, um token secreto vira "chave
 * pública" e vaza para qualquer visitante da loja. Nunca houve teste direto
 * deste módulo (caça por mutação de 25/11/2026).
 *
 * Os valores abaixo são inventados (UUIDs de exemplo, nunca uma chave real).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ERRO_CHAVE_PUBLICA_IGUAL_AO_TOKEN_MP,
  ERRO_FORMATO_CHAVE_PUBLICA_MP,
  FORMATO_CHAVE_PUBLICA_MP,
} from "./formato-chave-publica-mp.ts";

const UUID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

Deno.test("chave pública: APP_USR e TEST seguidos de UUID passam, em minúsculas ou maiúsculas", () => {
  assert(FORMATO_CHAVE_PUBLICA_MP.test(`APP_USR-${UUID}`));
  assert(FORMATO_CHAVE_PUBLICA_MP.test(`TEST-${UUID}`));
  assert(FORMATO_CHAVE_PUBLICA_MP.test(`TEST-${UUID.toUpperCase()}`));
});

Deno.test("chave pública: o formato de Access Token (números e hífens, sem UUID) NÃO passa", () => {
  // forma de um token secreto: APP_USR-<numero>-<mmddhh>-<hex>-<numero>
  const token = ["APP_USR", "1234567890123456", "112509", "abcdef0123456789abcdef0123456789", "987654321"].join("-");
  assertEquals(FORMATO_CHAVE_PUBLICA_MP.test(token), false);
});

Deno.test("chave pública: prefixo em minúsculas, outro prefixo ou sem prefixo não passam", () => {
  for (const ruim of [`app_usr-${UUID}`, `test-${UUID}`, `PROD-${UUID}`, `APP-${UUID}`, UUID, `APP_USR${UUID}`, `APP_USR_${UUID}`, `-${UUID}`]) {
    assertEquals(FORMATO_CHAVE_PUBLICA_MP.test(ruim), false, ruim);
  }
});

Deno.test("chave pública: nada antes nem depois do UUID (espaço, quebra de linha, sobra)", () => {
  for (const ruim of [
    ` APP_USR-${UUID}`,
    `APP_USR-${UUID} `,
    `APP_USR-${UUID}\n`,
    `\nAPP_USR-${UUID}`,
    `APP_USR-${UUID}0`,
    `xAPP_USR-${UUID}`,
    `TEST-${UUID}-extra`,
  ]) {
    assertEquals(FORMATO_CHAVE_PUBLICA_MP.test(ruim), false, JSON.stringify(ruim));
  }
});

Deno.test("chave pública: cada grupo do UUID tem o tamanho exato (8-4-4-4-12) e só hexadecimal", () => {
  for (const ruim of [
    "APP_USR-0a1b2c3-4e5f-6a7b-8c9d-0e1f2a3b4c5d", // primeiro grupo curto
    "APP_USR-0a1b2c3d0-4e5f-6a7b-8c9d-0e1f2a3b4c5d", // primeiro grupo longo
    "APP_USR-0a1b2c3d-4e5-6a7b-8c9d-0e1f2a3b4c5d", // segundo curto
    "APP_USR-0a1b2c3d-4e5f0-6a7b-8c9d-0e1f2a3b4c5d", // segundo longo
    "APP_USR-0a1b2c3d-4e5f-6a7-8c9d-0e1f2a3b4c5d", // terceiro curto
    "APP_USR-0a1b2c3d-4e5f-6a7b-8c9-0e1f2a3b4c5d", // quarto curto
    "APP_USR-0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5", // último curto (11)
    "APP_USR-0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d0", // último longo (13)
    "APP_USR-0a1b2c3g-4e5f-6a7b-8c9d-0e1f2a3b4c5d", // 'g' não é hexa
    "APP_USR-0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5z",
    "APP_USR-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d", // sem hífens
  ]) {
    assertEquals(FORMATO_CHAVE_PUBLICA_MP.test(ruim), false, ruim);
  }
});

Deno.test("mensagens de erro: dizem o que fazer e nunca citam um valor de chave", () => {
  assertEquals(
    ERRO_FORMATO_CHAVE_PUBLICA_MP,
    "Copie a chave pública (Public Key) no painel do Mercado Pago. Confira se não colou o token secreto.",
  );
  assertEquals(
    ERRO_CHAVE_PUBLICA_IGUAL_AO_TOKEN_MP,
    "A chave pública não pode ser o token secreto. Confira os campos.",
  );
});
