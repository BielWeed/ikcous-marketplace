import { faixaDeCepReconhecida } from "@/lib/faixa-de-cep";
import { describe, expect, it } from "vitest";

describe("faixa de CEP reconhecível pela cotação para algum CEP de oito dígitos", () => {
  // Vereditos de isLocalCep em calculate-shipping/index.ts:558–596.
  // Vazio usa o fallback local, mas não contém uma faixa escrita.
  it.each([
    ["38500-000", true],
    ["38.500-000", true],
    ["38500000", true],
    ["385", true],
    ["38500-000, 38599-999", true],
    ["38500000-38599999", true],
    ["385999-385000", true],
    ["100000000-38500000", true],
    ["100000000-100000001", false],
    ["000000001-000000002", true],
    ["38500-000 a 38599-999", false],
    ["38500-000 até 38599-999", false],
    ["38500000 a 38599999", false],
    ["centro", false],
    ["", false],
    ["   ", false],
    [",,,", false],
    ["lixo, 38500-000", true],
    ["38500-000,\n38599-999", true],
    ["38500-000;38599-999", false],
    ["38500-000\n38599-999", false],
    ["385;00", true],
    ["38500-000 a 38599-999, 01310", true],
  ] as const)("%j → %s", (faixa, reconhecida) => {
    expect(faixaDeCepReconhecida(faixa)).toBe(reconhecida);
  });
});
