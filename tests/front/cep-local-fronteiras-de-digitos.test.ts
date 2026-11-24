// Fronteiras de DÍGITOS do `cepEhLocal` que o teste espelho do banco não
// segurava (achadas por mutação, 24/11/2026). Todas seguem o `is_local_cep`
// do baseline SQL (a regra é uma só nas três cópias: SQL, edge e front):
//
// - origem ou destino sem dígitos é falso ANTES de olhar a faixa. Só a versão
//   "sem faixa" estava coberta; com faixa, um destino vazio caía em "0" e a
//   faixa de exemplo do painel ("00000-000, 00000-999") o declarava local.
// - destino com 7 dígitos (CEP digitado pela metade) completa com ZEROS à
//   direita (`rpad(destino, 8, '0')`), nunca à esquerda.
// - CEP completo (8 dígitos) casa EXATO: o mesmo CEP com um dígito a mais não
//   é o CEP da faixa (só item curto vale como prefixo).
import { cepEhLocal, temPrefixoDeSeteDigitos } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

describe("cepEhLocal — fronteiras de dígitos", () => {
  it("origem sem dígitos nunca é local, mesmo com faixa configurada", () => {
    expect(cepEhLocal("", "38503-123", "38500000-38505000")).toBe(false);
    expect(cepEhLocal("sem cep", "38503-123", "38500000-38505000")).toBe(false);
  });

  it("destino sem dígitos nunca é local, nem com a faixa de exemplo que começa em zero", () => {
    expect(cepEhLocal("38500-000", "", "00000-000, 00000-999")).toBe(false);
    expect(cepEhLocal("38500-000", "---", "00000000-00000999")).toBe(false);
  });

  it("destino de 7 dígitos completa com zeros à direita: 3850012 vale 38500120", () => {
    expect(cepEhLocal("38500000", "3850012", "38500120-38500129")).toBe(true);
    // CONTROLE: 3850013 vale 38500130, fora da faixa.
    expect(cepEhLocal("38500000", "3850013", "38500120-38500129")).toBe(false);
  });

  it("CEP completo na faixa casa exato: com um dígito a mais já não é o mesmo CEP", () => {
    expect(cepEhLocal("38500000", "38500123", "38500123")).toBe(true);
    expect(cepEhLocal("38500000", "385001239", "38500123")).toBe(false);
  });

  it("item curto vale como prefixo: o CEP completo dentro dele é local", () => {
    expect(cepEhLocal("38500000", "38500123", "38500")).toBe(true);
    expect(cepEhLocal("38500000", "38501123", "38500")).toBe(false);
  });
});

// O aviso do painel "isso vale como prefixo" só vale para o item de EXATOS 7
// dígitos: CEP completo (8) e faixa explícita (dois blocos de 6+) não são
// prefixo.
describe("temPrefixoDeSeteDigitos — o aviso do painel", () => {
  it("item de 7 dígitos (com ou sem hífen) é prefixo, em qualquer posição da lista", () => {
    expect(temPrefixoDeSeteDigitos("3850012")).toBe(true);
    expect(temPrefixoDeSeteDigitos("38500-12")).toBe(true);
    expect(temPrefixoDeSeteDigitos("38500-000, 3850012")).toBe(true);
  });

  it("CEP completo, faixa explícita e item curto não são 'prefixo de sete'", () => {
    expect(temPrefixoDeSeteDigitos("38500-000")).toBe(false);
    expect(temPrefixoDeSeteDigitos("38500000-38505000")).toBe(false);
    expect(temPrefixoDeSeteDigitos("385000-385050")).toBe(false);
    expect(temPrefixoDeSeteDigitos("385001")).toBe(false);
    expect(temPrefixoDeSeteDigitos("")).toBe(false);
  });
});
