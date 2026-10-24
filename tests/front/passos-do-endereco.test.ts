// Barra de 3 passos da tela "Novo endereço" (redesenho Tinta, 23/10/2026).
// Segmentos: 1 = CEP de 8 dígitos; 2 = rua+bairro+cidade+UF; 3 = número e
// "quem vai receber". Cada segmento só enche se o ANTERIOR encheu (nunca barra
// com buraco), e o "N de 3" é quantos estão cheios em sequência a partir do 1º
// (mínimo 1; nunca "3 de 3" com o 3º vazio). Função pura: o que a tela mostra
// sai só destes sete campos.
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
  it("tela recém-aberta: nenhum segmento cheio, '1 de 3'", () => {
    expect(cheios(VAZIO)).toEqual([false, false, false]);
    expect(passosDoEndereco(VAZIO).atual).toBe(1);
  });

  it("CEP incompleto (7 dígitos, com máscara) não enche o segmento 1", () => {
    const entrada = { ...VAZIO, cep: "38500-00" };
    expect(cheios(entrada)).toEqual([false, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("CEP de 8 dígitos (com ou sem hífen), endereço ainda vazio: [cheio, vazio, vazio], '1 de 3'", () => {
    for (const cep of ["38500-000", "38500000"]) {
      const entrada = { ...VAZIO, cep };
      expect(cheios(entrada)).toEqual([true, false, false]);
      expect(passosDoEndereco(entrada).atual).toBe(1);
    }
  });

  it("CEP achado SEM rua (cidade inteira): só o 1 cheio, '1 de 3'", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      cidade: "Cidade Exemplo",
      uf: "MG",
    };
    expect(cheios(entrada)).toEqual([true, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("endereço incompleto (falta o bairro) não enche o 2", () => {
    const entrada = { ...VAZIO, cep: "38500-000", ...ENDERECO, bairro: "" };
    expect(cheios(entrada)).toEqual([true, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("UF faltando, ou rua só de espaços, não enche o 2 (mesma régua do zod: aparado)", () => {
    const base = { ...VAZIO, cep: "38500-000", ...ENDERECO };
    expect(cheios({ ...base, uf: "" })).toEqual([true, false, false]);
    expect(cheios({ ...base, rua: "   " })).toEqual([true, false, false]);
  });

  it("CEP + endereço, número ainda vazio (o nome já vem da conta): [cheio, cheio, vazio], '2 de 3'", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      ...ENDERECO,
      recebedor: "Fulana de Tal",
    };
    expect(cheios(entrada)).toEqual([true, true, false]);
    expect(passosDoEndereco(entrada).atual).toBe(2);
  });

  it("número sem 'quem vai receber' (ou o contrário) não enche o 3", () => {
    const base = { ...VAZIO, cep: "38500-000", ...ENDERECO };
    expect(cheios({ ...base, numero: "12" })).toEqual([true, true, false]);
    expect(cheios({ ...base, recebedor: "Fulana" })).toEqual([
      true,
      true,
      false,
    ]);
    expect(passosDoEndereco({ ...base, numero: "12" }).atual).toBe(2);
  });

  it("número só de espaços não enche o 3", () => {
    const entrada = {
      ...VAZIO,
      cep: "38500-000",
      ...ENDERECO,
      numero: "   ",
      recebedor: "Fulana",
    };
    expect(cheios(entrada)).toEqual([true, true, false]);
  });

  it("tudo preenchido: três cheios, '3 de 3'", () => {
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
    expect(passosDoEndereco(entrada).atual).toBe(3);
  });

  it("nunca barra com buraco: sem CEP, rua e número que sobraram no formulário não enchem nada, '1 de 3'", () => {
    const entrada = { ...VAZIO, ...ENDERECO, numero: "1", recebedor: "F" };
    expect(cheios(entrada)).toEqual([false, false, false]);
    expect(passosDoEndereco(entrada).atual).toBe(1);
  });

  it("CEP apagado depois de tudo preenchido: a barra inteira volta a vazia", () => {
    const completo = {
      cep: "38500-000",
      ...ENDERECO,
      numero: "12",
      recebedor: "Fulana",
    };
    expect(cheios(completo)).toEqual([true, true, true]);
    const semCep = { ...completo, cep: "3850" };
    expect(cheios(semCep)).toEqual([false, false, false]);
    expect(passosDoEndereco(semCep).atual).toBe(1);
  });

  it("o N nunca passa de 3 nem cai abaixo de 1, em nenhuma combinação dos três segmentos", () => {
    const cepOk = "38500-000";
    for (const cep of ["", cepOk])
      for (const comEndereco of [false, true])
        for (const comEntrega of [false, true]) {
          const p = passosDoEndereco({
            ...VAZIO,
            cep,
            ...(comEndereco ? ENDERECO : {}),
            ...(comEntrega ? { numero: "1", recebedor: "F" } : {}),
          });
          expect(p.atual).toBeGreaterThanOrEqual(1);
          expect(p.atual).toBeLessThanOrEqual(3);
          // Sem buraco: depois do primeiro vazio, tudo vazio.
          const f = p.segmentos.map((s) => s.cheio);
          const primeiroVazio = f.indexOf(false);
          if (primeiroVazio !== -1)
            expect(f.slice(primeiroVazio).every((x) => !x)).toBe(true);
        }
  });
});
