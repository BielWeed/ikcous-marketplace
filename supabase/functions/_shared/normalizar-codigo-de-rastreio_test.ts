// @ts-nocheck
/**
 * Testes de `normalizarCodigoDeRastreio` e `codigoDeRastreioTemLetraOuDigito`
 * (caça por mutação de 25/11/2026: o módulo não tinha teste Deno). O código de
 * rastreio digitado no painel ou recebido do Melhor Envio vira a chave de busca
 * do pacote e o link do cliente: espaço invisível colado do WhatsApp (NBSP,
 * largura zero, Braille em branco) fazia o link "não achar" a encomenda.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  codigoDeRastreioTemLetraOuDigito,
  normalizarCodigoDeRastreio,
} from "./normalizar-codigo-de-rastreio.ts";

Deno.test("normaliza: tira espaço comum, NBSP, espaço fino e espaço de ideograma", () => {
  assertEquals(normalizarCodigoDeRastreio("ab 123 br"), "AB123BR");
  assertEquals(normalizarCodigoDeRastreio("AB 123 BR　"), "AB123BR");
});

Deno.test("normaliza: tira caractere de controle (tab, quebra de linha) e de formato (largura zero, BOM)", () => {
  assertEquals(normalizarCodigoDeRastreio("AB\t12\n3\rBR"), "AB123BR");
  assertEquals(normalizarCodigoDeRastreio("AB​123﻿BR‍"), "AB123BR");
});

Deno.test("normaliza: o Braille em branco (U+2800) também some", () => {
  assertEquals(normalizarCodigoDeRastreio("AB⠀123⠀BR"), "AB123BR");
});

Deno.test("normaliza: converte para maiúsculas e conserva pontuação e acento", () => {
  assertEquals(normalizarCodigoDeRastreio("ab-12.3/br"), "AB-12.3/BR");
  assertEquals(normalizarCodigoDeRastreio("código1"), "CÓDIGO1");
});

Deno.test("normaliza: texto ausente (null/undefined) vira vazio, nunca lança", () => {
  assertEquals(normalizarCodigoDeRastreio(null), "");
  assertEquals(normalizarCodigoDeRastreio(undefined), "");
  assertEquals(normalizarCodigoDeRastreio(""), "");
  assertEquals(normalizarCodigoDeRastreio(" ​ "), "");
});

Deno.test("normaliza: rodar duas vezes dá o mesmo resultado (idempotente)", () => {
  const uma = normalizarCodigoDeRastreio(" ab 12-3 ");
  assertEquals(normalizarCodigoDeRastreio(uma), uma);
});

Deno.test("tem letra ou dígito: pontuação sozinha não é código", () => {
  assertEquals(codigoDeRastreioTemLetraOuDigito(""), false);
  assertEquals(codigoDeRastreioTemLetraOuDigito("---"), false);
  assertEquals(codigoDeRastreioTemLetraOuDigito("./-_"), false);
});

Deno.test("tem letra ou dígito: uma letra OU um dígito já basta, em qualquer posição", () => {
  assertEquals(codigoDeRastreioTemLetraOuDigito("A"), true);
  assertEquals(codigoDeRastreioTemLetraOuDigito("7"), true);
  assertEquals(codigoDeRastreioTemLetraOuDigito("--7--"), true);
  assertEquals(codigoDeRastreioTemLetraOuDigito("--É--"), true);
});

Deno.test("tem letra ou dígito: só dígito decimal conta; sobrescrito e fração não", () => {
  assertEquals(codigoDeRastreioTemLetraOuDigito("٣"), true); // dígito três arábico-índico
  assertEquals(codigoDeRastreioTemLetraOuDigito("²"), false); // ² (sobrescrito)
  assertEquals(codigoDeRastreioTemLetraOuDigito("½"), false); // ½
});
