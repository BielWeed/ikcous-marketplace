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

  it("ignora dígito além do 11º (não deixa passar de 11)", () => {
    expect(formatarCpf("111444777350000")).toEqual({
      limpo: "11144477735",
      formatado: "111.444.777-35",
    });
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
