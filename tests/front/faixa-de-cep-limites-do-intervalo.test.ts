// FAIXA DE CEP RECONHECIDA — os limites do intervalo "início-fim" que a suíte
// principal (`faixa-de-cep-reconhecida.test.ts`) não amarra: cada ponta precisa
// ter 6 dígitos para formar intervalo, o preenchimento é de 8 dígitos (a ponta
// de início com 0, a de fim com 9) e o teto é o CEP 99999999.
import { describe, expect, it } from "vitest";

import { faixaDeCepReconhecida } from "@/lib/faixa-de-cep";

describe("faixaDeCepReconhecida — cada ponta do intervalo precisa de 6 dígitos", () => {
  it("início curto (5 dígitos) com fim longo NÃO é intervalo: cai na regra de prefixo e passa de 8 dígitos", () => {
    expect(faixaDeCepReconhecida("12345-123456")).toBe(false);
  });

  it("fim curto (5 dígitos) com início longo NÃO é intervalo, pelo mesmo motivo", () => {
    expect(faixaDeCepReconhecida("123456-12345")).toBe(false);
  });

  it("com 6 dígitos nas duas pontas é intervalo e é reconhecido", () => {
    expect(faixaDeCepReconhecida("385000-385999")).toBe(true);
  });
});

describe("faixaDeCepReconhecida — basta a MENOR ponta caber em 8 dígitos", () => {
  it("início válido e fim com 9 dígitos: reconhecido (a menor ponta cabe)", () => {
    expect(faixaDeCepReconhecida("38500000-123456789")).toBe(true);
  });

  it("início com 9 dígitos e fim válido: reconhecido (a cotação ordena as pontas)", () => {
    expect(faixaDeCepReconhecida("123456789-38500000")).toBe(true);
  });

  it("as duas pontas com 9 dígitos: nenhum CEP de 8 dígitos cabe, não reconhece", () => {
    expect(faixaDeCepReconhecida("123456789-987654321")).toBe(false);
  });

  it("início de 6 dígitos é preenchido com ZEROS até 8 (999999 vale 99999900, que cabe)", () => {
    // Se o preenchimento fosse de 9 casas, 999999 viraria 999999000 e as duas
    // pontas passariam do teto.
    expect(faixaDeCepReconhecida("999999-123456789")).toBe(true);
  });

  it("o teto é INCLUSIVO: 99999999 é um CEP de 8 dígitos e a faixa 99999999-99999999 é reconhecida", () => {
    expect(faixaDeCepReconhecida("99999999-99999999")).toBe(true);
  });
});
