// Barra de 3 passos da tela "Novo endereço" (redesenho Tinta, 23/10/2026):
// 1 enche com o CEP de 8 dígitos; 2 com rua+bairro+cidade+UF; 3 com número e
// "quem vai receber". O "N de 3" é o primeiro segmento VAZIO (mínimo 1,
// máximo 3). Função pura: o que a tela mostra sai só destes sete campos.
import { describe, expect, it } from "vitest";

import { passosDoEndereco } from "@/lib/passos-do-endereco";

const VAZIO = {
  cep: "",
  rua: "",
  bairro: "",
  cidade: "",
  uf: "",
  numero: "",
  recebedor: "",
};

const ENDERECO = {
  rua: "Rua Exemplo",
  bairro: "Centro",
  cidade: "Cidade Exemplo",
  uf: "MG",
};

function cheios(entrada: Parameters<typeof passosDoEndereco>[0]) {
  return passosDoEndereco(entrada).segmentos.map((s) => s.cheio);
}

describe("passosDoEndereco — N de 3 por estado", () => {
  it("tela recém-aberta: nenhum segmento cheio, passo 1", () => {
    const p = passosDoEndereco(VAZIO);
    expect(cheios(VAZIO)).toEqual([false, false, false]);
    expect(p.atual).toBe(1);
  });

  it("CEP incompleto (7 dígitos, com máscara) não enche o segmento 1", () => {
    const p = passosDoEndereco({ ...VAZIO, cep: "38500-00" });
    expect(p.segmentos[0].cheio).toBe(false);
    expect(p.atual).toBe(1);
  });

  it("CEP de 8 dígitos (com ou sem hífen) enche o 1 e leva ao passo 2", () => {
    for (const cep of ["38500-000", "38500000"]) {
      const p = passosDoEndereco({ ...VAZIO, cep });
      expect(p.segmentos.map((s) => s.cheio)).toEqual([true, false, false]);
      expect(p.atual).toBe(2);
    }
  });

  it("endereço incompleto (falta o bairro) não enche o 2", () => {
    const entrada = { ...VAZIO, cep: "38500-000", ...ENDERECO, bairro: "" };
    expect(cheios(entrada)).toEqual([true, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(2);
  });

  it("UF faltando, ou rua só de espaços, não enche o 2 (mesma régua do zod: aparado)", () => {
    const base = { ...VAZIO, cep: "38500-000", ...ENDERECO };
    expect(cheios({ ...base, uf: "" })).toEqual([true, false, false]);
    expect(cheios({ ...base, rua: "   " })).toEqual([true, false, false]);
  });

  it("CEP + endereço, sem número: segmento 3 vazio, passo 3", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      ...ENDERECO,
      recebedor: "Fulana de Tal",
    };
    expect(cheios(entrada)).toEqual([true, true, false]);
    expect(passosDoEndereco(entrada).atual).toBe(3);
  });

  it("número sem 'quem vai receber' (ou o contrário) não enche o 3", () => {
    const base = { ...VAZIO, cep: "38500-000", ...ENDERECO };
    expect(cheios({ ...base, numero: "12" })[2]).toBe(false);
    expect(cheios({ ...base, recebedor: "Fulana" })[2]).toBe(false);
  });

  it("número só de espaços não enche o 3", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      ...ENDERECO,
      numero: "   ",
      recebedor: "Fulana",
    };
    expect(cheios(entrada)[2]).toBe(false);
  });

  it("tudo preenchido: três segmentos cheios e o passo para em 3 (nunca 4)", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      ...ENDERECO,
      numero: "12",
      recebedor: "Fulana",
    };
    expect(cheios(entrada)).toEqual([true, true, true]);
    expect(passosDoEndereco(entrada).atual).toBe(3);
  });

  it("edição: endereço salvo já chega com tudo cheio", () => {
    const entrada = {
      cep: "38500-000",
      ...ENDERECO,
      numero: "S/N",
      recebedor: "Fulana",
    };
    expect(cheios(entrada)).toEqual([true, true, true]);
  });

  it("a ordem não pula: endereço sem CEP deixa o passo em 1", () => {
    const entrada = { ...VAZIO, ...ENDERECO, numero: "1", recebedor: "F" };
    const p = passosDoEndereco(entrada);
    expect(p.segmentos.map((s) => s.cheio)).toEqual([false, true, true]);
    expect(p.atual).toBe(1);
  });
});
