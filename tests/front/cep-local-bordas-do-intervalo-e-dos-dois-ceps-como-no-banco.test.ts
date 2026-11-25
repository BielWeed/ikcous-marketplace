// Achado por mutação, 25/11/2026, em `cepEhLocal` (cópia no front de
// `is_local_cep`, migration baseline linha 3128, e da `isLocalCep` da edge
// calculate-shipping). A suíte de CEP já cobria o caminho feliz e as bordas de
// dígitos, mas 12 mudanças de uma linha passavam todas verdes:
//   · item com TRÊS blocos de dígitos lido como intervalo (`=== 2` -> `>= 2`);
//   · ponta de 5 dígitos aceita como "bloco longo" (`>= 6` -> `>= 5`), nas duas pontas;
//   · dois CEPs completos avulsos lidos como faixa MESMO quando já existe um
//     intervalo explícito no texto (`faixas.length === 0` -> `>= 0`);
//   · dois CEPs avulsos de 9 dígitos lidos como faixa (`every(=== 8)` -> `>= 8`);
//   · os dois CEPs avulsos fora de ordem sem ordenar (a faixa "invertida" só era
//     testada no formato de bloco longo);
//   · prefixo casando no MEIO do CEP (`startsWith` -> `includes`);
//   · item de 9+ dígitos casando exato em vez de por prefixo (`=== 8` -> `>= 8`);
//   · CEP digitado pela metade completado com 9 em vez de 0 (`padEnd`).
// Cada caso abaixo tem a resposta que o BANCO daria para o mesmo texto: a
// cliente vê no carrinho o mesmo que o pedido vai confirmar no servidor.
import { cepEhLocal } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

const LOJA = "38500000";

describe("cepEhLocal — só dois blocos longos são intervalo (como no banco)", () => {
  it("três blocos de dígitos NÃO são intervalo: viram um 'CEP' de 13 dígitos que não casa com ninguém", () => {
    expect(cepEhLocal(LOJA, "38550000", "385000-385999-1")).toBe(false);
    expect(cepEhLocal(LOJA, "38550000", "38500000-38599999-9")).toBe(false);
  });

  it("controle: os mesmos dois blocos, sem o terceiro, são intervalo", () => {
    expect(cepEhLocal(LOJA, "38550000", "385000-385999")).toBe(true);
  });

  it("ponta de 5 dígitos NÃO é bloco longo: o item vira um prefixo gigante que não casa", () => {
    expect(cepEhLocal(LOJA, "38550000", "38500-385999")).toBe(false);
    expect(cepEhLocal(LOJA, "38550000", "385000-38599")).toBe(false);
  });

  it("ponta de 6 dígitos já é bloco longo, nas duas pontas", () => {
    expect(cepEhLocal(LOJA, "38550000", "385000-385999")).toBe(true);
    expect(cepEhLocal(LOJA, "38550000", "385000-38599999")).toBe(true);
    expect(cepEhLocal(LOJA, "38550000", "38500000-385999")).toBe(true);
  });
});

describe("cepEhLocal — dois CEPs completos avulsos formam faixa só se NÃO há intervalo no texto", () => {
  it("com um intervalo explícito no texto, os dois CEPs completos avulsos valem cada um só por si", () => {
    const faixa = "38500000-38505000, 39000000, 39000999";
    // 39000500 está ENTRE os dois avulsos, mas o intervalo explícito desliga a leitura "dois CEPs = faixa".
    expect(cepEhLocal(LOJA, "39000500", faixa)).toBe(false);
    expect(cepEhLocal(LOJA, "39000000", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "39000999", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "38502000", faixa)).toBe(true);
  });

  it("controle: sem intervalo no texto, os mesmos dois CEPs completos formam a faixa", () => {
    expect(cepEhLocal(LOJA, "39000500", "39000000, 39000999")).toBe(true);
  });

  it("os dois CEPs fora de ordem ainda formam a faixa (o banco usa LEAST e GREATEST)", () => {
    expect(cepEhLocal(LOJA, "38500500", "38500999, 38500000")).toBe(true);
    expect(cepEhLocal(LOJA, "38500000", "38500999, 38500000")).toBe(true);
    expect(cepEhLocal(LOJA, "38500999", "38500999, 38500000")).toBe(true);
    expect(cepEhLocal(LOJA, "38501000", "38500999, 38500000")).toBe(false);
    expect(cepEhLocal(LOJA, "38499999", "38500999, 38500000")).toBe(false);
  });

  it("dois itens de 9 dígitos NÃO são dois CEPs completos: não formam faixa", () => {
    expect(cepEhLocal(LOJA, "385000500", "385000001, 385000999")).toBe(false);
  });
});

describe("cepEhLocal — o CEP do destino chega com pontos, hífen e espaços", () => {
  it("tira TODA a pontuação do destino, não só o primeiro sinal", () => {
    const faixa = "38500000-38505000";
    expect(cepEhLocal(LOJA, "38.500-000", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "38 500 - 000", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, " 38.502.000 ", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "38.600-000", faixa)).toBe(false);
  });
});

describe("cepEhLocal — prefixo, item comprido e CEP pela metade", () => {
  it("prefixo casa só no COMEÇO do CEP, nunca no meio", () => {
    expect(cepEhLocal(LOJA, "38512345", "385")).toBe(true);
    expect(cepEhLocal(LOJA, "12385000", "385")).toBe(false);
    expect(cepEhLocal(LOJA, "00038500", "385, 386")).toBe(false);
  });

  it("item com mais de 8 dígitos vale como prefixo, não como CEP exato", () => {
    expect(cepEhLocal(LOJA, "3850000012", "385000001")).toBe(true);
    expect(cepEhLocal(LOJA, "3850000022", "385000001")).toBe(false);
  });

  it("CEP do destino digitado pela metade é completado com ZEROS: vale o começo da região", () => {
    const faixa = "38500000-38505000";
    expect(cepEhLocal(LOJA, "385", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "3850", faixa)).toBe(true);
    expect(cepEhLocal(LOJA, "386", faixa)).toBe(false);
  });
});
