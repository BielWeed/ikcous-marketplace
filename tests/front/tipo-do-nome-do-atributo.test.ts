// O tipo que o NOME gravado representa. O painel (peças do seletor) e a loja
// (ordem das fileiras) leem o nome pela mesma função; aqui ficam os dois tipos
// que passaram a ter peça própria: Capacidade (com os apelidos que o lojista
// já usa) e Material.
import { tipoDoNome } from "@/utils/atributos-da-variacao";
import { describe, expect, it } from "vitest";

describe("tipoDoNome — Capacidade e Material", () => {
  it("Capacidade, Armazenamento e Memória (com ou sem acento) são o mesmo tipo", () => {
    for (const nome of [
      "Capacidade",
      "capacidade",
      "CAPACIDADE",
      "Armazenamento",
      "armazenamento",
      "Memória",
      "memória",
      "Memoria",
      "MEMORIA",
      "  Memória  ",
    ]) {
      expect(tipoDoNome(nome), nome).toBe("Capacidade");
    }
  });

  it("Material ignora caixa, acento e espaço nas pontas", () => {
    for (const nome of ["Material", "material", " MATERIAL ", "Matérial"]) {
      expect(tipoDoNome(nome), nome).toBe("Material");
    }
  });

  it("só o nome INTEIRO conta: 'Memória RAM', 'Material do cabo' e as combinações legadas seguem Outro", () => {
    expect(tipoDoNome("Memória RAM")).toBe("Outro");
    expect(tipoDoNome("Material do cabo")).toBe("Outro");
    expect(tipoDoNome("Capacidade / Cor")).toBe("Outro");
    expect(tipoDoNome("Material / Tamanho")).toBe("Outro");
  });

  it("os tipos de antes não mudam, e vazio continua sendo 'nenhum'", () => {
    expect(tipoDoNome("")).toBeNull();
    expect(tipoDoNome("   ")).toBeNull();
    expect(tipoDoNome("Cor")).toBe("Cor");
    expect(tipoDoNome("tamanho")).toBe("Tamanho");
    expect(tipoDoNome("Voltagem")).toBe("Voltagem");
    expect(tipoDoNome("Estampa")).toBe("Outro");
  });
});
