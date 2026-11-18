import {
  cpfValido,
  formatarCpf,
  mascararCpfParaExibicao,
  somenteDigitosDoCpf,
} from "@/lib/cpf";
import { describe, expect, it } from "vitest";

describe("somenteDigitosDoCpf", () => {
  it("remove pontuação e traço", () => {
    expect(somenteDigitosDoCpf("111.444.777-35")).toBe("11144477735");
  });

  it("aceita entrada já sem máscara", () => {
    expect(somenteDigitosDoCpf("11144477735")).toBe("11144477735");
  });
});

describe("formatarCpf", () => {
  it("formata progressivamente enquanto digita", () => {
    expect(formatarCpf("111")).toEqual({ limpo: "111", formatado: "111" });
    expect(formatarCpf("111444")).toEqual({
      limpo: "111444",
      formatado: "111.444",
    });
    expect(formatarCpf("111444777")).toEqual({
      limpo: "111444777",
      formatado: "111.444.777",
    });
    expect(formatarCpf("11144477735")).toEqual({
      limpo: "11144477735",
      formatado: "111.444.777-35",
    });
  });

  it("NÃO corta em silêncio o que passa do 11º dígito: o excedente fica e o CPF reprova", () => {
    // Antes: "12345678909000" virava "123.456.789-09" (um CPF válido) e a
    // cliente nem via que o número tinha mudado.
    const colado = formatarCpf("12345678909000");
    expect(colado.limpo).toBe("12345678909000");
    expect(colado.formatado).toBe("123.456.789-09000");
    expect(cpfValido(colado.formatado)).toBe(false);
    expect(cpfValido("12345678909")).toBe(true);
  });

  it("12º dígito digitado no fim de um CPF completo também reprova", () => {
    const campo = formatarCpf("111.444.777-350");
    expect(campo.formatado).toBe("111.444.777-350");
    expect(cpfValido(campo.formatado)).toBe(false);
  });

  it("apagar o excedente devolve o CPF válido", () => {
    expect(cpfValido(formatarCpf("111.444.777-350").formatado)).toBe(false);
    expect(cpfValido(formatarCpf("111.444.777-35").formatado)).toBe(true);
  });

  it("colagem enorme é limitada a 14 dígitos e continua reprovada", () => {
    const campo = formatarCpf("111444777351114447773511144477735");
    expect(campo.limpo).toHaveLength(14);
    expect(cpfValido(campo.formatado)).toBe(false);
  });

  it("CPF colado com máscara, espaços ou prefixo continua válido", () => {
    expect(formatarCpf(" 111.444.777-35 ").formatado).toBe("111.444.777-35");
    expect(formatarCpf("CPF: 11144477735").formatado).toBe("111.444.777-35");
    expect(cpfValido(formatarCpf("111 444 777 35").formatado)).toBe(true);
  });
});

describe("mascararCpfParaExibicao", () => {
  it("esconde os 3 primeiros e os 2 últimos dígitos, mostra o miolo", () => {
    expect(mascararCpfParaExibicao("11144477735")).toBe("***.444.777-**");
  });

  it("aceita entrada com máscara", () => {
    expect(mascararCpfParaExibicao("111.444.777-35")).toBe("***.444.777-**");
  });

  it("devolve o valor original quando não tem 11 dígitos (nunca mascara pela metade)", () => {
    expect(mascararCpfParaExibicao("111.444.777")).toBe("111.444.777");
    expect(mascararCpfParaExibicao("")).toBe("");
  });
});

describe("cpfValido", () => {
  it("aceita CPF válido com máscara", () => {
    expect(cpfValido("111.444.777-35")).toBe(true);
  });

  it("aceita o mesmo CPF sem máscara", () => {
    expect(cpfValido("11144477735")).toBe(true);
  });

  it("rejeita dígito verificador errado", () => {
    expect(cpfValido("111.444.777-30")).toBe(false);
  });

  it("rejeita primeiro dígito verificador errado mesmo com o segundo coerente", () => {
    // Base fictícia: soma 162, d1 = 3; com d1 trocado para 4, soma 206 e d2 = 3.
    expect(cpfValido("111.444.777-43")).toBe(false);
    expect(cpfValido("11144477743")).toBe(false);
  });

  it("rejeita sequência de dígito repetido, mesmo que a conta feche", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
    expect(cpfValido("222.222.222-22")).toBe(false);
  });

  it("rejeita entrada com menos de 11 dígitos", () => {
    expect(cpfValido("111.444.777")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });

  it("rejeita entrada com mais de 11 dígitos", () => {
    expect(cpfValido("111.444.777-350")).toBe(false);
  });

  it("rejeita string não numérica", () => {
    expect(cpfValido("abc.def.ghi-jk")).toBe(false);
  });
});
