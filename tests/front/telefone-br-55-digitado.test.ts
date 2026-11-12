import {
  celularBrasileiroCompleto,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
} from "@/lib/telefone-br";
import { describe, expect, it } from "vitest";

// O campo devolvido pela máscara vira a entrada da tecla seguinte, como
// nos onChange do cadastro e do checkout. Não injeta o número inteiro.
function digitar(
  mascara: (novo: string, anterior?: string) => string,
  texto: string,
) {
  let campo = "";
  for (const tecla of texto) campo = mascara(campo + tecla, campo);
  return campo;
}

describe.each([
  ["cadastro", mascaraTelefoneDoCadastro],
  ["checkout", mascaraWhatsappBr],
] as const)("%s — código do Brasil digitado", (_nome, mascara) => {
  it("preserva +, +5 e +55 para a próxima tecla", () => {
    expect(digitar(mascara, "+")).toBe("+");
    expect(digitar(mascara, "+5")).toBe("+5");
    expect(digitar(mascara, "+55")).toBe("+55");
  });

  it.each([
    ["+55 34 99999 1234", "(34) 99999-1234"],
    ["+5534999991234", "(34) 99999-1234"],
    ["+5599999991234", "(99) 99999-1234"],
  ])(
    "digita %s sem perder o fim nem confundir país com DDD",
    (texto, esperado) => {
      const campo = digitar(mascara, texto);
      expect(campo).toBe(esperado);
      expect(celularBrasileiroCompleto(campo)).toBe(true);
    },
  );

  it("mantém o DDD 55 real, com ou sem país explícito", () => {
    expect(digitar(mascara, "55999991234")).toBe("(55) 99999-1234");
    expect(digitar(mascara, "+5555999991234")).toBe("(55) 99999-1234");
  });

  it.each(["5", "44"])(
    "um DDD 55 digitado com excesso %s continua sendo o mesmo telefone",
    (excesso) => {
      const campo = digitar(mascara, `55999991234${excesso}`);
      expect(campo).toBe("(55) 99999-1234");
      expect(celularBrasileiroCompleto(campo)).toBe(true);
    },
  );

  it("apagar o prefixo e redigitar um número nacional não deixa estado", () => {
    expect(mascara("", "+55")).toBe("");
    expect(digitar(mascara, "34999991234")).toBe("(34) 99999-1234");
  });
});
