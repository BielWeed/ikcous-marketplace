import { prepararTextoDeBuscaDoPainel } from "@/lib/texto-de-busca-do-painel";
import { describe, expect, it } from "vitest";

describe("texto de busca enviado ao ILIKE das RPCs do painel", () => {
  it("tira as pontas e colapsa espaços internos de texto colado", () => {
    expect(prepararTextoDeBuscaDoPainel("  Maria  Silva  ")).toBe(
      "Maria Silva",
    );
    expect(prepararTextoDeBuscaDoPainel("Maria\t\nSilva")).toBe("Maria Silva");
  });

  it.each([
    ["%", "\\%"],
    ["ana_silva@email.test", "ana\\_silva@email.test"],
    ["\\", "\\\\"],
    ["\\%_", "\\\\\\%\\_"],
  ])("trata %s como texto literal, não curinga", (entrada, esperado) => {
    expect(prepararTextoDeBuscaDoPainel(entrada)).toBe(esperado);
  });

  it("preserva texto normal, vazio e telefone com máscara", () => {
    for (const texto of [
      "Maria Silva",
      "",
      "(11) 99999-1234",
      "+55 (11) 99999-1234",
    ]) {
      expect(prepararTextoDeBuscaDoPainel(texto)).toBe(texto);
    }
  });
});
