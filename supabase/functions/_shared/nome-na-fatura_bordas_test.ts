// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `nome-na-fatura.ts` (o nome da loja que
 * aparece na fatura do cartão e evita a contestação "não reconheço a compra").
 * 26 mutantes plantados; 5 sobreviviam à suíte de `nome-na-fatura_test.ts`. 4
 * são equivalentes (cada um só troca "devolve undefined" por "lança dentro de
 * `comPrazo`, que devolve undefined": banco sem `from`, resposta nula, dado
 * ausente, o `?? undefined` final) e 1 mudava o resultado:
 *
 *   * a entrada é cortada em 200 caracteres ANTES de limpar: o nome que só
 *     aparece depois do caractere 200 não entra (e o do caractere 200 entra).
 *
 * O segundo caso (corte em 13 sem espaço sobrando) já era segurado; fica como
 * prova de limite ao lado do primeiro.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { LIMITE_DO_NOME_NA_FATURA, nomeNaFatura } from "./nome-na-fatura.ts";

Deno.test("nomeNaFatura: só os 200 primeiros caracteres da entrada contam (a limpeza vem depois do corte)", () => {
  // 199 espaços e depois o nome: o caractere 200 é o "A" (índice 199).
  assertEquals(nomeNaFatura(" ".repeat(199) + "ACME"), "A");
  // 200 espaços: o nome inteiro cai fora do corte e não sobra nada.
  assertEquals(nomeNaFatura(" ".repeat(200) + "ACME"), undefined);
  // um caractere a menos de espaço: "AC" entra.
  assertEquals(nomeNaFatura(" ".repeat(198) + "ACME"), "AC");
});

Deno.test("nomeNaFatura: o corte em 13 não deixa espaço sobrando na ponta", () => {
  assertEquals(LIMITE_DO_NOME_NA_FATURA, 13);
  assertEquals(nomeNaFatura("Loja Bonita Demais"), "LOJA BONITA D");
  // o 13º caractere é um espaço: some, em vez de sobrar
  assertEquals(nomeNaFatura("Loja Bonitas Demais"), "LOJA BONITAS");
  assertEquals(nomeNaFatura("1234567890123456"), "1234567890123");
});
