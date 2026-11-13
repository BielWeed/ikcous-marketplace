import {
  VALIDADE_DO_CODIGO_PARA_CADASTRO_MS,
  guardarCodigoParaCadastro,
  tomarCodigoParaCadastro,
} from "@/lib/codigo-para-cadastro";
import { beforeEach, describe, expect, it } from "vitest";

// O recado "código lido no balcão -> cadastro de produto novo": uma passagem,
// uma vez só, com validade curta e só no formato que o campo aceita.
describe("codigo-para-cadastro", () => {
  beforeEach(() => {
    // Esvazia qualquer recado de um teste anterior.
    tomarCodigoParaCadastro();
  });

  it("devolve o código guardado, na limpeza do campo", () => {
    guardarCodigoParaCadastro("  789 1234 567890 ", 1000);

    expect(tomarCodigoParaCadastro(1000)).toBe("7891234567890");
  });

  it("sem nada guardado devolve null", () => {
    expect(tomarCodigoParaCadastro(1000)).toBeNull();
  });

  it("vale uma vez só", () => {
    guardarCodigoParaCadastro("7891234567890", 1000);

    expect(tomarCodigoParaCadastro(1000)).toBe("7891234567890");
    expect(tomarCodigoParaCadastro(1000)).toBeNull();
  });

  it("vale até o limite da validade e vence logo depois", () => {
    guardarCodigoParaCadastro("7891234567890", 1000);
    expect(
      tomarCodigoParaCadastro(1000 + VALIDADE_DO_CODIGO_PARA_CADASTRO_MS),
    ).toBe("7891234567890");

    guardarCodigoParaCadastro("7891234567890", 1000);
    expect(
      tomarCodigoParaCadastro(1000 + VALIDADE_DO_CODIGO_PARA_CADASTRO_MS + 1),
    ).toBeNull();
  });

  it("o vencido também esvazia (não sobra para a próxima abertura)", () => {
    guardarCodigoParaCadastro("7891234567890", 1000);
    tomarCodigoParaCadastro(1000 + VALIDADE_DO_CODIGO_PARA_CADASTRO_MS + 1);

    expect(tomarCodigoParaCadastro(1000)).toBeNull();
  });

  it("o último guardado vence o anterior", () => {
    guardarCodigoParaCadastro("1111111111111", 1000);
    guardarCodigoParaCadastro("2222222222222", 1000);

    expect(tomarCodigoParaCadastro(1000)).toBe("2222222222222");
  });

  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["curto demais (3)", "123"],
    ["comprido demais (65)", "1".repeat(65)],
    ["com caractere que o campo não aceita", "7891234*567890"],
  ])("código %s não é entregue", (_nome, codigo) => {
    guardarCodigoParaCadastro(codigo, 1000);

    expect(tomarCodigoParaCadastro(1000)).toBeNull();
  });

  it("aceita os limites do formato (4 e 64) e letras com hífen", () => {
    guardarCodigoParaCadastro("1234", 1000);
    expect(tomarCodigoParaCadastro(1000)).toBe("1234");

    guardarCodigoParaCadastro("1".repeat(64), 1000);
    expect(tomarCodigoParaCadastro(1000)).toBe("1".repeat(64));

    guardarCodigoParaCadastro("AB-123", 1000);
    expect(tomarCodigoParaCadastro(1000)).toBe("AB-123");
  });
});
