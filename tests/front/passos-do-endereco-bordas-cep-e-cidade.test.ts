// Caça por mutação na barra de 3 passos do endereço: duas bordas que o teste
// principal (`passos-do-endereco.test.ts`) não pisava.
//   1. CEP: vale a contagem de DÍGITOS == 8. 9 dígitos NÃO enche o passo 1
//      (a tela não pode mostrar "1 pronto" para um CEP que o formulário recusa),
//      e pontuação/espaço no meio ("38.500 000") não conta como dígito.
//   2. Cidade: o passo 2 só enche com cidade preenchida (vazia ou só de espaços
//      mantém a barra no "1 de 3"), igual rua, bairro e UF.
import { passosDoEndereco } from "@/lib/passos-do-endereco";
import { describe, expect, it } from "vitest";

const COMPLETO = {
  cep: "38500-000",
  rua: "Rua Exemplo",
  bairro: "Centro",
  cidade: "Cidade Exemplo",
  uf: "MG",
  numero: "12",
  recebedor: "Fulana",
};

function cheios(entrada: Parameters<typeof passosDoEndereco>[0]) {
  return passosDoEndereco(entrada).segmentos.map((s) => s.cheio);
}

describe("passosDoEndereco — CEP conta dígitos, exatamente 8", () => {
  it("9 dígitos (dígito a mais colado) não enche nem o passo 1", () => {
    const entrada = { ...COMPLETO, cep: "385000001" };
    expect(cheios(entrada)).toEqual([false, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("pontuação e espaço no meio não contam: '38.500 000' tem 8 dígitos e enche", () => {
    expect(cheios({ ...COMPLETO, cep: "38.500 000" })).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("8 caracteres que não são todos dígitos ('3850A000') não enchem", () => {
    expect(cheios({ ...COMPLETO, cep: "3850A000" })).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("passosDoEndereco — cidade é parte do endereço", () => {
  it("cidade vazia mantém o passo 2 vazio, mesmo com rua, bairro e UF", () => {
    const entrada = { ...COMPLETO, cidade: "" };
    expect(cheios(entrada)).toEqual([true, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("cidade só de espaços também", () => {
    expect(cheios({ ...COMPLETO, cidade: "   " })).toEqual([
      true,
      false,
      false,
    ]);
  });
});
