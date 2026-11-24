// O que este teste protege: o resumo recolhido do checkout mostra o CPF como
// "***.456.789-**" SÓ quando ele tem exatamente 11 dígitos. Com 12 ou mais
// (um dígito a mais digitado) a máscara olharia só os 11 primeiros e mostraria
// um CPF "bonito" que não é o que está no campo; por isso o valor volta como
// veio, e o excesso continua à vista. O teste vizinho (`cpf.test.ts`) só cobre
// entrada com MENOS de 11 dígitos, então trocar `!== 11` por `< 11` passava.
import { mascararCpfParaExibicao } from "@/lib/cpf";
import { describe, expect, it } from "vitest";

describe("mascararCpfParaExibicao — só mascara 11 dígitos exatos", () => {
  it.each([
    "111.444.777-350",
    "111444777350",
    "11144477735000",
    "1114447773500000",
  ])("com dígito a mais (%s) devolve o valor como veio", (entrada) => {
    expect(mascararCpfParaExibicao(entrada)).toBe(entrada);
  });

  it.each(["1", "111.444.777-3", "1114447773"])(
    "com dígito a menos (%s) também devolve o valor como veio",
    (entrada) => {
      expect(mascararCpfParaExibicao(entrada)).toBe(entrada);
    },
  );

  it("com exatamente 11 dígitos mascara, mesmo cercado de espaços", () => {
    expect(mascararCpfParaExibicao(" 111.444.777-35 ")).toBe("***.444.777-**");
  });
});
